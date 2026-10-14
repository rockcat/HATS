import { writeFile, mkdir, rename } from 'fs/promises';
import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { DiscoveredTool, MCPCatalogueEntry } from './mcp-catalogue.js';
import { builtin } from './builtin-server.js';

// All built-in entries serialised as plain JSON-compatible objects.
// Uses ~/ prefix for home-directory paths (expanded by resolveConfig at connect time).
export const BUILTIN_CATALOGUE: MCPCatalogueEntry[] = [
  {
    id: 'kanban',
    name: 'Kanban Board',
    description: 'Built-in kanban board for ticket and task tracking',
    category: 'productivity',
    users: ['human'],
    config: { transport: 'stdio', command: 'node', args: [builtin('mcp/kanban/server')] },
  },
  {
    id: 'calendar',
    name: 'Calendar',
    description: 'A diary of its own for each agent — meetings, free/busy, and invitations by email',
    category: 'productivity',
    // Per agent rather than shared: the point is that each one knows what it
    // has agreed to. A team instance would be one diary for everybody.
    users: ['agent'],
    config: {
      transport: 'stdio', command: 'node', args: [builtin('calendar/server')],
      // Beside its memory, for the same reason: one agent, one directory.
      env: { CALENDAR_FILE_PATH: '{AGENT_DIR}/calendar.ics' },
    },
    notes: 'Invitations need an email account. Set up the Email (IMAP / SMTP) server for this '
      + 'agent and the calendar borrows its settings — there is nothing to enter twice.',
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read, write, and list files in the project folder — sources/ for inputs, outputs/ for deliverables',
    category: 'files',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'excel',
    name: 'Excel / Spreadsheets',
    description: 'Read and write Microsoft Excel (.xlsx) files — create sheets, edit cells, formulas, and charts',
    category: 'files',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@negokaz/excel-mcp-server'] },
    url: 'https://github.com/negokaz/excel-mcp-server',
  },
  {
    id: 'docx',
    name: 'Word / DOCX',
    description: 'Create and edit Microsoft Word (.docx) documents using structured JSON',
    category: 'files',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@docx-mcp/docx-mcp'] },
    url: 'https://www.npmjs.com/package/@docx-mcp/docx-mcp',
  },
  {
    id: 'pdf',
    name: 'PDF',
    description: 'Generate PDF files from content — supports text, layout, tables, and Unicode. Save to outputs/ for deliverables',
    category: 'files',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@mcp-z/mcp-pdf'] },
    url: 'https://www.npmjs.com/package/@mcp-z/mcp-pdf',
  },
  {
    id: 'powerpoint',
    name: 'PowerPoint / PPTX',
    description: 'Create PowerPoint presentations — add slides, text, tables, shapes, and charts. Save .pptx to outputs/',
    category: 'files',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@pylogmonmcp/powerpoint-generator'] },
    url: 'https://www.npmjs.com/package/@pylogmonmcp/powerpoint-generator',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave Search API — returns titles, URLs, and snippets',
    category: 'web',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '' } },
    envVars: ['BRAVE_API_KEY'],
    url: 'https://brave.com/search/api/',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent knowledge graph — facts an agent keeps across sessions',
    category: 'productivity',
    // Both: as a team server it is a shared graph, as a personal one each
    // agent keeps its own. The file path is what tells them apart.
    users: ['human', 'agent'],
    config: {
      transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'],
      // Without this the server writes inside its npx cache directory, so
      // every agent and every project shared one graph nobody could find.
      env: { MEMORY_FILE_PATH: '{AGENT_DIR}/memory.json' },
    },
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Search repos, read files, manage issues and pull requests',
    category: 'dev',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' } },
    envVars: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Run queries against a local SQLite database file',
    category: 'data',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sqlite', './data.db'] },
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query and inspect a PostgreSQL database',
    category: 'data',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres'], env: { POSTGRES_CONNECTION_STRING: '' } },
    envVars: ['POSTGRES_CONNECTION_STRING'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer / Browser',
    description: 'Control a headless Chrome browser — navigate pages, take screenshots, fill forms',
    category: 'web',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] },
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Post messages and read channels in a Slack workspace',
    category: 'productivity',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-slack'], env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' } },
    envVars: ['SLACK_BOT_TOKEN', 'SLACK_TEAM_ID'],
    url: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    description: 'Search LinkedIn profiles and jobs, retrieve profile details, and message connections',
    category: 'web',
    users: ['human'],
    config: { transport: 'stdio', command: 'node', args: ['linkedin-mcpserver/build/index.js'], env: { LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '' } },
    envVars: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    notes: 'Requires manual setup: git clone https://github.com/felipfr/linkedin-mcpserver, then npm install && npm run build inside the cloned folder. Place the folder alongside this project. Create a LinkedIn app at https://www.linkedin.com/developers/apps to obtain credentials.',
    url: 'https://github.com/felipfr/linkedin-mcpserver',
  },
  {
    id: 'email-imap',
    name: 'Email (IMAP / SMTP)',
    description: 'Read, search, compose, send, and manage email via IMAP and SMTP — works with Gmail, Outlook, and any standard mail server',
    category: 'productivity',
    users: ['agent'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@codefuturist/email-mcp'], env: { MCP_EMAIL_ADDRESS: '', MCP_EMAIL_PASSWORD: '', MCP_EMAIL_IMAP_HOST: '', MCP_EMAIL_SMTP_HOST: '' } },
    envVars: [
      { name: 'MCP_EMAIL_ADDRESS',                  placeholder: 'required — email address' },
      { name: 'MCP_EMAIL_PASSWORD',                  placeholder: 'required — password or app password' },
      { name: 'MCP_EMAIL_IMAP_HOST',                 placeholder: 'required — IMAP server hostname' },
      { name: 'MCP_EMAIL_SMTP_HOST',                 placeholder: 'required — SMTP server hostname' },
      { name: 'MCP_EMAIL_ACCOUNT_NAME',              placeholder: 'default — account name' },
      { name: 'MCP_EMAIL_FULL_NAME',                 placeholder: 'display name' },
      { name: 'MCP_EMAIL_USERNAME',                  placeholder: 'default: email address' },
      { name: 'MCP_EMAIL_IMAP_PORT',                 placeholder: '993' },
      { name: 'MCP_EMAIL_IMAP_TLS',                  placeholder: 'true' },
      { name: 'MCP_EMAIL_SMTP_PORT',                 placeholder: '465' },
      { name: 'MCP_EMAIL_SMTP_TLS',                  placeholder: 'true' },
      { name: 'MCP_EMAIL_SMTP_STARTTLS',             placeholder: 'false' },
      { name: 'MCP_EMAIL_SMTP_VERIFY_SSL',           placeholder: 'true' },
      { name: 'MCP_EMAIL_SMTP_POOL_ENABLED',         placeholder: 'true' },
      { name: 'MCP_EMAIL_SMTP_POOL_MAX_CONNECTIONS', placeholder: '1' },
      { name: 'MCP_EMAIL_SMTP_POOL_MAX_MESSAGES',    placeholder: '100' },
      { name: 'MCP_EMAIL_RATE_LIMIT',                placeholder: '10' },
    ],
    notes: 'Run "npx @codefuturist/email-mcp setup" for a guided wizard that auto-detects server settings. For Gmail use an App Password (not your main password) and set IMAP host to imap.gmail.com, SMTP host to smtp.gmail.com.',
    url: 'https://www.npmjs.com/package/@codefuturist/email-mcp',
    // The package advertises "id" in its schema but validates against "emailId" internally.
    toolArgMappings: { 'get_email': { 'id': 'emailId' } },
  },
  {
    id: 'email-pop3',
    name: 'Email (POP3 / SMTP)',
    description: 'Read and delete email via POP3, send via SMTP — use this when your mail provider supports POP3 but not IMAP',
    category: 'productivity',
    users: ['agent'],
    config: { transport: 'stdio', command: 'uvx', args: ['--from', 'git+https://github.com/ptbsare/email-mcp-server.git', 'email-mcp-server'], env: { EMAIL_USER: '', EMAIL_PASS: '', POP3_SERVER: '', POP3_PORT: '995', SMTP_SERVER: '', SMTP_PORT: '587', SMTP_USE_SSL: 'false' } },
    envVars: ['EMAIL_USER', 'EMAIL_PASS', 'POP3_SERVER', 'SMTP_SERVER', 'SMTP_PORT', 'SMTP_USE_SSL'],
    notes: 'Requires Python 3.12+ and uv (install uv with: pip install uv). No npm package exists for POP3 — this runs a Python-based server via uvx. For Gmail set POP3_SERVER=pop.gmail.com and use an App Password.',
    url: 'https://github.com/ptbsare/email-mcp-server',
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365',
    description: 'Access Outlook calendar, email, OneDrive, Teams, Contacts, and more via the Microsoft Graph API — works with personal, work, and school Microsoft accounts',
    category: 'productivity',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@softeria/ms-365-mcp-server'] },
    notes: 'No credentials needed to get started — the server has a built-in Azure app registration. On first use call the "login" tool and follow the device-code flow printed to the terminal. For org/work accounts add --org-mode to the args. Optionally supply MS365_MCP_CLIENT_ID and MS365_MCP_TENANT_ID env vars to use your own Azure app registration.',
    url: 'https://github.com/softeria/ms-365-mcp-server',
  },
  {
    id: 'whatsapp-periskope',
    name: 'WhatsApp (Periskope)',
    description: 'Send and receive WhatsApp messages, manage chats and contacts — uses the Periskope managed API (requires a Periskope account)',
    category: 'productivity',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@periskope/whatsapp-mcp'], env: { PERISKOPE_API_KEY: '', PERISKOPE_PHONE_ID: '' } },
    envVars: ['PERISKOPE_API_KEY', 'PERISKOPE_PHONE_ID'],
    notes: 'Sign up at console.periskope.app, connect your WhatsApp number, then find your API key and Phone ID under Settings → API settings.',
    url: 'https://www.npmjs.com/package/@periskope/whatsapp-mcp',
  },
  {
    id: 'whatsapp-web',
    name: 'WhatsApp Web (personal)',
    description: 'Send and receive WhatsApp messages using your personal account via WhatsApp Web automation — scan a QR code once to authenticate',
    category: 'productivity',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', 'wweb-mcp', '--mode', 'mcp', '--transport', 'command'] },
    notes: 'Uses WhatsApp Web browser automation (unofficial). On first run, scan the QR code printed to the terminal. Session is persisted locally. Note: WhatsApp does not officially support automation on personal accounts.',
    url: 'https://www.npmjs.com/package/wweb-mcp',
  },
  {
    id: 'twitter',
    name: 'Twitter / X',
    description: 'Post tweets and search Twitter/X — requires a Twitter Developer account and OAuth credentials',
    category: 'web',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@enescinar/twitter-mcp'], env: { API_KEY: '', API_SECRET_KEY: '', ACCESS_TOKEN: '', ACCESS_TOKEN_SECRET: '' } },
    envVars: ['API_KEY', 'API_SECRET_KEY', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET'],
    notes: 'Create a developer app at developer.twitter.com and generate OAuth 1.0a keys under "Keys and Tokens". Posting requires at least the Basic tier ($100/month). Search is available on the Free tier.',
    url: 'https://developer.twitter.com/en/portal/dashboard',
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'Publish posts, read your timeline, search Threads, and view analytics — uses the official Meta Threads API',
    category: 'web',
    users: ['human'],
    config: { transport: 'stdio', command: 'npx', args: ['-y', '@mikusnuz/meta-mcp'], env: { THREADS_ACCESS_TOKEN: '', THREADS_USER_ID: '' } },
    envVars: ['THREADS_ACCESS_TOKEN', 'THREADS_USER_ID'],
    notes: 'Create an app at developers.facebook.com, add the Threads API product, and generate an OAuth access token. Your user ID can be found via the Threads API /me endpoint.',
    url: 'https://developers.facebook.com/docs/threads',
  },

  // ── Google Workspace — Gemini CLI extension (stdio, per-agent feature config) ──

  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Access Gmail, Drive, Calendar, Chat, Contacts, Docs, Sheets, Slides, and Tasks via the Gemini CLI extension',
    category: 'productivity',
    users: ['human', 'agent'],
    config: {
      transport: 'stdio',
      command: 'node',
      args: ['~/.gemini/extensions/google-workspace/dist/index.js'],
      env: { WORKSPACE_FEATURE_OVERRIDES: '' },
    },
    envVars: [
      {
        name: 'WORKSPACE_FEATURE_OVERRIDES',
        type: 'features',
        features: [
          { key: 'docs.read',      label: 'Docs (read)',          defaultOn: true  },
          { key: 'docs.write',     label: 'Docs (write)',         defaultOn: true  },
          { key: 'drive.read',     label: 'Drive (read)',         defaultOn: true  },
          { key: 'drive.write',    label: 'Drive (write)',        defaultOn: true  },
          { key: 'calendar.read',  label: 'Calendar (read)',      defaultOn: true  },
          { key: 'calendar.write', label: 'Calendar (write)',     defaultOn: true  },
          { key: 'gmail.read',     label: 'Gmail (read)',         defaultOn: true  },
          { key: 'gmail.write',    label: 'Gmail (write)',        defaultOn: true  },
          { key: 'chat.read',      label: 'Chat (read)',          defaultOn: true  },
          { key: 'chat.write',     label: 'Chat (write)',         defaultOn: true  },
          { key: 'people.read',    label: 'Contacts (read)',      defaultOn: true  },
          { key: 'slides.read',    label: 'Slides (read)',        defaultOn: true  },
          { key: 'slides.write',   label: 'Slides (write)',       defaultOn: false },
          { key: 'sheets.read',    label: 'Sheets (read)',        defaultOn: true  },
          { key: 'sheets.write',   label: 'Sheets (write)',       defaultOn: false },
          { key: 'tasks.read',     label: 'Tasks (read)',         defaultOn: false },
          { key: 'tasks.write',    label: 'Tasks (write)',        defaultOn: false },
          { key: 'time.read',      label: 'Work Hours (read)',    defaultOn: true  },
        ],
      },
    ],
    notes: 'Requires the Gemini CLI with the workspace extension. Install with: gemini extensions install https://github.com/gemini-cli-extensions/workspace — then authenticate by running: gemini',
    url: 'https://github.com/gemini-cli-extensions/workspace',
  },

  // ── Google Workspace — shared (human's account, env var token) ────────────

  {
    id: 'google-gmail',
    name: 'Google Gmail',
    description: 'Read, search, send, and manage Gmail messages and threads — uses the shared team account',
    category: 'productivity',
    users: ['human'],
    config: {
      transport: 'http',
      url: 'https://gmailmcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_ACCESS_TOKEN}' },
    },
    notes: 'Authenticate via the Google Connect button in the MCP settings. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables (Google Cloud OAuth 2.0 credentials).',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Read, create, update, and delete Google Calendar events and schedules — uses the shared team account',
    category: 'productivity',
    users: ['human'],
    config: {
      transport: 'http',
      url: 'https://calendarmcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_ACCESS_TOKEN}' },
    },
    notes: 'Authenticate via the Google Connect button in the MCP settings. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Browse, upload, download, and manage files and folders in Google Drive — uses the shared team account',
    category: 'productivity',
    users: ['human'],
    config: {
      transport: 'http',
      url: 'https://drivemcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_ACCESS_TOKEN}' },
    },
    notes: 'Authenticate via the Google Connect button in the MCP settings. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-chat',
    name: 'Google Chat',
    description: 'Send messages and manage spaces and threads in Google Chat — uses the shared team account',
    category: 'productivity',
    users: ['human'],
    config: {
      transport: 'http',
      url: 'https://chatmcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_ACCESS_TOKEN}' },
    },
    notes: 'Authenticate via the Google Connect button in the MCP settings. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-contacts',
    name: 'Google Contacts',
    description: 'Look up and manage contacts and directory information via the Google People API — uses the shared team account',
    category: 'productivity',
    users: ['human'],
    config: {
      transport: 'http',
      url: 'https://people.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_ACCESS_TOKEN}' },
    },
    notes: 'Authenticate via the Google Connect button in the MCP settings. Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },

  // ── Google Workspace — personal (per-agent account) ────────────────────────

  {
    id: 'google-gmail-personal',
    name: 'Google Gmail (mine)',
    description: 'Read, search, send, and manage Gmail messages — uses this agent\'s own Google account',
    category: 'productivity',
    users: ['agent'],
    config: {
      transport: 'http',
      url: 'https://gmailmcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_GMAIL_ACCESS_TOKEN}' },
    },
    envVars: [{ name: 'GOOGLE_GMAIL_ACCESS_TOKEN', placeholder: 'required — OAuth2 access token for this agent\'s account' }],
    notes: 'Each agent stores their own token. OAuth scope: gmail.modify. Get a token via "gcloud auth print-access-token" or the Google OAuth 2.0 Playground. Tokens expire after 1 hour.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-calendar-personal',
    name: 'Google Calendar (mine)',
    description: 'Read, create, update, and delete Google Calendar events — uses this agent\'s own Google account',
    category: 'productivity',
    users: ['agent'],
    config: {
      transport: 'http',
      url: 'https://calendarmcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_CALENDAR_ACCESS_TOKEN}' },
    },
    envVars: [{ name: 'GOOGLE_CALENDAR_ACCESS_TOKEN', placeholder: 'required — OAuth2 access token for this agent\'s account' }],
    notes: 'Each agent stores their own token. OAuth scope: calendar. Get a token via "gcloud auth print-access-token" or the Google OAuth 2.0 Playground.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-drive-personal',
    name: 'Google Drive (mine)',
    description: 'Browse, upload, download, and manage files in Google Drive — uses this agent\'s own Google account',
    category: 'productivity',
    users: ['agent'],
    config: {
      transport: 'http',
      url: 'https://drivemcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_DRIVE_ACCESS_TOKEN}' },
    },
    envVars: [{ name: 'GOOGLE_DRIVE_ACCESS_TOKEN', placeholder: 'required — OAuth2 access token for this agent\'s account' }],
    notes: 'Each agent stores their own token. OAuth scope: drive. Get a token via "gcloud auth print-access-token" or the Google OAuth 2.0 Playground.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-chat-personal',
    name: 'Google Chat (mine)',
    description: 'Send messages and manage spaces in Google Chat — uses this agent\'s own Google account',
    category: 'productivity',
    users: ['agent'],
    config: {
      transport: 'http',
      url: 'https://chatmcp.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_CHAT_ACCESS_TOKEN}' },
    },
    envVars: [{ name: 'GOOGLE_CHAT_ACCESS_TOKEN', placeholder: 'required — OAuth2 access token for this agent\'s account' }],
    notes: 'Each agent stores their own token. OAuth scope: chat.messages. Get a token via "gcloud auth print-access-token" or the Google OAuth 2.0 Playground.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
  {
    id: 'google-contacts-personal',
    name: 'Google Contacts (mine)',
    description: 'Look up and manage contacts via the Google People API — uses this agent\'s own Google account',
    category: 'productivity',
    users: ['agent'],
    config: {
      transport: 'http',
      url: 'https://people.googleapis.com/mcp/v1',
      headers: { Authorization: 'Bearer ${GOOGLE_CONTACTS_ACCESS_TOKEN}' },
    },
    envVars: [{ name: 'GOOGLE_CONTACTS_ACCESS_TOKEN', placeholder: 'required — OAuth2 access token for this agent\'s account' }],
    notes: 'Each agent stores their own token. OAuth scope: contacts. Get a token via "gcloud auth print-access-token" or the Google OAuth 2.0 Playground.',
    url: 'https://developers.google.com/workspace/guides/configure-mcp-servers',
  },
];

