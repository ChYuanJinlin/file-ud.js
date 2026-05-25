# 统一日志工具使用指南

## 📖 概述

本项目提供了统一的日志工具模块 `logger`，用于替代原生的 `console` 方法，提供环境感知、级别控制和格式化输出功能。

## 🚀 快速开始

### 1. 导入 logger

```typescript
import { logger } from '@core/utils';
// 或者
import { logger, LogLevel, initLogger } from '@core/utils/logger';
```

### 2. 基本用法

```typescript
// 调试日志（仅开发环境显示）
logger.debug('uploadChunkManager', '分片详情', { index: 0, size: 1024 });

// 信息日志
logger.info('UploadFile', '文件上传成功', fileName);

// 警告日志
logger.warn('uploadChunkManager', '更新分片状态失败:', error);

// 错误日志
logger.error('Uploader', '批量上传失败', error);
```

## 📊 日志级别

| 级别 | 方法 | 使用场景 | 生产环境默认 |
|------|------|---------|------------|
| DEBUG | `logger.debug()` | 详细的调试信息 | ❌ 禁用 |
| INFO | `logger.info()` | 关键业务流程节点 | ❌ 禁用 |
| WARN | `logger.warn()` | 可恢复的异常情况 | ✅ 启用 |
| ERROR | `logger.error()` | 导致功能失败的严重错误 | ✅ 启用 |

## ⚙️ 配置方式

### 1. 通过 uploaderConfigs 配置（推荐）

在创建 Uploader 实例时配置日志：

```typescript
import Uploader from '@repo/core';

const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  // 日志配置
  logConfig: {
    enabled: true,              // 是否启用日志（默认 true）
    level: 1,                   // 日志级别：0=DEBUG, 1=INFO, 2=WARN, 3=ERROR
    showTimestamp: true,        // 显示时间戳（默认 true）
    enableColors: true,         // 启用颜色输出（默认非生产环境启用）
  },
});
```

**日志级别说明**：
- `0` (DEBUG): 显示所有日志，包括详细的调试信息
- `1` (INFO): 显示 INFO、WARN、ERROR
- `2` (WARN): 仅显示 WARN 和 ERROR（生产环境默认）
- `3` (ERROR): 仅显示 ERROR

### 2. 环境变量配置

```bash
# 开发环境（默认 DEBUG 级别）
npm run dev

# 生产环境启用详细日志
VITE_LOG_LEVEL=debug npm run build

# 仅显示错误
VITE_LOG_LEVEL=error npm run build
```

### 3. 编程方式配置

```typescript
import { initLogger, LogLevel } from '@core/utils/logger';

// 自定义配置
initLogger({
  enabled: true,                // 是否启用日志
  level: LogLevel.DEBUG,        // 最低日志级别
  showTimestamp: true,          // 显示时间戳
  enableColors: true,           // 启用颜色输出
});
```

### 4. 动态调整级别

```typescript
import { setLogLevel, LogLevel } from '@core/utils/logger';

// 运行时调整
setLogLevel(LogLevel.DEBUG);  // 显示所有日志
setLogLevel(LogLevel.ERROR);  // 仅显示错误
```

## 🎯 最佳实践

### 1. 模块标识规范

第一个参数必须是**模块名称**（类名或功能模块名），便于日志过滤和追踪：

```typescript
// ✅ 正确
logger.info('uploadChunkManager', '开始上传分片');
logger.error('UploadFile', '文件读取失败');

// ❌ 错误
logger.info('', '开始上传');
logger.info('upload', '开始上传');
```

### 2. 日志级别选择

```typescript
// DEBUG: 详细的内部状态、调试信息
logger.debug('uploadChunkManager', '分片切割完成', { 
  totalChunks: 10, 
  chunkSize: 5 * 1024 * 1024 
});

// INFO: 关键业务流程节点
logger.info('UploadFile', '文件上传成功', fileName);
logger.info('uploadChunkManager', '所有分片合并完成');

// WARN: 可恢复的异常、降级处理
logger.warn('uploadChunkManager', 'IndexedDB 更新失败，使用备用方案');
logger.warn('UploadFile', '缺少 onMerge 回调，跳过合并步骤');

// ERROR: 导致功能失败的严重错误
logger.error('Uploader', '网络请求失败', error);
logger.error('uploadChunkManager', '分片上传超时', { chunkIndex, timeout });
```

### 3. 错误对象传递

直接传递 Error 对象，logger 会自动提取 stack trace：

```typescript
// ✅ 推荐
try {
  await uploadChunk();
} catch (error) {
  logger.error('uploadChunkManager', '分片上传失败', error);
}

// ❌ 不推荐
logger.error('uploadChunkManager', `分片上传失败: ${error.message}`);
```

### 4. 可变参数支持

支持任意数量的额外参数，会自动展开输出：

```typescript
logger.info('uploadChunkManager', '上传统计', {
  totalTime: 1234,
  fileSize: 1024000,
  averageSpeed: 829.27,
});

logger.debug('UploadFile', '文件信息', file.name, file.size, file.type);
```

## 🔧 迁移指南

### 从 console 迁移到 logger

``typescript
// ❌ 旧代码
console.log('开始上传');
console.warn('更新失败:', error);
console.error('上传失败', error);

// ✅ 新代码
logger.info('uploadChunkManager', '开始上传');
logger.warn('uploadChunkManager', '更新失败:', error);
logger.error('uploadChunkManager', '上传失败', error);
```

### 批量替换脚本（VSCode）

1. 打开搜索替换（Ctrl+Shift+H）
2. 启用正则表达式（.* 图标）
3. 搜索：`console\.(log|warn|error)\((.*?)\)`
4. 替换：`logger.$1('ModuleName', $2)`
5. 手动调整模块名称

## 📝 注意事项

1. **性能优化**：DEBUG/INFO 级别在生产环境会被完全跳过，无性能损耗
2. **类型安全**：所有方法都经过 TypeScript 类型约束
3. **浏览器兼容**：自动检测运行环境，在浏览器中也能正常工作
4. **颜色输出**：仅在非生产环境启用 ANSI 颜色代码
5. **时间戳格式**：ISO 8601 格式（`2024-01-15 10:30:45.123`）

## 🐛 常见问题

### Q: 为什么生产环境看不到 DEBUG 日志？

A: 这是预期行为。如需在生产环境查看，设置环境变量：
```bash
VITE_LOG_LEVEL=debug npm run build
```

### Q: 如何禁用所有日志？

A: 设置日志级别为最高：
```typescript
setLogLevel(LogLevel.ERROR + 1); // 或直接修改源码
```

### Q: 日志输出到哪里？

A: 
- DEBUG → `console.debug()`
- INFO → `console.info()`
- WARN → `console.warn()`
- ERROR → `console.error()`

### Q: 可以在 Node.js 环境中使用吗？

A: 可以，logger 会自动检测运行环境并适配。

## 📚 相关文档

- [代码日志规范](./CODE_LOGGING_SPEC.md)
- [uploadChunkManager 断点续传规范](./CHUNK_MANAGER_DB_SPEC.md)
- [IndexedDB 存储规范](./INDEXEDDB_SPEC.md)
