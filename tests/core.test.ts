import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Adaptor, builtinAdapters, createParser, type HarnessAdapter } from '../src/core/index';

const directories: string[] = [];
const engines: Adaptor[] = [];
async function engine(mode = 'ok') {
  const dataDir = await mkdtemp(join(tmpdir(), 'oma-test-'));
  directories.push(dataDir);
  const adapter: HarnessAdapter = {
    id: 'fixture',
    name: 'Fixture',
    provider: 'Tests',
    description: 'Local test process',
    command: process.execPath,
    docsUrl: '',
    build: (o) => ({
      args: [fileURLToPath(new URL('./fixtures/harness.cjs', import.meta.url)), mode],
      stdin: o.prompt,
    }),
    createParser: () => createParser('codex'),
  };
  const adaptor = await Adaptor.create({ dataDir, adapters: [adapter] });
  engines.push(adaptor);
  return { adaptor, dataDir };
}
afterEach(async () => {
  await Promise.all(engines.splice(0).map((a) => a.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('adapter protocols', () => {
  it('normalizes Claude tool calls, results and usage without duplicate response text', () => {
    const parse = createParser('claude');
    expect(
      parse(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'tool_use', name: 'Read', input: { file_path: 'README.md' }, id: 't1' },
            ],
          },
        }),
      ).map((e) => e.kind),
    ).toEqual(['message', 'tool']);
    expect(
      parse(JSON.stringify({ type: 'result', result: 'Hello', usage: { input_tokens: 4 } })).map(
        (e) => e.kind,
      ),
    ).toEqual(['usage']);
    expect(
      parse(JSON.stringify({ type: 'result', is_error: true, errors: ['login required'] }))[0].kind,
    ).toBe('error');
  });
  it('handles Gemini deltas, failures, and OpenCode tool payloads', () => {
    expect(
      createParser('gemini')(
        '{"type":"message","role":"assistant","delta":true,"content":"Hi"}',
      )[0],
    ).toMatchObject({ kind: 'delta', text: 'Hi' });
    expect(
      createParser('gemini')('{"type":"result","status":"error","error":"no key"}')[0].kind,
    ).toBe('error');
    expect(
      createParser('opencode')(
        '{"type":"tool_use","part":{"tool":"read","state":{"status":"completed"}}}',
      )[0],
    ).toMatchObject({ kind: 'tool', text: 'read' });
  });
  it('keeps unknown and malformed events inspectable', () => {
    for (const value of ['bad json', 'null', '[]', '42', '{"type":"future_event"}'])
      expect(createParser('codex')(value)[0].kind).toBe('log');
  });
  it('maps review/edit policy without bypassing all permissions', () => {
    for (const adapter of builtinAdapters) {
      for (const mode of ['review', 'edit'] as const) {
        const invocation = adapter.build({
          harness: adapter.id,
          prompt: '--help; $(whoami)',
          cwd: '/tmp',
          mode,
        });
        expect(invocation.args.join(' ')).not.toContain('dangerously');
        expect(invocation.args.join(' ')).not.toContain('yolo');
      }
    }
    expect(
      builtinAdapters
        .find((a) => a.id === 'codex')!
        .build({ harness: 'codex', prompt: 'x', cwd: '.', mode: 'review' }).args,
    ).toContain('read-only');
    expect(
      JSON.parse(
        builtinAdapters
          .find((a) => a.id === 'opencode')!
          .build({ harness: 'opencode', prompt: 'x', cwd: '.' }).env!.OPENCODE_PERMISSION,
      ),
    ).toMatchObject({ '*': 'deny', edit: 'deny' });
  });
});

describe('SDK process lifecycle', () => {
  it('streams split UTF-8, preserves literal prompts, and persists the final session', async () => {
    const { adaptor, dataDir } = await engine();
    const prompt = 'hello; $(whoami) `echo no`';
    const run = await adaptor.run({ harness: 'fixture', cwd: dataDir, prompt });
    const events = [];
    for await (const event of run.events) events.push(event);
    expect((await run.done).status).toBe('completed');
    expect(events.find((e) => e.kind === 'message')?.text).toBe(`안녕하세요 🌱 ${prompt}`);
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, index) => index + 1));
    const restored = await Adaptor.create({ dataDir });
    expect(restored.get(run.session.id)?.status).toBe('completed');
  });
  it('treats protocol failure as failed even with exit code zero', async () => {
    const { adaptor, dataDir } = await engine('fail');
    const run = await adaptor.run({ harness: 'fixture', cwd: dataDir, prompt: 'test' });
    expect((await run.done).status).toBe('failed');
  });
  it('cancels a long-running process and forbids deleting active runs', async () => {
    const { adaptor, dataDir } = await engine('wait');
    const run = await adaptor.run({ harness: 'fixture', cwd: dataDir, prompt: 'test' });
    await expect(adaptor.remove(run.session.id)).rejects.toThrow('Stop');
    run.cancel();
    expect((await run.done).status).toBe('cancelled');
    await adaptor.remove(run.session.id);
    expect(adaptor.get(run.session.id)).toBeUndefined();
  });
  it('enforces the concurrency limit even when starts race', async () => {
    const { adaptor, dataDir } = await engine('wait');
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        adaptor.run({ harness: 'fixture', cwd: dataDir, prompt: 'test' }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('validates paths and unknown harnesses before execution', async () => {
    const { adaptor, dataDir } = await engine();
    await expect(adaptor.run({ harness: 'missing', cwd: dataDir, prompt: 'test' })).rejects.toThrow(
      'Unknown',
    );
    await expect(
      adaptor.run({ harness: 'fixture', cwd: join(dataDir, 'no-such-dir'), prompt: 'test' }),
    ).rejects.toThrow('does not exist');
    await expect(adaptor.run({ harness: 'fixture', cwd: dataDir, prompt: '' })).rejects.toThrow(
      'prompt',
    );
  });
  it('passes prior conversation context into a fresh run', async () => {
    const { adaptor, dataDir } = await engine();
    const first = await adaptor.run({
      harness: 'fixture',
      cwd: dataDir,
      prompt: 'Original question',
    });
    await first.done;
    const next = await adaptor.run({
      harness: 'fixture',
      cwd: dataDir,
      prompt: 'Follow-up',
      parentId: first.session.id,
    });
    const session = await next.done;
    expect(session.events.find((e) => e.kind === 'message')?.text).toContain('Original question');
    expect(session.events.find((e) => e.kind === 'message')?.text).toContain(
      'Current user request:\nFollow-up',
    );
  });
  it('recovers interrupted sessions but preserves a live process’s session', async () => {
    const { adaptor, dataDir } = await engine('wait');
    const live = await adaptor.run({ harness: 'fixture', cwd: dataDir, prompt: 'test' });
    const interrupted = {
      ...live.session,
      id: '00000000-0000-0000-0000-000000000000',
      ownerPid: undefined,
    };
    await writeFile(join(dataDir, `${interrupted.id}.json`), JSON.stringify(interrupted));
    const restored = await Adaptor.create({ dataDir });
    expect(restored.get(interrupted.id)?.status).toBe('interrupted');
    expect(restored.get(live.session.id)?.status).toBe('running');
    live.cancel();
    await live.done;
  });
});
