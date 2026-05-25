# 日志收集器使用指南

## 📖 概述

日志收集器允许你拦截所有日志输出，并将其发送到监控系统、保存到本地存储或执行其他自定义操作。

## 🚀 快速开始

### 1. 基本用法

```typescript
import { addLogCollector, LogLevel, LogEntry } from '@core/utils';

// 注册日志收集器
const unsubscribe = addLogCollector((entry: LogEntry) => {
  console.log('捕获到日志:', entry);
});

// 使用一段时间后取消注册
unsubscribe();
```

### 2. LogEntry 结构

```typescript
interface LogEntry {
  timestamp: number;      // 时间戳 (Date.now())
  level: LogLevel;        // 日志级别 (0-3)
  module: string;         // 模块名称 (如 'uploadChunkManager')
  message: string;        // 消息内容
  args?: any[];           // 额外参数
  stack?: string;         // 错误堆栈（如果是 Error 对象）
}
```

---

## 🎯 常见场景

### 1. 上报错误到 Sentry

```typescript
import * as Sentry from '@sentry/browser';
import { addLogCollector, LogLevel } from '@core/utils';

addLogCollector((entry) => {
  // 仅上报 ERROR 级别
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

---

### 2. 保存到 IndexedDB（离线分析）

```typescript
import { addLogCollector } from '@core/utils';
import { saveLogEntry } from './logStorage'; // 自定义存储方法

addLogCollector(async (entry) => {
  try {
    await saveLogEntry(entry);
  } catch (error) {
    console.error('保存日志失败:', error);
  }
});
```

**logStorage.ts 示例**：
```typescript
import { openDB } from 'idb';
import { LogEntry } from '@core/utils';

const DB_NAME = 'upload-logs';
const STORE_NAME = 'logs';

export async function saveLogEntry(entry: LogEntry): Promise<void> {
  const db = await openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' });
    },
  });
  
  await db.add(STORE_NAME, entry);
}

export async function getRecentLogs(count: number = 100): Promise<LogEntry[]> {
  const db = await openDB(DB_NAME, 1);
  const allLogs = await db.getAll(STORE_NAME);
  return allLogs.slice(-count).reverse();
}
```

---

### 3. 发送到后端 API

```typescript
import { addLogCollector, LogLevel } from '@core/utils';

const LOG_ENDPOINT = '/api/logs';

addLogCollector(async (entry) => {
  // 仅上报 WARN 和 ERROR
  if (entry.level < LogLevel.WARN) return;
  
  try {
    await fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: LogLevel[entry.level],
        module: entry.module,
        message: entry.message,
        stack: entry.stack,
        timestamp: entry.timestamp,
        userAgent: navigator.userAgent,
        url: window.location.href,
      }),
    });
  } catch (error) {
    // 避免日志上报失败导致无限循环
    console.error('日志上报失败:', error);
  }
});
```

---

### 4. 性能监控（统计上传耗时）

```typescript
import { addLogCollector } from '@core/utils';

const uploadMetrics: {
  startTime?: number;
  endTime?: number;
  errors: number;
} = {
  errors: 0,
};

addLogCollector((entry) => {
  // 记录上传开始
  if (entry.module === 'UploadFile' && entry.message.includes('开始上传')) {
    uploadMetrics.startTime = entry.timestamp;
  }
  
  // 记录上传结束
  if (entry.module === 'UploadFile' && entry.message.includes('上传成功')) {
    uploadMetrics.endTime = entry.timestamp;
    
    if (uploadMetrics.startTime) {
      const duration = uploadMetrics.endTime - uploadMetrics.startTime;
      console.log(`上传耗时: ${duration}ms`);
      
      // 上报到性能监控平台
      reportPerformance('upload_duration', duration);
    }
  }
  
  // 统计错误数
  if (entry.level === 3) { // ERROR
    uploadMetrics.errors++;
  }
});
```

---

### 5. 调试模式（实时查看特定模块日志）

```typescript
import { addLogCollector, LogLevel } from '@core/utils';

