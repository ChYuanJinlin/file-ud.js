import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(__dirname, "..");
const corePackagePath = resolve(docsRoot, "../core/package.json");
const corePackage = JSON.parse(await readFile(corePackagePath, "utf8"));

const command = process.argv[2] || "dev";
const args = process.argv.slice(3);
if (args[0] === "--") {
  args.shift();
}
const env = {
  ...process.env,
};

if (!env.VITE_DOC_VERSION) {
  env.VITE_DOC_VERSION = `v${corePackage.version}`;
}

if (!env.VITE_DOC_VERSIONS) {
  env.VITE_DOC_VERSIONS = await resolveNpmVersions();
}

if (!env.VITE_DOC_HISTORY_BASE_URL && !env.GITHUB_ACTIONS) {
  env.VITE_DOC_HISTORY_BASE_URL = "https://chyuanjinlin.github.io/file-ud.js/";
}

if (!env.VITE_DOC_DYNAMIC_ROUTES) {
  env.VITE_DOC_DYNAMIC_ROUTES = "false";
}

const vitepressBin = process.platform === "win32" ? "vitepress.cmd" : "vitepress";
const child = spawn(vitepressBin, [command, ...args], {
  cwd: docsRoot,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

async function resolveNpmVersions() {
  const currentVersion = `v${corePackage.version}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(corePackage.name)}`,
      {
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    if (!res.ok) {
      return currentVersion;
    }

    const metadata = await res.json();
    const versions = Object.keys(metadata.versions || {})
      .map((version) => `v${version.replace(/^v/, "")}`)
      .filter(Boolean)
      .sort(compareVersionDesc);

    return Array.from(new Set([currentVersion, ...versions])).join(",");
  } catch {
    return currentVersion;
  }
}

function compareVersionDesc(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (right[i] || 0) - (left[i] || 0);
    if (diff) return diff;
  }

  return b.localeCompare(a);
}

function parseVersionParts(version) {
  return version
    .replace(/^v/, "")
    .split(/[.-]/)
    .map((part) => Number(part))
    .map((part) => (Number.isFinite(part) ? part : 0));
}
