import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
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

export type MCPServerConfig = MCPServerConfigStdio | MCPServerConfigSSE;

export interface MCPServerDef {
  name: string;          // short identifier, used for tool namespacing
  config: MCPServerConfig;
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

  async connect(config: MCPServerConfig): Promise<void> {
    this._def = { name: this.serverName, config };
    const transport = config.transport === 'stdio'
      ? new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: config.env,
        })
      : new SSEClientTransport(new URL(config.url));

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
    const toolName = this.stripNamespace(namespacedName);
    const result = await this.client.callTool({ name: toolName, arguments: args });

    // MCP tool results are arrays of content blocks
    const content = (result.content as Array<{ type: string; text?: string }>) ?? [];
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('\n') || JSON.stringify(result.content);
  }

  isMCPTool(namespacedName: string): boolean {
    return namespacedName.startsWith(`mcp__${this.serverName}__`);
  }

  private async refreshTools(): Promise<void> {
    const response = await this.client.listTools();
    this.tools = response.tools.map((t) => ({
      name: `mcp__${this.serverName}__${t.name}`,
      description: t.description ?? t.name,
      parameters: (t.inputSchema as ToolDefinition['parameters']) ?? {
        type: 'object',
        properties: {},
      },
    }));
  }

  private stripNamespace(namespacedName: string): string {
    return namespacedName.replace(`mcp__${this.serverName}__`, '');
  }
}
