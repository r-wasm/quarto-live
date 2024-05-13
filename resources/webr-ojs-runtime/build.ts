import { build, context, BuildOptions, PluginBuild } from 'esbuild';
import process from 'process';
import { promises as fs } from 'fs';

let watch = false;
if (process.argv.includes("--watch")) {
  watch = true;
}

const cssFiles = [
  "codemirror-themes-html.css",
];

const copyPlugin = () => ({
  name: 'copy-plugin',
  setup(build: PluginBuild) {
    build.onLoad({ filter: /.+/ }, () => {
      return { watchFiles: cssFiles.map((f) => `./src/${f}`) };
    });
    build.onEnd(async () => {
      await Promise.all(cssFiles.map((f) =>
        fs.copyFile(`./src/${f}`, `./dist/${f}`)
      ));
    });
  },
});

const options: BuildOptions = {
  entryPoints: ['./src/main.ts'],
  bundle: true,
  outfile: './dist/webr-ojs-runtime.js',
  minify: true,
  loader: { '.svg': 'text' },
  platform: 'browser',
  plugins: [ copyPlugin() ],
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
