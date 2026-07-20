import pkg from "../../core/package.json";

/** core 包版本号 */
export const coreVersion = pkg.version;

const currentVersion = import.meta.env.VITE_DOC_VERSION || `v${coreVersion}`;
const latestPath = normalizePath(import.meta.env.VITE_DOC_LATEST_PATH || "/");
const historyBasePath = normalizePath(
  import.meta.env.VITE_DOC_HISTORY_BASE_URL || latestPath,
);
const rawVersions = import.meta.env.VITE_DOC_VERSIONS || "";
const versionList = parseVersions(rawVersions);
const historyVersions = versionList.filter((version) => {
  return normalizeVersion(version) !== normalizeVersion(currentVersion);
});

function normalizePath(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path.endsWith("/") ? path : `${path}/`;
  }

  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path.endsWith("/") ? path : `${path}/`;
}

function parseVersions(value: string): string[] {
  const versions = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(versions));
}

function normalizeVersion(version: string): string {
  return `v${version.replace(/^v/, "")}`;
}

/** 可用版本列表（按发布日期降序） */
export const versions = versionList.length
  ? [
      {
        label: `latest (${currentVersion})`,
        path: latestPath,
      },
      ...historyVersions.map((version) => ({
        label: version,
        path: normalizePath(`${historyBasePath}${version}`),
      })),
    ]
  : [
      {
        label: currentVersion,
        path: latestPath,
      },
    ];

export type Version = (typeof versions)[number];
