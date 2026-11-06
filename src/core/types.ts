export type HarnessId = 'claude' | 'codex' | 'gemini' | 'opencode' | (string & {});
export type PermissionMode = 'review' | 'edit';
export type SessionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type EventKind =
  'message' | 'delta' | 'tool' | 'result' | 'status' | 'error' | 'log' | 'usage';

export interface AgentEvent {
  sequence: number;
  timestamp: string;
  kind: EventKind;
  text: string;
  data?: Record<string, unknown>;
}

export type EventInput = Omit<AgentEvent, 'sequence' | 'timestamp'>;

export interface RunOptions {
  harness: HarnessId;
  prompt: string;
  cwd: string;
  model?: string;
  mode?: PermissionMode;
  /** A previous local run whose conversation should be passed as context. */
  parentId?: string;
}

export interface Session extends RunOptions {
  id: string;
  mode: PermissionMode;
  status: SessionStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  ownerPid?: number;
  events: AgentEvent[];
}

export type SessionSummary = Omit<Session, 'events'> & { eventCount: number };

export interface HarnessInfo {
  id: HarnessId;
  name: string;
  provider: string;
  description: string;
  command: string;
  docsUrl: string;
  available: boolean;
  version?: string;
  error?: string;
}

export interface Invocation {
  args: string[];
  stdin?: string;
  env?: Record<string, string>;
}

/** Register an adapter to connect another CLI without changing the runner. */
export interface HarnessAdapter {
  id: HarnessId;
  name: string;
  provider: string;
  description: string;
  command: string;
  docsUrl: string;
  versionArgs?: string[];
  build(options: RunOptions): Invocation;
  /** A fresh parser per run can retain protocol state without leaking between sessions. */
  createParser(): (line: string) => EventInput[];
}

export interface RunHandle {
  session: Session;
  events: AsyncIterable<AgentEvent>;
  done: Promise<Session>;
  cancel(): void;
}