// 仅在开发环境启用
if (process.env.NODE_ENV === 'development') {
  addLogCollector((entry) => {
    // 仅关注 uploadChunkManager 模块
    if (entry.module === 'uploadChunkManager') {
      console.group(`🔍 [${LogLevel[entry.level]}] ${entry.module}`);
      console.log('Message:', entry.message);
      if (entry.args?.length) {
        console.log('Args:', ...entry.args);
      }
      if (entry.stack) {
        console.trace('Stack:', entry.stack);
      }
      console.groupEnd();
    }
  });
}
```

---

### 6. 用户行为追踪

```typescript
import { addLogCollector } from '@core/utils';

const userActions: Array<{
  action: string;
  timestamp: number;
  details?: any;
}> = [];

addLogCollector((entry) => {
  // 记录用户触发的关键操作
  if (entry.message.includes('暂停') || entry.message.includes('恢复')) {
    userActions.push({
      action: entry.message,
      timestamp: entry.timestamp,
      details: {
        file: entry.args?.[0],
        module: entry.module,
      },
    });
    
    // 保持最近 50 条记录
    if (userActions.length > 50) {
      userActions.shift();
    }
  }
});

// 发生错误时，附带用户行为历史
window.addEventListener('error', (event) => {
  console.error('Error occurred with user actions:', {
    error: event.error,
    recentActions: userActions.slice(-10),
  });
});
```

---

## 🔧 高级用法

### 1. 多个收集器

```typescript
import { addLogCollector, LogLevel } from '@core/utils';

// 收集器 1: 上报错误到 Sentry
addLogCollector((entry) => {
  if (entry.level === LogLevel.ERROR) {
    Sentry.captureException(entry);
  }
});

// 收集器 2: 保存到本地存储
addLogCollector((entry) => {
  localStorage.setItem('last-log', JSON.stringify(entry));
});

// 收集器 3: 发送到后端
addLogCollector(async (entry) => {
  if (entry.level >= LogLevel.WARN) {
    await sendToBackend(entry);
  }
});
```

---

### 2. 条件过滤

```typescript
import { addLogCollector, LogLevel } from '@core/utils';

addLogCollector((entry) => {
  // 仅收集特定模块的日志
  const targetModules = ['uploadChunkManager', 'UploadFile'];
  if (!targetModules.includes(entry.module)) return;
  
  // 仅收集 WARN 和 ERROR
  if (entry.level < LogLevel.WARN) return;
  
  // 排除某些消息
  if (entry.message.includes('已清除上传进度缓存')) return;
  
  // 处理日志
  processLog(entry);
});
```

---

### 3. 批量上报（减少网络请求）

```typescript
import { addLogCollector, LogLevel } from '@core/utils';

const logBuffer: LogEntry[] = [];
const BATCH_SIZE = 10;
const FLUSH_INTERVAL = 5000; // 5秒

addLogCollector((entry) => {
  if (entry.level >= LogLevel.WARN) {
    logBuffer.push(entry);
    
    // 达到批次大小，立即上报
    if (logBuffer.length >= BATCH_SIZE) {
      flushLogs();
    }
  }
});

// 定时刷新
setInterval(flushLogs, FLUSH_INTERVAL);

async function flushLogs() {
  if (logBuffer.length === 0) return;
  
  const batch = [...logBuffer];
  logBuffer.length = 0;
  
  try {
    await fetch('/api/logs/batch', {
      method: 'POST',
      body: JSON.stringify(batch),
    });
  } catch (error) {
    // 失败则重新加入队列
    logBuffer.unshift(...batch);
  }
}
```

---

### 4. 动态启用/禁用

```typescript
import { addLogCollector, clearLogCollectors } from '@core/utils';

let isMonitoring = false;
let unsubscribe: (() => void) | null = null;

