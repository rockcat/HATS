// ── Entry point — wires all modules together ──────────────────────────────────
// This file is loaded as <script type="module"> and does nothing except import
// modules and call their init functions in dependency order.

import { checkAuth }                                   from './modules/auth.js';
import { loadSpecialisations }                         from './modules/specialisations.js';
import { initTelemetry, initTelScopeToggle,
         applyTelemetrySummary }                       from './modules/telemetry.js';
import { fetchFiles, startFilesRefresh,
         initFileUpload, initFileViewer,
         initGenBgModal }                              from './modules/files.js';
import { fetchCalendar, initCalendar,
         initImpromptuMeeting }                        from './modules/calendar.js';
import { updateGoalBar, initGoalBar,
         initProjectBadge, initProject }               from './modules/project.js';
import { initKanban }                                  from './modules/kanban.js';
import { initSettings }                                from './modules/settings.js';
import { initAddAgent, openLibraryEdit }               from './modules/add-agent.js';
import { initLibraryTab, fetchGlobalAgents }           from './modules/library.js';
import { initSchedulesTab }                            from './modules/schedules.js';
import { initMCPEditor }                               from './modules/mcp.js';
import { initAgentDetail, closeAgentDetail }           from './modules/agent-detail.js';
import { initCLI }                                     from './modules/cli.js';
import { appendCLILine }                               from './modules/cli.js';
import { initGoogleReturn }                            from './modules/google-return.js';
import { initAllowlist }                               from './modules/allowlist.js';
import { initTabs, initBacklogCalendarTabs,
         initPanelExpand, initMicButtons }             from './modules/panels.js';
import { connect, fetchTools, applyState }             from './modules/sse.js';

if (!await checkAuth()) throw new Error('Not authenticated');

// ── Cross-module dependency injection ─────────────────────────────────────────
// These break import cycles by handing each module the functions it depends on
// at startup rather than at import time.

initProject({
  applyState,
  fetchTools,
  fetchFiles,
  startFilesRefresh,
  fetchCalendar,
  applyTelemetrySummary,
  closeAgentDetail,
});

initKanban({ updateGoalBar });

initLibraryTab({ openLibraryEdit });

initAddAgent({ fetchGlobalAgentsOverride: fetchGlobalAgents });

// ── Sequential startup ────────────────────────────────────────────────────────

initProjectBadge();
initGoalBar();
initSettings();
loadSpecialisations();
initMCPEditor();
initImpromptuMeeting();
initCalendar();
initMicButtons();
initBacklogCalendarTabs();
initPanelExpand();
initTelemetry();
initTelScopeToggle();
initFileUpload();
initFileViewer();
initGenBgModal();
initSchedulesTab();

// A sign-in that ran in this tab rather than a popup comes back with its
// result in the query string, and nobody listening for the message that a
// popup would have sent.
initGoogleReturn({
  announce: (text) => appendCLILine(text, 'cli-system'),
  showMcpTab: () => document.querySelector('.panel-tab[data-tab="mcp"]')?.click(),
});

// connect() opens the SSE stream; the 'init' event fires initTabs(),
// initKanbanDrag(), initTicketEditing(), initCLI(), initAgentDetail(),
// initAllowlist() — those need the DOM and state, so they run after SSE init.
connect();
