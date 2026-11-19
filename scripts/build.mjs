import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import fs from 'node:fs';

const dev = process.argv.includes('--dev');
fs.rmSync('dist', { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  external: ['electron'],
  logLevel: 'warning',
};

await Promise.all([
  build({ ...common, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.cjs' }),
  build({ ...common, entryPoints: ['src/main/updateRunner.ts'], outfile: 'dist/main/update-runner.cjs' }),
  build({ ...common, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.cjs' }),
]);
if (!dev) await viteBuild({ configFile: 'vite.config.ts', logLevel: 'warn' });
console.log(`build ok${dev ? ' (main only, UI from vite dev server)' : ''}`);
