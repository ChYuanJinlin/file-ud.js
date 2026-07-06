# 错误码参考

file-UD 所有错误均通过 `FileUDError` 类抛出，包含错误码、级别、上下文和选项信息。

## ErrorCode 枚举

### 通用错误（1000-1999）

| 错误码 | 常量名 | 中文描述 | 错误级别 |
|--------|--------|----------|----------|
| `1000` | `UNKNOWN` | 未知错误 | `error` |
| `1001` | `ABORTED` | 操作已中止 | `error` |
| `1002` | `TIMEOUT` | 请求超时 | `error` |
| `1003` | `NETWORK` | 网络错误 | `error` |

### 文件验证错误（2000-2999）

| 错误码 | 常量名 | 中文描述 | 错误级别 |
|--------|--------|----------|----------|
| `2000` | `FILE_TOO_LARGE` | 文件过大 | `warn` |
| `2001` | `FILE_TOO_SMALL` | 文件过小 | `warn` |
| `2002` | `INVALID_TYPE` | 文件类型无效 | `warn` |
| `2003` | `FILE_LIMIT_EXCEEDED` | 文件数量超限 | `warn` |
| `2004` | `DUPLICATE_FILE` | 重复的文件 | `warn` |
| `2005` | `FILE_EMPTY` | 文件为空 | `warn` |
| `2006` | `FILE_CORRUPTED` | 文件已损坏 | `warn` |
| `2007` | `FILE_TOO_EMPTY` | 文件内容不完整 | `warn` |

### 图片验证错误（2100-2199）

| 错误码 | 常量名 | 中文描述 | 错误级别 |
|--------|--------|----------|----------|
| `2100` | `IMAGE_WIDTH_INVALID` | 图片宽度不符合要求 | `warn` |
| `2101` | `IMAGE_HEIGHT_INVALID` | 图片高度不符合要求 | `warn` |
| `2102` | `IMAGE_ASPECT_RATIO_INVALID` | 图片宽高比不符合要求 | `warn` |
| `2103` | `IMAGE_RESOLUTION_INVALID` | 图片分辨率不符合要求 | `warn` |
| `2104` | `IMAGE_NOT_SQUARE` | 图片不是正方形 | `warn` |
| `2105` | `IMAGE_ANIMATED` | 不支持动态图片 | `warn` |

### 视频验证错误（2200-2299）

| 错误码 | 常量名 | 中文描述 | 错误级别 |
|--------|--------|----------|----------|
| `2200` | `VIDEO_DURATION_INVALID` | 视频时长不符合要求 | `warn` |
| `2201` | `VIDEO_WIDTH_INVALID` | 视频宽度不符合要求 | `warn` |
| `2202` | `VIDEO_HEIGHT_INVALID` | 视频高度不符合要求 | `warn` |
| `2203` | `VIDEO_BITRATE_INVALID` | 视频比特率不符合要求 | `warn` |
| `2204` | `VIDEO_CODEC_INVALID` | 视频编码格式不支持 | `warn` |

### 上传错误（3000-3999）

| 错误码 | 常量名 | 中文描述 | 错误级别 |
|--------|--------|----------|----------|
| `3000` | `UPLOAD_FAILED` | 上传失败 | `error` |
| `3001` | `CHUNK_UPLOAD_FAILED` | 分片上传失败 | `error` |
| `3002` | `MERGE_FAILED` | 合并分片失败 | `error` |
| `3003` | `SERVER_ERROR` | 服务器错误 | `error` |
| `3004` | `UNAUTHORIZED` | 未授权访问 | `error` |
| `3005` | `FORBIDDEN` | 禁止访问 | `error` |
| `3006` | `NOT_FOUND` | 资源不存在 | `error` |

### 下载错误（4000-4999）

| 错误码 | 常量名 | 中文描述 | 错误级别 |
|--------|--------|----------|----------|
| `4000` | `DOWNLOAD_FAILED` | 下载失败 | `critical` |
| `4001` | `CHUNK_DOWNLOAD_FAILED` | 分片下载失败 | `critical` |

### 插件错误（5000-5999）

