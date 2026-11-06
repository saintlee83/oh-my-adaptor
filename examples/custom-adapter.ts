import { Adaptor, type HarnessAdapter } from 'oh-my-adaptor';

// A self-contained adapter example. Replace this process with your own agent CLI.
const echo: HarnessAdapter = {
  id: 'local-echo',
  name: 'Local echo',
  provider: 'Example',
  description: 'Demonstrates the adapter contract without using a model.',
  command: process.execPath,
  docsUrl: 'https://github.com/saintlee83/oh-my-adaptor',
  build: ({ prompt }) => ({
    args: ['-e', 'process.stdin.pipe(process.stdout)'],
    stdin: prompt,
  }),
  createParser: () => (line) => [{ kind: 'message', text: line }],
};

const adaptor = await Adaptor.create({ adapters: [echo] });
const run = await adaptor.run({
  harness: 'local-echo',
  cwd: process.cwd(),
  prompt: 'Hello from a custom harness!',
});
for await (const event of run.events) console.log(event.kind, event.text);
await run.done;
await adaptor.close();
