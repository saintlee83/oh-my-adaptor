import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Asterisk,
  BookOpen,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleHelp,
  Code2,
  Command,
  Copy,
  ExternalLink,
  Folder,
  History,
  Loader2,
  Menu,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  PanelsTopLeft,
  Play,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type {
  AgentEvent,
  HarnessInfo,
  PermissionMode,
  Session,
  SessionSummary,
} from '../core/types';

declare global {
  interface Window {
    desktop?: { platform: string; chooseDirectory(): Promise<string | null> };
  }
}
type Page = 'workspace' | 'harnesses' | 'sessions' | 'developers' | 'settings';
type Config = { token: string; cwd: string; version: string };

const initialHarnesses: HarnessInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    provider: 'Anthropic',
    description: 'Thoughtful reasoning. Deep code understanding.',
    command: 'claude',
    docsUrl: 'https://code.claude.com/docs/en/overview',
    available: false,
  },
  {
    id: 'codex',
    name: 'Codex',
    provider: 'OpenAI',
    description: 'From a first idea to working software.',
    command: 'codex',
    docsUrl: 'https://developers.openai.com/codex/cli',
    available: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    provider: 'Google',
    description: 'A fresh perspective on your entire codebase.',
    command: 'gemini',
    docsUrl: 'https://geminicli.com/docs/',
    available: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    provider: 'Open source',
    description: 'An open harness. Your choice of model.',
    command: 'opencode',
    docsUrl: 'https://opencode.ai/docs/',
    available: false,
  },
];

