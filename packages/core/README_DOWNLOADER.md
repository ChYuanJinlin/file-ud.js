# Downloader 使用指南

## 简介

`Downloader` 是 `file-UD` 库中的文件下载模块，支持普通下载、分片并发下载、断点续传、秒下（instant download）、速率统计、流式写入磁盘等功能。

## 快速开始

### 1. 基础用法

```typescript
import { FileUD } from "@file-ud.js/core";

// 创建下载器实例
const downloader = FileUD.createDownloader("myDownloader", {
  action: "https://example.com/file.pdf",
  headers: { Authorization: "Bearer token" },
  timeout: 30000,
});

// 设置更新回调（所有文件列表变化时触发）
downloader.onUpdate = (files) => {
  files.forEach((file) => {
    console.log(`${file.fileName}: ${file.percent}%`);
  });
};

// 设置成功回调
downloader.onSuccess = (response, file) => {
  console.log(`下载完成: ${file.fileName}`);
};

// 添加下载任务（立即开始下载）
downloader.downloadFile({
  url: "https://example.com/file.pdf",
  fileName: "document.pdf",
});
```

### 2. 分片下载（断点续传 + 秒下）

```typescript
const downloader = FileUD.createDownloader("chunkDownloader", {
  action: "https://example.com/file",
  chunkOptions: {
    chunkSize: 2 * 1024 * 1024,   // 2MB 分片
    maxConcurrent: 3,              // 最多 3 个并发
    retries: 3,                    // 失败重试 3 次
    timeout: 10000,                // 单分片超时
    enableFileCache: true,         // 启用 IndexedDB 缓存（支持断点续传）
  },
});

// 分片初始化回调（查询服务端已存在的分片，实现断点续传 / 秒下）
downloader.onInitChunk = async (downloadFile, totalChunks, fileHash) => {
  const { data } = await checkFile({ fileHash });
  return {
    fileHash: data.fileHash,
    chunks: data.chunks || [],           // 已存在的分片索引
    isInstantDownload: data.isInstant,   // 秒下标记
  };
};

// 分片合并回调
downloader.onMergeChunk = async (chunkManager) => {
  // 流式模式自动落盘，内存模式需要手动保存（触发浏览器下载对话框）
};

// 添加分片下载任务
downloader.downloadFile({
  url: "https://example.com/large-file.zip",
  fileName: "large-file.zip",
  size: 1024 * 1024 * 500,   // 500MB，用于端侧校验
});
```

### 3. File System Access API（流式写入磁盘）

分片下载时，浏览器会自动弹出"另存为"对话框，使用 File System Access API 将每个分片直接写入磁盘，**避免内存中累积完整文件**，适合大文件下载。

```typescript
// 方式 1：自动弹出保存对话框（分片模式下默认行为）
downloader.downloadFile({
  url: "https://example.com/big-file.zip",
  fileName: "big-file.zip",
});

// 方式 2：预先获取 FileHandle（手动控制保存位置）
const fileHandle = await Downloader.pickSaveFile("big-file.zip");
if (fileHandle) {
  downloader.downloadFile(
    { url: "https://example.com/big-file.zip", fileName: "big-file.zip" },
    fileHandle,
  );
}
```

### 4. 手动控制下载

```typescript
// 文件级别控制
const file = downloader.downloadFile({ url: "...", fileName: "..." });

file.pause();     // 暂停下载（仅分片模式）
file.resume();    // 恢复下载（仅分片模式）
file.cancel();    // 取消下载
file.retry();     // 重试下载
file.remove();    // 从列表移除
```

### 5. 批量操作

```typescript
downloader.pauseAll();    // 暂停所有
downloader.resumeAll();   // 恢复所有
downloader.cancelAll();   // 取消所有
downloader.retryAll();    // 重试所有失败/取消的任务
downloader.removeAll();   // 清空所有任务
downloader.submit();      // 提交所有 pending 任务
```

