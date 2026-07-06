# SmartRetryPlugin — 智能重试

**优先级**：10

上传失败时自动重试，支持三种重试策略，智能错误过滤。

## 基础用法

```ts
import { SmartRetryPlugin } from "@file-ud.js/plugins/retry";

uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: "exponential",
  initialDelay: 1000,
  maxDelay: 30000,
}));
```

## 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRetries` | `number` | `3` | 最大重试次数 |
| `strategy` | `string` | `"fixed"` | 重试策略：`fixed` / `exponential` / `linear` |
| `initialDelay` | `number` | `1000` | 初始延迟（ms） |
| `maxDelay` | `number` | `30000` | 最大延迟（ms） |

## 重试策略

### Fixed — 固定延迟

每次重试间隔相同：

```ts
uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: "fixed",
  initialDelay: 2000,   // 每次等待 2s
}));
// 重试间隔：2s → 2s → 2s
```

### Exponential — 指数退避

延迟时间指数增长，减轻服务器压力：

```ts
uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: "exponential",
  initialDelay: 1000,
  maxDelay: 30000,      // 最大不超过 30s
}));
// 重试间隔：1s → 2s → 4s → 8s ...
```

### Linear — 线性增长

延迟时间线性递增：

```ts
uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: "linear",
  initialDelay: 1000,
}));
// 重试间隔：1s → 2s → 3s
```

## 使用场景

### 不稳定网络环境

```ts
uploader.use(new SmartRetryPlugin({
  maxRetries: 5,
  strategy: "exponential",
  initialDelay: 2000,
  maxDelay: 60000,
}));
```

### 快速失败场景

```ts
uploader.use(new SmartRetryPlugin({
  maxRetries: 1,
  strategy: "fixed",
  initialDelay: 500,
}));
```

### 策略对比

| 策略 | 适用场景 | 特点 |
|------|----------|------|
| `fixed` | 偶发失败，快速恢复 | 简单直接 |
| `exponential` | 服务器过载、网络波动 | 逐步降低请求频率 |
| `linear` | 需要平衡恢复速度 | 介于两者之间 |
