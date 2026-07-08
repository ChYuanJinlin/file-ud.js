# file-ud.js 插件系统

## 📖 概述

file-ud.js 提供了强大的插件系统，允许你通过非侵入式的方式扩展上传功能。所有插件都实现 `IUDPlugin` 接口，可以在不修改核心代码的情况下添加新功能。

---

## 🧱 插件架构

插件系统分为三层：

| 层级 | 所在包 | 职责 |
|------|--------|------|
| 核心传输层 | `@file-ud.js/core` | 管理上传器、下载器、文件队列、进度、事件、暂停、恢复、取消 |
| 插件协议层 | `IUDPlugin` / `PluginContext` | 定义插件生命周期、优先级、上下文和共享数据 |
| 插件实现层 | `@file-ud.js/plugins` | 提供上传插件、下载插件、通用插件和自定义插件基类 |

推荐按场景导入：

| 场景 | 导入路径 |
|------|----------|
| 上传插件 | `@file-ud.js/plugins/uploader` |
| 下载插件 | `@file-ud.js/plugins/downloader` |
| 通用重试插件 | `@file-ud.js/plugins/retry` |
| 自定义插件基类 | `@file-ud.js/plugins` |

---

## 🎯 设计理念

### 1. 非侵入式扩展
- ✅ **零核心代码修改**：所有功能通过插件实现
- ✅ **向后兼容**：不影响现有功能和 API
- ✅ **可选启用**：用户可以选择性使用插件

### 2. 插件化架构
- 实现 `IUDPlugin` 接口
- 利用事件钩子（`onFileSelect`, `beforeTransfer`, `onProgress` 等）
- 独立的配置和状态管理

### 3. 优先级机制
- 每个插件可以设置 `priority`（数字越小越先执行）
- 关键插件（如验证器）使用 priority: 0
- 普通插件使用 priority: 10-50

---

## 📦 内置插件

### 1. 文件验证插件 (FileValidatorPlugin)

**优先级**: 0（最高）  
**位置**: [`validator/README.md`](./validator/README.md)

**功能**:
- ✅ 文件大小验证（最小/最大）
- ✅ 文件类型验证
- ✅ 空文件检测
- ✅ 自定义验证函数
- ✅ 错误消息定制

**快速开始**:
```typescript
import { FileValidatorPlugin } from '@file-ud.js/plugins/uploader';

uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,    // 10MB
  accept: ['image/*'],
  allowEmpty: false
}));
```

---

### 2. 图片压缩插件 (CompressImagePlugin)

**优先级**: 10  
**位置**: [`compress/README.md`](./compress/README.md)

**功能**:
- ✅ 智能图片压缩
- ✅ 尺寸调整
- ✅ 格式转换（JPEG/PNG/WebP）
- ✅ 质量可控
- ✅ 实时反馈

**快速开始**:
```typescript
import { CompressImagePlugin } from '@file-ud.js/plugins/uploader';

uploader.use(new CompressImagePlugin({
  quality: 0.8,
  maxWidth: 1920,
  maxHeight: 1080,
  format: "webp"
}));
```

---

### 3. 水印插件 (WatermarkPlugin)

**优先级**: 20  
**位置**: [`watermark/README.md`](./watermark/README.md)

**功能**:
- ✅ 文字水印
- ✅ 图片水印
- ✅ 多位置选择（5个预设位置）
- ✅ 透明度控制
- ✅ 样式自定义

**快速开始**:
```typescript
import { WatermarkPlugin } from '@file-ud.js/plugins/uploader';

// 文字水印
uploader.use(new WatermarkPlugin({
  text: "© MyCompany",
  position: "bottom-right",
  opacity: 0.6
}));

// 图片水印
uploader.use(new WatermarkPlugin({
  imageUrl: "https://example.com/logo.png",
  position: "top-left",
  imageWidth: 100,
  imageHeight: 100
}));
```

---

### 4. 智能重试插件 (SmartRetryPlugin)

**优先级**: 10  
**位置**: [`retry/README.md`](./retry/README.md)

**功能**:
- ✅ 三种重试策略（固定延迟、指数退避、线性增长）
- ✅ 可配置重试次数
- ✅ 智能错误过滤
- ✅ 自动状态清理
- ✅ 完全非侵入式

**快速开始**:
```typescript
import { SmartRetryPlugin } from '@file-ud.js/plugins/retry';

uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: "exponential",
  initialDelay: 1000,
  maxDelay: 30000
}));
```

---

## 🔧 使用指南

### 1. 安装插件包

```bash
# npm
npm install @file-ud.js/plugins

# pnpm
pnpm add @file-ud.js/plugins

# yarn
yarn add @file-ud.js/plugins

# bun
bun add @file-ud.js/plugins
```

### 2. 导入和使用插件

推荐按能力导入，根入口保留用于兼容旧版本和自定义插件基类：

