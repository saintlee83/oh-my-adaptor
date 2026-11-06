# oh-my-adaptor

**One interface. Every coding agent.**

A local TypeScript SDK, CLI, and desktop workspace for coding agent harnesses. Connect Claude Code, Codex, Gemini CLI, and OpenCode through one execution interface. Register adapters to add more.

여러 코딩 에이전트 하네스를 하나의 SDK, CLI, 데스크톱 앱에서 사용합니다. 각 CLI의 기존 로그인과 프로젝트 설정을 활용하며, 실행 기록과 이벤트를 로컬에 저장합니다.

## Start the desktop app

Requires Node.js 22.12+ and npm. macOS is the primary development target; Linux packaging is configured but has not been validated. Windows support is not yet claimed.

```sh
npm install
npm run desktop
```

The app starts its local engine automatically, detects CLIs on your login shell’s `PATH`, and opens a native window. Choose a project folder, select an installed harness, and enter a task. Use each harness’s own CLI to install and authenticate it first. Detection confirms that a CLI is executable; it does **not** confirm an authenticated account.

Features in v0.1:

- Four built-in CLI adapters, plus custom SDK adapters.
- Normalized streaming messages, tools, diagnostics, usage, and errors.
- Up to four concurrent runs, process-group cancellation on macOS/Linux, and interruption recovery.
- Persisted sessions shared by the SDK, CLI, and desktop app.
- Conversation handoff to another harness, model overrides, and review/edit modes.
- Native project picker, searchable history, Markdown output, and quick switch with `⌘/Ctrl K`.

Submit a task with `⌘/Ctrl Enter`. No credentials are stored by this app; subprocesses use the harness’s existing authentication and configuration. Model calls still go to that harness’s configured provider and use its normal quota or billing.

## CLI

Build and link the package locally. This repository does not assume an npm publication already exists.

```sh
npm run build
npm link

oma harnesses
oma run -h codex -C ./my-project "Explain the architecture"
oma run -h claude --mode edit "Fix the failing test"
oma run -h gemini --model YOUR_MODEL --json "Review this code"
oma sessions
oma run -h opencode --parent SESSION_ID "Continue with a simpler approach"
```

`oh-my-adaptor` is an alias for `oma`. `--json` emits normalized JSONL, including the local session ID. Ctrl-C stops the run. Exit status is `0` for completion, `1` for failure, and `130` for cancellation. Run `oma --help` for all flags.

The optional browser interface runs with `oma serve` at `http://127.0.0.1:4317`. `--port 0` chooses an available port. `npm run dev` serves the same interface with hot reload.

## TypeScript SDK

Import the built local package using a workspace dependency or `npm install /path/to/oh-my-adaptor` after building it.

```ts
import { Adaptor } from 'oh-my-adaptor';

const adaptor = await Adaptor.create();
const harnesses = await adaptor.detect();

const run = await adaptor.run({
  harness: 'codex',
  cwd: process.cwd(),
  prompt: 'Explain this project',
  mode: 'review',
});

for await (const event of run.events) {
  console.log(event.kind, event.text);
}

const session = await run.done;
console.log(session.status);
await adaptor.close();
```

`run.cancel()` stops an active run. `run.events` is a single-consumer async iterable; use `adaptor.subscribe(id, listener)` for additional live observers. `run.done` resolves to the final session, including failed or cancelled outcomes. Invalid input rejects `run()` before creating a process.

| Method | Purpose |
| --- | --- |
| `Adaptor.create({ dataDir?, adapters? })` | Load persisted sessions and register adapters |
| `register(adapter)` | Add or replace an adapter |
| `detect()` | Check executables and versions |
| `run(options)` | Start a run and return its stream, completion promise, and cancellation handle |
| `list()` / `get(id)` | Read locally loaded sessions |
| `sync()` | Discover sessions written by other CLI/SDK processes |
| `subscribe(id, listener)` | Observe events produced by this engine; returns an unsubscribe function |
| `cancel(id)` / `remove(id)` | Stop an owned run or delete a finished session |
| `close()` | Stop owned runs, flush their records, and close the engine |

Event kinds are `message`, `delta`, `tool`, `result`, `status`, `error`, `log`, and `usage`. Each event includes an increasing `sequence`, ISO timestamp, text, and optional provider-specific data. Providers emit at different granularities: Claude streams complete assistant messages; Gemini can emit text deltas. Unknown events remain inspectable as diagnostic logs.

### Add a harness

