// ── How an MCP server is described ───────────────────────────────────────────
//
// Shared rather than owned by the client, because the catalogue and the agent
// library both describe servers without ever speaking the protocol. Dragging
// the whole MCP client into a shared package for the sake of a type would make
// every consumer of the catalogue depend on a transport it never uses.

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
