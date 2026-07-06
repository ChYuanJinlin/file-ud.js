# 日志 API（Logger）

## 简介

`logger` 是 file-UD 提供的统一日志工具模块，用于替代原生 `console`，支持环境感知、级别控制、格式化输出和日志收集器。

```typescript
import { logger, LogLevel, initLogger } from "@file-ud.js/core";
```

## LogLevel 日志级别

| 枚举值 | 数值 | 方法 | 使用场景 | 生产环境默认 |
|--------|------|------|----------|-------------|
| `LogLevel.DEBUG` | `0` | `logger.debug()` | 详细调试信息 | ❌ 禁用 |
| `LogLevel.INFO` | `1` | `logger.info()` | 关键业务流程节点 | ❌ 禁用 |
| `LogLevel.WARN` | `2` | `logger.warn()` | 可恢复的异常情况 | ✅ 启用 |
| `LogLevel.ERROR` | `3` | `logger.error()` | 导致功能失败的严重错误 | ✅ 启用 |

## LoggerOptions 配置

```typescript
interface LoggerOptions {
  /** 是否启用日志输出，默认 false */
  enabled?: boolean;
  /** 最低日志级别，生产环境默认 WARN(2)，开发环境默认 DEBUG(0) */
  level?: LogLevel;
  /** 是否显示时间戳，默认 true */
  showTimestamp?: boolean;
  /** 是否启用 ANSI 颜色输出，非生产环境默认 true */
  enableColors?: boolean;
}
```

## 函数 API

### initLogger(options?)

初始化日志配置。配置优先级：**环境变量 > initLogger() > 默认配置**。

```typescript
import { initLogger, LogLevel } from "@file-ud.js/core";

initLogger({
  enabled: true,
  level: LogLevel.DEBUG,
  showTimestamp: true,
  enableColors: true,
});
```

### setLogLevel(level)

运行时动态调整日志级别。

```typescript
import { setLogLevel, LogLevel } from "@file-ud.js/core";

setLogLevel(LogLevel.DEBUG);  // 显示所有日志
setLogLevel(LogLevel.ERROR);  // 仅显示错误
```

### addLogCollector(callback)

注册日志收集器，返回取消注册的函数。

```typescript
import { addLogCollector, LogLevel } from "@file-ud.js/core";

const unsubscribe = addLogCollector((entry) => {
  if (entry.level === LogLevel.ERROR) {
    // 上报错误到监控平台
    reportToSentry(entry);
  }
});

// 取消注册
unsubscribe();
```

### clearLogCollectors()

清除所有已注册的日志收集器。

```typescript
import { clearLogCollectors } from "@file-ud.js/core";

clearLogCollectors();
```

## LogEntry 日志条目

```typescript
interface LogEntry {
  timestamp: number;      // 时间戳 (Date.now())
  level: LogLevel;        // 日志级别 (0-3)
  module: string;         // 模块名称（如 "uploadChunkManager"）
  message: string;        // 消息内容
  args?: any[];           // 额外参数
  stack?: string;         // 错误堆栈（如果是 Error 对象）
}
```

## LogCollectorCallback 类型

```typescript
type LogCollectorCallback = (entry: LogEntry) => void | Promise<void>;
```

## logger 对象

`logger` 是核心日志输出对象，所有方法签名统一为 `(module, message, ...args)`。

### logger.debug(module, message, ...args)

调试日志，生产环境默认禁用。

```typescript
logger.debug("uploadChunkManager", "分片切割完成", {
  totalChunks: 10,
  chunkSize: 5 * 1024 * 1024,
});
// 输出: 🔍 [DEBUG] [uploadChunkManager] 分片切割完成 { totalChunks: 10, chunkSize: 5242880 }
```

### logger.info(module, message, ...args)

信息日志，记录关键业务节点。

```typescript
logger.info("UploadFile", "文件传输成功", fileName);
// 输出: ✅ [INFO] [UploadFile] 文件传输成功 document.pdf
```

### logger.warn(module, message, ...args)

警告日志，可恢复的异常情况。

```typescript
logger.warn("uploadChunkManager", "IndexedDB 更新失败，使用备用方案");
// 输出: ⚠️ [WARN] [uploadChunkManager] IndexedDB 更新失败，使用备用方案
```

### logger.error(module, message, ...args)

错误日志，导致功能失败的严重错误。直接传入 Error 对象，logger 会自动提取堆栈。

```typescript
try {
  await uploadChunk();
} catch (error) {
  logger.error("uploadChunkManager", "分片上传失败", error);
}
// 输出: ❌ [ERROR] [uploadChunkManager] 分片上传失败 Error: timeout
//       at uploadChunkManager.ts:42:15
```

## 日志输出格式