### 6. 全局统计信息

```typescript
downloader.onUpdate = (files) => {
  // 全局进度
  console.log(`总进度: ${downloader.totalPercent}%`);
  console.log(`已下载: ${downloader.transferredFormatSize}`);
  console.log(`总大小: ${downloader.totalFormatSize}`);
  // 全局速度
  console.log(`瞬时速度: ${downloader.speed.currentSpeedFormatted}`);
  console.log(`平均速度: ${downloader.speed.averageSpeedFormatted}`);
  console.log(`预计剩余: ${downloader.speed.estimatedTimeFormatted}`);
};
```

---

## API 参考

### DownloaderConfig 配置

```typescript
interface DownloaderConfig {
  /** 下载地址：字符串 URL 或函数 */
  action: string | ((transferFile: DownloadFile) => string | Promise<any>);
  /** 自定义请求头 */
  headers?: Record<string, any>;
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number;
  /** 分片下载配置 */
  chunkOptions?: ChunkOptions | null;
  /** 文件数量限制 */
  limit?: number;
  /** 单文件大小限制（字节） */
  maxSize?: number;
  /** 最大同时传输文件数 */
  maxFileConcurrent?: number;
  /** 自定义 axios 实例 */
  axiosInstance?: AxiosInstance;
  /** axios 请求配置（method、responseType 等） */
  axiosOptions?: AxiosRequestConfig;
  /** 下载最大速率限制（bytes/秒） */
  maxDownloadSpeed?: number;
}
```

### ChunkOptions 分片配置

```typescript
interface ChunkOptions {
  /** 分片大小（字节），如 2 * 1024 * 1024 */
  chunkSize?: number;
  /** 分片最大并发数 */
  maxConcurrent?: number;
  /** 失败重试次数 */
  retries?: number | null;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  /** 单分片超时（毫秒） */
  timeout?: number;
  /** 是否启用 IndexedDB 文件缓存（断点续传用） */
  enableFileCache?: boolean;
  /** 缓存保留天数，默认 7 天 */
  cacheRetentionDays?: number;
}
```

### Downloader 方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `downloadFile(file, fileHandle?)` | 添加下载任务并立即开始 | `DownloadFile` |
| `use(plugin)` | 注册插件 | `this` |
| `unuse(name)` | 移除插件 | `this` |
| `getPlugin(name?)` | 获取插件 | `IUDPlugin \| IUDPlugin[]` |
| `updateConfig(config)` | 动态更新配置 | `void` |
| `pauseAll()` | 暂停所有进行中的下载 | `void` |
| `resumeAll()` | 恢复所有暂停的下载 | `Promise<void>` |
| `cancelAll()` | 取消所有下载 | `void` |
| `retryAll()` | 重试所有失败/取消的任务 | `Promise<void>` |
| `removeAll()` | 清空所有任务 | `void` |
| `submit()` | 提交所有 pending 任务 | `void` |

### Downloader 静态方法

| 方法 | 说明 |
|------|------|
| `Downloader.setDefaultPlugins(plugins)` | 设置全局默认插件 |
| `Downloader.pickSaveFile(name?)` | 弹出系统保存对话框，返回 FileHandle |
| `Downloader.saveBlob(fileName, data)` | 保存 Blob 到本地（触发浏览器下载） |
| `Downloader.saveFile(fileName, url)` | 通过 URL 下载并保存文件 |

### Downloader 回调设置器

| 设置器 | 回调签名 | 说明 |
|--------|----------|------|
| `onSuccess = fn` | `(response, file) => void` | 单文件下载成功 |
| `onUpdate = fn` | `(files: DownloadFile[]) => void` | 文件列表更新（进度/状态变化） |
| `onInitChunk = fn` | `(file, totalChunks, fileHash) => Promise` | 分片初始化（查已下载分片） |
| `onMergeChunk = fn` | `(chunkManager) => Promise` | 分片合并 |
| `onbeforeTransfer = fn` | `(file) => boolean \| Promise` | 下载前拦截 |

