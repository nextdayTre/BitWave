import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * BitWave build — multi-file source, single-file delivery.
 *
 * `src/index.html` + `src/main.js` + `src/styles/app.css` compile to
 * `dist/index.html` with every asset inlined; `tools/build-artifact.mjs`
 * copies that to `bitwave-v2.html`, the double-clickable instrument.
 *
 * No minification on purpose: the artifact is a teaching/preservation object,
 * and a readable built file keeps diffs and view-source honest.
 */
export default defineConfig({
  root: "src",
  publicDir: false,
  build: {
    target: "es2022",
    minify: false,
    cssCodeSplit: false,
    emptyOutDir: true,
    outDir: "../dist",
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    reportCompressedSize: false,
  },
  plugins: [viteSingleFile()],
});
