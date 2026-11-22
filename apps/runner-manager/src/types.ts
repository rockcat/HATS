/** A team runner, as the dashboard's project list shows it. */
export interface RunnerInfo {
  project: string;
  /** The port its dashboard listens on, the same inside a container as outside. */
  port: number;
  /** Set when the runner knows a better address than the browser's host + port. */
  url?: string;
  /**
   * running     reported in recently
   * starting    its container is up but it has not reported in yet
   * stopped     its container exists but is not running
   * unreachable it reported in once, but not lately
   */
  status: 'running' | 'starting' | 'stopped' | 'unreachable';
  /** Started by this manager, which can therefore stop and remove it. */
  managed: boolean;
  lastSeen?: string;
}

/** What a runner sends when it reports in. */
export interface Heartbeat {
  project: string;
  port: number;
  url?: string;
}

/** A runner container this manager started, as Docker lists it. */
export interface ManagedContainer {
  id: string;
  project: string;
  port: number;
  running: boolean;
}
