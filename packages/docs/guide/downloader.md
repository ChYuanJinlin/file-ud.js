# Downloader 下载器

## 简介

`Downloader` 是 file-UD 库的文件下载模块，支持普通下载、分片并发下载、断点续传、秒下、速率统计、流式写入磁盘等功能。

## 基础用法

```typescript
import { FileUD } from "@file-ud.js/core";

const downloader = FileUD.createDownloader("myDownloader", {
  action: "https://example.com/file.pdf",
  headers: { Authorization: "Bearer token" },
  timeout: 30000,
});

downloader.onUpdate = (files) => {
  files.forEach((file) => {
    console.log(`${file.fileName}: ${file.percent}%`);
  });
};

downloader.onSuccess = (response, file) => {
  console.log(`下载完成: ${file.fileName}`);
};

// 添加下载任务
downloader.downloadFile({
  url: "https://example.com/file.pdf",
  fileName: "document.pdf",
});
```

## 下载方式选择

file-UD 提供了下载任务、分片下载和静态保存方法，不同入口的定位不同：

| 入口 | 适用场景 | 注意事项 |
|------|----------|----------|
| `downloader.downloadFile(file)` | 需要进度、事件、插件、鉴权请求头、限速、统一队列管理 | 推荐作为业务下载的默认入口 |
| `downloadFile()` + `chunkOptions` | 大文件、断点续传、暂停恢复、秒下、分片并发 | 更适合文件传输 SDK 的核心场景 |
| `Downloader.saveFile(fileName, url)` | 小文件、公开 URL、无需进度和生命周期 | 内部使用 `response.blob()`，会把完整文件读入内存，不适合大文件 |
| `Downloader.saveBlob(fileName, data)` | 已经拿到 Blob，需要触发浏览器保存 | Blob 本身已经在内存里，大文件要谨慎 |
| 原生 `<a download>` | 公开直链、无需请求头、无需进度 | 浏览器直接处理下载，内存占用最低 |

`Downloader.saveFile()` 是便捷方法，不会使用当前 `Downloader` 实例的 `headers`、`timeout`、插件、暂停恢复、分片和进度统计。大文件或需要 SDK 能力时，应使用 `downloadFile()`。

```typescript
// 公开小文件：可以直接交给浏览器
function downloadByLink(fileName: string, url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
}

// 需要鉴权、进度、断点续传：使用 Downloader 实例
const downloader = FileUD.createDownloader("assetDownloader", {
  headers: { Authorization: "Bearer token" },
  chunkOptions: {
    chunkSize: 20 * 1024 * 1024,
    maxConcurrent: 3,
    enableFileCache: true,
  },
});

downloader.downloadFile({
  url: "/api/files/big.zip",
  fileName: "big.zip",
  size: 1024 * 1024 * 500,
});
```

## 分片下载（断点续传 + 秒下）

```typescript
const downloader = FileUD.createDownloader("chunkDownloader", {
  action: "https://example.com/file",
  chunkOptions: {
    chunkSize: 2 * 1024 * 1024,    // 2MB 分片
    maxConcurrent: 3,               // 最多 3 个并发
    retries: 3,                     // 失败重试 3 次
    timeout: 10000,                 // 单分片超时
    enableFileCache: true,          // 启用 IndexedDB 缓存
  },
});

// 分片初始化回调
downloader.onInitChunk = async (downloadFile, totalChunks, fileHash) => {
  const { data } = await checkFile({ fileHash });
  return {
    fileHash: data.fileHash,
    chunks: data.chunks || [],
    isInstantDownload: data.isInstant,
  };
};

// 分片合并回调
downloader.onMergeChunk = async (chunkManager) => {
  // 流式模式自动落盘，内存模式可在此保存文件
};

downloader.downloadFile({
  url: "https://example.com/large-file.zip",
  fileName: "large-file.zip",
  size: 1024 * 1024 * 500,  // 500MB
});
```

## File System Access API（流式写入磁盘）

分片下载时，浏览器会自动弹出"另存为"对话框，使用 File System Access API 将分片直接写入磁盘，避免内存中累积完整文件。

```typescript
// 方式 1：自动弹出保存对话框（分片模式默认行为）
downloader.downloadFile({
  url: "https://example.com/big-file.zip",
  fileName: "big-file.zip",
});

// 方式 2：预先获取 FileHandle
const fileHandle = await Downloader.pickSaveFile("big-file.zip");
if (fileHandle) {
  downloader.downloadFile(
    { url: "https://example.com/big-file.zip", fileName: "big-file.zip" },
    fileHandle,
  );
}
```

## 文件操作

```typescript
// 单个文件操作
file.pause();     // 暂停（仅分片模式）
file.resume();    // 恢复（仅分片模式）
file.cancel();    // 取消
file.retry();     // 重试
file.remove();    // 从列表移除

// 批量操作
downloader.pauseAll();
downloader.resumeAll();
downloader.cancelAll();
downloader.retryAll();
downloader.removeAll();
downloader.submit();
```

## 全局统计

```typescript
downloader.onUpdate = (files) => {
  console.log(`总进度: ${downloader.totalPercent}%`);
  console.log(`已下载: ${downloader.transferredFormatSize}`);
  console.log(`总大小: ${downloader.totalFormatSize}`);
  console.log(`瞬时速度: ${downloader.speed.currentSpeedFormatted}`);
  console.log(`平均速度: ${downloader.speed.averageSpeedFormatted}`);
  console.log(`预计剩余: ${downloader.speed.estimatedTimeFormatted}`);
};
```

## 下载流程

### 普通下载

```
downloadFile() → onFileSelect 钩子 → beforeTransfer 钩子
  → axios GET → 进度回调 → saveBlob / 流式写入 → onSuccess
```

### 分片下载

```
downloadFile()
  → onInitChunk 回调（查服务端已存在分片）
  → IndexedDB 恢复（如启用 enableFileCache）
  → 磁盘断点续传检测（File System Access API）
  → 秒下检查（全部已完成 → 跳过下载）
  → 并发下载缺失分片（Range 请求）
  → 流式写入磁盘 / 内存累积
  → 分片合并 → onSuccess
```

### 状态流转

```
pending → UDLoading → success
                   → paused → UDLoading（恢复）
                   → cancelled / fail / error → retry → UDLoading
```

## 插件系统

```typescript
const myPlugin = {
  name: "my-download-plugin",
  version: "1.0.0",

  beforeTransfer: async (file, context) => {
    return true;
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
