import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const roots = ['src', 'tests', 'scripts', 'benchmarks'];
const extensions = new Set(['.ts', '.css', '.html', '.mjs']);
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (extensions.has(extname(entry.name))) files.push(path);
  }
}
for (const root of roots) await visit(root);
const invalid = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (source.includes('\r\n')) continue;
  const lines = source.split('\n');
  if (lines.some((line) => /[ \t]+$/.test(line))) invalid.push(file);
}
if (invalid.length) {
  console.error(`Espaços no fim da linha: ${invalid.join(', ')}`);
  process.exitCode = 1;
} else console.log(`Formato básico: ${files.length} arquivos verificados.`);
