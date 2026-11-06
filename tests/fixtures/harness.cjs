const mode = process.argv[2];
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  if (mode === 'wait') {
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'test-thread' }));
    setInterval(() => {}, 1000);
  } else if (mode === 'fail') {
    console.log(
      JSON.stringify({ type: 'turn.failed', error: { message: 'Authentication required' } }),
    );
  } else if (mode === 'malformed') {
    process.stdout.write('not json\nnull\n{"type":"new.event","data":true}\n');
  } else {
    process.stderr.write('diagnostic output\n');
    const buffer = Buffer.from(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: `안녕하세요 🌱 ${input}` },
      }),
    );
    const split = buffer.indexOf(Buffer.from('안')) + 1;
    process.stdout.write(buffer.subarray(0, split));
    setTimeout(() => process.stdout.end(buffer.subarray(split)), 25);
  }
});
