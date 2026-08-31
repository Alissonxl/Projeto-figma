import { build, context } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { embedUiHtml } from './embedUi.mjs';

const watch = process.argv.includes('--watch');
if (!watch) await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

const root = process.cwd();
const common = {
  bundle: true,
  target: 'es2020',
  platform: 'browser',
  packages: 'external',
  preserveSymlinks: true,
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
  absWorkingDir: root
};
const mainOptions = {
  ...common,
  entryPoints: [resolve(root, 'src/plugin/main.ts')],
  outfile: resolve(root, 'dist/main.js')
};
const uiOptions = { ...common, entryPoints: [resolve(root, 'src/ui/ui.ts')], outfile: resolve(root, 'dist/ui.js') };

async function makeHtml() {
  const [template, css, js] = await Promise.all([
    readFile('src/ui/index.html', 'utf8'),
    readFile('src/ui/style.css', 'utf8'),
    readFile('dist/ui.js', 'utf8')
  ]);
  await writeFile('dist/ui.html', embedUiHtml(template, css, js));
}

async function cleanProductionIntermediates() {
  await Promise.all(['dist/ui.js', 'dist/ui.js.map', 'dist/main.js.map'].map((file) => rm(file, { force: true })));
}

if (watch) {
  const main = await context(mainOptions);
  const ui = await context({
    ...uiOptions,
    plugins: [
      {
        name: 'html',
        setup(b) {
          b.onEnd(makeHtml);
        }
      }
    ]
  });
  await Promise.all([main.watch(), ui.watch()]);
  console.log('Watching Figma to Tailwind Pro…');
} else {
  await build(mainOptions);
  await build(uiOptions);
  await makeHtml();
  await cleanProductionIntermediates();
}
