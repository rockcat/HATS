import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolDefinition } from '../providers/types.js';
import { log } from '../util/logger.js';

export interface MCPServerConfigStdio {
  transport: 'stdio';
  command: string;       // e.g. 'npx'
  args?: string[];       // e.g. ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
  env?: Record<string, string>;
}

export interface MCPServerConfigSSE {
  transport: 'sse';
  url: string;           // e.g. 'http://localhost:3001/sse'
}

export interface MCPServerConfigHTTP {
  transport: 'http';
  url: string;           // e.g. 'https://service.googleapis.com/mcp/v1'
  /** Request headers. Values may use ${VAR_NAME} to interpolate env / credentials. */
  headers?: Record<string, string>;
}

export type MCPServerConfig = MCPServerConfigStdio | MCPServerConfigSSE | MCPServerConfigHTTP;

/** Replace ${VAR_NAME} placeholders in header values from the supplied variable map. */
export function interpolateHeaders(
  headers: Record<string, string>,
  vars: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    result[k] = v.replace(/\$\{([^}]+)\}/g, (_, name) => vars[name] ?? '');
  }
  return result;
}

export interface MCPServerDef {
  name: string;          // short identifier, used for tool namespacing
  config: MCPServerConfig;
  /** Per-tool argument key renames applied before calling the server.
   *  Maps toolName → { fromArgName: toArgName }.
   *  Use this to work around MCP servers whose advertised schema doesn't match their validator. */
  toolArgMappings?: Record<string, Record<string, string>>;
}

/**
 * Manages one MCP server connection.
 * Tools are exposed as ToolDefinitions with name prefix `mcp__<serverName>__<toolName>`.
 */
export class MCPClient {
  readonly serverName: string;
  private client: Client;
  private tools: ToolDefinition[] = [];
  private connected = false;
  private _def: MCPServerDef | null = null;

  constructor(serverName: string) {
    this.serverName = serverName;
    this.client = new Client({ name: 'hat-agent', version: '1.0.0' });
  }

  getDef(): MCPServerDef | null { return this._def; }

  async connect(config: MCPServerConfig, toolArgMappings?: Record<string, Record<string, string>>): Promise<void> {
    this._def = { name: this.serverName, config, toolArgMappings };
    let transport;
    if (config.transport === 'stdio') {
      transport = new StdioClientTransport({ command: config.command, args: config.args ?? [], env: config.env });
    } else if (config.transport === 'http') {
      const headers = config.headers
        ? interpolateHeaders(config.headers, process.env as Record<string, string>)
        : undefined;
      transport = new StreamableHTTPClientTransport(new URL(config.url), headers ? { requestInit: { headers } } : undefined);
    } else {
      transport = new SSEClientTransport(new URL(config.url));
    }

    await this.client.connect(transport);
    this.connected = true;
    await this.refreshTools();
    log.info(`[MCP] Connected to "${this.serverName}" (${this.tools.length} tools)`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.close();
    this.connected = false;
  }

  /** Returns tool definitions with namespaced names for use in CompletionRequest. */
  getToolDefinitions(): ToolDefinition[] {
    return this.tools;
  }

  /** Call a tool by its namespaced name. Returns result as string. */
  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<string> {
    const raw = await this.callToolRaw(namespacedName, args);
    const content = (raw.content as Array<{ type: string; text?: string }>) ?? [];
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n') || JSON.stringify(raw.content);
  }

  /** Call a tool and return the full MCP result object (content + isError). */
  async callToolRaw(namespacedName: string, args: Record<string, unknown>): Promise<Awaited<ReturnType<typeof this.client.callTool>>> {
    const toolName = this.stripNamespace(namespacedName);
    const mappings = this._def?.toolArgMappings?.[toolName];
    const resolvedArgs = mappings
      ? Object.fromEntries(Object.entries(args).map(([k, v]) => [mappings[k] ?? k, v]))
      : args;
    log.info(`[MCP] callTool "${toolName}" on server "${this.serverName}" args=${JSON.stringify(resolvedArgs)}`);
    let result: Awaited<ReturnType<typeof this.client.callTool>>;
    try {
      result = await this.client.callTool({ name: toolName, arguments: resolvedArgs });
    } catch (err) {
      log.error(`[MCP] callTool "${toolName}" threw:`, (err as Error).message, (err as Error).stack ?? '');
      throw err;
    }
    if (result.isError) {
      const errText = (result.content as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text').map(b => b.text ?? '').join('\n') || JSON.stringify(result.content);
      log.error(`[MCP] callTool "${toolName}" returned error:`, errText);
    }
    return result;
  }

  isMCPTool(namespacedName: string): boolean {
    return namespacedName.startsWith(`mcp__${this.serverName}__`);
  }

  private async refreshTools(): Promise<void> {
    const response = await this.client.listTools();
    this.tools = response.tools.map((t) => {
      const toolMappings = this._def?.toolArgMappings?.[t.name];
      let params: ToolDefinition['parameters'] = (t.inputSchema as ToolDefinition['parameters']) ?? {
        type: 'object',
        properties: {},
      };
      if (toolMappings) {
        // Reverse the mapping (toKey → fromKey) so the LLM always sees and uses the "from" key.
        // The forward mapping at call time then reliably converts it to what the server validates.
        const reverse: Record<string, string> = {};
        for (const [from, to] of Object.entries(toolMappings)) reverse[to] = from;
        const props: typeof params.properties = {};
        for (const [k, v] of Object.entries(params.properties)) props[reverse[k] ?? k] = v;
        params = {
          ...params,
          properties: props,
          ...(params.required ? { required: params.required.map(r => reverse[r] ?? r) } : {}),
        };
      }
      return {
        name: `mcp__${this.serverName}__${t.name}`,
        description: t.description ?? t.name,
        parameters: params,
      };
    });
  }

  private stripNamespace(namespacedName: string): string {
    return namespacedName.replace(`mcp__${this.serverName}__`, '');
  }
}
