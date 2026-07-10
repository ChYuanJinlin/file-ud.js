import packageJson from "../../package.json";

declare const __FILE_UD_PACKAGE_NAME__: string;
declare const __FILE_UD_VERSION__: string;
declare const __FILE_UD_HOMEPAGE__: string;

const GLOBAL_BANNER_FLAG = "__FILE_UD_BANNER_PRINTED__";

const packageName =
  typeof __FILE_UD_PACKAGE_NAME__ === "string"
    ? __FILE_UD_PACKAGE_NAME__
    : packageJson.name || "@file-ud.js/core";
const version =
  typeof __FILE_UD_VERSION__ === "string"
    ? __FILE_UD_VERSION__
    : packageJson.version || "0.0.0";
const homepage =
  typeof __FILE_UD_HOMEPAGE__ === "string"
    ? __FILE_UD_HOMEPAGE__
    : packageJson.homepage || "";

function getPackageDisplayName(name: string): string {
  if (!name) return "SDK";

  const withoutScope = name.startsWith("@") ? name.slice(1).split("/")[0] : name;
  return withoutScope.split("/")[0] || name;
}

const displayName = getPackageDisplayName(packageName);

function hasPrintedBanner(): boolean {
  return Boolean((globalThis as any)[GLOBAL_BANNER_FLAG]);
}

function markBannerPrinted() {
  try {
    Object.defineProperty(globalThis, GLOBAL_BANNER_FLAG, {
      value: true,
      configurable: true,
    });
  } catch {
    (globalThis as any)[GLOBAL_BANNER_FLAG] = true;
  }
}

export function printFileUDBanner() {
  if (hasPrintedBanner()) return;

  markBannerPrinted();

  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }

  const titleStyle =
    "background:#111827;color:#fff;padding:2px 8px;border-radius:4px 0 0 4px;font-weight:700";
  const versionStyle =
    "background:#2563eb;color:#fff;padding:2px 8px;border-radius:0 4px 4px 0;font-weight:700";
  const textStyle = "color:#64748b";

  try {
    console.info(
      "%c %s %c v%s ",
      titleStyle,
      displayName,
      versionStyle,
      version,
    );
    if (homepage) {
      console.info("%cDocs: %s", textStyle, homepage);
    }
  } catch {
    console.info(`[${displayName}] v${version}`);
  }
}
