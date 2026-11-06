import type { EventInput, HarnessAdapter, RunOptions } from './types.js';

type Json = Record<string, any>;
const str = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '');
const model = (options: RunOptions) => (options.model ? ['--model', options.model] : []);
const event = (kind: EventInput['kind'], text: string, data?: Json): EventInput => ({
  kind,
  text,
  ...(data ? { data } : {}),
});

/** Normalizes newline-delimited provider events. Unknown JSON remains inspectable. */
export function createParser(provider: string): (line: string) => EventInput[] {
  let sawMessage = false;
  return (line) => {
    if (!line.trim()) return [];
    let raw: Json;
    try {
      raw = JSON.parse(line);
    } catch {
      return [event('log', line)];
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [event('log', line)];
    if (provider === 'codex') {
      const item = raw.item;
      if (raw.type === 'item.completed' && item?.type === 'agent_message')
        return [event('message', str(item.text))];
      if (raw.type === 'item.completed' && item?.type === 'reasoning')
        return [event('log', str(item.text))];
      if (item && ['item.started', 'item.updated', 'item.completed'].includes(raw.type)) {
        return [
          event('tool', str(item.command ?? item.tool ?? item.type), { ...item, phase: raw.type }),
        ];
      }
      if (raw.type === 'turn.completed') return [event('usage', 'Turn completed', raw.usage)];
      if (raw.type === 'error' || raw.type === 'turn.failed')
        return [event('error', str(raw.message ?? raw.error?.message ?? raw.error))];
      if (raw.type === 'thread.started')
        return [event('status', 'Connected to Codex', { nativeSessionId: raw.thread_id })];
    }
    if (provider === 'claude') {
      // Full assistant messages avoid duplicating partial text and final result payloads.
      if (raw.type === 'assistant' || raw.type === 'user') {
        return (raw.message?.content ?? []).flatMap((block: Json) => {
          if (block.type === 'text' && raw.type === 'assistant') {
            sawMessage = true;
            return [event('message', str(block.text))];
          }
          if (block.type === 'tool_use')
            return [event('tool', str(block.name), { input: block.input, id: block.id })];
          if (block.type === 'tool_result')
            return [
              event('result', str(block.content), {
                toolId: block.tool_use_id,
                isError: block.is_error,
              }),
            ];
          return [];
        });
      }
      if (raw.type === 'result') {
        const events: EventInput[] = [];
        if (raw.is_error)
          events.push(event('error', str(raw.result ?? raw.errors ?? 'Claude run failed')));
        else if (!sawMessage && raw.result) events.push(event('message', str(raw.result)));
        if (raw.permission_denials?.length)
          events.push(
            event('log', 'Some tools were denied by the current permission policy.', {
              denials: raw.permission_denials,
            }),
          );
        if (raw.usage)
          events.push(
            event('usage', 'Turn completed', { ...raw.usage, costUsd: raw.total_cost_usd }),
          );
        return events;
      }
      if (raw.type === 'system')
        return [
          event(
            'status',
            raw.subtype === 'init' ? 'Connected to Claude Code' : str(raw.message ?? raw.subtype),
            { nativeSessionId: raw.session_id },
          ),
        ];
    }
    if (provider === 'gemini') {
      if (raw.type === 'message' && raw.role === 'assistant')
        return [event(raw.delta ? 'delta' : 'message', str(raw.content))];
      if (raw.type === 'message') return [];
      if (raw.type === 'tool_use')
        return [event('tool', str(raw.tool_name), { input: raw.parameters, id: raw.tool_id })];
      if (raw.type === 'tool_result')
        return [event('result', str(raw.output), { toolId: raw.tool_id, status: raw.status })];
      if (raw.type === 'init')
        return [event('status', 'Connected to Gemini CLI', { nativeSessionId: raw.session_id })];
      if (raw.type === 'result')
        return raw.status === 'error'
          ? [event('error', str(raw.error ?? 'Gemini run failed'))]
          : [event('usage', 'Turn completed', raw.stats)];
      if (raw.type === 'error')
        return [event(raw.severity === 'warning' ? 'log' : 'error', str(raw.message))];
    }
    if (provider === 'opencode') {
      if (raw.type === 'text') return [event('message', str(raw.part?.text ?? raw.text))];
      if (raw.type === 'tool_use')
        return [event('tool', str(raw.part?.tool ?? raw.tool), raw.part ?? raw)];
      if (raw.type === 'step_finish') return [event('usage', 'Step completed', raw.part ?? raw)];
      if (raw.type === 'error')
        return [event('error', str(raw.error?.data?.message ?? raw.error ?? raw.message))];
    }
    return [event('log', str(raw.type ?? 'event'), raw)];
  };
}

export const builtinAdapters: HarnessAdapter[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    provider: 'Anthropic',
    command: 'claude',
    description: 'Thoughtful reasoning. Deep code understanding.',
    docsUrl: 'https://code.claude.com/docs/en/overview',
    build: (o) => ({
      args: [
        '--print',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-prompts',
        'none',
        '--permission-mode',
        o.mode === 'edit' ? 'acceptEdits' : 'plan',
        ...model(o),
      ],
      stdin: o.prompt,
    }),
    createParser: () => createParser('claude'),
  },
  {
    id: 'codex',
    name: 'Codex',
    provider: 'OpenAI',
    command: 'codex',
    description: 'From a first idea to working software.',
    docsUrl: 'https://developers.openai.com/codex/cli',
    build: (o) => ({
      args: [
        'exec',
        '--json',
        '--color',
        'never',
        '--skip-git-repo-check',
        '--sandbox',
        o.mode === 'edit' ? 'workspace-write' : 'read-only',
        '-c',
        'approval_policy="never"',
        ...model(o),
        '-',
      ],
      stdin: o.prompt,
    }),
    createParser: () => createParser('codex'),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    provider: 'Google',
    command: 'gemini',
    description: 'A fresh perspective on your entire codebase.',
    docsUrl: 'https://geminicli.com/docs/',
    // Default headless policy denies tools requiring approval. Plan mode can auto-transition to YOLO.
    build: (o) => ({
      args: [
        '--output-format',
        'stream-json',
        '--approval-mode',
        o.mode === 'edit' ? 'auto_edit' : 'default',
        ...model(o),
        '--prompt',
        o.prompt,
      ],
    }),
    createParser: () => createParser('gemini'),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    provider: 'Open source',
    command: 'opencode',
    description: 'An open harness. Your choice of model.',
    docsUrl: 'https://opencode.ai/docs/',
    build: (o) => ({
      args: ['run', '--format', 'json', ...model(o), '--', o.prompt],
      env: {
        OPENCODE_PERMISSION: JSON.stringify({
          '*': 'deny',
          read: 'allow',
          glob: 'allow',
          grep: 'allow',
          list: 'allow',
          edit: o.mode === 'edit' ? 'allow' : 'deny',
        }),
      },
    }),
    createParser: () => createParser('opencode'),
  },
];