### DownloadFile 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `fileId` | `string` | 文件唯一标识 |
| `fileName` | `string` | 文件名 |
| `url` | `string` | 下载地址 |
| `size` | `number` | 文件大小（字节） |
| `percent` | `number` | 下载进度 (0-100) |
| `status` | `string` | 状态：pending / UDLoading / paused / success / fail / error / cancelled |
| `speed` | `speedInfo` | 速率信息（瞬时/平均速度、预计剩余时间） |
| `formatSize` | `string` | 格式化文件大小 |
| `transferFormatSize` | `string` | 已下载大小格式化字符串 |
| `fileHandle` | `FileSystemFileHandle \| null` | 流式写入的文件句柄 |

### DownloadFile 方法

| 方法 | 说明 |
|------|------|
| `start(chunkManager)` | 开始下载 |
| `pause()` | 暂停下载（仅分片模式） |
| `resume()` | 恢复下载（仅分片模式） |
| `cancel()` | 取消下载 |
| `retry()` | 重试下载 |
| `remove()` | 从列表移除 |

### 事件

通过 `downloader.on(eventName, callback)` 监听：

| 事件名 | 回调参数 | 说明 |
|--------|----------|------|
| `progress` | `(percent: number)` | 全局进度 |
| `change` | `(file: DownloadFile)` | 文件新增 |
| `pause` | `(file: DownloadFile)` | 文件暂停 |
| `resume` | `(file: DownloadFile)` | 文件恢复 |
| `cancel` | `(file: DownloadFile)` | 文件取消 |
| `retry` | `(file: DownloadFile)` | 文件重试 |
| `remove` | `(file: DownloadFile)` | 文件移除 |
| `files-start` | `(files: DownloadFile[])` | 批量开始 |
| `files-complete` | `(files: DownloadFile[])` | 批量完成 |
| `chunk-success` | `(data: ChunkSuccessData)` | 分片下载成功 |
| `chunk-error` | `(data: ChunkErrorData)` | 分片下载失败 |
| `chunk-download-start` | `(data: ChunkStartData)` | 分片下载开始 |
| `merging` | `(data)` | 分片合并中 |
| `merge-success` | `(data)` | 分片合并完成 |
| `merge-error` | `(data)` | 分片合并失败 |

---

## 插件系统

```typescript
const myPlugin = {
  name: "my-download-plugin",
  version: "1.0.0",

  onFileSelect: async (file, context) => {
    console.log(`准备下载: ${file.fileName}`);
    return file;   // 返回 false 可拒绝下载
  },

  beforeTransfer: async (file, context) => {
    return true;   // 返回 false 阻止下载
  },

  onProgress: (percent, file, context) => {
    console.log(`${file.fileName}: ${percent}%`);
  },

  onSuccess: (response, file, context) => {
    console.log(`✅ ${file.fileName} 下载成功`);
  },

  onError: (error, file, context) => {
    console.error(`❌ ${file.fileName} 下载失败:`, error);
  },
};

downloader.use(myPlugin);
```

---

## 下载流程说明

### 普通下载流程
```
downloadFile() → onFileSelect 钩子 → beforeTransfer 钩子
  → axios GET → 进度回调 → 成功 → saveBlob / 流式写入 → onSuccess
```

### 分片下载流程
```
downloadFile()
  → onInitChunk 回调（查服务端已存在分片）
  → IndexedDB 恢复（如启用 enableFileCache）
  → 磁盘断点续传检测（File System Access API）
  → 秒下检查（全部已完成 → 跳过下载）
  → 并发下载缺失分片（Range 请求）
  → 流式写入磁盘 / 内存累积
  → 分片合并
  → onSuccess
```

### 文件状态流转
```
pending → UDLoading → success
                   → paused → UDLoading（恢复）
                   → cancelled / fail / error → retry → UDLoading
```
