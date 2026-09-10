import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
async function walk(path) {
  for (const item of await readdir(path, { withFileTypes: true })) {
    if (['.git', '.sites-runtime', 'node_modules'].includes(item.name)) continue;
    const file = join(path, item.name);
    if (item.isDirectory()) await walk(file);
    else if (/\.(mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status) process.exit(result.status);
    }
  }
}
await walk('.');
const html = await readFile('public/index.html', 'utf8');
for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) await readFile('public' + path);
console.log('Sintaxe JavaScript e arquivos de entrada validados.');
