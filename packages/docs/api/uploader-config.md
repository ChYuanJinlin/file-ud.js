# Uploader API 参考

## UploaderConfig

```typescript
interface UploaderConfig {
  /** 上传地址：字符串 URL 或自定义函数 */
  action: string | ((formData: FormData, uploadFile: UploadFile) => any);
  /** 是否支持多选，默认 false。false 为单文件覆盖模式，true 为多文件追加列表 */
  multiple?: boolean;
  /** 接受的文件类型 */
  accept?: AcceptFileType[] | string[];
  /** 是否自动上传，默认 true */
  autoUpload?: boolean;
  /** 是否显示文件输入框，默认 false */
  show?: boolean;
  /** 挂载的元素 ID */
  elementId?: string;
  /** FormData 中文件的字段名，默认 "file" */
  file?: string | ((fileConfig: FileConfig) => void);
  /** 分片上传配置 */
  chunkOptions?: ChunkOptions | null;
  /** 文件数量限制，仅 multiple: true 时生效 */
  limit?: number;
  /** 单文件大小限制（字节） */
  maxSize?: number;
  /** 自定义请求头 */
  headers?: Record<string, any>;
  /** 最大同时传输文件数 */
  maxFileConcurrent?: number;
  /** 自定义 axios 实例 */
  axiosInstance?: AxiosInstance;
}
```

### 常用配置说明

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `action` | `string \| function` | `""` | 上传接口地址，或自定义上传函数 |
| `multiple` | `boolean` | `false` | 是否允许多文件；`false` 为单文件覆盖模式，`true` 为多文件追加列表 |
| `autoUpload` | `boolean` | `true` | 选择文件后是否立即上传 |
| `accept` | `AcceptFileType[] \| string[]` | `[]` | 限制可选择的文件类型，例如 `["image/*", ".pdf"]` |
| `limit` | `number` | - | 文件数量限制，仅 `multiple: true` 时生效 |
| `maxSize` | `number` | - | 单文件大小限制，单位为字节 |
| `maxFileConcurrent` | `number` | - | 多文件同时上传数量 |

`multiple: false` 是头像、Logo、封面等单文件上传场景的默认模式。重新选择文件时，上传器会在新文件通过校验和传输前拦截后替换当前文件；如果新文件校验失败，旧文件会继续保留。

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
  /** 是否启用 IndexedDB 缓存（断点续传用） */
  enableFileCache?: boolean;
  /** 缓存保留天数，默认 7 天 */
  cacheRetentionDays?: number;
}
```

## Uploader 方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `open(fn?)` | 打开文件选择器，`fn` 会接收当前选中的 `UploadFile` | `void` |
| `use(plugin)` | 注册插件 | `this` |
| `unuse(name)` | 移除插件 | `this` |
| `getPlugin(name?)` | 获取插件 | `IUDPlugin \| IUDPlugin[]` |
| `updateConfig(config)` | 动态更新配置 | `void` |
| `setFiles(files)` | 回显文件列表 | `void` |
| `clearFiles()` | 清空文件列表 | `void` |
| `pauseAll()` | 暂停所有进行中的上传 | `void` |
| `resumeAll()` | 恢复所有暂停的上传 | `void` |
| `cancelAll()` | 取消所有上传 | `void` |
| `retryAll()` | 重试所有失败/取消的任务 | `void` |
| `submit()` | 提交所有 pending 任务 | `Promise<void>` |

## Uploader 静态方法

| 方法 | 说明 |
|------|------|
| `Uploader.setDefaultPlugins(plugins)` | 设置上传器全局默认插件，只影响之后创建的实例 |

## Uploader 回调设置器

| 设置器 | 回调签名 | 说明 |
|--------|----------|------|
| `onSuccess` | `(response, file) => void` | 单文件上传成功 |
| `onUpdate` | `(files: UploadFile[]) => void` | 文件列表更新 |
| `onInitChunk` | `(file, totalChunks, fileHash) => Promise` | 分片初始化 |
| `onMergeChunk` | `(chunkManager) => Promise` | 分片合并 |
| `onbeforeTransfer` | `(file) => boolean \| Promise` | 上传前拦截 |
| `onSelect` | `(file: File) => boolean \| Promise` | 文件选择时拦截 |

## UploadFile 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `fileId` | `string` | 文件唯一标识 |
| `fileName` | `string` | 文件名 |
| `File` | `File` | 原始 File 对象 |
| `url` | `string` | 文件预览 URL |
| `size` | `number` | 文件大小（字节） |
| `percent` | `number` | 上传进度 (0-100) |
| `status` | `string` | 状态 |
| `speed` | `speedInfo` | 速率信息 |
| `formatSize` | `string` | 格式化文件大小 |
| `hashPercent` | `number` | MD5 计算进度 (0-100) |
| `hashLoading` | `boolean` | 是否正在计算 MD5 |

## UploadFile 方法

| 方法 | 说明 |
|------|------|
| `start(chunkManager)` | 开始上传 |
| `pause()` | 暂停上传（仅分片模式） |
| `resume()` | 恢复上传（仅分片模式） |
| `cancel()` | 取消上传 |
| `retry()` | 重试上传 |

## 事件

| 事件名 | 回调参数 | 说明 |
|--------|----------|------|
| `change` | `(file: UploadFile)` | 用户选择文件 |
| `progress` | `(percent: number)` | 全局进度 |
| `pause` | `(file: UploadFile)` | 文件暂停 |
| `resume` | `(file: UploadFile)` | 文件恢复 |
| `cancel` | `(file: UploadFile)` | 文件取消 |
| `retry` | `(file: UploadFile)` | 文件重试 |
| `remove` | `(file: UploadFile)` | 文件移除 |
| `files-start` | `(files: UploadFile[])` | 批量开始 |
| `files-complete` | `(files: TransferFile[])` | 批量完成 |
| `chunk-success` | `(data)` | 分片上传成功 |
| `chunk-error` | `(data)` | 分片上传失败 |
| `chunk-upload-start` | `(data)` | 分片上传开始 |
| `instant-upload` | `(data)` | 秒传成功 |
| `merging` | `(data)` | 分片合并中 |
| `merge-success` | `(data)` | 分片合并完成 |
| `merge-error` | `(data)` | 分片合并失败 |
| `error` | `(error)` | 上传错误 |
