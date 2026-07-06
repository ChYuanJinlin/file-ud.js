# Changesets

此目录包含 changeset 文件和配置，用于管理 file-ud.js 的版本发布。

## 快速开始

### 1. 创建 changeset

当你完成一个功能开发或修复 bug 后，运行：

```bash
pnpm changeset
```

交互式 CLI 会引导你：
- 选择受影响的包（`@file-ud.js/core`、`@file-ud.js/plugins`）
- 选择版本变更类型（major / minor / patch）
- 编写变更描述（Summary）

生成的 `.md` 文件会保存在 `.changeset/` 目录下，应随代码一起提交。

### 2. 版本升级

当 PR 合并到 `main` 后，GitHub Actions 会自动创建 "Version Packages" PR：

```
ci: version packages
```

合并该 PR 后，包版本号自动升级，CHANGELOG.md 自动更新。

你也可以手动运行：

```bash
pnpm version-packages
```

### 3. 发布到 npm

版本升级 PR 合并后，GitHub Actions 会自动发布到 npm。

手动发布：

```bash
pnpm release
```

## 版本策略

### 联动升级（Linked Packages）

`@file-ud.js/core` 和 `@file-ud.js/plugins` 为**联动包**，修改任意一个，另一个也会同步升级。

### 内部依赖更新

当 `@file-ud.js/core` 发生变更时，依赖它的 `@file-ud.js/plugins`、`example` 等工作区内包会自动更新依赖版本号（`updateInternalDependencies: "patch"`）。

### Commit 信息规范

虽然 changeset 不自动提交（`commit: false`），但建议使用以下 commit 前缀：

| 前缀 | 说明 | 示例 |
|------|------|------|
| `feat:` | 新功能 | `feat: add resume upload support` |
| `fix:` | Bug 修复 | `fix: chunk merge race condition` |
| `docs:` | 文档 | `docs: update API reference` |
| `chore:` | 杂项 | `chore: update dependencies` |
| `refactor:` | 重构 | `refactor: simplify downloader logic` |
| `test:` | 测试 | `test: add chunk upload unit tests` |
| `perf:` | 性能优化 | `perf: optimize chunk hash calculation` |

### 预发布版本（Snapshot）

开发测试阶段可生成快照版本：

```bash
pnpm snapshot
```

会生成如 `0.0.1-20240702-abc1234` 格式的临时版本，用于本地测试或内部验证。

## 发布流程总览

```
开发功能 → pnpm changeset → 提交代码 → 合并到 main
    ↓
CI 自动创建 Version Packages PR → 合并 PR
    ↓
版本号升级 + CHANGELOG 更新 → CI 自动发布到 npm
```
