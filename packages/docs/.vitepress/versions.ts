import pkg from "../../core/package.json";

/** 核心包版本号 */
export const coreVersion = pkg.version;

/** 可用版本列表（按发布日期降序）
 *
 * 当前文档部署在根路径 /，发布历史版本后再追加对应子目录。
 */
export const versions = [
  { label: `v${coreVersion}`, path: "/" },
] as const;

export type Version = (typeof versions)[number];
