import { MCPServerConfig } from './mcp-client.js';

export type MCPCategory = 'productivity' | 'files' | 'web' | 'data' | 'dev';

export interface MCPCatalogueEntry {
  id: string;
  name: string;
  description: string;
  category: MCPCategory;
  config: MCPServerConfig;
  envVars?: string[];   // env var names required by this server
  notes?: string;
}

/** Resolves env var placeholders in a config using process.env at connect time.
 *  Also patches command names for Windows (npx → npx.cmd, node → node stays as-is). */
export function resolveConfig(config: MCPServerConfig): MCPServerConfig {
  if (config.transport !== 'stdio') return config;

  // Resolve env vars
  const resolved: Record<string, string> = {};
  for (const [k] of Object.entries(config.env ?? {})) {
    resolved[k] = process.env[k] ?? '';
  }

  // On Windows, shell commands like npx need the .cmd extension when spawned directly
  let command = config.command;
  if (process.platform === 'win32' && (command === 'npx' || command === 'npm')) {
    command = command + '.cmd';
  }

  return {
    ...config,
    command,
    ...(Object.keys(resolved).length > 0 ? { env: resolved } : {}),
  };
}

export const MCP_CATALOGUE: MCPCatalogueEntry[] = [
  {
    id: 'kanban',
    name: 'Kanban Board',
    description: 'Built-in kanban board for ticket and task tracking',
    category: 'productivity',
    config: { transport: 'stdio', command: 'node', args: ['dist/mcp/kanban/server.js'] },
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, write, and list files in the project folder — sources/ for inputs, outputs/ for deliverables',
    category: 'files',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    // project dir is appended at runtime by resolveMCPConfig
  },
  {
    id: 'excel',
    name: 'Excel / Spreadsheets',
    description: 'Read and write Microsoft Excel (.xlsx) files — create sheets, edit cells, formulas, and charts',
    category: 'files',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@negokaz/excel-mcp-server'] },
  },
  {
    id: 'docx',
    name: 'Word / DOCX',
    description: 'Create and edit Microsoft Word (.docx) documents using structured JSON',
    category: 'files',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@docx-mcp/docx-mcp'] },
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: 'Generate PDF files from content — supports text, layout, tables, and Unicode. Save to outputs/ for deliverables',
    category: 'files',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@mcp-z/mcp-pdf'] },
  },
  {
    id: 'powerpoint',
    name: 'PowerPoint / PPTX',
    description: 'Create PowerPoint presentations — add slides, text, tables, shapes, and charts. Save .pptx to outputs/',
    category: 'files',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@pylogmonmcp/powerpoint-generator'] },
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave Search API — returns titles, URLs, and snippets',
    category: 'web',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '' } },
    envVars: ['BRAVE_API_KEY'],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent knowledge graph — agents can store and retrieve facts across sessions',
    category: 'productivity',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Search repos, read files, manage issues and pull requests',
    category: 'dev',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } },
    envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Run queries against a local SQLite database file',
    category: 'data',
    config: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-sqlite', '--db-path', './data.db'] },
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and inspect a PostgreSQL database',
    category: 'data',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { POSTGRES_CONNECTION_STRING: '' } },
    envVars: ['POSTGRES_CONNECTION_STRING'],
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer / Browser',
    description: 'Control a headless Chrome browser — navigate pages, take screenshots, fill forms',
    category: 'web',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Post messages and read channels in a Slack workspace',
    category: 'productivity',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' } },
    envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
  },
];