| 错误码 | 常量名 | 中文描述 | 错误级别 |
|--------|--------|----------|----------|
| `5000` | `PLUGIN_ERROR` | 插件错误 | `critical` |
| `5001` | `PLUGIN_INIT_FAILED` | 插件初始化失败 | `critical` |
| `5002` | `PLUGIN_EXECUTION_FAILED` | 插件执行失败 | `critical` |

## ErrorLevel 错误级别

| 级别 | 值 | 说明 |
|------|------|------|
| `info` | `"info"` | 提示信息，不影响流程 |
| `warn` | `"warn"` | 警告，但继续执行（文件验证类） |
| `error` | `"error"` | 错误，中断当前操作 |
| `critical` | `"critical"` | 致命错误，整个实例不可用 |

## FileUDError 类

```typescript
class FileUDError extends Error {
  code: ErrorCode;            // 错误码
  level: ErrorLevel;          // 错误级别
  context: ErrorContext;      // 错误上下文
  options: ErrorOptions;      // 错误选项
  cause?: Error;              // 原始错误
}
```

### 方法

| 方法 | 说明 |
|------|------|
| `toJSON()` | 转为 JSON 对象 |
| `getChineseDescription(code?)` | 获取错误码中文描述 |
| `setCode(code)` | 设置错误码 |
| `setMessage(message)` | 设置错误消息 |
| `setContext(context)` | 设置上下文 |
| `setOptions(options)` | 设置选项 |

## ErrorContext 错误上下文

```typescript
interface ErrorContext {
  timestamp?: number;      // 发生时间
  plugin?: string;         // 插件名称
  uploader?: Uploader;     // 上传器实例
  fileName?: string;       // 文件名
  fileSize?: number;       // 文件大小（字节）
  chunkIndex?: number;     // 分片索引
  httpStatus?: number;     // HTTP 状态码
  retryCount?: number;     // 重试次数
  originalError?: any;     // 原始错误
  options?: Record<string, any>;  // 参数选项
}
```

## ErrorOptions 错误选项

```typescript
interface ErrorOptions {
  recoverable?: boolean;   // 是否可恢复（默认 true）
  retryable?: boolean;     // 是否自动重试（默认 false）
  suggestion?: string;     // 建议操作
  userVisible?: boolean;   // 是否显示给用户（默认 true）
  i18nKey?: string;        // 国际化 key
}
```

## 使用示例

### 监听错误

```typescript
import { ErrorCode } from "@file-ud.js/core";

// 通过事件监听
uploader.on("error", (error) => {
  console.log(`错误码: ${error.code}`);          // 3000
  console.log(`错误级别: ${error.level}`);        // "error"
  console.log(`错误消息: ${error.message}`);      // "文件 xxx 上传失败 (500)"
  console.log(`上下文:`, error.context);          // { fileName, httpStatus, ... }
  console.log(`是否可重试: ${error.options.retryable}`); // true
});

// 通过 onError 回调
uploader.onError = (error) => {
  switch (error.code) {
    case ErrorCode.FILE_TOO_LARGE:
      alert("文件太大，请选择更小的文件");
      break;
    case ErrorCode.NETWORK:
      alert("网络连接失败，请检查网络后重试");
      break;
    case ErrorCode.UPLOAD_FAILED:
      alert(`上传失败: ${error.context.fileName}`);
      break;
  }
};
```

### 错误级别处理策略

```typescript
import { ErrorLevel } from "@file-ud.js/core";

uploader.onError = (error) => {
  switch (error.level) {
    case ErrorLevel.INFO:
      // 提示信息，不处理
      console.info(error.message);
      break;
    case ErrorLevel.WARNING:
      // 警告，给用户 toast 提示但不中断
      showToast(error.message, "warning");
      break;
    case ErrorLevel.ERROR:
      // 错误，中断当前操作，提示用户
      showToast(error.message, "error");
      if (error.options.retryable) {
        // 可重试，给用户重试按钮
        showRetryButton();
      }
      break;
    case ErrorLevel.CRITICAL:
      // 致命错误，禁用整个上传器
      showModal(error.message);
      uploader.cancelAll();
      break;
  }
};
```
