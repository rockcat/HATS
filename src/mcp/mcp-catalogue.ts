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
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Search LinkedIn profiles and jobs, retrieve profile details, and message connections',
    category: 'web',
    config: { transport: 'stdio', command: 'node', args: ['linkedin-mcpserver/build/index.js'], env: { LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '' } },
    envVars: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    notes: 'Requires manual setup: git clone https://github.com/felipfr/linkedin-mcpserver, then npm install && npm run build inside the cloned folder. Place the folder alongside this project. Create a LinkedIn app at https://www.linkedin.com/developers/apps to obtain credentials.',
  },
  {
    id: 'email-imap',
    name: 'Email (IMAP / SMTP)',
    description: 'Read, search, compose, send, and manage email via IMAP and SMTP — works with Gmail, Outlook, and any standard mail server',
    category: 'productivity',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@codefuturist/email-mcp'], env: { MCP_EMAIL_ADDRESS: '', MCP_EMAIL_PASSWORD: '', MCP_EMAIL_IMAP_HOST: '', MCP_EMAIL_SMTP_HOST: '' } },
    envVars: ['MCP_EMAIL_ADDRESS', 'MCP_EMAIL_PASSWORD', 'MCP_EMAIL_IMAP_HOST', 'MCP_EMAIL_SMTP_HOST'],
    notes: 'Run "npx @codefuturist/email-mcp setup" for a guided wizard that auto-detects server settings. For Gmail use an App Password (not your main password) and set IMAP host to imap.gmail.com, SMTP host to smtp.gmail.com.',
  },
  {
    id: 'email-pop3',
    name: 'Email (POP3 / SMTP)',
    description: 'Read and delete email via POP3, send via SMTP — use this when your mail provider supports POP3 but not IMAP',
    category: 'productivity',
    config: { transport: 'stdio', command: 'uvx', args: ['--from', 'git+https://github.com/ptbsare/email-mcp-server.git', 'email-mcp-server'], env: { EMAIL_USER: '', EMAIL_PASS: '', POP3_SERVER: '', POP3_PORT: '995' } },
    envVars: ['EMAIL_USER', 'EMAIL_PASS', 'POP3_SERVER'],
    notes: 'Requires Python 3.12+ and uv (install uv with: pip install uv). No npm package exists for POP3 — this runs a Python-based server via uvx. For Gmail set POP3_SERVER=pop.gmail.com and use an App Password.',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'List, create, update, delete and respond to Google Calendar events across all your calendars',
    category: 'productivity',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@cocal/google-calendar-mcp'], env: { GOOGLE_OAUTH_CREDENTIALS: '' } },
    envVars: ['GOOGLE_OAUTH_CREDENTIALS'],
    notes: 'GOOGLE_OAUTH_CREDENTIALS should be the file path to your OAuth 2.0 JSON key (e.g. /path/to/gcp-oauth.keys.json). To obtain it: create a project in Google Cloud Console, enable the Calendar API, create an OAuth 2.0 "Desktop app" credential, and download the JSON file. A browser OAuth consent flow runs on first use; tokens are cached locally.',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    description: 'Access Outlook calendar, email, OneDrive, Teams, Contacts, and more via the Microsoft Graph API — works with personal, work, and school Microsoft accounts',
    category: 'productivity',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@softeria/ms-365-mcp-server'] },
    notes: 'No credentials needed to get started — the server has a built-in Azure app registration. On first use call the "login" tool and follow the device-code flow printed to the terminal. For org/work accounts add --org-mode to the args. Optionally supply MS365_MCP_CLIENT_ID and MS365_MCP_TENANT_ID env vars to use your own Azure app registration.',
  },
  {
    id: 'whatsapp-periskope',
    name: 'WhatsApp (Periskope)',
    description: 'Send and receive WhatsApp messages, manage chats and contacts — uses the Periskope managed API (requires a Periskope account)',
    category: 'productivity',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@periskope/whatsapp-mcp'], env: { PERISKOPE_API_KEY: '', PERISKOPE_PHONE_ID: '' } },
    envVars: ['PERISKOPE_API_KEY', 'PERISKOPE_PHONE_ID'],
    notes: 'Sign up at console.periskope.app, connect your WhatsApp number, then find your API key and Phone ID under Settings → API settings.',
  },
  {
    id: 'whatsapp-web',
    name: 'WhatsApp Web (personal)',
    description: 'Send and receive WhatsApp messages using your personal account via WhatsApp Web automation — scan a QR code once to authenticate',
    category: 'productivity',
    config: { transport: 'stdio', command: 'npx', args: ['-y', 'wweb-mcp', '--mode', 'mcp', '--transport', 'command'] },
    notes: 'Uses WhatsApp Web browser automation (unofficial). On first run, scan the QR code printed to the terminal. Session is persisted locally. Note: WhatsApp does not officially support automation on personal accounts.',
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'Post tweets and search Twitter/X — requires a Twitter Developer account and OAuth credentials',
    category: 'web',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@enescinar/twitter-mcp'], env: { API_KEY: '', API_SECRET_KEY: '', ACCESS_TOKEN: '', ACCESS_TOKEN_SECRET: '' } },
    envVars: ['API_KEY', 'API_SECRET_KEY', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'],
    notes: 'Create a developer app at developer.twitter.com and generate OAuth 1.0a keys under "Keys and Tokens". Posting requires at least the Basic tier ($100/month). Search is available on the Free tier.',
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'Publish posts, read your timeline, search Threads, and view analytics — uses the official Meta Threads API',
    category: 'web',
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@mikusnuz/meta-mcp'], env: { THREADS_ACCESS_TOKEN: '', THREADS_USER_ID: '' } },
    envVars: ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID'],
    notes: 'Create an app at developers.facebook.com, add the Threads API product, and generate an OAuth access token. Your user ID can be found via the Threads API /me endpoint.',
  },
];
