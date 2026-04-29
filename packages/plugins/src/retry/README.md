# 智能重试插件 (SmartRetryPlugin)

## 📖 功能介绍

智能重试插件为 file-UD 上传库提供了**自动重试失败上传**的能力，支持多种重试策略，无需修改核心代码。

### ✨ 核心特性

- ✅ **多种重试策略**：固定延迟、指数退避、线性增长
- ✅ **可配置重试次数**：避免无限重试
- ✅ **智能错误过滤**：仅对可恢复的错误进行重试
- ✅ **自动清理**：上传成功或文件移除时自动清理状态
- ✅ **完全非侵入式**：通过插件系统实现，不改动核心代码

---

## 🚀 快速开始

### 1. 安装插件

```bash
npm install @file-ud.js/plugins
```

### 2. 基本使用

```typescript
import { FileUD } from '@file-ud.js/core';
import { SmartRetryPlugin } from '@file-ud.js/plugins';

const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload',
  // ... 其他配置
});

// 使用默认配置（指数退避，最多重试 3 次）
uploader.use(new SmartRetryPlugin());
```

### 3. 自定义配置

```typescript
// 使用指数退避策略，最多重试 5 次
uploader.use(new SmartRetryPlugin({
  maxRetries: 5,              // 最大重试次数
  strategy: "exponential",    // 重试策略
  initialDelay: 1000,         // 初始延迟 1 秒
  maxDelay: 30000,            // 最大延迟 30 秒
  showRetryNotification: true // 显示重试通知
}));
```

---

## ⚙️ 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRetries` | `number` | `3` | 最大重试次数 |
| `strategy` | `"fixed" \| "exponential" \| "linear"` | `"exponential"` | 重试策略 |
| `initialDelay` | `number` | `1000` | 初始延迟时间（毫秒） |
| `maxDelay` | `number` | `30000` | 最大延迟时间（毫秒） |
| `retryableErrors` | `string[]` | `[]` | 可重试的错误码列表（空数组表示对所有错误重试） |
| `showRetryNotification` | `boolean` | `true` | 是否显示重试通知 |

---

## 📊 重试策略详解

### 1. 固定延迟 (fixed)

每次重试的延迟时间相同。

```typescript
new SmartRetryPlugin({
  strategy: "fixed",
  initialDelay: 2000, // 每次重试都延迟 2 秒
});
```

**适用场景**：网络波动较小的稳定环境。

---

### 2. 指数退避 (exponential) ⭐推荐

延迟时间呈指数增长：`delay = initialDelay × 2^retryCount`

```typescript
new SmartRetryPlugin({
  strategy: "exponential",
  initialDelay: 1000,
  maxDelay: 30000,
});
```

**重试时间线**：
- 第 1 次重试：1s
- 第 2 次重试：2s
- 第 3 次重试：4s
- 第 4 次重试：8s
- 第 5 次重试：16s
- 第 6 次重试：30s（达到 maxDelay 上限）

**适用场景**：网络不稳定、服务器负载波动的情况（**最常用**）。

---

### 3. 线性增长 (linear)

延迟时间线性增长：`delay = initialDelay × (retryCount + 1)`

```typescript
new SmartRetryPlugin({
  strategy: "linear",
  initialDelay: 1000,
});
```

**重试时间线**：
- 第 1 次重试：1s
- 第 2 次重试：2s
- 第 3 次重试：3s
- 第 4 次重试：4s

**适用场景**：希望重试间隔平缓增长的场景。

---

## 🔍 高级用法

### 1. 仅对特定错误重试

```typescript
new SmartRetryPlugin({
  maxRetries: 3,
  retryableErrors: [
    "NETWORK_ERROR",      // 网络错误
    "TIMEOUT",            // 超时
    "SERVER_ERROR",       // 服务器错误（5xx）
    "RATE_LIMIT"          // 频率限制
  ]
});
```

### 2. 结合其他插件使用

```typescript
import { 
  SmartRetryPlugin, 
  FileValidatorPlugin, 
  CompressImagePlugin 
} from '@file-ud.js/plugins';

uploader.use([
  // 1. 文件校验（优先级最高）
  new FileValidatorPlugin({
    maxSize: 100 * 1024 * 1024, // 100MB
    accept: ['image/*', 'video/*']
  }),
  
  // 2. 图片压缩
  new CompressImagePlugin({
    quality: 0.8,
    maxWidth: 1920
  }),
  
  // 3. 智能重试（最后执行）
  new SmartRetryPlugin({
    maxRetries: 5,
    strategy: "exponential"
  })
]);
```

### 3. 监听重试事件

```typescript
// 监听错误事件，记录重试日志
uploader.on('error', (error) => {
  console.error('上传失败:', error);
});

// 监听文件状态变化
uploader.onUpdate((files) => {
  files.forEach(file => {
    if (file.isRetry) {
      console.log(`文件 ${file.fileName} 正在重试...`);
    }
  });
});
```

---

## 💡 最佳实践

### 1. 根据业务场景选择策略

| 场景 | 推荐策略 | 配置建议 |
|------|---------|---------|
| **大文件上传** | exponential | maxRetries: 5, initialDelay: 2000 |
| **小文件批量上传** | fixed | maxRetries: 3, initialDelay: 1000 |
| **弱网环境** | exponential | maxRetries: 8, initialDelay: 3000, maxDelay: 60000 |
| **实时性要求高** | linear | maxRetries: 2, initialDelay: 500 |

### 2. 避免过度重试

```typescript
// ❌ 不推荐：重试次数过多，浪费资源
new SmartRetryPlugin({
  maxRetries: 20, // 太多！
});

// ✅ 推荐：合理的重试次数
new SmartRetryPlugin({
  maxRetries: 3,  // 通常 3-5 次足够
});
```

### 3. 配合断点续传使用

```typescript
const uploader = FileUD.createUploader("chunkUploader", {
  action: '/api/upload-chunk',
  chunkOptions: {
    enableResume: true, // 启用断点续传
    retries: null,      // 分片级别不重试（由插件统一处理）
  }
});

// 使用智能重试插件
uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: "exponential"
}));
```

---

## 🐛 常见问题

### Q1: 为什么重试后还是失败？

**可能原因**：
1. 网络连接完全中断（需要检查网络状态）
2. 服务器返回不可恢复的错误（如 403 Forbidden）
3. 文件本身有问题（如损坏、格式错误）

**解决方案**：
```typescript
// 配置仅对可恢复错误重试
new SmartRetryPlugin({
  retryableErrors: ["NETWORK_ERROR", "TIMEOUT", "5xx"]
});
```

### Q2: 如何取消自动重试？

**方法1**：不使用插件
```typescript
// 不注册 SmartRetryPlugin 即可
```

**方法2**：手动取消
```typescript
// 在 onError 回调中返回 false 阻止默认行为
uploader.onError = (error, file) => {
  if (shouldCancelRetry(error)) {
    return false; // 阻止自动重试
  }
};
```

### Q3: 重试会影响性能吗？

**影响很小**：
- 插件仅在上传失败时触发，不影响正常上传流程
- 使用 setTimeout 异步延迟，不阻塞主线程
- 自动清理状态，无内存泄漏风险

---

## 📝 更新日志

### v1.0.0 (2024-01-XX)
- ✨ 首次发布
- ✅ 支持三种重试策略
- ✅ 可配置重试次数和延迟时间
- ✅ 智能错误过滤
- ✅ 自动状态清理

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

**报告 Bug**：[GitHub Issues](https://github.com/your-repo/file-ud/issues)

**提出建议**：[Feature Requests](https://github.com/your-repo/file-ud/discussions)
