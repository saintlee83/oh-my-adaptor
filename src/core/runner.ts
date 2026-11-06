import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { builtinAdapters } from './adapters.js';
import { SessionStore } from './store.js';
import type {
  AgentEvent,
  EventInput,
  HarnessAdapter,
  HarnessInfo,
  RunHandle,
  RunOptions,
  Session,
  SessionSummary,
} from './types.js';

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 16 * 1024 * 1024;
const MAX_EVENTS = 30_000;

export class Adaptor {
  private adapters = new Map<string, HarnessAdapter>();
  private sessions = new Map<string, Session>();
  private running = new Map<string, { cancel: () => void; done: Promise<Session> }>();
  private bus = new EventEmitter();
  private store: SessionStore;
  private starting = Promise.resolve();
  private closed = false;
  private constructor(directory: string) {
    this.store = new SessionStore(directory);
    this.bus.setMaxListeners(100);
    for (const adapter of builtinAdapters) this.register(adapter);
  }

  static async create(
    options: { dataDir?: string; adapters?: HarnessAdapter[] } = {},
  ): Promise<Adaptor> {
    const instance = new Adaptor(options.dataDir ?? join(homedir(), '.oh-my-adaptor', 'sessions'));
    for (const adapter of options.adapters ?? []) instance.register(adapter);
    for (const session of await instance.store.load()) {
      if (session.status === 'running' && !isProcessAlive(session.ownerPid)) {
        session.status = 'interrupted';
        session.finishedAt = new Date().toISOString();
        session.events.push({
          sequence: session.events.length + 1,
          timestamp: session.finishedAt,
          kind: 'status',
          text: 'Run interrupted: the previous application process stopped.',
        });
        await instance.store.save(session);
      }
      instance.sessions.set(session.id, session);
    }
    return instance;
  }

