import { defineConfig } from "tsup";
export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "iife"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
    outDir: "dist",
  },
]);
