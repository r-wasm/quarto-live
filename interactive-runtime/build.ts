import { build, context, BuildOptions } from 'esbuild';
import process from 'process';

let watch = false;
if (process.argv.includes("--watch")) {
  watch = true;
}

const options: BuildOptions = {
  entryPoints: ['./src/main.ts'],
  bundle: true,
  outfile: '../_extensions/learn/resources/interactive-runtime.js',
  minify: true,
  loader: { '.svg': 'text', '.R': 'text', '.py': 'text' },
  platform: 'browser',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
