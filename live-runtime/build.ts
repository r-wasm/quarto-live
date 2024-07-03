import { build, context, BuildOptions } from 'esbuild';
import process from 'process';

let watch = false;
if (process.argv.includes("--watch")) {
  watch = true;
}

const external = [
  'node:child_process',
  'node:crypto',
  'node:fs',
  'node:path',
  'node:url',
  'node:vm',
]

const options: BuildOptions = {
  entryPoints: ['./src/live-runtime.ts', './src/pyodide-worker.ts'],
  external,
  bundle: true,
  outdir: '../_extensions/live/resources',
  minify: true,
  loader: { '.svg': 'text', '.R': 'base64', '.py': 'base64' },
  platform: 'browser',
  format: 'esm',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
