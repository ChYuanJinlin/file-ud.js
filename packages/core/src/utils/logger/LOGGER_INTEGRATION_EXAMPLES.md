# Logger 集成完整示例

## 📋 目录

1. [基础集成](#基础集成)
2. [Sentry 监控集成](#sentry-监控集成)
3. [后端日志服务集成](#后端日志服务集成)
4. [IndexedDB 离线存储](#indexeddb-离线存储)
5. [性能监控](#性能监控)
6. [Vue/React 组件集成](#vuereact-组件集成)

---

## 基础集成

### 1. 初始化配置

```typescript
// main.ts 或 app.ts
import Uploader from '@repo/core';

const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  
  // 日志配置
  logConfig: {
    enabled: true,
    level: import.meta.env.PROD ? 2 : 0, // 生产环境 WARN，开发环境 DEBUG
    showTimestamp: true,
    enableColors: !import.meta.env.PROD,
  },
});
```

---

### 2. 注册全局日志收集器

```typescript
// logger-setup.ts
import { addLogCollector, LogLevel, LogEntry } from '@core/utils';

/**
 * 初始化日志监控系统
 */
export function initLogMonitoring() {
  // 收集器 1: 控制台增强输出
  addLogCollector((entry) => {
    if (import.meta.env.DEV) {
      console.groupCollapsed(
        `%c[${LogLevel[entry.level]}] ${entry.module}`,
        getLevelStyle(entry.level)
      );
      console.log('Message:', entry.message);
      if (entry.args?.length) {
        console.log('Args:', ...entry.args);
      }
      console.groupEnd();
    }
  });
  
  // 收集器 2: 错误统计
  const errorStats = new Map<string, number>();
  addLogCollector((entry) => {
    if (entry.level === LogLevel.ERROR) {
      const key = `${entry.module}:${entry.message}`;
      errorStats.set(key, (errorStats.get(key) || 0) + 1);
      
      // 同一错误超过 10 次，发出警告
      if (errorStats.get(key)! > 10) {
        console.warn(`⚠️ 频繁错误: ${key} (${errorStats.get(key)} 次)`);
      }
    }
  });
}

function getLevelStyle(level: LogLevel): string {
  const colors = {
    [LogLevel.DEBUG]: 'color: #0ea5e9',
    [LogLevel.INFO]: 'color: #22c55e',
    [LogLevel.WARN]: 'color: #f59e0b',
    [LogLevel.ERROR]: 'color: #ef4444',
  };
  return colors[level];
}
```

**使用**：
```typescript
// main.ts
import { initLogMonitoring } from './logger-setup';

initLogMonitoring();
```

---

## Sentry 监控集成

### 1. 安装依赖

```bash
npm install @sentry/browser @sentry/tracing
```

### 2. 配置 Sentry

```typescript
// sentry-logger.ts
import * as Sentry from '@sentry/browser';
import { addLogCollector, LogLevel, LogEntry } from '@core/utils';

export function initSentryLogger(dsn: string) {
  // 初始化 Sentry
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
  });
  
  // 注册日志收集器
  addLogCollector((entry) => {
    // 仅上报 ERROR 级别
    if (entry.level !== LogLevel.ERROR) return;
    
    // 提取上下文
    const context: Record<string, any> = {
      module: entry.module,
      timestamp: new Date(entry.timestamp).toISOString(),
    };
    
    // 添加额外参数
    if (entry.args?.length) {
      context.args = entry.args.map(arg => 
        arg instanceof Error ? arg.message : String(arg)
      );
    }
    
    // 上报到 Sentry
    Sentry.captureException({
      name: `[${entry.module}] Error`,
      message: entry.message,
      stack: entry.stack,
    }, {
      extra: context,
      level: 'error',
      tags: {
        module: entry.module,
        logLevel: LogLevel[entry.level],
      },
    });
  });
  
  console.log('✅ Sentry 日志监控已启用');
}
```

**使用**：
```typescript
// main.ts
import { initSentryLogger } from './sentry-logger';

if (import.meta.env.PROD) {
  initSentryLogger(import.meta.env.VITE_SENTRY_DSN);
}
```

---

## 后端日志服务集成

### 1. 创建日志上报工具

```typescript
// api-logger.ts
import { addLogCollector, LogLevel, LogEntry } from '@core/utils';

interface LogReportPayload {
  level: string;
  module: string;
  message: string;
  stack?: string;
  timestamp: number;
  userAgent: string;
  url: string;
  userId?: string;
  sessionId: string;
}

class ApiLogger {
  private buffer: LogEntry[] = [];
  private readonly BATCH_SIZE = 20;
  private readonly FLUSH_INTERVAL = 10000; // 10秒
  private timer?: NodeJS.Timeout;
  private sessionId: string;
  
  constructor(private endpoint: string) {
    this.sessionId = this.generateSessionId();
    this.startAutoFlush();
  }
  
  /**
   * 启动自动刷新
   */
  private startAutoFlush() {
    this.timer = setInterval(() => this.flush(), this.FLUSH_INTERVAL);
  }
  
  /**
   * 停止自动刷新
   */
  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    // 刷新剩余日志
    this.flush();
  }
  
  /**
   * 批量上报日志
   */
  private async flush() {
    if (this.buffer.length === 0) return;
    
    const batch = [...this.buffer];
    this.buffer = [];
    
    try {
      const payload: LogReportPayload[] = batch.map(entry => ({
        level: LogLevel[entry.level],
        module: entry.module,
        message: entry.message,
        stack: entry.stack,
        timestamp: entry.timestamp,
        userAgent: navigator.userAgent,
        url: window.location.href,
        userId: this.getUserId(),
        sessionId: this.sessionId,
      }));
      
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      console.debug(`✅ 已上报 ${batch.length} 条日志`);
    } catch (error) {
      console.error('❌ 日志上报失败，重新加入队列', error);
      // 失败则重新加入队列（放在前面，优先上报）
      this.buffer.unshift(...batch);
    }
  }
  
  /**
   * 添加日志到缓冲区
   */
  public add(entry: LogEntry) {
    // 仅上报 WARN 和 ERROR
    if (entry.level < LogLevel.WARN) return;
    
    this.buffer.push(entry);
    
    // 达到批次大小，立即上报
    if (this.buffer.length >= this.BATCH_SIZE) {
      this.flush();
    }
  }
  
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private getUserId(): string | undefined {
    // 从 localStorage 或用户状态获取
    return localStorage.getItem('userId') || undefined;
  }
}

/**
 * 初始化 API 日志上报
 */
export function initApiLogger(endpoint: string) {
  const apiLogger = new ApiLogger(endpoint);
  
  addLogCollector((entry) => {
    apiLogger.add(entry);
  });
  
  // 页面卸载时停止上报
  window.addEventListener('beforeunload', () => {
    apiLogger.stop();
  });
  
  return apiLogger;
}
```

**使用**：
```typescript
// main.ts
import { initApiLogger } from './api-logger';

initApiLogger('/api/logs/upload');
```

---

## IndexedDB 离线存储

### 1. 创建日志存储服务

```typescript
// log-storage.ts
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { LogEntry, LogLevel } from '@core/utils';

interface LogDB extends DBSchema {
  logs: {
    key: number; // timestamp
    value: LogEntry;
    indexes: {
      byModule: string;
      byLevel: number;
      byTime: number;
    };
  };
}

const DB_NAME = 'upload-logs';
const DB_VERSION = 1;
const STORE_NAME = 'logs';

class LogStorage {
  private db: IDBPDatabase<LogDB> | null = null;
  
  /**
   * 初始化数据库
   */
  async init() {
    this.db = await openDB<LogDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' });
        store.createIndex('byModule', 'module');
        store.createIndex('byLevel', 'level');
        store.createIndex('byTime', 'timestamp');
      },
    });
  }
  
  /**
   * 保存日志
   */
  async save(entry: LogEntry) {
    if (!this.db) await this.init();
    await this.db!.add(STORE_NAME, entry);
  }
  
  /**
   * 查询最近 N 条日志
   */
  async getRecent(count: number = 100): Promise<LogEntry[]> {
    if (!this.db) await this.init();
    
    const allLogs = await this.db!.getAllFromIndex(
      STORE_NAME,
      'byTime'
    );
    
    return allLogs.slice(-count).reverse();
  }
  
  /**
   * 按模块查询
   */
  async getByModule(module: string): Promise<LogEntry[]> {
    if (!this.db) await this.init();
    return await this.db!.getAllFromIndex(
      STORE_NAME,
      'byModule',
      module
    );
  }
  
  /**
   * 按级别查询
   */
  async getByLevel(level: LogLevel): Promise<LogEntry[]> {
    if (!this.db) await this.init();
    return await this.db!.getAllFromIndex(
      STORE_NAME,
      'byLevel',
      level
    );
  }
  
  /**
   * 清理过期日志（保留最近 N 天）
   */
  async cleanup(days: number = 7) {
    if (!this.db) await this.init();
    
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const tx = this.db!.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    let cursor = await store.openCursor();
    let deleted = 0;
    
    while (cursor) {
      if (cursor.value.timestamp < cutoffTime) {
        await cursor.delete();
        deleted++;
      }
      cursor = await cursor.continue();
    }
    
    await tx.done;
    console.log(`🗑️ 已清理 ${deleted} 条过期日志`);
  }
  
  /**
   * 清空所有日志
   */
  async clear() {
    if (!this.db) await this.init();
    await this.db!.clear(STORE_NAME);
  }
}

// 单例
const logStorage = new LogStorage();

/**
 * 初始化离线日志存储
 */
export function initOfflineLogger() {
  logStorage.init();
  
  addLogCollector(async (entry) => {
    try {
      await logStorage.save(entry);
    } catch (error) {
      console.error('保存日志到 IndexedDB 失败:', error);
    }
  });
  
  // 每天清理一次过期日志
  setInterval(() => {
    logStorage.cleanup(7);
  }, 24 * 60 * 60 * 1000);
  
  return logStorage;
}

export { logStorage };
```

**使用**：
```typescript
// main.ts
import { initOfflineLogger, logStorage } from './log-storage';

initOfflineLogger();

// 在开发者工具中查看日志
window.viewLogs = async () => {
  const logs = await logStorage.getRecent(50);
  console.table(logs);
};
```

---

## 性能监控

### 1. 上传性能追踪

```typescript
// performance-monitor.ts
import { addLogCollector, LogLevel } from '@core/utils';

interface UploadMetrics {
  totalUploads: number;
  successfulUploads: number;
  failedUploads: number;
  averageDuration: number;
  durations: number[];
  errorsByModule: Map<string, number>;
}

class PerformanceMonitor {
  private metrics: UploadMetrics = {
    totalUploads: 0,
    successfulUploads: 0,
    failedUploads: 0,
    averageDuration: 0,
    durations: [],
    errorsByModule: new Map(),
  };
  
  private activeUploads = new Map<string, number>();
  
  constructor() {
    this.init();
  }
  
  private init() {
    addLogCollector((entry) => {
      // 追踪上传开始
      if (entry.module === 'UploadFile' && entry.message.includes('开始上传')) {
        const fileId = this.extractFileId(entry);
        if (fileId) {
          this.activeUploads.set(fileId, entry.timestamp);
          this.metrics.totalUploads++;
        }
      }
      
      // 追踪上传成功
      if (entry.module === 'UploadFile' && entry.message.includes('上传成功')) {
        const fileId = this.extractFileId(entry);
        if (fileId && this.activeUploads.has(fileId)) {
          const startTime = this.activeUploads.get(fileId)!;
          const duration = entry.timestamp - startTime;
          
          this.metrics.successfulUploads++;
          this.metrics.durations.push(duration);
          this.updateAverageDuration();
          this.activeUploads.delete(fileId);
          
          console.log(`📊 上传耗时: ${duration}ms`);
        }
      }
      
      // 追踪错误
      if (entry.level === LogLevel.ERROR) {
        const count = this.metrics.errorsByModule.get(entry.module) || 0;
        this.metrics.errorsByModule.set(entry.module, count + 1);
        
        if (entry.module === 'UploadFile') {
          this.metrics.failedUploads++;
        }
      }
    });
  }
  
  private extractFileId(entry: any): string | null {
    // 从 args 中提取 fileId
    return entry.args?.[0]?.fileId || null;
  }
  
  private updateAverageDuration() {
    if (this.metrics.durations.length === 0) return;
    
    const sum = this.metrics.durations.reduce((a, b) => a + b, 0);
    this.metrics.averageDuration = Math.round(sum / this.metrics.durations.length);
  }
  
  /**
   * 获取性能报告
   */
  public getReport() {
    const successRate = this.metrics.totalUploads > 0
      ? ((this.metrics.successfulUploads / this.metrics.totalUploads) * 100).toFixed(2)
      : '0.00';
    
    return {
      summary: {
        totalUploads: this.metrics.totalUploads,
        successfulUploads: this.metrics.successfulUploads,
        failedUploads: this.metrics.failedUploads,
        successRate: `${successRate}%`,
        averageDuration: `${this.metrics.averageDuration}ms`,
      },
      errorsByModule: Object.fromEntries(this.metrics.errorsByModule),
    };
  }
  
  /**
   * 重置统计数据
   */
  public reset() {
    this.metrics = {
      totalUploads: 0,
      successfulUploads: 0,
      failedUploads: 0,
      averageDuration: 0,
      durations: [],
      errorsByModule: new Map(),
    };
    this.activeUploads.clear();
  }
}

// 单例
export const performanceMonitor = new PerformanceMonitor();
```

**使用**：
```typescript
// 在任何地方查看性能报告
import { performanceMonitor } from './performance-monitor';

console.log(performanceMonitor.getReport());

// 或在浏览器控制台
window.getUploadStats = () => performanceMonitor.getReport();
```

---

## Vue/React 组件集成

### Vue 3 示例

```vue
<!-- LogViewer.vue -->
<template>
  <div class="log-viewer">
    <h3>实时日志</h3>
    <div class="controls">
      <button @click="clearLogs">清空</button>
      <button @click="exportLogs">导出</button>
      <select v-model="filterLevel">
        <option value="-1">全部</option>
        <option value="0">DEBUG</option>
        <option value="1">INFO</option>
        <option value="2">WARN</option>
        <option value="3">ERROR</option>
      </select>
    </div>
    
    <div class="log-list">
      <div
        v-for="log in filteredLogs"
        :key="log.timestamp"
        :class="['log-item', `level-${log.level}`]"
      >
        <span class="time">{{ formatTime(log.timestamp) }}</span>
        <span class="level">{{ LogLevel[log.level] }}</span>
        <span class="module">[{{ log.module }}]</span>
        <span class="message">{{ log.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { addLogCollector, LogLevel, LogEntry } from '@core/utils';

const logs = ref<LogEntry[]>([]);
const filterLevel = ref(-1);
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  // 注册收集器
  unsubscribe = addLogCollector((entry) => {
    logs.value.push(entry);
    
    // 保持最近 200 条
    if (logs.value.length > 200) {
      logs.value.shift();
    }
  });
});

onUnmounted(() => {
  // 取消注册
  if (unsubscribe) {
    unsubscribe();
  }
});

const filteredLogs = computed(() => {
  if (filterLevel.value === -1) return logs.value;
  return logs.value.filter(log => log.level === filterLevel.value);
});

function clearLogs() {
  logs.value = [];
}

function exportLogs() {
  const blob = new Blob([JSON.stringify(logs.value, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `logs-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString();
}
</script>

<style scoped>
.log-viewer {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid #ddd;
  padding: 10px;
}

.log-item {
  padding: 4px 8px;
  margin: 2px 0;
  font-family: monospace;
  font-size: 12px;
}

.level-0 { color: #0ea5e9; } /* DEBUG */
.level-1 { color: #22c55e; } /* INFO */
.level-2 { color: #f59e0b; } /* WARN */
.level-3 { color: #ef4444; } /* ERROR */
</style>
```

---

### React 示例

```tsx
// LogViewer.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { addLogCollector, LogLevel, LogEntry } from '@core/utils';

export const LogViewer: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<number>(-1);
  
  useEffect(() => {
    // 注册收集器
    const unsubscribe = addLogCollector((entry) => {
      setLogs(prev => {
        const updated = [...prev, entry];
        // 保持最近 200 条
        return updated.length > 200 ? updated.slice(-200) : updated;
      });
    });
    
    // 清理
    return () => unsubscribe();
  }, []);
  
  const filteredLogs = useCallback(() => {
    if (filterLevel === -1) return logs;
    return logs.filter(log => log.level === filterLevel);
  }, [logs, filterLevel]);
  
  const clearLogs = () => setLogs([]);
  
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  return (
    <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px' }}>
      <h3>实时日志</h3>
      
      <div style={{ marginBottom: '10px' }}>
        <button onClick={clearLogs}>清空</button>
        <button onClick={exportLogs}>导出</button>
        <select 
          value={filterLevel} 
          onChange={(e) => setFilterLevel(Number(e.target.value))}
        >
          <option value={-1}>全部</option>
          <option value={0}>DEBUG</option>
          <option value={1}>INFO</option>
          <option value={2}>WARN</option>
          <option value={3}>ERROR</option>
        </select>
      </div>
      
      <div>
        {filteredLogs().map((log, index) => (
          <div
            key={log.timestamp + index}
            style={{
              padding: '4px 8px',
              margin: '2px 0',
              fontFamily: 'monospace',
              fontSize: '12px',
              color: getLevelColor(log.level),
            }}
          >
            <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span> [{LogLevel[log.level]}]</span>
            <span> [{log.module}]</span>
            <span> {log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

function getLevelColor(level: LogLevel): string {
  const colors = {
    [LogLevel.DEBUG]: '#0ea5e9',
    [LogLevel.INFO]: '#22c55e',
    [LogLevel.WARN]: '#f59e0b',
    [LogLevel.ERROR]: '#ef4444',
  };
  return colors[level];
}
```

---

## 🎯 最佳实践总结

1. **分层收集**：ERROR → Sentry，WARN → 后端 API，ALL → IndexedDB
2. **批量上报**：减少网络请求，提高性能
3. **定期清理**：避免存储空间无限增长
4. **条件过滤**：仅收集需要的日志，减少噪音
5. **及时清理**：组件卸载时取消注册
6. **异步处理**：避免阻塞主线程
7. **错误隔离**：收集器异常不影响正常日志输出
