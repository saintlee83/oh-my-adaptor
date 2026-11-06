import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url));
const icon = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } });
await writeFile(new URL('../desktop/icon.png', import.meta.url), icon.render().asPng());
console.log('Generated desktop/icon.png from the vector brand mark.');