```
[2024-01-15 10:30:45.123] [DEBUG] [uploadChunkManager] 🔍 分片切割完成 { totalChunks: 10 }
[2024-01-15 10:30:46.789] [INFO]  [UploadFile]          ✅ 文件传输成功
[2024-01-15 10:30:47.012] [WARN]  [uploadChunkManager]  ⚠️  IndexedDB 更新失败
[2024-01-15 10:30:48.234] [ERROR] [Uploader]             ❌ 网络请求失败
```

- 时间戳格式：`YYYY-MM-DD HH:mm:ss.SSS`（本地时间）
- DEBUG → `console.debug()`，INFO → `console.info()`，WARN → `console.warn()`，ERROR → `console.error()`
- 支持 ANSI 颜色：DEBUG=青色、INFO=绿色、WARN=黄色、ERROR=红色
- 自动通过 `Error().stack` 获取真实调用位置，支持浏览器控制台点击跳转

## 环境变量配置

```bash
# 设置日志级别（优先级最高）
VITE_LOG_LEVEL=debug    # 显示所有日志
VITE_LOG_LEVEL=info     # 显示 INFO+WARN+ERROR
VITE_LOG_LEVEL=warn     # 仅 WARN+ERROR（生产默认）
VITE_LOG_LEVEL=error    # 仅 ERROR
```

## 配置优先级

```
环境变量(VITE_LOG_LEVEL) > UploaderConfig.logConfig > initLogger() > 默认配置
```

## 日志收集器示例

### 上报错误到 Sentry

```typescript
import { addLogCollector, LogLevel } from "@file-ud.js/core";
import * as Sentry from "@sentry/browser";

addLogCollector((entry) => {
  if (entry.level === LogLevel.ERROR) {
    Sentry.captureException({
      message: `[${entry.module}] ${entry.message}`,
      extra: {
        args: entry.args,
        stack: entry.stack,
        timestamp: new Date(entry.timestamp).toISOString(),
      },
    });
  }
});
```

### 批量上报到后端 API

```typescript
import { addLogCollector, LogLevel } from "@file-ud.js/core";

const buffer: LogEntry[] = [];

addLogCollector((entry) => {
  if (entry.level >= LogLevel.WARN) {
    buffer.push(entry);
    if (buffer.length >= 10) {
      const batch = [...buffer];
      buffer.length = 0;
      fetch("/api/logs/batch", {
        method: "POST",
        body: JSON.stringify(batch),
      });
    }
  }
});
```

### 多收集器 + 条件过滤

```typescript
import { addLogCollector, LogLevel } from "@file-ud.js/core";

// 收集器 1：错误上报
addLogCollector((entry) => {
  if (entry.level === LogLevel.ERROR) {
    reportError(entry);
  }
});

// 收集器 2：特定模块调试
addLogCollector((entry) => {
  const targetModules = ["uploadChunkManager", "UploadFile"];
  if (entry.level < LogLevel.WARN) return;
  if (!targetModules.includes(entry.module)) return;
  sendToBackend(entry);
});
```

## 最佳实践

### 模块标识规范

第一个参数必须是模块名称（类名或功能模块名），便于日志过滤和追踪。

```typescript
// ✅ 正确
logger.info("uploadChunkManager", "开始上传分片");
logger.error("UploadFile", "文件读取失败");

// ❌ 错误
logger.info("", "开始上传");
logger.info("upload", "开始上传");
```

### 日志级别选择

```typescript
// DEBUG: 详细内部状态、调试信息
logger.debug("uploadChunkManager", "分片切割完成", { totalChunks: 10 });

// INFO: 关键业务流程节点
logger.info("UploadFile", "文件传输成功", fileName);

// WARN: 可恢复的异常、降级处理
logger.warn("uploadChunkManager", "IndexedDB 更新失败，使用备用方案");

// ERROR: 导致功能失败的严重错误
logger.error("Uploader", "网络请求失败", error);
```

### 错误对象传递

直接传递 Error 对象，logger 自动提取堆栈：

```typescript
// ✅ 推荐
try {
  await uploadChunk();
} catch (error) {
  logger.error("uploadChunkManager", "分片上传失败", error);
}

// ❌ 不推荐
logger.error("uploadChunkManager", `分片上传失败: ${error.message}`);
```

## 注意事项

1. **零开销优化**：`enabled: false` 时日志函数直接返回，无性能损耗
2. **级别过滤在格式化前**：低于设定级别的日志不进行字符串拼接
3. **环境变量优先级最高**：设置 `VITE_LOG_LEVEL` 会覆盖代码配置
4. **避免循环**：日志收集器中不要使用 `logger` 方法，防止递归
5. **异步收集器**：logger 会捕获收集器中的 Promise 异常，不影响正常日志输出
6. **调用位置追踪**：自动获取真实调用位置，点击可跳转到源码
