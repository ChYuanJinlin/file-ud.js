# File-UD

<p>
  <a href="https://www.npmjs.com/package/@file-ud.js/core">
    <img src="https://img.shields.io/npm/v/@file-ud.js/core?style=flat-square&logo=npm&label=npm" alt="npm version" />
  </a>
  <a href="https://chyuanjinlin.github.io/file-ud.js/">
    <img src="https://img.shields.io/badge/docs-GitHub%20Pages-0969da?style=flat-square&logo=githubpages&logoColor=white" alt="docs" />
  </a>
  <a href="https://github.com/ChYuanJinlin/file-ud.js/releases">
    <img src="https://img.shields.io/github/v/release/ChYuanJinlin/file-ud.js?style=flat-square&logo=github&label=%40file-ud.js" alt="GitHub release" />
  </a>
  <img src="https://img.shields.io/badge/runtime-browser-4285f4?style=flat-square&logo=googlechrome&logoColor=white" alt="browser runtime" />
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-339933?style=flat-square&logo=node.js&logoColor=white" alt="node >= 18.0.0" />
  <img src="https://img.shields.io/badge/pnpm-8.9.0-f69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm 8.9.0" />
  <img src="https://img.shields.io/badge/license-MIT-4c1?style=flat-square" alt="MIT license" />
  <img src="https://img.shields.io/badge/types-TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

面向浏览器的 TypeScript/JavaScript 文件上传下载 SDK，支持分片传输、断点续传、秒传秒下、插件扩展。