Implement `HarnessAdapter`: metadata, `build(options)` returning an argument array and optional stdin/environment, and `createParser()` returning a fresh line parser for each run. The runner never invokes a shell to expand prompt text.

```ts
import { Adaptor, type HarnessAdapter } from 'oh-my-adaptor';

const myHarness: HarnessAdapter = {
  id: 'my-agent',
  name: 'My agent',
  provider: 'My team',
  description: 'Our own coding agent',
  command: '/absolute/path/to/my-agent',
  docsUrl: 'https://example.com/docs',
  build: ({ prompt }) => ({ args: [], stdin: prompt }),
  createParser: () => (line) => [{ kind: 'message', text: line }],
};

const adaptor = await Adaptor.create({ adapters: [myHarness] });
```

For a complete, offline example: `npx tsx examples/custom-adapter.ts` after `npm run build`. The desktop currently loads built-in adapters; custom adapter registration is available through the SDK.

## Harness behavior

| Harness | Non-interactive protocol | Review | Allow edits |
| --- | --- | --- | --- |
| Claude Code | `--print --output-format stream-json --verbose` | `--permission-mode plan` | `--permission-mode acceptEdits` |
| Codex | `exec --json`, prompt over stdin | `--sandbox read-only` | `--sandbox workspace-write` |
| Gemini CLI | `--output-format stream-json --prompt` | `--approval-mode default` | `--approval-mode auto_edit` |
| OpenCode | `run --format json` | Explicit read/list/search tool allowlist | Also allows the edit permission |

Codex uses `approval_policy="never"` so approval-requiring actions fail instead of waiting on a hidden terminal. No adapter enables blanket approval bypass. Other CLIs apply their own headless approval behavior. **Review mode is a per-harness policy mapping, not a portable OS sandbox.** Existing settings, hooks, extensions, and MCP tools may still apply. Run agents only in projects and environments you trust. This version does not forward interactive permission questions.

Handoff sends up to eight previous prompts and assistant responses, capped at 40,000 characters, into a **fresh** process. It does not resume provider-native sessions or transfer tool state, hidden reasoning, or full provider history. Long contexts are truncated from the oldest end. Project changes remain on disk and are visible to the next harness. Concurrent editing runs share the selected directory; use separate worktrees when isolation is needed.

Official integration references: [Claude Code headless](https://code.claude.com/docs/en/headless), [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive), [Gemini headless mode](https://geminicli.com/docs/cli/headless/), [OpenCode CLI](https://opencode.ai/docs/cli/), [OpenCode permissions](https://opencode.ai/docs/permissions/).

## Architecture

```text
TypeScript SDK ──┐
CLI (oma) ───────┼── Adaptor engine ── adapter ── local CLI subprocess
Desktop UI ─────┘      │                            │
  React + Electron    └── session store ◀── normalized event stream
```

```text
src/core/       Public types, built-in adapters, runner, and atomic session store
src/cli.ts      Command-line entry point
src/server/    Loopback API, SSE replay, and static/dev UI serving
src/ui/        React workspace and locally bundled fonts
desktop/       Electron main process and minimal folder-picker preload
examples/      SDK and custom adapter examples
tests/         Protocol, process lifecycle, persistence, and API integration tests
```

The desktop renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing enabled. The local API binds only to `127.0.0.1`, validates Host/Origin, and requires a per-process token for mutations. Fonts are bundled; the UI needs no remote assets. This is a single-user local application, not a remotely exposed multi-user service.

Sessions are stored as private JSON files in `~/.oh-my-adaptor/sessions`; set `OMA_DATA_DIR`, pass `--data-dir`, or use the SDK’s `dataDir` option to override this. Files contain prompts and agent output. Checkpoints are written during runs and replaced atomically. A run is marked interrupted after its owning process disappears. The desktop can observe runs started by another process; stop those from the original CLI/SDK process. Each process should use only one engine instance for a given data directory.

Output is bounded at 16 MB / 30,000 events per run. Sessions are retained until deleted; there is no automatic retention policy. The JSON store is intended for local use, not concurrent access over a network filesystem.

## Development and packaging

```sh
npm run check            # TypeScript, tests, SDK/CLI/UI production build
npm run dev              # Local browser workspace with hot reload
npm run desktop          # Build and launch Electron
npm run package:desktop  # Create an unpacked local desktop application
```

Desktop packages are unsigned development builds. Signing, notarization, automatic updates, and distribution publishing are outside v0.1. Tests use local fixture processes and do not consume model credits. End-to-end provider execution also requires the relevant installed CLI and account access.

Apache-2.0. See [LICENSE](LICENSE).
