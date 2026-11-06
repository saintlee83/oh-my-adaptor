import { Adaptor } from 'oh-my-adaptor';

const adaptor = await Adaptor.create();
const available = await adaptor.detect();
console.log(available.map(({ id, available }) => ({ id, available })));

const run = await adaptor.run({
  harness: 'codex',
  cwd: process.cwd(),
  prompt: 'Explain this project’s architecture. Do not modify any files.',
  mode: 'review',
});

const cancel = () => run.cancel();
process.once('SIGINT', cancel);

try {
  for await (const event of run.events) {
    if (event.kind === 'message') console.log(event.text);
    else console.error(`[${event.kind}] ${event.text}`);
  }
  console.log('Finished:', (await run.done).status);
} finally {
  process.off('SIGINT', cancel);
  await adaptor.close();
}
