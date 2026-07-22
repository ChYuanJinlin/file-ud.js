# Downloader API 参考

## DownloaderConfig

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

## ChunkOptions

```typescript
interface ChunkOptions {
  /** 分片大小（字节） */
  chunkSize?: number;
  /** 分片最大并发数 */
  maxConcurrent?: number;
  /** 失败重试次数 */
  retries?: number | null;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  /** 单分片超时（毫秒） */
  timeout?: number;
  /** 是否启用 IndexedDB 文件缓存 */
  enableFileCache?: boolean;
  /** 缓存保留天数，默认 7 天 */
  cacheRetentionDays?: number;
}
```

## Downloader 方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `downloadFile(file, fileHandle?)` | 添加下载任务 | `DownloadFile` |
| `use(plugin)` | 注册插件 | `this` |
| `unuse(name)` | 移除插件 | `this` |
| `getPlugin(name?)` | 获取插件 | `IUDPlugin \| IUDPlugin[]` |
| `updateConfig(config)` | 动态更新配置 | `void` |
| `pauseAll()` | 暂停所有下载 | `void` |
| `resumeAll()` | 恢复所有下载 | `Promise<void>` |
| `cancelAll()` | 取消所有下载 | `void` |
| `retryAll()` | 重试所有失败/取消 | `Promise<void>` |
| `removeAll()` | 清空所有任务 | `void` |
| `submit()` | 提交所有 pending | `void` |

## Downloader 静态方法

| 方法 | 说明 |
|------|------|
| `Downloader.setDefaultPlugins(plugins)` | 设置下载器全局默认插件，只影响之后创建的实例 |
| `Downloader.pickSaveFile(name?)` | 弹出保存对话框 |
| `Downloader.saveBlob(fileName, data)` | 保存 Blob 到本地 |
| `Downloader.saveFile(fileName, url)` | 通过 URL 下载文件 |

### 静态保存方法的性能边界

`Downloader.saveBlob(fileName, data)` 和 `Downloader.saveFile(fileName, url)` 是浏览器便捷保存方法，适合小文件、图片预览结果、导出文件等场景。

`Downloader.saveFile(fileName, url)` 内部会先 `fetch(url)`，再通过 `response.blob()` 把完整响应读入内存，最后创建 `Object URL` 触发浏览器保存。因此它不适合大文件下载，也不走 `Downloader` 实例的 `headers`、`timeout`、插件、限速、暂停、恢复、分片和进度统计。

| 场景 | 推荐方式 | 原因 |
|------|----------|------|
| 公开 URL、小文件、无需进度 | 原生 `<a download>` 或 `Downloader.saveFile()` | 实现简单 |
| 需要请求头、鉴权、进度、事件、插件 | `downloader.downloadFile(file)` | 会走实例配置和生命周期 |
| 大文件、断点续传、暂停恢复、秒下 | `downloadFile()` + `chunkOptions` | 分片传输，不需要一次性把完整文件放进内存 |
| 支持 File System Access API 的大文件保存 | `downloadFile(file, fileHandle)` 或分片模式自动弹出保存对话框 | 分片直接写入磁盘，降低内存占用 |

如果只是公开直链下载，并且不需要鉴权、进度和 SDK 生命周期，浏览器原生下载的内存占用最低：

```typescript
function downloadByLink(fileName: string, url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.click();
}
```

## Downloader 回调设置器

| 设置器 | 回调签名 | 说明 |
|--------|----------|------|
| `onSuccess` | `(response, file) => void` | 单文件下载成功 |
| `onUpdate` | `(files: DownloadFile[]) => void` | 文件列表更新 |
| `onInitChunk` | `(file, totalChunks, fileHash) => Promise` | 分片初始化 |
| `onMergeChunk` | `(chunkManager) => Promise` | 分片合并 |
| `onbeforeTransfer` | `(file) => boolean \| Promise` | 下载前拦截 |

## DownloadFile 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `fileId` | `string` | 文件唯一标识 |
| `fileName` | `string` | 文件名 |
| `url` | `string` | 下载地址 |
| `size` | `number` | 文件大小（字节） |
| `percent` | `number` | 下载进度 (0-100) |
| `status` | `string` | 状态 |
| `speed` | `speedInfo` | 速率信息 |
| `formatSize` | `string` | 格式化文件大小 |
| `fileHandle` | `FileSystemFileHandle \| null` | 文件句柄 |

## DownloadFile 方法

| 方法 | 说明 |
|------|------|
| `start(chunkManager)` | 开始下载 |
| `pause()` | 暂停（仅分片模式） |
| `resume()` | 恢复（仅分片模式） |
| `cancel()` | 取消 |
| `retry()` | 重试 |
| `remove()` | 移除 |

## 事件

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
| `chunk-success` | `(data)` | 分片下载成功 |
| `chunk-error` | `(data)` | 分片下载失败 |
| `chunk-download-start` | `(data)` | 分片下载开始 |
| `merging` | `(data)` | 分片合并中 |
| `merge-success` | `(data)` | 分片合并完成 |
| `merge-error` | `(data)` | 分片合并失败 |