文档站：[https://chyuanjinlin.github.io/file-ud.js/](https://chyuanjinlin.github.io/file-ud.js/)

## 特性

- **分片上传/下载** — 大文件自动切片，可配分片大小和并发数
- **断点续传** — 网络中断后自动恢复，已传分片不重复传
- **秒传 / 秒下** — 相同文件自动跳过，零等待返回结果
- **插件体系** — 图片压缩、水印、类型校验、智能重试等开箱即用
- **速度监控** — 实时速度、平均速度、预计剩余时间
- **文件并发控制** — 上传/下载独立队列，互不阻塞
- **流式下载** — 支持 File System Access API 直接在磁盘写入大文件
- **事件驱动** — 细粒度事件（分片级 + 文件级 + 全局级）

## 安装

```bash
# npm
npm install @file-ud.js/core

# pnpm
pnpm add @file-ud.js/core

# yarn
yarn add @file-ud.js/core

# bun
bun add @file-ud.js/core
```

官方插件包按需安装：

```bash
# npm
npm install @file-ud.js/plugins

# pnpm
pnpm add @file-ud.js/plugins

# yarn
yarn add @file-ud.js/plugins

# bun
bun add @file-ud.js/plugins
```

## 实例模式说明

file-ud.js 同时提供两种创建方式，使用场景不同：

- `new Uploader(config)` / `new Downloader(config)` 是**单例模式**。第一次创建后，后续再次 `new` 会复用同一个全局实例，后续传入的配置不会创建新的隔离实例。适合整个页面只需要一个上传器或下载器的简单场景。
- `FileUD.createUploader(name, config)` / `FileUD.createDownloader(name, config)` 是**命名多实例模式**。每个 `name` 对应一个独立实例；如果重复使用同一个 `name`，旧实例会被销毁并重新创建。多个业务区域、多个上传入口、头像/附件/视频等需要隔离时，推荐使用这种方式。

```ts
import { FileUD, Uploader, Downloader } from "@file-ud.js/core";

// 单例：全局只会保留一个 Uploader 实例
const singletonUploader = new Uploader({ action: "/api/upload" });

// 单例：全局只会保留一个 Downloader 实例
const singletonDownloader = new Downloader({ action: "/api/download" });

// 多实例：按 name 隔离，推荐用于真实业务页面
const avatarUploader = FileUD.createUploader("avatar", {
  action: "/api/upload-avatar",
  multiple: false,
});
const attachmentUploader = FileUD.createUploader("attachments", {
  action: "/api/upload-attachment",
  multiple: true,
});
```

## 快速上手

### 上传

```ts
import { Uploader } from "@file-ud.js/core";

// 注意：new Uploader 是单例模式；多个上传入口请使用 FileUD.createUploader(name, config)
const uploader = new Uploader({
  // 上传地址（必填）
  action: "/api/upload",
  // 分片配置
  chunkOptions: {
    chunkSize: 20 * 1024 * 1024, // 分片大小，默认 20MB
    maxConcurrent: 3,              // 最大并发数
    retries: 3,                    // 失败重试次数
    timeout: 30000,                // 超时时间（毫秒）
  },
  // 文件限制
  maxSize: 2 * 1024 * 1024 * 1024, // 单文件最大 2GB
  limit: 10,                        // 最多 10 个文件
  accept: ["image/*", ".pdf"],     // 允许的文件类型
  autoUpload: true,                 // 选完文件自动上传
});

// 监听全局进度
uploader.on("progress", (percent) => {
  console.log(`总进度: ${percent}%`);
});

// 监听单文件上传成功
uploader.onSuccess = (response, file) => {
  console.log(`${file.fileName} 上传完成`, response);
};

uploader.on("chunk-success", ({ chunkIndex, totalChunks, percent }) => {
  console.log(`分片 ${chunkIndex + 1}/${totalChunks} 完成 (${percent}%)`);
});

// 手动打开文件选择
uploader.open();

// 或手动提交（autoUpload: false 时）
// uploader.submit();
```

### 单文件覆盖上传

头像、Logo、封面这类场景只需要保留一个文件时，保持 `multiple: false` 即可。重新选择文件后，上传器会用新文件替换当前文件；只有 `multiple: true` 时才会追加为文件列表。

```ts
import { FileUD } from "@file-ud.js/core";

const logoUploader = FileUD.createUploader("tagLogoUploader", {
  action: "/api/upload-logo",
  multiple: false,
  accept: ["image/*"],
});

logoUploader.open();
```

### 接入第三方上传组件

如果文件选择已经由 Element Plus、Ant Design Upload、拖拽区或自定义 input 完成，不需要再调用 `open()`，直接把原生 `File` 交给上传器即可：

```ts
await logoUploader.addFile(file);

// 多文件 / FileList
await attachmentUploader.addFiles(files);
```

完整示例见文档站：[第三方上传组件接入](https://chyuanjinlin.github.io/file-ud.js/guide/ui-upload.html)。

### 初始化分片回调（配合后端）

```ts
uploader.onInitChunk = async (file, totalChunks, fileHash) => {
  // 调用后端接口，返回已上传的分片索引
  const res = await fetch("/api/init", {
    method: "POST",
    body: JSON.stringify({ fileHash, totalChunks, fileName: file.fileName }),
  });
  const data = await res.json();
  return {
    fileHash,
    chunks: data.uploadedChunks,        // 已上传的分片索引数组
    isInstantUpload: data.exists,        // 秒传标记
    shouldRemove: data.exists,           // 秒传时是否移除文件
    url: data.url,                       // 秒传时返回文件地址
  };
};

uploader.onMergeChunk = async (chunkManager) => {
  // 当所有分片上传完成后，调用后端合并
  return fetch("/api/merge", {
    method: "POST",
    body: JSON.stringify({
      fileHash: chunkManager.fileHash,
    }),
  });
};
```

### 下载

```ts
import { Downloader } from "@file-ud.js/core";

// 注意：new Downloader 是单例模式；多个下载入口请使用 FileUD.createDownloader(name, config)
const downloader = new Downloader({
  action: "/api/download",
  chunkOptions: {
    chunkSize: 20 * 1024 * 1024,
    maxConcurrent: 3,
  },
  maxDownloadSpeed: 0, // 不限制速度（bytes/s）
  timeout: 30000,
});

// 开始下载
const file = downloader.downloadFile({
  url: "https://example.com/files/report.pdf",
  fileName: "report.pdf",
});

// 监听全局下载进度
downloader.on("progress", (percent) => {
  console.log(`下载进度: ${percent}%`);
});

downloader.onSuccess = (response, file) => {
  console.log(`${file.fileName} 下载完成`, response);
};
```

### 使用插件

```ts
import { Uploader } from "@file-ud.js/core";
import { CompressImagePlugin, WatermarkPlugin } from "@file-ud.js/plugins/uploader";

// 注意：new Uploader 是单例模式；多个上传入口请使用 FileUD.createUploader(name, config)
const uploader = new Uploader({
  action: "/api/upload",
  autoUpload: true,
});

// 注册插件
uploader.use(new CompressImagePlugin({ quality: 0.8, maxWidth: 1920 }));
uploader.use(new WatermarkPlugin({ text: "公司水印", opacity: 0.3 }));
```

## 完整配置

### Uploader 配置（`UploaderConfig`）

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `action` | `string \| function` | — | **必填**，上传地址 |
| `chunkOptions` | `ChunkOptions \| null` | `null` | 分片配置，null 为普通上传 |
| `multiple` | `boolean` | `false` | 是否多选文件；`false` 为单文件覆盖模式，`true` 为多文件追加列表 |
| `accept` | `string[]` | `[]` | 允许的文件类型（MIME/扩展名） |
| `autoUpload` | `boolean` | `true` | 选完文件自动上传 |
| `maxSize` | `number` | — | 单文件最大字节数 |
| `limit` | `number` | — | 最大文件数量，仅 `multiple: true` 时生效 |
| `maxFileConcurrent` | `number` | — | 最大同时传输文件数 |
| `headers` | `Record<string, any>` | — | 请求头 |
| `elementId` | `string` | — | 挂载 input 的元素 ID |
| `axiosInstance` | `AxiosInstance` | — | 自定义 axios 实例 |

### Downloader 配置（`DownloaderConfig`）

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `action` | `string \| function` | — | **必填**，下载地址 |
| `chunkOptions` | `ChunkOptions \| null` | `null` | 分片配置 |
| `maxDownloadSpeed` | `number` | `0` | 下载限速（bytes/s），0 不限 |
| `maxFileConcurrent` | `number` | — | 最大同时传输文件数 |
| `timeout` | `number` | `30000` | 超时时间（毫秒） |
| `headers` | `Record<string, any>` | `{}` | 请求头 |
| `axiosInstance` | `AxiosInstance` | — | 自定义 axios 实例 |

### ChunkOptions 分片配置

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `chunkSize` | `number` | `20971520` | 分片大小（字节），默认 20MB |
| `maxConcurrent` | `number` | `3` | 分片最大并发数 |
| `retries` | `number \| null` | `3` | 失败重试次数 |
| `retryDelay` | `number` | `1000` | 重试延迟（毫秒） |
| `timeout` | `number` | `30000` | 单分片超时时间（毫秒） |
| `enableFileCache` | `boolean` | `false` | 是否启用 IndexedDB 文件缓存 |
| `cacheRetentionDays` | `number` | `7` | 缓存保留天数 |

## 事件

### 全局事件

```ts
uploader.on("eventName", (arg) => { ... });
```

| 事件 | 参数 | 说明 |
|------|------|------|
| `change` | `file: UploadFile` | 文件添加到列表 |
| `progress` | `percent: number` | 全局传输进度 (0-100) |
| `files-start` | `files: UploadFile[]` | 批量文件开始传输 |
| `files-complete` | `files: UploadFile[]` | 所有文件传输完成 |
| `error` | `errors: FileUDErrorJSON` | 错误事件 |

单文件成功通过回调设置：

```ts
uploader.onSuccess = (response, file) => {
  console.log(file.fileName, response);
};
```

### 文件级事件

```ts
uploader.on("pause", (file) => { ... });
```

| 事件 | 参数 | 说明 |
|------|------|------|
| `pause` | `file: UploadFile` | 文件暂停 |
| `resume` | `file: UploadFile` | 文件恢复 |
| `cancel` | `file: UploadFile` | 文件取消 |
| `retry` | `file: UploadFile` | 文件重试 |
| `remove` | `file: UploadFile` | 文件移除 |

### 分片级事件

| 事件 | 参数 | 说明 |
|------|------|------|
| `chunk-success` | `{ chunkIndex, totalChunks, completedChunks, percent, file }` | 单个分片成功 |
| `chunk-error` | `{ chunkIndex, totalChunks, error, file }` | 单个分片失败 |
| `merging` | `{ file, completedChunks, totalChunks }` | 开始合并分片 |
| `merge-success` | `{ file, response? }` | 合并完成 |
| `merge-error` | `{ file, error }` | 合并失败 |
| `instant-upload` | `{ file, reason }` | 秒传触发 |

## 文件状态生命周期

```
pending → UDLoading → merging → success
                     ↘ fail / error → retry → UDLoading
                     ↘ paused → resume → UDLoading
                     ↘ cancelled
```

| 状态 | 说明 |
|------|------|
| `pending` | 等待传输 |
| `UDLoading` | 传输中 |
| `paused` | 已暂停 |
| `success` | 传输成功 |
| `fail` | 传输失败 |
| `error` | 发生错误 |
| `cancelled` | 已取消 |
| `merging` | 正在合并分片 |

## 内置插件

| 插件 | 功能 |
|------|------|
| `CompressImagePlugin` | 图片压缩（Canvas），支持质量/尺寸/格式 |
| `WatermarkPlugin` | 图片水印（文字），支持位置/透明度/颜色 |
| `FileValidatorPlugin` | 文件大小/类型/数量校验 |
| `ImageValidatorPlugin` | 图片宽高/分辨率/宽高比校验 |
| `VideoValidatorPlugin` | 视频时长/尺寸/编码校验 |
| `SmartRetryPlugin` | 智能重试，指数退避，支持重试次数和间隔配置 |

## 开发

```bash
# 安装依赖
pnpm install

# 启动本地测试服务器（端口 3000）
node server/main.js

# 启动示例页面
cd packages/example && pnpm dev

# 运行单元测试
cd packages/core && pnpm test

# 监听模式
cd packages/core && pnpm test:watch
```

## 项目结构

```
file-UD/
├── packages/
│   ├── core/              # 核心库
│   │   └── src/
│   │       ├── uploader/  # 上传器
│   │       ├── downloader/# 下载器
│   │       ├── transfer/  # 传输基类
│   │       ├── types/     # 类型定义
│   │       ├── utils/     # 工具函数
│   │       ├── chunkManager/ # 分片管理
│   │       ├── concurrency/  # 并发控制
│   │       └── fileUD/    # 错误体系
│   ├── plugins/           # 官方插件包
│   │   └── src/
│   │       ├── uploader/  # 上传插件（压缩/水印/校验）
│   │       └── retry/     # 重试插件
│   ├── docs/              # 文档站 (VitePress)
│   └── example/           # 示例项目 (Vue 3)
├── server/                # 本地测试服务 (Express)
│   ├── main.js            # 入口
│   ├── uploads/           # 上传文件存储目录
│   └── worker/            # 服务端 worker
```

## 变更日志

每个版本的详细变更记录会整理在 GitHub 发行说明中：

[查看发行说明](https://github.com/ChYuanJinlin/file-ud.js/releases)

## 提问

如果你在使用过程中遇到问题，建议通过 [GitHub Issues](https://github.com/ChYuanJinlin/file-ud.js/issues) 提交，并尽量提供以下信息：

- 使用明确、具体的标题描述问题。
- 提供问题的详细描述，包括重现步骤、预期行为和实际行为。
- 说明当前使用的 `@file-ud.js/core`、`@file-ud.js/plugins`、浏览器和框架版本。
- 如果可能，附加截图、录屏、控制台报错或最小复现仓库。

## 贡献代码

欢迎提交 Pull Request。建议按以下流程参与：

1. Fork 项目到你的 GitHub 账户。
2. 基于最新分支创建功能分支，例如 `feat/upload-queue` 或 `fix/download-progress`。
3. 在本地安装依赖并启动开发环境：

```bash
pnpm install
pnpm build
pnpm test
```

4. core 功能优先在 `packages/core/src` 下修改，并根据影响范围补充测试。
5. 插件功能优先在 `packages/plugins/src` 下修改。
6. 文档和示例更新放在 `packages/docs` 或 `packages/example`。
7. 提交 Pull Request，并说明改动内容、测试结果和兼容性影响。

## 联系信息

如果你有任何问题或建议，可以通过以下方式联系：

- GitHub Issues: [https://github.com/ChYuanJinlin/file-ud.js/issues](https://github.com/ChYuanJinlin/file-ud.js/issues)
- Email: 1075360356@qq.com
