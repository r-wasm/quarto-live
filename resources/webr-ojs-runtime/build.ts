import { build, context, BuildOptions, PluginBuild } from 'esbuild';
import process from 'process';

let watch = false;
if (process.argv.includes("--watch")) {
  watch = true;
}

const options: BuildOptions = {
  entryPoints: ['./src/main.ts'],
  bundle: true,
  outfile: './dist/webr-ojs-runtime.js',
  minify: true,
  loader: { '.svg': 'text' },
  platform: 'browser',
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
