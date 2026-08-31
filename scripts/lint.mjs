import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const roots = ['src', 'tests', 'scripts', 'benchmarks'];
const extensions = new Set(['.ts', '.mjs']);
const files = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (extensions.has(extname(entry.name))) files.push(path);
  }
}
for (const root of roots) await visit(root);
const errors = [];
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) errors.push(`${file}: execução dinâmica não permitida`);
  if (/\bas\s+any\b|:\s*any\b/.test(source)) errors.push(`${file}: uso explícito de any`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Lint leve: ${files.length} arquivos verificados.`);
