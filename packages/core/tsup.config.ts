import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  name: string;
  version: string;
  homepage?: string;
  license?: string;
};

const define = {
  __FILE_UD_PACKAGE_NAME__: JSON.stringify(packageJson.name),
  __FILE_UD_VERSION__: JSON.stringify(packageJson.version),
  __FILE_UD_HOMEPAGE__: JSON.stringify(packageJson.homepage || ""),
};

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
    outDir: "dist",
    define,
  },
  {
    entry: ["src/utils/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: false,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: false,
    outDir: "dist/utils",
    define,
  },
]);