function startMonitoring() {
  if (isMonitoring) return;
  
  unsubscribe = addLogCollector((entry) => {
    // 处理日志
    handleLog(entry);
  });
  
  isMonitoring = true;
  console.log('日志监控已启动');
}

function stopMonitoring() {
  if (!isMonitoring || !unsubscribe) return;
  
  unsubscribe();
  clearLogCollectors(); // 清除所有收集器
  
  isMonitoring = false;
  console.log('日志监控已停止');
}

// 用户点击按钮切换
document.getElementById('toggle-monitoring').addEventListener('click', () => {
  if (isMonitoring) {
    stopMonitoring();
  } else {
    startMonitoring();
  }
});
```

---

## ⚠️ 注意事项

### 1. 避免无限循环

```typescript
// ❌ 错误示例：在收集器中使用 console.error，可能导致递归
addLogCollector((entry) => {
  console.error('Log:', entry); // 可能触发新的日志
});

// ✅ 正确示例：仅在外部使用
addLogCollector((entry) => {
  // 发送到外部系统，不产生新日志
  sendToExternalSystem(entry);
});
```

---

### 2. 异步错误处理

```typescript
// ✅ 推荐：捕获异步错误
addLogCollector(async (entry) => {
  try {
    await sendToServer(entry);
  } catch (error) {
    // 不要在这里调用 logger，避免循环
    // 可以使用原生 console 或忽略
    console.warn('Failed to send log:', error);
  }
});
```

---

### 3. 性能考虑

```typescript
// ❌ 避免：同步阻塞操作
addLogCollector((entry) => {
  const result = heavyComputation(entry); // 阻塞主线程
});

// ✅ 推荐：异步处理
addLogCollector((entry) => {
  requestIdleCallback(() => {
    processLog(entry); // 在空闲时处理
  });
});
```

---

### 4. 内存管理

```typescript
// ✅ 及时取消注册
const unsubscribe = addLogCollector(handler);

// 组件卸载时
onUnmounted(() => {
  unsubscribe();
});
```

---

## 📊 完整示例：生产环境监控方案

```typescript
import { addLogCollector, LogLevel, LogEntry } from '@core/utils';
import * as Sentry from '@sentry/browser';

class LogMonitor {
  private buffer: LogEntry[] = [];
  private readonly MAX_BUFFER = 50;
  
  constructor() {
    this.init();
  }
  
  private init() {
    // 1. 实时上报错误到 Sentry
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
    
    // 2. 批量上报 WARN 到后端
    addLogCollector((entry) => {
      if (entry.level === LogLevel.WARN) {
        this.buffer.push(entry);
        
        if (this.buffer.length >= 10) {
          this.flushBuffer();
        }
      }
    });
    
    // 3. 定期清理旧日志
    setInterval(() => this.cleanup(), 60000); // 每分钟
  }
  
  private async flushBuffer() {
    if (this.buffer.length === 0) return;
    
    const batch = [...this.buffer];
    this.buffer = [];
    
    try {
      await fetch('/api/logs/warnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
    } catch (error) {
      // 失败则保留在缓冲区
      this.buffer.unshift(...batch);
    }
  }
  
  private cleanup() {
    // 保留最近 1 小时的日志
    const oneHourAgo = Date.now() - 3600000;
    this.buffer = this.buffer.filter(
      (entry) => entry.timestamp > oneHourAgo
    );
  }
}

// 初始化监控
new LogMonitor();
```

---

## 🐛 故障排查

### Q: 收集器没有被触发？

A: 检查以下几点：
1. 确认 `logConfig.enabled !== false`
2. 确认日志级别满足要求（`entry.level >= config.level`）
3. 确认没有调用 `clearLogCollectors()`

### Q: 如何查看所有注册的收集器？

A: 当前版本未暴露此 API，建议在开发环境中添加：
```typescript
// 临时调试代码
console.log('Active collectors:', logCollectors.length);
```

### Q: 收集器中抛出异常会影响日志输出吗？

A: 不会。logger 内部已捕获收集器的异常，不会影响正常的日志输出。
