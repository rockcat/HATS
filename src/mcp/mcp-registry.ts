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

  async disconnectAll(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map((c) => c.disconnect()));
    this.clients.clear();
  }

  /** All MCP tool definitions across all connected servers. */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.clients.values()).flatMap((c) => c.getToolDefinitions());
  }

  /** Returns true if the tool name belongs to any registered MCP server. */
  isMCPTool(toolName: string): boolean {
    return Array.from(this.clients.values()).some((c) => c.isMCPTool(toolName));
  }

  /** Route a namespaced tool call to the correct MCP server. */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const client = Array.from(this.clients.values()).find((c) => c.isMCPTool(toolName));
    if (!client) throw new Error(`No MCP server handles tool "${toolName}"`);
    return client.callTool(toolName, args);
  }
}
