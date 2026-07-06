import { defineConfig } from "tsup";
export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "uploader/index": "src/uploader/index.ts",
      "downloader/index": "src/downloader/index.ts",
      "retry/index": "src/retry/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
    outDir: "dist",
  },
]);
