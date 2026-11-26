/**
 * Keeping a runner on one project.
 *
 * Several runners can share one set of services, one project each. Switching
 * one of them to another project would have two runners writing the same
 * team state and board, so HATS_PROJECT_LOCKED holds a runner on the project
 * it started with.
 */

const OFF = ['', '0', 'false', 'no', 'off'];

export function projectLocked(env: Record<string, string | undefined> = process.env): boolean {
  return !OFF.includes((env['HATS_PROJECT_LOCKED'] ?? '').trim().toLowerCase());
}

export const PROJECT_LOCKED_MESSAGE =
  'This runner is kept on one project (HATS_PROJECT_LOCKED). Open the other project on its own runner.';

export const RUNNER_MANAGED_MESSAGE =
  'Each project has its own runner here. Open or launch the other project from the project badge.';

/**
 * Why this runner cannot switch projects, or null when it can. A runner with
 * a runner manager never switches: another project means another runner.
 */
export function switchRefusal(hasRunnerManager: boolean, env: Record<string, string | undefined> = process.env): string | null {
  if (projectLocked(env)) return PROJECT_LOCKED_MESSAGE;
  if (hasRunnerManager) return RUNNER_MANAGED_MESSAGE;
  return null;
}
