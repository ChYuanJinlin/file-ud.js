# 日志配置完整示例

## 📋 配置优先级

```
环境变量 > uploaderConfigs.logConfig > initLogger() > 默认配置
```

## 🎯 常见场景配置

### 1. 开发环境（显示所有日志）

```typescript
const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    enabled: true,
    level: 0,  // DEBUG
    showTimestamp: true,
    enableColors: true,
  },
});
```

**输出示例**：
```
[2024-01-15 10:30:45.123] [DEBUG] [uploadChunkManager] 分片切割完成 { totalChunks: 10, chunkSize: 5242880 }
[2024-01-15 10:30:45.456] [INFO] [UploadFile] 文件上传开始 test.pdf
[2024-01-15 10:30:46.789] [WARN] [uploadChunkManager] IndexedDB 更新失败，使用备用方案
[2024-01-15 10:30:47.012] [ERROR] [Uploader] 网络请求失败 Error: timeout
```

---

### 2. 生产环境（仅警告和错误）

```typescript
const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    enabled: true,
    level: 2,  // WARN
    showTimestamp: true,
    enableColors: false,  // 生产环境禁用颜色
  },
});
```

**输出示例**：
```
[2024-01-15 10:30:46.789] [WARN] [uploadChunkManager] IndexedDB 更新失败，使用备用方案
[2024-01-15 10:30:47.012] [ERROR] [Uploader] 网络请求失败 Error: timeout
```

---

### 3. 完全禁用日志

```typescript
const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    enabled: false,  // 禁用所有日志输出
  },
});
```

**适用场景**：
- 性能敏感的生产环境
- 已有外部监控系统（如 Sentry）
- 减少控制台噪音

---

### 4. 仅记录错误（用于监控）

```typescript
const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    enabled: true,
    level: 3,  // ERROR
    showTimestamp: true,
    enableColors: false,
  },
});

// 配合错误上报
uploader.on('error', (error) => {
  // 上报到监控平台
  reportError(error);
});
```

---

### 5. 动态切换日志级别

```typescript
import { setLogLevel, LogLevel } from '@core/utils';

// 初始配置为 WARN
const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    level: 2,  // WARN
  },
});

// 用户点击"调试模式"按钮时
document.getElementById('debug-mode').addEventListener('click', () => {
  setLogLevel(LogLevel.DEBUG);  // 切换到 DEBUG
  console.log('已启用调试模式');
});
```

---

## 🔧 高级配置

### 1. 结合环境变量

```bash
# .env.development
VITE_LOG_LEVEL=debug

# .env.production
VITE_LOG_LEVEL=error
```

```typescript
// 代码中仍然可以覆盖
const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    enabled: import.meta.env.VITE_ENABLE_LOGS === 'true',
    level: import.meta.env.VITE_LOG_LEVEL === 'debug' ? 0 : 3,
  },
});
```

---

### 2. 根据用户角色配置

```typescript
const isAdmin = checkUserAdmin();

const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    enabled: true,
    level: isAdmin ? 0 : 3,  // 管理员看 DEBUG，普通用户只看 ERROR
    enableColors: isAdmin,   // 仅管理员启用颜色
  },
});
```

---

### 3. 性能测试场景

```typescript
// 禁用日志以减少性能影响
const uploader = new Uploader({
  action: '/api/upload',
  file: 'file',
  logConfig: {
    enabled: false,
  },
});

// 执行性能测试
performance.mark('upload-start');
await uploader.submit();
performance.mark('upload-end');
performance.measure('upload-duration', 'upload-start', 'upload-end');
```

---

## 📊 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | `boolean` | `true` | 是否启用日志输出 |
| `level` | `0 \| 1 \| 2 \| 3` | 自动（开发=0，生产=2） | 最低日志级别 |
| `showTimestamp` | `boolean` | `true` | 是否显示时间戳 |
| `enableColors` | `boolean` | 自动（非生产=true） | 是否启用 ANSI 颜色 |

---

## ⚠️ 注意事项

1. **enabled=false 时零开销**：当 `enabled: false` 时，日志函数直接返回，无任何性能损耗
2. **级别过滤在格式化前**：低于设定级别的日志不会进行字符串拼接，避免不必要的开销
3. **环境变量优先级最高**：设置 `VITE_LOG_LEVEL` 会覆盖代码中的配置
4. **颜色仅在终端生效**：浏览器控制台中颜色可能不显示，不影响功能
5. **时间戳格式固定**：ISO 8601 格式（`YYYY-MM-DD HH:mm:ss.SSS`），不可自定义

---

## 🐛 故障排查

### Q: 配置了 logConfig 但没有生效？

A: 检查以下几点：
1. 确认 `logConfig` 对象结构正确
2. 检查是否有环境变量覆盖了配置
3. 确认 Uploader 是首次创建（单例模式下后续配置无效）

### Q: 如何验证当前日志级别？

A: 查看初始化时的输出：
```
[Logger] Initialized with level: DEBUG
```

或者手动测试：
```typescript
logger.debug('Test', 'This should appear if level is DEBUG');
logger.info('Test', 'This should appear if level <= INFO');
```

### Q: 生产环境为什么看不到 DEBUG 日志？

A: 这是预期行为。如需查看，设置：
```typescript
logConfig: {
  level: 0,  // DEBUG
}
```
或环境变量：
```bash
VITE_LOG_LEVEL=debug
```