```typescript
// 上传相关插件
import { FileValidatorPlugin, CompressImagePlugin } from '@file-ud.js/plugins/uploader';

// 下载相关插件（当前先提供通用重试能力）
import { SmartRetryPlugin as DownloaderRetryPlugin } from '@file-ud.js/plugins/downloader';

// 上传/下载通用插件
import { SmartRetryPlugin } from '@file-ud.js/plugins/retry';

// 自定义插件基类
import { BasePlugin } from '@file-ud.js/plugins';
```

```typescript
import { 
  FileValidatorPlugin,
  CompressImagePlugin,
  WatermarkPlugin
} from '@file-ud.js/plugins/uploader';
import { SmartRetryPlugin } from '@file-ud.js/plugins/retry';

const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload',
});

// 使用单个插件
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024
}));

// 或使用多个插件
uploader.use([
  new FileValidatorPlugin({ maxSize: 10 * 1024 * 1024 }),
  new CompressImagePlugin({ quality: 0.8 }),
  new SmartRetryPlugin({ maxRetries: 3 })
]);
```

### 3. 插件执行顺序

插件按照 `priority` 从小到大依次执行：

```typescript
uploader.use([
  new FileValidatorPlugin(),    // priority: 0  (最先执行)
  new CompressImagePlugin(),     // priority: 10
  new SmartRetryPlugin(),        // priority: 10
  new WatermarkPlugin()          // priority: 20 (最后执行)
]);
```

**典型流程**:
```
文件选择
  ↓
FileValidatorPlugin (验证文件)
  ↓
CompressImagePlugin (压缩图片)
  ↓
WatermarkPlugin (添加水印)
  ↓
上传开始
  ↓
SmartRetryPlugin (失败时重试)
  ↓
上传完成
```

---

## 🎨 开发自定义插件

### 1. 插件接口

所有插件必须实现 `IUDPlugin` 接口：

```typescript
interface IUDPlugin {
  /** 插件名称 */
  name: string;
  
  /** 插件版本 */
  version?: string;
  
  /** 插件描述 */
  desc?: string;
  
  /** 插件优先级（数字越小越先执行） */
  priority?: number;
  
  /** 插件初始化（注册时调用一次） */
  install?: (uploader: Uploader, options?: any) => void | Promise<void>;
  
  /** 创建时钩子 */
  created?: (uploader: Uploader) => void | Promise<void>;
  
  /** 文件选择后触发 */
  onFileSelect?: (
    file: UploadFile,
    context: PluginContext,
  ) => Promise<UploadFile | void | false> | UploadFile | void;
  
  /** 上传前触发 */
  beforeTransfer?: (
    file: UploadFile,
    context: PluginContext,
  ) => Promise<boolean | void> | boolean | void;
  
  /** 上传进度触发 */
  onProgress?: (
    percent: number,
    file: UploadFile,
    context: PluginContext,
  ) => void;
  
  /** 上传成功触发 */
  onSuccess?: (
    response: any,
    file: UploadFile,
    context: PluginContext,
  ) => void;
  
  /** 上传失败触发 */
  onError?: (
    error: Error,
    file: UploadFile,
    context: PluginContext,
  ) => void;
  
  /** 插件销毁时调用 */
  destroy?: () => void;
}
```

### 2. 基础插件类

推荐使用 `BasePlugin` 作为基类：

```typescript
import { BasePlugin } from '@file-ud.js/plugins';
import { UploadFile, PluginContext } from '@file-ud.js/core/types';

export interface MyPluginOptions {
  // 配置选项
}

export class MyPlugin extends BasePlugin {
  name = "my-plugin";
  version = "1.0.0";
  desc = "我的自定义插件";
  priority = 50;
  
  private options: Required<MyPluginOptions>;
  
  constructor(options: MyPluginOptions = {}) {
    super();
    this.options = {
      // 默认配置
      ...options
    };
  }
  
  async onFileSelect(file: UploadFile, context: PluginContext) {
    // 实现你的逻辑
    console.log('文件已选择:', file.fileName);
    
    // 可以修改文件
    // file.proxy.File = newFile;
    
    return file;
  }
}
```

### 3. 完整示例：日志插件

```typescript
import { BasePlugin } from '@file-ud.js/plugins';
import { UploadFile, PluginContext } from '@file-ud.js/core/types';

export class LoggerPlugin extends BasePlugin {
  name = "logger-plugin";
  version = "1.0.0";
  desc = "上传日志插件";
  priority = 5;
  
  onFileSelect(file: UploadFile, context: PluginContext) {
    console.log(`📁 文件选择: ${file.fileName} (${file.formatSize})`);
    return file;
  }
  
  beforeTransfer(file: UploadFile, context: PluginContext) {
    console.log(`⬆️ 开始上传: ${file.fileName}`);
    return true;
  }
  
  onProgress(percent: number, file: UploadFile, context: PluginContext) {
    if (percent % 10 === 0) { // 每 10% 输出一次
      console.log(`📊 上传进度: ${file.fileName} - ${percent}%`);
    }
  }
  
  onSuccess(response: any, file: UploadFile, context: PluginContext) {
    console.log(`✅ 上传成功: ${file.fileName}`, response);
  }
  
  onError(error: Error, file: UploadFile, context: PluginContext) {
    console.error(`❌ 上传失败: ${file.fileName}`, error);
  }
}
```

