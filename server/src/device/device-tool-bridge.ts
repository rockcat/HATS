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
import type { ToolDefinition, ToolOutcome } from '../providers/types.js';
import { rejectImage } from './image-store.js';
import { negotiate, sanitise } from './capabilities.js';
import type { DeviceCapabilities, Negotiated, RunnerCapabilities } from './capabilities.js';
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
  /** A picture the tool took, base64, for a model that can see. */
  image?: { mediaType: string; base64: string };
}

/** What a device tool produced. Same shape as any other tool result. */
export type DeviceOutcome = ToolOutcome;

interface Device {
  deviceId: string;
  /** Something a human can recognise in a log: "Paul's phone". */
  label: string;
  tools: DeviceToolSpec[];
  /** What it can do for itself, beyond the tools it offers. */
  capabilities: DeviceCapabilities;
  /** What the runner and this device settled on. */
  agreed: Negotiated;
  /** Registration order. A clock ties when two devices connect in the same
   *  millisecond, which is exactly what happens on a reconnect. */
  seq: number;
}

interface Pending {
  deviceId: string;
  tool: string;
  settle: (result: DeviceOutcome) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface DeviceToolBridgeOptions {
  /** How long to wait for a device before giving up. */
  timeoutMs?: number;
  /** Delivers a request to one device. Returns false when it could not be sent. */
  deliver: (deviceId: string, request: DeviceRequest) => boolean;
  /**
   * Keep an image the device sent, and say where it went.
   *
   * Optional: with no keeper the picture is still shown to the model, it
   * just cannot be referred back to once the thread moves on.
   */
  keepImage?: (tool: string, image: { mediaType: string; base64: string }) => Promise<string | null>;
  /**
   * What the runner can do itself, for devices that cannot.
   *
   * The runner's embedding model is canonical: it is the space the person
   * store is in, so a device may only embed if it runs that exact model.
   *
   * Read fresh on every registration rather than captured, because whether
   * the runner can embed is decided by a model that loads in the background
   * and a device may well register before it has.
   */
  runner?: RunnerCapabilities | (() => RunnerCapabilities);
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class DeviceToolBridge {
  private readonly devices = new Map<string, Device>();
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private readonly timeoutMs: number;
  private readonly deliver: DeviceToolBridgeOptions['deliver'];
  private readonly keepImage: DeviceToolBridgeOptions['keepImage'];
  private readonly runner: () => RunnerCapabilities;

  constructor(options: DeviceToolBridgeOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.deliver = options.deliver;
    this.keepImage = options.keepImage;
    const runner = options.runner ?? {};
    this.runner = typeof runner === 'function' ? runner : () => runner;
  }

  // ── Devices ────────────────────────────────────────────────────────────────

  /**
   * A device declares what it can do. Re-registering replaces the old list.
   *
   * Returns what was agreed, so the device learns where work will happen —
   * a phone that can embed faces needs telling whether the runner wants it
   * to, and with which model.
   */
  register(
    deviceId: string, tools: DeviceToolSpec[], label = 'device', capabilities?: unknown,
  ): Negotiated {
    const valid = tools.filter((t) => t.name?.trim());
    const declared = sanitise(capabilities);
    const agreed = negotiate(declared, this.runner());
    this.devices.set(deviceId, {
      deviceId, label, tools: valid, capabilities: declared, agreed, seq: ++this.seq,
    });
    log.info(`[Device] "${label}" offers ${valid.length} tool(s): ${valid.map((t) => t.name).join(', ')}`);
    if (agreed.faceEmbedding !== 'nowhere') {
      log.info(`[Device] "${label}" will embed faces on the ${agreed.faceEmbedding}`
        + ` (${agreed.faceModel?.model})`);
    }
    return agreed;
  }

  /** What a connected device can do, for code deciding how to do a job. */
  capabilitiesOf(deviceId: string): DeviceCapabilities | undefined {
    return this.devices.get(deviceId)?.capabilities;
  }

  /** What was agreed with a connected device. */
  agreementWith(deviceId: string): Negotiated | undefined {
    return this.devices.get(deviceId)?.agreed;
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

  connected(): Array<{
    deviceId: string; label: string; tools: string[];
    capabilities: DeviceCapabilities; agreed: Negotiated;
  }> {
    return [...this.devices.values()].map((d) => ({
      deviceId: d.deviceId, label: d.label, tools: d.tools.map((t) => t.name),
      capabilities: d.capabilities, agreed: d.agreed,
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
  call(name: string, args: Record<string, unknown> = {}): Promise<DeviceOutcome> {
    const tool = this.bare(name);
    const device = this.deviceFor(tool);
    if (!device) {
      return Promise.resolve({
        text: `No connected device offers "${tool}". The user's device may be offline or may not have granted permission.`,
      });
    }

    const id = randomUUID();
    const request: DeviceRequest = {
      id,
      tool,
      arguments: args,
      expiresAt: new Date(Date.now() + this.timeoutMs).toISOString(),
    };

    return new Promise<DeviceOutcome>((settle) => {
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
    const call = this.pending.get(id);
    if (!call) return false;

    if (!result.ok) {
      this.resolve(id, { text: `The device could not do that: ${result.error ?? 'no reason given'}` });
      return true;
    }

    const image = result.image;
    const text = result.result ?? (image ? 'Here is the picture.' : 'Done.');
    if (!image) { this.resolve(id, { text }); return true; }

    // An image we cannot pass on costs the picture, not the answer: an
    // oversized one would otherwise fail the whole model request.
    const refusal = rejectImage(image);
    if (refusal) {
      this.resolve(id, { text: `${text}

${refusal}` });
      return true;
    }

    // Keeping it is best-effort and must not cost the agent the picture:
    // a full disk is a reason to lose the copy, not the answer.
    const settleWith = (path: string | null) => {
      this.resolve(id, {
        text: path ? `${text}

Kept at ${path}.` : text,
        images: [{ mediaType: image.mediaType, base64: image.base64, ...(path ? { path } : {}) }],
      });
    };

    if (!this.keepImage) { settleWith(null); return true; }
    this.keepImage(call.tool, image)
      .then(settleWith)
      .catch((err) => {
        log.warn(`[Device] Could not keep the image from "${call.tool}": ${(err as Error).message}`);
        settleWith(null);
      });
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

  private resolve(id: string, outcome: DeviceOutcome | string): void {
    const call = this.pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(id);
    call.settle(typeof outcome === 'string' ? { text: outcome } : outcome);
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
