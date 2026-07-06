# 本地示例

`packages/example` 是本仓库的 Vue 3 本地调试项目，用来验证上传、下载、分片、断点续传和插件能力。

示例依赖本地后端接口，直接嵌入文档站会导致线上文档需要同时部署后端和 example 静态资源，维护成本高，也容易让用户看到一个不可用的页面。

## 本地运行

先安装依赖：

```bash
pnpm install
```

启动本地后端：

```bash
node server/main.js
```

启动示例项目：

```bash
pnpm --filter example dev
```

默认访问地址：

```text
http://localhost:6677
```

## 示例包含

- 普通上传
- 分片上传
- 分片下载
- 断点续传
- 秒传与秒下
- 文件级并发控制
- 上传/下载总进度
- 暂停、继续、取消、重试
- File System Access API 流式保存

## 适用场景

这个示例主要给开发者调试源码和验证改动使用。学习 API 时优先看：

- [快速开始](./getting-started)
- [Uploader 上传器](./uploader)
- [Downloader 下载器](./downloader)
- [插件文档](../plugins/)