/**
 * The catalogue is one file shared by several processes.
 *
 * The Team Runner writes to it — it is the only process that starts MCP
 * servers, so it is the only one that can record what they offer. The Agent
 * Library and Project Server read it, and the dashboard edits it. So a copy
 * held in memory from startup goes stale the moment another process writes,
 * and a blind write-back destroys what that process recorded.
 *
 * Hence: reads check the file's mtime, and every write re-reads first.
 */
let _catalogue: MCPCatalogueEntry[] = [];
let _filePath = '';
/** mtime of the file as this process last read it. */
let _loadedMtimeMs = 0;

/**
 * Discovered tools live beside the catalogue, not in it.
 *
 * The catalogue is checked-in configuration: what a server *is*. What it
 * turned out to offer is an observation of one machine at one moment, and
 * writing it into the tracked file meant every runner start produced a diff
 * and threatened to push one machine's findings to everybody.
 */
let _toolsPath = '';
let _toolsMtimeMs = 0;
let _discovered: Record<string, { tools: DiscoveredTool[]; at: string }> = {};

const toolsFileFor = (cataloguePath: string): string =>
  path.join(path.dirname(cataloguePath), 'mcp-discovered-tools.json');

/**
 * Built-in definitions win on everything a human declares, so a change in code
 * reaches every machine. What was observed at runtime survives, because
 * nothing in the code could regenerate it.
 */
