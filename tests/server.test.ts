import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Adaptor, createParser } from '../src/core/index';
import { startServer } from '../src/server/index';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
let dataDir: string | undefined;
afterEach(async () => {
  await server?.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('local API boundary and streaming', () => {
  it('requires same-origin requests and a token, validates input, and replays SSE history', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'oma-api-'));
    const adaptor = await Adaptor.create({
      dataDir,
      adapters: [
        {
          id: 'fixture',
          name: 'Fixture',
          provider: 'Test',
          description: '',
          docsUrl: '',
          command: process.execPath,
          build: () => ({
            args: [
              '-e',
              'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"Hello from API"}}))',
            ],
          }),
          createParser: () => createParser('codex'),
        },
      ],
    });
    server = await startServer({ port: 0, adaptor });
    const url = server.url;
    expect(
      (await fetch(`${url}/api/config`, { headers: { Origin: 'https://evil.example' } })).status,
    ).toBe(403);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/api/config`, { headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    expect(reboundStatus).toBe(403);
    expect(
      (
        await fetch(`${url}/api/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    const { token } = await (await fetch(`${url}/api/config`)).json();
    const headers = { 'Content-Type': 'application/json', 'X-OMA-Token': token };
    expect(
      (
        await fetch(`${url}/api/sessions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ harness: 'missing', prompt: 'hello', cwd: dataDir }),
        })
      ).status,
    ).toBe(400);
    const created = await fetch(`${url}/api/sessions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ harness: 'fixture', prompt: 'hello', cwd: dataDir }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    const stream = await fetch(`${url}/api/sessions/${session.id}/events`);
    const output = await stream.text();
    expect(output).toContain('Hello from API');
    expect(output).toContain('event: done');
    const replay = await (
      await fetch(`${url}/api/sessions/${session.id}/events`, { headers: { 'Last-Event-ID': '1' } })
    ).text();
    expect(replay).not.toContain('id: 1\n');
    expect(replay).toContain('Hello from API');
    expect(
      (await fetch(`${url}/api/sessions/${session.id}`, { method: 'DELETE', headers })).status,
    ).toBe(200);
    expect((await fetch(`${url}/api/sessions/${session.id}`)).status).toBe(404);
  });
});
