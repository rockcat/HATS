import { MCPClient, MCPServerDef } from './mcp-client.js';
import { ToolDefinition } from '../providers/types.js';

/**
 * Holds all MCP server connections for a team.
 * Provides merged tool definitions and routes tool calls to the right server.
 */
export class MCPRegistry {
  private clients: Map<string, MCPClient> = new Map();

  async add(def: MCPServerDef): Promise<void> {
    const client = new MCPClient(def.name);
    await client.connect(def.config);
    this.clients.set(def.name, client);
  }

  has(name: string): boolean {
    return this.clients.has(name);
  }

  async disconnect(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;
    await client.disconnect();
    this.clients.delete(name);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map((c) => c.disconnect()));
    this.clients.clear();
  }

  /** All MCP tool definitions across all connected servers. */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.clients.values()).flatMap((c) => c.getToolDefinitions());
  }

  /** Tool definitions for a specific subset of servers (by server name/ID). */
  getToolsForServers(serverIds: string[]): ToolDefinition[] {
    return serverIds.flatMap((id) => this.clients.get(id)?.getToolDefinitions() ?? []);
  }

  /** Returns true if the tool name belongs to any registered MCP server. */
  isMCPTool(toolName: string): boolean {
    return Array.from(this.clients.values()).some((c) => c.isMCPTool(toolName));
  }

  /** Returns tools grouped by server name (for the UI tools panel). */
  getToolsByServer(): Array<{ server: string; tools: ToolDefinition[] }> {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      server: name,
      // Strip the mcp__server__ namespace prefix for display
      tools: client.getToolDefinitions().map((t) => ({
        ...t,
        name: t.name.replace(`mcp__${name}__`, ''),
      })),
    }));
  }

  /** Returns the server definitions for all connected servers (for snapshots). */
  getServerDefs(): MCPServerDef[] {
    return Array.from(this.clients.values())
      .map((c) => c.getDef())
      .filter((d): d is MCPServerDef => d !== null);
  }

  /** Route a namespaced tool call to the correct MCP server. */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const client = Array.from(this.clients.values()).find((c) => c.isMCPTool(toolName));
    if (!client) throw new Error(`No MCP server handles tool "${toolName}"`);
    return client.callTool(toolName, args);
  }
}
