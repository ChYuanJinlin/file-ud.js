import { defineConfig } from "tsup";
export default defineConfig([
  {
    // FileUD 主库
    entry: ["src/index.ts"],
    format: ["esm", "iife"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
    globalName: "FileUD", // 直接指定字符串
    outDir: "dist",
  },
  {
    // Uploader 独立库
    entry: ["src/uploader/index.ts"],
    format: ["esm", "iife"],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
    globalName: "Uploader", // 直接指定字符串
    outDir: "dist/uploader",
  },
]);
