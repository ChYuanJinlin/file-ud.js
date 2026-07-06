import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const subpaths = [
  {
    outDir: path.join(packageRoot, "dist", "uploader"),
    className: "Uploader",
    configName: "uploaderDefaultConfig",
  },
  {
    outDir: path.join(packageRoot, "dist", "downloader"),
    className: "Downloader",
    configName: "downloaderDefaultConfig",
  },
];

for (const { outDir, className, configName } of subpaths) {
  await mkdir(outDir, { recursive: true });

  const files = {
    "index.mjs": [
      `export { ${className} as default, ${className}, ${configName} as defaultConfig } from "../index.mjs";`,
      "",
    ].join("\n"),
    "index.js": [
      '"use strict";',
      "",
      'const core = require("../index.js");',
      "",
      `module.exports = core.${className};`,
      `module.exports.default = core.${className};`,
      `module.exports.${className} = core.${className};`,
      `module.exports.defaultConfig = core.${configName};`,
      "",
    ].join("\n"),
    "index.d.ts": [
      `export { ${className} as default, ${className}, ${configName} as defaultConfig } from "../index";`,
      "",
    ].join("\n"),
    "index.d.mts": [
      `export { ${className} as default, ${className}, ${configName} as defaultConfig } from "../index.mjs";`,
      "",
    ].join("\n"),
  };

  await Promise.all(
    Object.entries(files).map(([fileName, contents]) =>
      writeFile(path.join(outDir, fileName), contents),
    ),
  );
}
