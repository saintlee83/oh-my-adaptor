#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { Adaptor } from './core/index.js';
import { startServer } from './server/index.js';

const help = `
  oh-my-adaptor  v0.1.0
  One interface. Every coding agent.

  oma harnesses [--json]                  Detect installed harnesses
  oma run -h <harness> [options] <prompt>  Run a coding agent
  oma sessions [--json]                  List saved runs
  oma serve [--port 4317]                Start the local workspace

  Run options
    -h, --harness <id>    claude, codex, gemini, or opencode
    -C, --cwd <path>      Project directory (default: current directory)
    -m, --model <model>   Use a model supported by the selected CLI
    --mode <mode>        review (default) or edit; native CLI policy applies
    --parent <id>        Pass a previous run's conversation as context
    --json               Emit normalized events as JSONL
    --data-dir <path>    Override the session storage directory

  Desktop: npm run desktop
  Authenticate each harness with its own CLI before running it here.
`;

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(command)) {
    console.log(help);
    return;
  }
  if (command === '--version') {
    console.log('0.1.0');
    return;
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      harness: { type: 'string', short: 'h' },
      cwd: { type: 'string', short: 'C' },
      model: { type: 'string', short: 'm' },
      mode: { type: 'string' },
      parent: { type: 'string' },
      json: { type: 'boolean' },
      'data-dir': { type: 'string' },
      port: { type: 'string' },
      dev: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  const dataDir = values['data-dir'] ?? process.env.OMA_DATA_DIR;
  if (command === 'serve') {
    const port = Number(values.port ?? 4317);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error('Port must be between 0 and 65535.');
    const server = await startServer({ port, dev: values.dev, dataDir, cwd: values.cwd });
    console.log(`OMA_READY ${JSON.stringify({ url: server.url })}`);
    console.log(`\n  oh-my-adaptor → ${server.url}\n`);
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      await server.close();
    };
    process.on('SIGINT', () => {
      void close();
    });
    process.on('SIGTERM', () => {
      void close();
    });
    return;
  }
  if (!['harnesses', 'sessions', 'run'].includes(command))
    throw new Error(`Unknown command: ${command}. Use oma --help.`);
  const adaptor = await Adaptor.create({ dataDir });
  if (command === 'harnesses') {
    const harnesses = await adaptor.detect();
    if (values.json) console.log(JSON.stringify(harnesses));
    else
      for (const h of harnesses)
        console.log(
          `  ${h.available ? '●' : '○'} ${h.name.padEnd(15)} ${h.id.padEnd(10)} ${h.available ? h.version : h.error}`,
        );
    return;
  }
  if (command === 'sessions') {
    const sessions = adaptor.list();
    if (values.json) console.log(JSON.stringify(sessions));
    else if (!sessions.length)
      console.log('No sessions yet. Start with oma run -h codex "Explain this project".');
    else
      for (const s of sessions)
        console.log(
          `${s.id}  ${s.harness.padEnd(10)} ${s.status.padEnd(12)} ${s.prompt.slice(0, 70)}`,
        );
    return;
  }
  if (!values.harness) throw new Error('Choose a harness with --harness (or -h).');
  if (values.mode && !['review', 'edit'].includes(values.mode))
    throw new Error('Mode must be review or edit.');
  const run = await adaptor.run({
    harness: values.harness,
    prompt: positionals.join(' '),
    cwd: values.cwd ?? process.cwd(),
    model: values.model,
    mode: values.mode as 'review' | 'edit' | undefined,
    parentId: values.parent,
  });
  const cancel = () => run.cancel();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  for await (const event of run.events) {
    if (values.json) console.log(JSON.stringify({ sessionId: run.session.id, ...event }));
    else if (event.kind === 'delta') process.stdout.write(event.text);
    else if (event.kind === 'message') console.log(event.text);
    else if (event.kind === 'error') console.error(`Error: ${event.text}`);
    else if (event.kind === 'status' || event.kind === 'tool')
      console.error(`  [${event.kind}] ${event.text}`);
  }
  const session = await run.done;
  process.off('SIGINT', cancel);
  process.off('SIGTERM', cancel);
  process.exitCode = session.status === 'completed' ? 0 : session.status === 'cancelled' ? 130 : 1;
}

main().catch((error: Error) => {
  console.error(`oh-my-adaptor: ${error.message}`);
  process.exitCode = 1;
});