function normalise(entries: MCPCatalogueEntry[]): MCPCatalogueEntry[] {
  const builtinById = new Map(BUILTIN_CATALOGUE.map(e => [e.id, e]));
  const merged = entries.map(e => {
    const builtin = builtinById.get(e.id);
    // Strip any observation an older build wrote into the catalogue; it has
    // already been lifted into the sidecar by then.
    const { knownTools: _k, toolsDiscoveredAt: _t, ...declared } = e;
    return builtin ? { ...builtin } : (declared as MCPCatalogueEntry);
  });
  // Built-in entries added since the file was written. Copied, because the
  // catalogue is mutated in place — pushing the constant itself meant recording
  // a server's tools wrote them onto BUILTIN_CATALOGUE, where they then leaked
  // into every catalogue this process loaded afterwards.
  for (const b of BUILTIN_CATALOGUE) {
    if (!merged.some(e => e.id === b.id)) merged.push({ ...b });
  }
  return merged.map(e => {
    const seen = _discovered[e.id];
    return seen ? { ...e, knownTools: seen.tools, toolsDiscoveredAt: seen.at } : e;
  });
}

/** Read and normalise the file, or null if it is missing or unreadable. */
function readFromDisk(): MCPCatalogueEntry[] | null {
  try {
    const parsed = JSON.parse(readFileSync(_filePath, 'utf-8')) as MCPCatalogueEntry[];
    return Array.isArray(parsed) ? normalise(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * Pick up a write by another process. Cheap enough to do on every read — the
 * file is small and no caller is in a hot loop — and it is the difference
 * between the library listing a server's tools and claiming it has none.
 */
function reloadIfChanged(): void {
  if (!_filePath) return;

  // The sidecar changes far more often than the catalogue — it is what the
  // runner writes on every connect — so it is checked first and separately.
  let toolsMoved = false;
  try {
    if (statSync(_toolsPath).mtimeMs !== _toolsMtimeMs) {
      _discovered = readDiscovered();
      toolsMoved = true;
    }
  } catch {
    // No sidecar yet; nothing has been discovered on this machine.
  }

  try {
    const { mtimeMs } = statSync(_filePath);
    if (mtimeMs === _loadedMtimeMs && !toolsMoved) return;
    const fresh = readFromDisk();
    if (fresh) { _catalogue = fresh; _loadedMtimeMs = mtimeMs; }
  } catch {
    // The file has gone; keep serving what we already have.
  }
}

export async function initCatalogue(filePath: string): Promise<void> {
  _filePath = filePath;
  _toolsPath = toolsFileFor(filePath);
  _discovered = readDiscovered();

  // Lift anything an older build left in the catalogue into the sidecar, so
  // the tracked file loses its observations exactly once.
  const raw = existsSync(filePath) ? rawEntries() : null;
  let lifted = false;
  for (const e of raw ?? []) {
    if (!e.knownTools?.length || _discovered[e.id]) continue;
    _discovered[e.id] = { tools: e.knownTools, at: e.toolsDiscoveredAt ?? new Date().toISOString() };
    lifted = true;
  }
  if (lifted) await writeDiscovered();

  const onDisk = raw ? normalise(raw) : null;
  _catalogue = onDisk ?? (JSON.parse(JSON.stringify(BUILTIN_CATALOGUE)) as MCPCatalogueEntry[]);
  await persist();
}

/** The catalogue file exactly as written, before the built-in refresh. */
function rawEntries(): MCPCatalogueEntry[] | null {
  try {
    const parsed = JSON.parse(readFileSync(_filePath, 'utf-8')) as MCPCatalogueEntry[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readDiscovered(): Record<string, { tools: DiscoveredTool[]; at: string }> {
  if (!_toolsPath) return {};
  try {
    _toolsMtimeMs = statSync(_toolsPath).mtimeMs;
    const parsed = JSON.parse(readFileSync(_toolsPath, 'utf-8')) as Record<string, unknown>;
    return (parsed && typeof parsed === 'object' ? parsed : {}) as typeof _discovered;
  } catch {
    return {};
  }
}

async function writeDiscovered(): Promise<void> {
  if (!_toolsPath) return;
  await mkdir(path.dirname(_toolsPath), { recursive: true });
  const temp = `${_toolsPath}.tmp`;
  await writeFile(temp, JSON.stringify(_discovered, null, 2), 'utf-8');
  await rename(temp, _toolsPath);
  try { _toolsMtimeMs = statSync(_toolsPath).mtimeMs; } catch { _toolsMtimeMs = 0; }
}

export function getCatalogue(): MCPCatalogueEntry[] {
  reloadIfChanged();
  return _catalogue;
}

/**
 * Record what a server offered when the runner connected to it.
 *
 * Goes to the sidecar beside the catalogue, so the Agent Library — which
 * never starts an MCP server — can list a server's tools without the tracked
 * configuration gaining a diff every time the runner boots. Unchanged lists
 * are not rewritten, so a restart does not churn the file either.
 */
export async function recordDiscoveredTools(id: string, tools: DiscoveredTool[]): Promise<void> {
  if (tools.length === 0 || !_toolsPath) return;
  reloadIfChanged();
  if (!_catalogue.some(e => e.id === id)) return;

  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(_discovered[id]?.tools ?? []) === JSON.stringify(sorted)) return;

  _discovered[id] = { tools: sorted, at: new Date().toISOString() };
  await writeDiscovered();
  // Reflect it immediately; the next read would pick it up anyway.
  const entry = _catalogue.find(e => e.id === id);
  if (entry) { entry.knownTools = sorted; entry.toolsDiscoveredAt = _discovered[id]!.at; }
}

export async function addEntry(entry: MCPCatalogueEntry): Promise<void> {
  await mutate(entries => {
    if (entries.some(e => e.id === entry.id)) throw new Error(`ID "${entry.id}" already exists in catalogue`);
    entries.push(entry);
    return true;
  });
}

export async function updateEntry(id: string, patch: Partial<MCPCatalogueEntry>): Promise<void> {
  await mutate(entries => {
    const idx = entries.findIndex(e => e.id === id);
    if (idx < 0) throw new Error(`Catalogue entry "${id}" not found`);
    entries[idx] = { ...entries[idx], ...patch } as MCPCatalogueEntry;
    return true;
  });
}

export async function removeEntry(id: string): Promise<void> {
  await mutate(entries => {
    const idx = entries.findIndex(e => e.id === id);
    if (idx < 0) throw new Error(`Catalogue entry "${id}" not found`);
    entries.splice(idx, 1);
    return true;
  });
}

/**
 * Apply a change to the freshest copy of the catalogue and write it back.
 *
 * Re-reading first is what stops one process overwriting another's work: the
 * library saving a catalogue edit used to wipe every tool list the runner had
 * recorded, because it wrote out the snapshot it booted with.
 */
async function mutate(apply: (entries: MCPCatalogueEntry[]) => boolean): Promise<void> {
  reloadIfChanged();
  if (!apply(_catalogue)) return;
  await persist();
}

/** Write via a temp file, so a reader never sees a half-written catalogue. */
async function persist(): Promise<void> {
  if (!_filePath) return;
  await mkdir(path.dirname(_filePath), { recursive: true });
  const temp = `${_filePath}.tmp`;
  // The catalogue file holds what a server *is*, never what it turned out to
  // offer. Observations are attached in memory for callers and stripped here,
  // so the tracked file cannot pick them up by a side door.
  const declared = _catalogue.map(({ knownTools: _k, toolsDiscoveredAt: _t, ...rest }) => rest);
  await writeFile(temp, JSON.stringify(declared, null, 2), 'utf-8');
  await rename(temp, _filePath);
  // Our own write must not look like somebody else's.
  try { _loadedMtimeMs = statSync(_filePath).mtimeMs; } catch { _loadedMtimeMs = 0; }
}