  register(adapter: HarnessAdapter): this {
    if (!/^[a-z][a-z0-9-]*$/.test(adapter.id))
      throw new Error('Adapter IDs must use lowercase letters, digits, and hyphens.');
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  async detect(): Promise<HarnessInfo[]> {
    return Promise.all(
      [...this.adapters.values()].map(async (adapter) => {
        const { id, name, provider, command, description, docsUrl } = adapter;
        const info = { id, name, provider, command, description, docsUrl };
        try {
          const { stdout, stderr } = await execFileAsync(
            command,
            adapter.versionArgs ?? ['--version'],
            { timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true },
          );
          return {
            ...info,
            available: true,
            version: (stdout || stderr).trim().split('\n')[0].slice(0, 160),
          };
        } catch (error) {
          return {
            ...info,
            available: false,
            error:
              (error as NodeJS.ErrnoException).code === 'ENOENT'
                ? 'Not found on PATH'
                : 'Version check failed or timed out',
          };
        }
      }),
    );
  }

  list(): SessionSummary[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(({ events, ...session }) => ({ ...session, eventCount: events.length }));
  }

  /** Discover runs written by other SDK/CLI processes without replacing owned live runs. */
  async sync(): Promise<void> {
    const stored = await this.store.load();
    const ids = new Set(stored.map((session) => session.id));
    for (const [id, session] of this.sessions)
      if (!ids.has(id) && session.status !== 'running') this.sessions.delete(id);
    for (const session of stored) {
      if (this.running.has(session.id)) continue;
      if (session.status === 'running' && !isProcessAlive(session.ownerPid)) {
        session.status = 'interrupted';
        session.finishedAt = new Date().toISOString();
        await this.store.save(session);
      }
      this.sessions.set(session.id, session);
    }
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  subscribe(id: string, listener: (event: AgentEvent, session: Session) => void): () => void {
    this.bus.on(id, listener);
    return () => {
      this.bus.off(id, listener);
    };
  }

  async remove(id: string): Promise<void> {
    if (this.sessions.get(id)?.status === 'running')
      throw new Error('Stop the running session before deleting it.');
    if (!this.sessions.has(id)) throw new Error('Session not found.');
    await this.store.delete(id);
    this.sessions.delete(id);
  }

  cancel(id: string): void {
    const run = this.running.get(id);
    if (!run && this.sessions.get(id)?.status === 'running')
      throw new Error('This run belongs to another CLI or SDK process. Stop it from that process.');
    run?.cancel();
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.starting;
    const active = [...this.running.values()];
    for (const run of active) run.cancel();
    await Promise.all(active.map((run) => run.done));
  }

  async run(options: RunOptions): Promise<RunHandle> {
    if (this.closed)
      throw new Error('This adaptor has been closed. Create a new instance to start another run.');
    const previous = this.starting;
    let release!: () => void;
    this.starting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.start(options);
    } finally {
      release();
    }
  }

  private async start(options: RunOptions): Promise<RunHandle> {
    const adapter = this.adapters.get(options.harness);
    if (!adapter) throw new Error(`Unknown harness: ${options.harness}`);
    if (typeof options.prompt !== 'string' || !options.prompt.trim())
      throw new Error('A prompt is required.');
    if (options.prompt.length > 100_000)
      throw new Error('Prompt must be under 100,000 characters.');
    if (typeof options.cwd !== 'string' || !options.cwd.trim())
      throw new Error('A project directory is required.');
    if (options.mode && !['review', 'edit'].includes(options.mode))
      throw new Error('Mode must be review or edit.');
    if (
      options.model !== undefined &&
      (typeof options.model !== 'string' ||
        options.model.length > 200 ||
        options.model.startsWith('-'))
    )
      throw new Error('Invalid model name.');
    if (this.running.size >= 4)
      throw new Error('Four agents are already running. Stop one before starting another.');
    const path =
      options.cwd === '~'
        ? homedir()
        : options.cwd.startsWith('~/')
          ? join(homedir(), options.cwd.slice(2))
          : options.cwd;
    const cwd = await realpath(isAbsolute(path) ? path : resolve(path)).catch(() => {
      throw new Error('Project directory does not exist.');
    });
    if (!(await stat(cwd)).isDirectory()) throw new Error('Project path must be a directory.');
    let prompt = options.prompt.trim();
    if (options.parentId) {
      const parent = this.sessions.get(options.parentId);
      if (!parent) throw new Error('Previous session not found.');
      if (parent.status === 'running')
        throw new Error('Wait for the previous session to finish before continuing.');
      const chain: Session[] = [];
      let cursor: Session | undefined = parent;
      while (cursor && chain.length < 8) {
        chain.unshift(cursor);
        cursor = cursor.parentId ? this.sessions.get(cursor.parentId) : undefined;
      }
      const context = chain
        .map(
          (run) =>
            `User: ${run.prompt}\n${run.harness}: ${run.events
              .filter((e) => e.kind === 'message' || e.kind === 'delta')
              .map((e) => e.text)
              .join('\n')}`,
        )
        .join('\n\n')
        .slice(-40_000);
      prompt = `Previous conversation (context from another run; tool state is not preserved):\n<context>\n${context}\n</context>\n\nCurrent user request:\n${prompt}`;
    }
    const session: Session = {
      ...options,
      cwd,
      prompt: options.prompt.trim(),
      mode: options.mode ?? 'review',
      id: randomUUID(),
      ownerPid: process.pid,
      status: 'running',
      startedAt: new Date().toISOString(),
      events: [],
    };
    const invocation = adapter.build({ ...session, prompt });
    this.sessions.set(session.id, session);
    try {
      await this.store.save(session);
    } catch (error) {
      this.sessions.delete(session.id);
      throw error;
    }
    const queue: AgentEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    let cancelled = false;
    let failed = false;
    let child: ChildProcess;
    let killer: ReturnType<typeof setTimeout> | undefined;
    let checkpoint: ReturnType<typeof setTimeout> | undefined;
    let finishPromise!: (value: Session) => void;
    const done = new Promise<Session>((resolve) => {
      finishPromise = resolve;
    });
    const persist = () =>
      this.store.save(session).catch((error) => {
        console.error(
          `Session persistence failed: ${error instanceof Error ? error.message : error}`,
        );
      });
    const emit = (input: EventInput) => {
      if (finished) return;
      const event: AgentEvent = {
        ...input,
        sequence: session.events.length + 1,
        timestamp: new Date().toISOString(),
      };
      session.events.push(event);
      queue.push(event);
      if (input.kind === 'error') failed = true;
      this.bus.emit(session.id, event, session);
      wake?.();
      wake = undefined;
      if (!checkpoint)
        checkpoint = setTimeout(() => {
          checkpoint = undefined;
          void persist();
        }, 500);
    };
    const kill = (signal: NodeJS.Signals) => {
      if (!child?.pid) return;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* Already exited. */
      }
    };
    const stop = () => {
      kill('SIGTERM');
      killer ??= setTimeout(() => kill('SIGKILL'), 2000);
    };
    const cancel = () => {
      if (!finished && !cancelled) {
        cancelled = true;
        emit({ kind: 'status', text: 'Stopping agent…' });
        stop();
      }
    };
    const finish = async (code: number | null) => {
      if (finished) return;
      clearTimeout(killer);
      clearTimeout(checkpoint);
      session.exitCode = code;
      session.status = cancelled ? 'cancelled' : failed || code !== 0 ? 'failed' : 'completed';
      session.finishedAt = new Date().toISOString();
      emit({ kind: 'status', text: `Session ${session.status}`, data: { exitCode: code } });
      finished = true;
      clearTimeout(checkpoint);
      await persist();
      this.running.delete(session.id);
      wake?.();
      wake = undefined;
      finishPromise(session);
    };
    this.running.set(session.id, { cancel, done });
    emit({ kind: 'status', text: `Starting ${adapter.name}`, data: { mode: session.mode } });
    try {
      child = spawn(adapter.command, invocation.args, {
        cwd,
        env: { ...process.env, NO_COLOR: '1', ...invocation.env },
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const parse = adapter.createParser();
      let bytes = 0;
      let exceeded = false;
      const connect = (stream: NodeJS.ReadableStream, stderr: boolean) => {
        const decoder = new StringDecoder('utf8');
        let buffer = '';
        const line = (value: string) => {
          if (!value.trim() || exceeded) return;
          if (session.events.length >= MAX_EVENTS) {
            exceeded = true;
            emit({ kind: 'error', text: 'Output event limit exceeded. Agent stopped.' });
            stop();
            return;
          }
          try {
            for (const input of stderr ? [{ kind: 'log' as const, text: value }] : parse(value))
              emit(input);
          } catch (error) {
            emit({
              kind: 'log',
              text: `Unrecognized provider event: ${error instanceof Error ? error.message : error}`,
            });
          }
        };
        stream.on('data', (chunk: Buffer) => {
          if (exceeded) return;
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT) {
            exceeded = true;
            emit({ kind: 'error', text: 'Output exceeded 16 MB. Agent stopped.' });
            stop();
            return;
          }
          buffer += decoder.write(chunk);
          let newline: number;
          while ((newline = buffer.indexOf('\n')) !== -1) {
            line(buffer.slice(0, newline).replace(/\r$/, ''));
            buffer = buffer.slice(newline + 1);
          }
        });
        stream.on('end', () => {
          buffer += decoder.end();
          if (buffer) line(buffer);
        });
      };
      connect(child.stdout!, false);
      connect(child.stderr!, true);
      child.on('error', (error) => {
        emit({ kind: 'error', text: `Could not start ${adapter.name}: ${error.message}` });
        void finish(null);
      });
      child.on('close', (code) => {
        void finish(code);
      });
      child.stdin!.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') emit({ kind: 'error', text: error.message });
      });
      child.stdin!.end(invocation.stdin ?? '');
    } catch (error) {
      emit({ kind: 'error', text: String(error) });
      void finish(null);
    }
    return {
      session,
      done,
      cancel,
      events: {
        async *[Symbol.asyncIterator]() {
          while (!finished || queue.length) {
            while (queue.length) yield queue.shift()!;
            if (!finished)
              await new Promise<void>((resolve) => {
                wake = resolve;
              });
          }
        },
      },
    };
  }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