function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`}>
      <svg width="25" height="25" viewBox="0 0 25 25" fill="none" aria-hidden="true">
        <path
          d="M5 8v9l7.5 4.5L20 17V8l-7.5-4.5L5 8Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path
          d="m5 8 7.5 4.5L20 8M12.5 12.5v9M8.7 5.8l7.5 4.5v5.2"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
function HarnessIcon({ id, small = false }: { id: string; small?: boolean }) {
  const Icon =
    id === 'claude' ? Asterisk : id === 'codex' ? Command : id === 'gemini' ? Sparkles : Box;
  return (
    <span className={`harness-icon ${id} ${small ? 'small' : ''}`}>
      <Icon size={small ? 16 : 26} strokeWidth={id === 'claude' ? 2.5 : 1.65} />
    </span>
  );
}
function relativeDate(value: string) {
  const time = new Date(value);
  return (
    time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' +
    time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}
function statusName(status: string) {
  return status === 'running' ? 'Running' : status.charAt(0).toUpperCase() + status.slice(1);
}
function safeRead(key: string, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function safeSave(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Preferences are optional. */
  }
}

export function App() {
  const [page, setPage] = useState<Page>('workspace');
  const [config, setConfig] = useState<Config | null>(null);
  const [harnesses, setHarnesses] = useState(initialHarnesses);
  const [detecting, setDetecting] = useState(true);
  const [selected, setSelected] = useState(safeRead('oma.harness', 'claude'));
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [cwd, setCwd] = useState(safeRead('oma.cwd'));
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<PermissionMode>('review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [palette, setPalette] = useState(false);
  const [search, setSearch] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [showLogs, setShowLogs] = useState(safeRead('oma.logs') === 'true');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const chosen = harnesses.find((h) => h.id === selected) ?? harnesses[0];
  const connected = harnesses.filter((h) => h.available).length;
  const running = active?.status === 'running';

  useEffect(() => {
    if (!palette && !deleteId) return;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        ),
      );
    if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      if (previous?.isConnected) previous.focus();
    };
  }, [palette, deleteId]);

  const api = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const response = await fetch(`/api${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-OMA-Token': config?.token ?? '',
          ...options?.headers,
        },
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Something went wrong.');
      return value as T;
    },
    [config?.token],
  );

  const refresh = useCallback(async () => {
    setDetecting(true);
    try {
      setHarnesses(await api<HarnessInfo[]>('/harnesses'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setDetecting(false);
    }
  }, [api]);

  useEffect(() => {
    let live = true;
    fetch('/api/config')
      .then(async (r) => {
        if (!r.ok) throw new Error('Local engine is unavailable.');
        return r.json() as Promise<Config>;
      })
      .then((c) => {
        if (live) {
          setConfig(c);
          setCwd((old) => old || c.cwd);
        }
      })
      .catch((e) => {
        if (live) setError(`${e.message} Start the engine and reload this window.`);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    let live = true;
    const load = () =>
      api<SessionSummary[]>('/sessions')
        .then((data) => {
          if (live) setSessions(data);
        })
        .catch(() => {});
    void load();
    const interval = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [api]);
  useEffect(() => {
    safeSave('oma.cwd', cwd);
  }, [cwd]);
  useEffect(() => {
    safeSave('oma.harness', selected);
  }, [selected]);
  useEffect(() => {
    safeSave('oma.logs', String(showLogs));
  }, [showLogs]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 2600);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setPalette((old) => !old);
        setSearch('');
      }
      if (event.key === 'Escape') {
        setPalette(false);
        setDeleteId(null);
        setMobileNav(false);
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!active || active.status !== 'running') return;
    const id = active.id;
    const stream = new EventSource(
      `/api/sessions/${id}/events?after=${active.events.at(-1)?.sequence ?? 0}`,
    );
    stream.onmessage = (message) => {
      const value = JSON.parse(message.data) as {
        event: AgentEvent;
        status: Session['status'];
        finishedAt?: string;
      };
      setActive((current) =>
        !current ||
        current.id !== id ||
        current.events.some((e) => e.sequence === value.event.sequence)
          ? current
          : {
              ...current,
              status: value.status,
              finishedAt: value.finishedAt,
              events: [...current.events, value.event],
            },
      );
    };
    stream.addEventListener('done', () => {
      stream.close();
      void api<Session>(`/sessions/${id}`)
        .then((session) => {
          setActive((current) => (current?.id === id ? session : current));
        })
        .catch((e) => setError(e.message));
    });
    stream.onerror = () => {
      // EventSource replays missed IDs automatically after a brief connection loss.
      void api<Session>(`/sessions/${id}`)
        .then((session) => {
          if (session.status !== 'running') {
            stream.close();
            setActive((current) => (current?.id === id ? session : current));
          }
        })
        .catch(() => setError('Connection to the local engine was lost. Reconnecting…'));
    };
    return () => stream.close();
    // Keep a single stream per run; sequence replay handles reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, api]);
  useEffect(() => {
    if (pinned.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [active?.events.length]);

  const navigate = (next: Page) => {
    setPage(next);
    setMobileNav(false);
    setError('');
  };
  const newSession = () => {
    setActive(null);
    setPrompt('');
    setError('');
    setPage('workspace');
    setMobileNav(false);
    setTimeout(() => promptRef.current?.focus(), 0);
  };
  const choose = (id: string) => {
    setSelected(id);
    setModel('');
  };
  const openSession = async (id: string) => {
    try {
      const session = await api<Session>(`/sessions/${id}`);
      setActive(session);
      setSelected(session.harness);
      setCwd(session.cwd);
      setModel(session.model ?? '');
      setMode(session.mode);
      setPrompt('');
      navigate('workspace');
      pinned.current = true;
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const submit = async () => {
    if (busy || running || !prompt.trim()) return;
    setBusy(true);
    setError('');
    try {
      const session = await api<Session>('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          harness: selected,
          prompt,
          cwd,
          model: model.trim() || undefined,
          mode,
          parentId: active?.id,
        }),
      });
      setActive(session);
      setPrompt('');
      pinned.current = true;
      setSessions(await api<SessionSummary[]>('/sessions'));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!active) return;
    try {
      await api(`/sessions/${active.id}/cancel`, { method: 'POST' });
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast('Copied to clipboard');
    } catch {
      setError('Clipboard access is unavailable. Select and copy the text manually.');
    }
  };
  const selectFolder = async () => {
    if (!window.desktop) {
      document.getElementById('project-path')?.focus();
      return;
    }
    try {
      const path = await window.desktop.chooseDirectory();
      if (path) setCwd(path);
    } catch (error) {
      setError((error as Error).message);
    }
  };
  const removeSession = async () => {
    if (!deleteId) return;
    try {
      await api(`/sessions/${deleteId}`, { method: 'DELETE' });
      setSessions((old) => old.filter((s) => s.id !== deleteId));
      if (active?.id === deleteId) newSession();
      setDeleteId(null);
      setToast('Session deleted');
    } catch (error) {
      setError((error as Error).message);
      setDeleteId(null);
    }
  };
  const nav = [
    { id: 'workspace' as const, name: 'Workspace', icon: PanelsTopLeft },
    { id: 'harnesses' as const, name: 'Harnesses', icon: Plug },
    { id: 'sessions' as const, name: 'All sessions', icon: History },
    { id: 'developers' as const, name: 'For developers', icon: Braces },
  ];

  const composer = (
    <div className={`composer ${running ? 'is-running' : ''}`}>
      <div className="composer-project">
        <Folder size={15} />
        <input
          id="project-path"
          aria-label="Project directory"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="Path to your project"
          disabled={running}
        />
        <button
          className="icon-button"
          title="Choose project directory"
          aria-label="Choose project directory"
          onClick={() => void selectFolder()}
          disabled={running}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
      <textarea
        ref={promptRef}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          active
            ? `Continue with ${chosen.name}, or choose another agent…`
            : 'What would you like to build?'
        }
        aria-label="Message your agent"
        disabled={running}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-controls">
        <div className="composer-options">
          <label className="select-control">
            <ShieldCheck size={14} />
            <select
              aria-label="Permission mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as PermissionMode)}
              disabled={running}
            >
              <option value="review">Review</option>
              <option value="edit">Allow edits</option>
            </select>
            <ChevronDown size={12} />
          </label>
          <span className="control-separator" />
          <input
            className="model-input"
            aria-label="Model override"
            placeholder="Default model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={running}
          />
        </div>
        {running ? (
          <button className="run-button stop" onClick={() => void stop()}>
            <Square size={13} fill="currentColor" />
            Stop agent
          </button>
        ) : (
          <button
            className="run-button"
            onClick={() => void submit()}
            disabled={!prompt.trim() || !chosen.available || busy || !config}
          >
            {busy ? <Loader2 className="spin" size={15} /> : <ArrowUpRight size={16} />}
            <span>{active ? 'Continue' : 'Start session'}</span>
            <kbd>↵</kbd>
          </button>
        )}
      </div>
      <div className="composer-caption">
        <span>
          {mode === 'review'
            ? 'Review with the harness’s native permission policy.'
            : 'File edits enabled. Other actions follow the harness’s policy.'}
        </span>
        <span>⌘ / Ctrl + Enter</span>
      </div>
    </div>
  );

  return (
    <div className={`app ${window.desktop ? 'desktop' : ''}`}>
      {mobileNav && <div className="nav-scrim" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="window-drag" />
        <button className="brand" onClick={newSession}>
          <Brand />
          <span>
            oh-my-adaptor<small>YOUR AGENT WORKSPACE</small>
          </span>
        </button>
        <button className="new-session" onClick={newSession}>
          <Plus size={17} />
          <span>New session</span>
          <kbd>↗</kbd>
        </button>
        <nav>
          {nav.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={17} />
              <span>{name}</span>
              {id === 'harnesses' && <span className="nav-count">{connected}</span>}
            </button>
          ))}
        </nav>
        <div className="recent-heading">
          <span>RECENT SESSIONS</span>
          <button className="icon-button" onClick={newSession} aria-label="New session">
            <Plus size={14} />
          </button>
        </div>
        <div className="recent-sessions">
          {sessions.length ? (
            sessions.slice(0, 8).map((s) => (
              <button
                key={s.id}
                className={`recent-session ${active?.id === s.id && page === 'workspace' ? 'selected' : ''}`}
                onClick={() => void openSession(s.id)}
              >
                <span className={`status-dot ${s.status}`} />
                <span>{s.prompt}</span>
              </button>
            ))
          ) : (
            <div className="recent-empty">
              <MessageSquare size={23} strokeWidth={1.3} />
              <p>A little space for your next big idea.</p>
              <span>Your sessions will appear here.</span>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="mini-terminal">
              <Terminal size={16} />
            </span>
            <div>
              Your tools. Your machine.<small>Powered by your local CLIs</small>
            </div>
            <ShieldCheck size={15} />
          </div>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={17} />
            <span>Preferences</span>
            <span className="version">v0.1</span>
          </button>
          <div className="engine-status">
            <span className={`status-dot ${config ? 'completed' : 'failed'}`} />
            {config ? 'Local engine connected' : 'Connecting to local engine'}
            <span className="engine-port">{config ? 'LOCAL' : '…'}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={19} />
            </button>
            <span className="breadcrumb-root">Personal workspace</span>
            <ChevronRight size={13} />
            <span>
              {page === 'workspace'
                ? active
                  ? 'Session'
                  : 'Overview'
                : page === 'developers'
                  ? 'For developers'
                  : page === 'settings'
                    ? 'Preferences'
                    : page === 'sessions'
                      ? 'All sessions'
                      : 'Harnesses'}
            </span>
          </div>
          <button
            className="search-button"
            onClick={() => {
              setPalette(true);
              setSearch('');
            }}
          >
            <Search size={14} />
            <span>Quick switch</span>
            <kbd>⌘ K</kbd>
          </button>
        </header>
        <div
          className="main-scroll"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
          }}
        >
          <div className={`content ${active && page === 'workspace' ? 'session-content' : ''}`}>
            {error && (
              <div className="error-banner" role="alert">
                <CircleHelp size={17} />
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => setError('')}
                >
                  <X size={15} />
                </button>
              </div>
            )}

            {page === 'workspace' && !active && (
              <>
                <section className="welcome">
                  <div>
                    <div className="eyebrow">
                      <span className="status-dot completed" />
                      ONE INTERFACE. ALL YOUR AGENTS.
                    </div>
                    <h1>
                      Great work starts
                      <br />
                      with the right agent<span className="accent-period">.</span>
                    </h1>
                    <p>
                      Bring your favorite coding agents together.
                      <br className="mobile-break" /> Same workspace. Endless possibilities.
                    </p>
                  </div>
                  <div className="orbit-art" aria-hidden="true">
                    <div className="orbit-ring one" />
                    <div className="orbit-ring two" />
                    <span className="orbit-line horizontal" />
                    <span className="orbit-line vertical" />
                    <div className="orbit-center">
                      <Brand />
                    </div>
                    <span className="orbit-node node-one">
                      <Asterisk size={25} />
                    </span>
                    <span className="orbit-node node-two">
                      <Command size={22} />
                    </span>
                    <span className="orbit-node node-three">
                      <Sparkles size={22} />
                    </span>
                    <span className="orbit-node node-four">
                      <Box size={22} />
                    </span>
                    <span className="orbit-spark spark-one">+</span>
                    <span className="orbit-spark spark-two">+</span>
                  </div>
                </section>
                <div className="section-heading">
                  <h2>
                    Choose your agent <span className="quiet-count">{harnesses.length}</span>
                  </h2>
                  <button className="text-button" onClick={() => navigate('harnesses')}>
                    Manage harnesses
                    <ArrowRight size={14} />
                  </button>
                </div>
                <div className="harness-grid">
                  {harnesses.map((h) => (
                    <button
                      key={h.id}
                      className={`harness-card ${selected === h.id ? 'selected' : ''}`}
                      onClick={() => choose(h.id)}
                      aria-pressed={selected === h.id}
                    >
                      <div className="card-top">
                        <HarnessIcon id={h.id} />
                        <span className={`selection-circle ${selected === h.id ? 'checked' : ''}`}>
                          {selected === h.id && <Check size={12} />}
                        </span>
                      </div>
                      <h3>{h.name}</h3>
                      <span className="provider">{h.provider}</span>
                      <div className={`availability ${h.available ? 'available' : ''}`}>
                        <span className="status-dot" />
                        {detecting
                          ? 'Checking…'
                          : h.available
                            ? 'Detected locally'
                            : 'Not installed'}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="start-heading">
                  <span>
                    <span className="step-label">LET’S MAKE SOMETHING</span>
                    <h2>Give {chosen.name} a task</h2>
                  </span>
                  <HarnessIcon id={chosen.id} small />
                </div>
                {!chosen.available && !detecting && (
                  <div className="setup-notice">
                    <Plug size={16} />
                    <span>Install {chosen.name} and sign in through its CLI to get started.</span>
                    <a href={chosen.docsUrl} target="_blank" rel="noreferrer">
                      Setup guide
                      <ArrowUpRight size={13} />
                    </a>
                    <button
                      className="icon-button"
                      onClick={() => void refresh()}
                      aria-label="Refresh harness detection"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                )}
                {composer}
                <div className="starter-heading">A starting point, if you need one</div>
                <div className="starter-grid">
                  {[
                    {
                      icon: BookOpen,
                      title: 'Explore a codebase',
                      description: 'Find your way around a project',
                      prompt:
                        'Explore this repository. Explain its architecture, main entry points, and how to run it. Do not modify files.',
                    },
                    {
                      icon: Code2,
                      title: 'Review your code',
                      description: 'A fresh pair of eyes on your work',
                      prompt:
                        'Review the current changes in this repository. Identify bugs, edge cases, and missing tests. Explain your findings without editing files.',
                    },
                    {
                      icon: Zap,
                      title: 'Plan the next feature',
                      description: 'Turn an idea into a clear plan',
                      prompt:
                        'Review this project and suggest one useful next feature. Propose a concrete implementation plan with the files to change and how to test it.',
                    },
                  ].map(({ icon: Icon, title, description, prompt }) => (
                    <button
                      key={title}
                      className="starter-card"
                      onClick={() => {
                        setPrompt(prompt);
                        promptRef.current?.focus();
                      }}
                    >
                      <Icon size={18} />
                      <strong>{title}</strong>
                      <span>{description}</span>
                      <ArrowUpRight className="starter-arrow" size={14} />
                    </button>
                  ))}
                </div>
                <div className="workspace-footnote">
                  <ShieldCheck size={13} />
                  <span>Local execution. Your existing accounts. No extra API keys to manage.</span>
                  <span className="open-source-label">
                    BUILT TO BE OPEN <ArrowUpRight size={11} />
                  </span>
                </div>
              </>
            )}

            {page === 'workspace' && active && (
              <>
                <div className="session-heading">
                  <div className="session-title">
                    <HarnessIcon id={active.harness} />
                    <div>
                      <span className="eyebrow">
                        {harnesses.find((h) => h.id === active.harness)?.name ?? active.harness}{' '}
                        SESSION
                      </span>
                      <h1>
                        {active.prompt.length > 62
                          ? active.prompt.slice(0, 62) + '…'
                          : active.prompt}
                      </h1>
                    </div>
                  </div>
                  <span className={`status-badge ${active.status}`}>
                    <span className="status-dot" />
                    {statusName(active.status)}
                  </span>
                </div>
                <div className="session-meta">
                  <span>
                    <Folder size={13} />
                    {active.cwd}
                  </span>
                  <span>{relativeDate(active.startedAt)}</span>
                  <button
                    className="text-button"
                    onClick={() =>
                      void copy(
                        active.events
                          .filter((e) => e.kind === 'message' || e.kind === 'delta')
                          .map((e) => e.text)
                          .join('\n'),
                      )
                    }
                  >
                    <Copy size={13} />
                    Copy response
                  </button>
                </div>
                {active.parentId && (
                  <button
                    className="context-note"
                    onClick={() => void openSession(active.parentId!)}
                  >
                    <ArrowDownLeft size={14} />
                    Continued with conversation context from a previous run
                    <ArrowUpRight size={12} />
                  </button>
                )}
                <div className="user-message">
                  <span className="avatar">Y</span>
                  <div>
                    <strong>You</strong>
                    <p>{active.prompt}</p>
                  </div>
                </div>
                <div className="agent-transcript">
                  <div className="transcript-label">
                    <HarnessIcon id={active.harness} small />
                    <strong>
                      {harnesses.find((h) => h.id === active.harness)?.name ?? active.harness}
                    </strong>
                    {running && (
                      <span className="working-label">
                        <Loader2 className="spin" size={12} />
                        Working
                      </span>
                    )}
                    <label className="logs-toggle">
                      <input
                        type="checkbox"
                        checked={showLogs}
                        onChange={(e) => setShowLogs(e.target.checked)}
                      />
                      Show logs
                    </label>
                  </div>
                  <EventList events={active.events} showLogs={showLogs} />
                  {running && (
                    <div className="thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                  {active.status === 'failed' && (
                    <div className="failure-hint">
                      Check the output above. If authentication is required, sign in with the
                      harness’s CLI, then start a new session.
                    </div>
                  )}
                </div>
                <div ref={bottomRef} />
                <div className="follow-up">
                  <div className="followup-heading">
                    <span>
                      {running ? 'Your agent is working on it' : 'Keep the conversation going'}
                    </span>
                    <label>
                      <span>Continue with</span>
                      <select
                        value={selected}
                        onChange={(e) => choose(e.target.value)}
                        disabled={running}
                        aria-label="Continue with agent"
                      >
                        {harnesses.map((h) => (
                          <option key={h.id} value={h.id} disabled={!h.available}>
                            {h.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {composer}
                  {!running && (
                    <p className="context-caption">
                      Previous messages are passed as context. Each run starts a fresh agent
                      process.
                    </p>
                  )}
                </div>
              </>
            )}

            {page === 'harnesses' && (
              <>
                <PageHeading
                  eyebrow="YOUR CONNECTIONS"
                  title="A home for every harness."
                  subtitle="Use the tools you already love, with the accounts you already have."
                  action={
                    <button
                      className="secondary-button"
                      onClick={() => void refresh()}
                      disabled={detecting}
                    >
                      <RefreshCw size={15} className={detecting ? 'spin' : ''} />
                      {detecting ? 'Checking…' : 'Refresh detection'}
                    </button>
                  }
                />
                <div className="info-strip">
                  <span className="status-dot completed" />
                  <strong>
                    {connected} of {harnesses.length} harnesses detected
                  </strong>
                  <span>Authentication is checked by each CLI when you start a session.</span>
                </div>
                <div className="integration-grid">
                  {harnesses.map((h) => (
                    <article className="integration-card" key={h.id}>
                      <div className="integration-top">
                        <HarnessIcon id={h.id} />
                        <span className={`integration-state ${h.available ? 'detected' : ''}`}>
                          {h.available ? <Check size={12} /> : <Circle size={10} />}{' '}
                          {h.available ? 'Detected' : 'Not installed'}
                        </span>
                      </div>
                      <h2>{h.name}</h2>
                      <span className="provider">{h.provider}</span>
                      <p>{h.description}</p>
                      <div className="integration-command">
                        <Terminal size={14} />
                        <code>{h.command} --version</code>
                        <button
                          className="icon-button"
                          aria-label={`Copy ${h.name} version command`}
                          onClick={() => void copy(`${h.command} --version`)}
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                      <span className="version-detail">
                        {h.version ?? h.error ?? 'Install the CLI and make it available on PATH.'}
                      </span>
                      <div className="integration-footer">
                        <a href={h.docsUrl} target="_blank" rel="noreferrer">
                          {h.available ? 'Documentation' : 'Install & sign in'}
                          <ExternalLink size={13} />
                        </a>
                        <button
                          className="text-button"
                          onClick={() => {
                            choose(h.id);
                            newSession();
                          }}
                          disabled={!h.available}
                        >
                          Use agent
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="extension-banner">
                  <span className="extension-icon">
                    <Braces size={24} />
                  </span>
                  <div>
                    <h3>Your next harness belongs here, too.</h3>
                    <p>Register a custom adapter with the SDK. One interface, any coding agent.</p>
                  </div>
                  <button className="secondary-button" onClick={() => navigate('developers')}>
                    Explore the SDK
                    <ArrowUpRight size={14} />
                  </button>
                </div>
              </>
            )}

            {page === 'sessions' && (
              <>
                <PageHeading
                  eyebrow="PICK UP WHERE YOU LEFT OFF"
                  title="Your sessions."
                  subtitle="Every idea, every agent, all in one place."
                  action={
                    <button className="run-button" onClick={newSession}>
                      <Plus size={15} />
                      New session
                    </button>
                  }
                />
                <div className="session-search">
                  <Search size={17} />
                  <input
                    aria-label="Search sessions"
                    placeholder="Search by prompt, agent, or project…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <span>{sessions.length} sessions</span>
                </div>
                {sessions.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <MessageSquare size={32} strokeWidth={1.3} />
                    </span>
                    <h2>Your first session is a prompt away.</h2>
                    <p>Start a conversation with an agent. We’ll keep the history here.</p>
                    <button className="secondary-button" onClick={newSession}>
                      Start something
                      <ArrowRight size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="session-list">
                    {sessions
                      .filter((s) =>
                        `${s.prompt} ${s.harness} ${s.cwd}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((s) => (
                        <div className="session-row" key={s.id}>
                          <button className="session-open" onClick={() => void openSession(s.id)}>
                            <HarnessIcon id={s.harness} small />
                            <div>
                              <strong>{s.prompt}</strong>
                              <span>
                                {s.harness} <span>·</span> {relativeDate(s.startedAt)}{' '}
                                <span>·</span> {s.cwd.split('/').at(-1)}
                              </span>
                            </div>
                            <span className={`status-badge ${s.status}`}>
                              <span className="status-dot" />
                              {statusName(s.status)}
                            </span>
                            <ChevronRight size={16} />
                          </button>
                          <button
                            className="icon-button delete-button"
                            aria-label="Delete session"
                            disabled={s.status === 'running'}
                            onClick={() => setDeleteId(s.id)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    {!sessions.some((s) =>
                      `${s.prompt} ${s.harness} ${s.cwd}`
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    ) && (
                      <div className="empty-state compact">
                        <Search size={25} />
                        <h2>No matching sessions.</h2>
                        <p>Try another prompt, agent name, or project.</p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {page === 'developers' && (
              <>
                <PageHeading
                  eyebrow="BUILD ON TOP"
                  title="One API. Every agent."
                  subtitle="The desktop app and CLI run on the same extensible TypeScript engine."
                />
                <div className="developer-tabs">
                  <span>
                    <Braces size={16} />
                    TypeScript SDK
                  </span>
                  <span className="muted">Node.js 22+</span>
                </div>
                <CodeBlock
                  title="A small interface. A lot of possibility."
                  code={`import { Adaptor } from 'oh-my-adaptor';\n\nconst adaptor = await Adaptor.create();\nconst run = await adaptor.run({\n  harness: 'codex',\n  cwd: process.cwd(),\n  prompt: 'Explain the architecture of this project',\n  mode: 'review',\n});\n\nfor await (const event of run.events) {\n  console.log(event.kind, event.text);\n}\n\nconst session = await run.done;\n// run.cancel() to stop the agent`}
                  onCopy={copy}
                />
                <div className="developer-tabs">
                  <span>
                    <Terminal size={16} />
                    Your terminal, connected
                  </span>
                </div>
                <CodeBlock
                  title="Build locally, then link the CLI"
                  code={`npm install && npm run build && npm link\n\noma harnesses\noma run -h claude "Explain this project"\noma run -h codex --mode edit "Fix the failing test"\noma run -h gemini --json "Review this code"\noma sessions`}
                  onCopy={copy}
                />
                <div className="sdk-features">
                  <div>
                    <Plug size={20} />
                    <h3>Bring your own harness</h3>
                    <p>Implement HarnessAdapter and register it with adaptor.register().</p>
                  </div>
                  <div>
                    <Zap size={20} />
                    <h3>One event stream</h3>
                    <p>Messages, tools, usage, and errors normalized across every agent.</p>
                  </div>
                  <div>
                    <ShieldCheck size={20} />
                    <h3>Local by design</h3>
                    <p>Run existing CLI installations. Credentials stay with each provider.</p>
                  </div>
                </div>
              </>
            )}

            {page === 'settings' && (
              <>
                <PageHeading
                  eyebrow="MAKE YOURSELF AT HOME"
                  title="Your workspace, your way."
                  subtitle="A few small preferences to keep you in flow."
                />
                <section className="settings-section">
                  <h2>Workspace</h2>
                  <div className="setting-row">
                    <div>
                      <strong>Project directory</strong>
                      <p>The folder agents work in when you start a new session.</p>
                    </div>
                    <div className="settings-path">
                      <input
                        aria-label="Default project directory"
                        value={cwd}
                        onChange={(e) => setCwd(e.target.value)}
                      />
                      <button
                        className="icon-button"
                        onClick={() => void selectFolder()}
                        aria-label="Choose default project directory"
                      >
                        <Folder size={17} />
                      </button>
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Preferred harness</strong>
                      <p>Your starting agent. You can switch at any time.</p>
                    </div>
                    <select
                      aria-label="Preferred harness"
                      value={selected}
                      onChange={(e) => choose(e.target.value)}
                    >
                      {harnesses.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="setting-row">
                    <div>
                      <strong>Show diagnostic logs</strong>
                      <p>Include raw CLI output in the session transcript.</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={showLogs}
                      aria-label="Show diagnostic logs"
                      className={`toggle ${showLogs ? 'on' : ''}`}
                      onClick={() => setShowLogs(!showLogs)}
                    >
                      <span />
                    </button>
                  </div>
                </section>
                <section className="settings-section">
                  <h2>About this workspace</h2>
                  <div className="about-grid">
                    <span>
                      Application<strong>oh-my-adaptor · {config?.version ?? '0.1.0'}</strong>
                    </span>
                    <span>
                      Environment
                      <strong>
                        {window.desktop
                          ? `Desktop · ${window.desktop.platform}`
                          : 'Local browser workspace'}
                      </strong>
                    </span>
                    <span>
                      Session storage<strong>~/.oh-my-adaptor/sessions</strong>
                    </span>
                    <span>
                      Connection<strong>Loopback only · 127.0.0.1</strong>
                    </span>
                  </div>
                  <p className="settings-note">
                    Prompts and agent output are saved locally. Each harness uses its own
                    authentication and sends requests to its configured model provider. Permission
                    modes use native harness policies; they are not a shared OS sandbox.
                  </p>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {palette && (
        <div className="modal-backdrop" onClick={() => setPalette(false)}>
          <div
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Quick switch"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="palette-input">
              <Search size={18} />
              <input
                autoFocus
                placeholder="Find a session or jump to a page…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Quick switch search"
              />
              <button
                className="icon-button"
                onClick={() => setPalette(false)}
                aria-label="Close quick switch"
              >
                <X size={16} />
              </button>
            </div>
            <div className="palette-results">
              <span className="eyebrow">JUMP TO</span>
              {[{ id: 'new', name: 'New session', icon: Plus }, ...nav]
                .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
                .map(({ id, name, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => {
                      id === 'new' ? newSession() : navigate(id as Page);
                      setPalette(false);
                    }}
                  >
                    <Icon size={17} />
                    {name}
                    <ArrowRight size={14} />
                  </button>
                ))}
              {sessions
                .filter((s) => s.prompt.toLowerCase().includes(search.toLowerCase()))
                .slice(0, 6)
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      void openSession(s.id);
                      setPalette(false);
                    }}
                  >
                    <HarnessIcon id={s.harness} small />
                    <span>{s.prompt}</span>
                  </button>
                ))}
            </div>
            <div className="palette-footer">
              Click an item to open it
              <span>
                <kbd>esc</kbd> to close
              </span>
            </div>
          </div>
        </div>
      )}
      {deleteId && (
        <div className="modal-backdrop" onClick={() => setDeleteId(null)}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 size={23} />
            <h2 id="delete-title">Delete this session?</h2>
            <p>
              This removes its local conversation and event history. Your project files stay as they
              are.
            </p>
            <div>
              <button className="secondary-button" onClick={() => setDeleteId(null)}>
                Keep session
              </button>
              <button className="danger-button" onClick={() => void removeSession()}>
                Delete session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function CodeBlock({
  title,
  code,
  onCopy,
}: {
  title: string;
  code: string;
  onCopy(text: string): Promise<void>;
}) {
  return (
    <div className="code-block">
      <div>
        <span>{title}</span>
        <button className="icon-button" aria-label="Copy code" onClick={() => void onCopy(code)}>
          <Copy size={15} />
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
function EventList({ events, showLogs }: { events: AgentEvent[]; showLogs: boolean }) {
  const grouped: AgentEvent[] = [];
  for (const event of events) {
    if (event.kind === 'delta' && grouped.at(-1)?.kind === 'delta')
      grouped[grouped.length - 1] = { ...grouped.at(-1)!, text: grouped.at(-1)!.text + event.text };
    else grouped.push(event);
  }
  return (
    <>
      {grouped.map((event) => {
        if (event.kind === 'message' || event.kind === 'delta')
          return (
            <div className="markdown" key={event.sequence}>
              <Markdown
                components={{
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {event.text}
              </Markdown>
            </div>
          );
        if (event.kind === 'error')
          return (
            <div className="agent-error" key={event.sequence}>
              <CircleHelp size={16} />
              <pre>{event.text}</pre>
            </div>
          );
        if (event.kind === 'tool' || event.kind === 'result')
          return (
            <details className="tool-event" key={event.sequence}>
              <summary>
                <Terminal size={14} />
                <span>{event.kind === 'result' ? 'Tool result' : event.text}</span>
                <ChevronDown size={13} />
              </summary>
              <pre>
                {event.kind === 'result' ? event.text : JSON.stringify(event.data, null, 2)}
              </pre>
            </details>
          );
        if (event.kind === 'status')
          return (
            <div className="event-status" key={event.sequence}>
              <span className="tiny-dot" />
              {event.text}
            </div>
          );
        if (event.kind === 'usage')
          return (
            showLogs && (
              <details className="tool-event" key={event.sequence}>
                <summary>
                  <Zap size={14} />
                  {event.text}
                  <ChevronDown size={13} />
                </summary>
                <pre>{JSON.stringify(event.data, null, 2)}</pre>
              </details>
            )
          );
        return (
          showLogs && (
            <details className="tool-event log-event" key={event.sequence}>
              <summary>
                <Terminal size={13} />
                <span>{event.text}</span>
              </summary>
              {event.data && <pre>{JSON.stringify(event.data, null, 2)}</pre>}
            </details>
          )
        );
      })}
    </>
  );
}
