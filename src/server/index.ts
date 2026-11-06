import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Adaptor } from '../core/index.js';

export async function startServer(
  options: { port?: number; dev?: boolean; dataDir?: string; cwd?: string; adaptor?: Adaptor } = {},
) {
  const adaptor = options.adaptor ?? (await Adaptor.create({ dataDir: options.dataDir }));
  const app = express();
  const server = createHttpServer(app);
  const token = randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (!hosts.includes(req.headers.host ?? '')) {
      res.status(403).json({ error: 'Only local connections are allowed.' });
      return;
    }
    const origin = req.headers.origin;
    if (
      (origin && !hosts.some((host) => origin === `http://${host}`)) ||
      req.headers['sec-fetch-site'] === 'cross-site'
    ) {
      res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!options.dev)
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
      );
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      const supplied = req.headers['x-oma-token'];
      if (
        typeof supplied !== 'string' ||
        Buffer.byteLength(supplied) !== token.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      ) {
        res.status(403).json({ error: 'Invalid local session token. Reload the app.' });
        return;
      }
    }
    next();
  });
  app.get('/api/config', (_req, res) => {
    res.json({ token, cwd: options.cwd ?? process.cwd(), version: '0.1.0' });
  });
  app.get('/api/harnesses', async (_req, res) => {
    res.json(await adaptor.detect());
  });
  app.get('/api/sessions', async (_req, res) => {
    await adaptor.sync();
    res.json(adaptor.list());
  });
  app.post('/api/sessions', async (req, res) => {
    const { harness, prompt, cwd, model, mode, parentId } = req.body ?? {};
    if (typeof harness !== 'string' || (parentId !== undefined && typeof parentId !== 'string')) {
      res.status(400).json({ error: 'Invalid session request.' });
      return;
    }
    const run = await adaptor.run({ harness, prompt, cwd, model, mode, parentId });
    res.status(201).json(run.session);
  });
  app.get('/api/sessions/:id', (req, res) => {
    const session = adaptor.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.json(session);
  });
  app.post('/api/sessions/:id/cancel', (req, res) => {
    if (!adaptor.get(req.params.id)) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    adaptor.cancel(req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/sessions/:id', async (req, res) => {
    await adaptor.remove(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/sessions/:id/events', (req, res) => {
    const session = adaptor.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const after = Number(req.headers['last-event-id'] ?? req.query.after ?? 0);
    const send = (event: { sequence: number }, current = session) => {
      res.write(
        `id: ${event.sequence}\ndata: ${JSON.stringify({ event, status: current.status, finishedAt: current.finishedAt })}\n\n`,
      );
      if (res.writableLength > 1024 * 1024) res.destroy();
    };
    for (const event of session.events) if (event.sequence > after) send(event);
    if (session.status !== 'running') {
      res.write(`event: done\ndata: ${JSON.stringify({ status: session.status })}\n\n`);
      res.end();
      return;
    }
    let sequence = session.events.at(-1)?.sequence ?? 0;
    const unsubscribe = adaptor.subscribe(session.id, (event, current) => {
      sequence = event.sequence;
      send(event, current);
      if (current.status !== 'running') {
        res.write(`event: done\ndata: ${JSON.stringify({ status: current.status })}\n\n`);
        res.end();
      }
    });
    // Runs launched by a separate SDK/CLI process are followed through their checkpoints.
    const external =
      session.ownerPid !== process.pid
        ? setInterval(() => {
            void adaptor
              .sync()
              .then(() => {
                if (res.destroyed) return;
                const current = adaptor.get(session.id);
                if (!current) return;
                for (const event of current.events)
                  if (event.sequence > sequence) {
                    send(event, current);
                    sequence = event.sequence;
                  }
                if (current.status !== 'running') {
                  res.write(`event: done\ndata: ${JSON.stringify({ status: current.status })}\n\n`);
                  res.end();
                }
              })
              .catch(() => {});
          }, 1000)
        : undefined;
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15_000);
    res.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(external);
      unsubscribe();
    });
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API route not found.' });
  });
  let vite: { close(): Promise<void> } | undefined;
  if (options.dev) {
    const { createServer } = await import('vite');
    const dev = await createServer({
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
    app.use(dev.middlewares);
    vite = dev;
  } else {
    const location = dirname(fileURLToPath(import.meta.url));
    const ui = existsSync(join(location, 'ui', 'index.html'))
      ? join(location, 'ui')
      : join(location, '..', 'ui');
    app.use(express.static(ui));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(join(ui, 'index.html'));
    });
  }
  app.use(
    (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: error.message || 'Request failed.' });
    },
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4317, '127.0.0.1', resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 4317}`;
  return {
    url,
    adaptor,
    async close() {
      await adaptor.close();
      await vite?.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
