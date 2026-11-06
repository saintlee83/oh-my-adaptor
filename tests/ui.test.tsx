// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/ui/App';
import type { Session } from '../src/core/types';

const harnesses = [
  {
    id: 'claude',
    name: 'Claude Code',
    provider: 'Anthropic',
    command: 'claude',
    available: true,
    docsUrl: 'https://code.claude.com',
    description: 'Claude',
  },
  {
    id: 'codex',
    name: 'Codex',
    provider: 'OpenAI',
    command: 'codex',
    available: true,
    docsUrl: 'https://developers.openai.com',
    description: 'Codex',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    provider: 'Google',
    command: 'gemini',
    available: false,
    docsUrl: 'https://geminicli.com',
    description: 'Gemini',
  },
];
class FakeEventSource {
  static latest: FakeEventSource;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor() {
    FakeEventSource.latest = this;
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
  emit(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
let posted: Record<string, unknown> | undefined;
let rejectRun = false;
let current: Session | undefined;
beforeEach(() => {
  localStorage.clear();
  posted = undefined;
  rejectRun = false;
  current = undefined;
  window.desktop = undefined;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/config')
        return Response.json({ token: 'test-token', cwd: '/project', version: '0.1.0' });
      if (url === '/api/harnesses') return Response.json(harnesses);
      if (url === '/api/sessions' && options?.method === 'POST') {
        posted = JSON.parse(String(options.body));
        if (rejectRun)
          return Response.json({ error: 'Project directory does not exist.' }, { status: 400 });
        current = {
          id: 'test-session',
          prompt: String(posted!.prompt),
          cwd: String(posted!.cwd),
          harness: String(posted!.harness),
          mode: 'review',
          startedAt: new Date().toISOString(),
          status: 'running',
          events: [],
        };
        return Response.json(current, { status: 201 });
      }
      if (url === '/api/sessions')
        return Response.json(current ? [{ ...current, events: undefined, eventCount: 0 }] : []);
      if (url === '/api/sessions/test-session') return Response.json(current);
      return Response.json({ ok: true });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.desktop = undefined;
});

describe('workspace interactions', () => {
  it('selects an agent, submits the project and prompt, and renders streamed responses once', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText('Detected locally');
    await user.click(screen.getByRole('button', { name: /Codex OpenAI/ }));
    await user.click(screen.getByRole('button', { name: /Explore a codebase/ }));
    expect(
      (screen.getByRole('textbox', { name: 'Message your agent' }) as HTMLTextAreaElement).value,
    ).toContain('Explore this repository');
    await user.click(screen.getByRole('button', { name: /Start session/ }));
    await waitFor(() => expect(posted?.harness).toBe('codex'));
    expect(posted?.cwd).toBe('/project');
    await screen.findByRole('button', { name: /Stop agent/ });
    const payload = {
      event: {
        sequence: 1,
        timestamp: new Date().toISOString(),
        kind: 'message',
        text: 'A real streamed response',
      },
      status: 'running',
    };
    FakeEventSource.latest.emit(payload);
    FakeEventSource.latest.emit(payload);
    await waitFor(() => expect(screen.getAllByText('A real streamed response')).toHaveLength(1));
  });
  it('keeps failed submissions editable and explains missing installations', async () => {
    rejectRun = true;
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText('Detected locally');
    await user.type(screen.getByRole('textbox', { name: 'Message your agent' }), 'Hello agent');
    await user.click(screen.getByRole('button', { name: /Start session/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (screen.getByRole('textbox', { name: 'Message your agent' }) as HTMLTextAreaElement).value,
    ).toBe('Hello agent');
    await user.click(screen.getByRole('button', { name: /Gemini CLI Google/ }));
    expect(await screen.findByText(/Install Gemini CLI and sign in/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /Start session/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('uses the native project picker and opens quick switch from the keyboard', async () => {
    window.desktop = { platform: 'darwin', chooseDirectory: vi.fn(async () => '/chosen/project') };
    const user = userEvent.setup();
    render(<App />);
    await screen.findAllByText('Detected locally');
    await user.click(screen.getByRole('button', { name: 'Choose project directory' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('textbox', { name: 'Project directory' }) as HTMLInputElement).value,
      ).toBe('/chosen/project'),
    );
    await user.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Quick switch' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
