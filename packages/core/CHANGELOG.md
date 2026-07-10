# @file-ud.js/core

## 0.1.2

### Patch Changes

- 修复 `multiple: false` 单文件模式下文件列表仍可能追加的问题，确保重新选择文件时只保留最新文件；同时让 `updateConfig` 自动同步内部 input 属性，并修复源码开发环境 banner 版本回退为 `0.0.0` 的问题。

## 0.1.1

### Patch Changes

- [`01d5702`](https://github.com/ChYuanJinlin/file-ud.js/commit/01d5702d7dba3ed6c9d69e869c8dc0d4dbe4d39e) Thanks [@ChYuanJinlin](https://github.com/ChYuanJinlin)! - 修复上传器全局默认插件在初始化时被清空的问题，并补充插件管理、架构图和单文件上传文档。

## 0.1.0

### Minor Changes

- Prepare the core and plugins packages for public npm release.

  Updated package exports to use built dist artifacts, added publish file lists, generated CJS/ESM/type subpath entries, and aligned plugin imports with the core public API.