**使用**:
```typescript
uploader.use(new LoggerPlugin());
```

### 4. 插件生命周期

```
1. install()         - 插件注册时调用（仅一次）
   ↓
2. created()         - Uploader 创建时调用
   ↓
3. onFileSelect()    - 用户选择文件时调用
   ↓
4. beforeTransfer()    - 上传开始前调用
   ↓
5. onProgress()      - 上传过程中持续调用
   ↓
6. onSuccess()       - 上传成功时调用
   或
   onError()         - 上传失败时调用
   ↓
7. destroy()         - 插件卸载时调用
```

---

## 💡 最佳实践

### 1. 合理设置优先级

```typescript
// 验证类插件：priority 0-5
class ValidatorPlugin extends BasePlugin {
  priority = 0;  // 最先执行
}

// 处理类插件：priority 10-20
class CompressPlugin extends BasePlugin {
  priority = 10;
}

// 辅助类插件：priority 30-50
class LoggerPlugin extends BasePlugin {
  priority = 50;  // 最后执行
}
```

### 2. 错误处理

```typescript
async onFileSelect(file: UploadFile, context: PluginContext) {
  try {
    // 你的逻辑
    const result = await doSomething(file);
    return result;
  } catch (error) {
    console.error('插件执行失败:', error);
    // 返回原文件，不阻断上传流程
    return file;
  }
}
```

### 3. 状态清理

```typescript
export class MyPlugin extends BasePlugin {
  private stateMap = new Map<string, any>();
  
  onSuccess(response: any, file: UploadFile, context: PluginContext) {
    // 清理文件相关的状态
    this.stateMap.delete(file.fileId);
  }
  
  destroy() {
    // 清理所有状态
    this.stateMap.clear();
  }
}
```

### 4. 配置验证

```typescript
constructor(options: MyPluginOptions = {}) {
  super();
  
  // 验证配置
  if (options.quality && (options.quality < 0 || options.quality > 1)) {
    throw new Error('quality 必须在 0-1 之间');
  }
  
  this.options = {
    ...this.defaultOptions,
    ...options
  };
}
```

---

## 🐛 常见问题

### Q1: 如何调试插件？

```typescript
class DebugPlugin extends BasePlugin {
  name = "debug-plugin";
  priority = 1;
  
  onFileSelect(file, context) {
    console.group('🔍 插件调试信息');
    console.log('文件名:', file.fileName);
    console.log('文件大小:', file.File.size);
    console.log('文件类型:', file.File.type);
    console.log('上下文:', context);
    console.groupEnd();
    
    return file;
  }
}
```

### Q2: 插件之间如何通信？

使用 `context.shared` Map：

```typescript
// 插件 A：存储数据
class PluginA extends BasePlugin {
  onFileSelect(file, context) {
    context.shared.set('pluginA_data', { timestamp: Date.now() });
    return file;
  }
}

// 插件 B：读取数据
class PluginB extends BasePlugin {
  onFileSelect(file, context) {
    const data = context.shared.get('pluginA_data');
    console.log('来自插件A的数据:', data);
    return file;
  }
}
```

### Q3: 如何阻止上传？

```typescript
// 方式1：在 onFileSelect 中返回 false
onFileSelect(file, context) {
  if (!isValid(file)) {
    return false;  // 阻止上传
  }
  return file;
}

// 方式2：在 beforeTransfer 中返回 false
beforeTransfer(file, context) {
  if (!shouldUpload(file)) {
    return false;  // 阻止上传
  }
  return true;
}
```

### Q4: 如何修改文件内容？

```typescript
onFileSelect(file, context) {
  // 替换文件对象
  const newFile = new File([blob], file.fileName, {
    type: 'image/jpeg'
  });
  
  // 使用 proxy 确保响应式更新
  file.proxy.File = newFile;
  file.proxy.formatSize = formatFileSize(newFile.size);
  
  return file;
}
```

---

## 📚 相关资源

- [文件验证插件文档](./validator/README.md)
- [图片压缩插件文档](./compress/README.md)
- [水印插件文档](./watermark/README.md)
- [智能重试插件文档](./retry/README.md)
- [file-ud.js 核心文档](../../../README.md)

---

## 🤝 贡献指南

欢迎提交新的插件！

**提交步骤**:
1. Fork 仓库
2. 创建新分支 (`feature/my-plugin`)
3. 实现插件（遵循 `IUDPlugin` 接口）
4. 编写详细文档（README.md）
5. 添加使用示例
6. 提交 Pull Request

**插件要求**:
- ✅ 实现完整的 TypeScript 类型定义
- ✅ 提供详细的 README 文档
- ✅ 包含使用示例
- ✅ 不修改核心代码
- ✅ 良好的错误处理

**报告 Bug**：[GitHub Issues](https://github.com/your-repo/file-ud/issues)

**提出建议**：[Feature Requests](https://github.com/your-repo/file-ud/discussions)
