/**
 * Tools that run on the user's device rather than on the runner.
 *
 * Every other tool an agent has executes here: a built-in, or an MCP server
 * this process spawned. A camera does not work that way. It is on a phone, and
 * a server-side process has no route to it — which is why "an MCP server for
 * the webcam" cannot be built as such.
 *
 * So the call is inverted. The agent calls the tool as normal; the bridge turns
 * that into a request, hands it to the device over the event stream it is
 * already listening on, and waits. The device does the work and posts the
 * answer back against the request's id.
 *
 * Three things this has to get right, because an agent is a poor judge of any
 * of them:
 *
 *  * **Timeouts.** A phone in a pocket never answers. The agent must be told
 *    that, in time, rather than waiting for ever.
 *  * **Honest capabilities.** Only tools a connected device actually declared
 *    are offered. An agent given a tool that always fails will keep trying it.
 *  * **Correlation.** Answers arrive out of band and possibly out of order.
 */

import { randomUUID } from 'crypto';
import type { ToolDefinition } from '../providers/types.js';
import { log } from '../util/logger.js';

/** The prefix that marks a tool as living on a device, as `mcp__` marks MCP. */
export const DEVICE_PREFIX = 'device__';

/** How a device describes one thing it can do. Mirrors ToolDefinition. */
export interface DeviceToolSpec {
  /** Bare name, e.g. `take_photo`. Namespaced by the bridge. */
  name: string;
  description: string;
  parameters?: ToolDefinition['parameters'];
}

/** What the device is asked to do. Carried to it on the event stream. */
export interface DeviceRequest {
  id: string;
  /** Bare tool name — the device never sees the namespace. */
  tool: string;
  arguments: Record<string, unknown>;
  /** ISO instant after which the runner stops waiting. */
  expiresAt: string;
}

/** What the device sends back. */
export interface DeviceResult {
  ok: boolean;
  /** Whatever the tool produced, as the agent should read it. */
  result?: string;
  error?: string;
}

interface Device {
  deviceId: string;
  /** Something a human can recognise in a log: "Paul's phone". */
  label: string;
  tools: DeviceToolSpec[];
  /** Registration order. A clock ties when two devices connect in the same
   *  millisecond, which is exactly what happens on a reconnect. */
  seq: number;
}

interface Pending {
  deviceId: string;
  tool: string;
  settle: (result: string) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DeviceToolBridgeOptions {
  /** How long to wait for a device before giving up. */
  timeoutMs?: number;
  /** Delivers a request to one device. Returns false when it could not be sent. */
  deliver: (deviceId: string, request: DeviceRequest) => boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class DeviceToolBridge {
  private readonly devices = new Map<string, Device>();
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private readonly timeoutMs: number;
  private readonly deliver: DeviceToolBridgeOptions['deliver'];

  constructor(options: DeviceToolBridgeOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.deliver = options.deliver;
  }

  // ── Devices ────────────────────────────────────────────────────────────────

  /** A device declares what it can do. Re-registering replaces the old list. */
  register(deviceId: string, tools: DeviceToolSpec[], label = 'device'): void {
    const valid = tools.filter((t) => t.name?.trim());
    this.devices.set(deviceId, { deviceId, label, tools: valid, seq: ++this.seq });
    log.info(`[Device] "${label}" offers ${valid.length} tool(s): ${valid.map((t) => t.name).join(', ')}`);
  }

  /**
   * A device has gone. Anything it was asked and never answered is failed now
   * rather than left to time out — the agent can act on a clear answer sooner.
   */
  unregister(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (!device) return;
    this.devices.delete(deviceId);
    for (const [id, call] of [...this.pending]) {
      if (call.deviceId !== deviceId) continue;
      this.resolve(id, `The device went offline before answering "${call.tool}".`);
    }
    log.info(`[Device] "${device.label}" disconnected`);
  }

  connected(): Array<{ deviceId: string; label: string; tools: string[] }> {
    return [...this.devices.values()].map((d) => ({
      deviceId: d.deviceId, label: d.label, tools: d.tools.map((t) => t.name),
    }));
  }

  // ── What the model is offered ──────────────────────────────────────────────

  /**
   * Tool definitions for every connected device, namespaced and de-duplicated.
   *
   * Nothing is offered when no device is connected: a tool that cannot possibly
   * work is worse than an absent one, because the agent will keep calling it.
   */
  toolDefinitions(): ToolDefinition[] {
    const byName = new Map<string, ToolDefinition>();
    for (const device of this.sortedDevices()) {
      for (const tool of device.tools) {
        const name = DEVICE_PREFIX + tool.name;
        if (byName.has(name)) continue;
        byName.set(name, {
          name,
          description: tool.description,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
        });
      }
    }
    return [...byName.values()];
  }

  isDeviceTool(name: string): boolean {
    return name.startsWith(DEVICE_PREFIX) && this.deviceFor(this.bare(name)) !== null;
  }

  // ── Calling ────────────────────────────────────────────────────────────────

  /**
   * Ask a device to run a tool and wait for the answer.
   *
   * Always resolves — never rejects. A tool result is a string the agent reads,
   * and "the device did not answer" is a useful answer; an exception is not.
   */
  call(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const tool = this.bare(name);
    const device = this.deviceFor(tool);
    if (!device) {
      return Promise.resolve(
        `No connected device offers "${tool}". The user's device may be offline or may not have granted permission.`,
      );
    }

    const id = randomUUID();
    const request: DeviceRequest = {
      id,
      tool,
      arguments: args,
      expiresAt: new Date(Date.now() + this.timeoutMs).toISOString(),
    };

    return new Promise<string>((settle) => {
      const timer = setTimeout(() => {
        this.resolve(id, `The device did not answer "${tool}" within ${Math.round(this.timeoutMs / 1000)}s.`);
      }, this.timeoutMs);
      timer.unref?.();

      this.pending.set(id, { deviceId: device.deviceId, tool, settle, timer });

      // Delivery is attempted after the call is pending, so an answer that
      // somehow arrives first still finds something to settle.
      if (!this.deliver(device.deviceId, request)) {
        this.resolve(id, `Could not reach the device to run "${tool}".`);
      }
    });
  }

  /**
   * The device has answered. Returns false when nothing was waiting — a late
   * reply after a timeout, or a result for a request this runner never made.
   */
  settleResult(id: string, result: DeviceResult): boolean {
    if (!this.pending.has(id)) return false;
    const text = result.ok
      ? (result.result ?? 'Done.')
      : `The device could not do that: ${result.error ?? 'no reason given'}`;
    this.resolve(id, text);
    return true;
  }

  /** Give up on everything in flight — the runner is shutting down. */
  close(): void {
    for (const id of [...this.pending.keys()]) {
      this.resolve(id, 'The runner stopped before the device answered.');
    }
    this.devices.clear();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private resolve(id: string, text: string): void {
    const call = this.pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(id);
    call.settle(text);
  }

  private bare(name: string): string {
    return name.startsWith(DEVICE_PREFIX) ? name.slice(DEVICE_PREFIX.length) : name;
  }

  /** Most recently registered wins, so the phone in your hand answers. */
  private deviceFor(tool: string): Device | null {
    return this.sortedDevices().find((d) => d.tools.some((t) => t.name === tool)) ?? null;
  }

  private sortedDevices(): Device[] {
    return [...this.devices.values()].sort((a, b) => b.seq - a.seq);
  }
}
