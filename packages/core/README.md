# @file-ud.js/core

强大的文件传输库，支持分片上传、断点续传、秒传等功能。

## ✨ 核心特性

- 🚀 **分片上传**：大文件自动分片，支持并发上传
- 🔄 **断点续传**：网络中断后可继续上传，无需重新开始
- ⚡ **秒传功能**：相同文件自动检测，跳过重复上传
- 📊 **实时进度**：精确的上传进度、速度、剩余时间
- 🎯 **智能重试**：可配置的重试策略（通过插件）
- 🔌 **插件系统**：丰富的插件生态，轻松扩展功能
- 📱 **响应式更新**：基于 Vue 3 响应式系统，UI 自动更新
- 🛡️ **类型安全**：完整的 TypeScript 类型定义

---

## 🚀 快速开始

### 1. 安装

```bash
# npm
npm install @file-ud.js/core

# pnpm
pnpm add @file-ud.js/core

# yarn
yarn add @file-ud.js/core

# bun
bun add @file-ud.js/core
```

### 实例模式说明

`@file-ud.js/core` 有两种创建方式：

- `new Uploader(config)` / `new Downloader(config)` 是**单例模式**。第一次创建后，后续再次 `new` 会复用同一个实例，不会创建新的隔离上传器/下载器。
- `FileUD.createUploader(name, config)` / `FileUD.createDownloader(name, config)` 是**命名多实例模式**。每个 `name` 对应一个独立实例；同名重复创建时，会先销毁旧实例再创建新实例。

业务里如果有多个上传入口，比如头像、Logo、附件、视频，推荐使用 `FileUD.createUploader(name, config)` 来隔离状态；只有全局单一上传/下载入口时，才建议直接 `new Uploader()` / `new Downloader()`。

### 2. 基本使用

```typescript
import { FileUD } from '@file-ud.js/core';

// 创建上传器
const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload',
  multiple: true,
  autoUpload: true
});

// 监听上传成功
uploader.onSuccess = (response, file) => {
  console.log('上传成功:', response);
};

// 打开文件选择器
uploader.open();
```

### 单文件覆盖上传

头像、Logo、封面等场景保持 `multiple: false` 即可，每次选择新文件都会替换当前文件：

```typescript
const logoUploader = FileUD.createUploader("tagLogoUploader", {
  action: '/api/upload-logo',
  multiple: false,
  accept: ['image/*']
});

logoUploader.open();
```

### 3. 分片上传

```typescript
const uploader = FileUD.createUploader("chunkUploader", {
  action: '/api/upload-chunk',
  chunkOptions: {
    chunkSize: 2 * 1024 * 1024,  // 2MB 分片
    maxConcurrent: 3,             // 最多3个并发
    retries: 3                    // 失败重试3次
  }
});

// 初始化分片上传回调
uploader.onInitChunk = async (uploadFile) => {
  const { data } = await checkFile({
    fileHash: uploadFile.chunkManager?.fileHash
  });
  
  return {
    chunks: data.chunks || [],
    fileHash: data.fileHash
  };
};

// 合并分片回调
uploader.onMergeChunk = async (chunkManager) => {
  const { data } = await mergeChunks({
    fileHash: chunkManager.fileHash,
    fileName: chunkManager.uploadFile.fileName,
    totalChunks: chunkManager.totalChunks
  });
  
  return data;
};
```

---

## 📚 详细文档

- **[Uploader 上传器文档](./README_UPLOADER.md)** — 完整上传 API、配置、事件、分片上传、插件系统
- **[Downloader 下载器文档](./README_DOWNLOADER.md)** — 完整下载 API、配置、事件、分片下载、File System Access
- **[高级指南与排障文档](https://github.com/ChYuanJinlin/file-ud.js/tree/main/packages/docs/advanced)** — setFiles/addFile、分片回显、IndexedDB 缓存、取消与重试等内部流程说明

---

## 📖 API 文档

### 配置选项

```typescript
interface UploaderConfig {
  /** 是否支持多选。false 为单文件覆盖模式，true 为多文件追加列表 */
  multiple?: boolean;
  
  /** 接受的文件类型 */
  accept?: string[];
  
  /** 是否自动上传 */
  autoUpload?: boolean;
  
  /** 上传地址 */
  action: string | ((formData: FormData, uploadFile: UploadFile) => Promise<any>);
  
  /** 文件大小限制（字节） */
  maxSize?: number;
  
  /** 文件数量限制，仅 multiple: true 时生效 */
  limit?: number;
  
  /** 分片上传配置 */
  chunkOptions?: ChunkOptions | null;
}
```

### 回调函数

```typescript
// 上传成功
uploader.onSuccess = (response, file) => {
  console.log('URL:', response.url);
};

// 上传进度
uploader.onUpdate = (files) => {
  files.forEach(file => {
    console.log(`${file.fileName}: ${file.percent}%`);
  });
};

// 错误处理
uploader.onError = (error) => {
  console.error('上传失败:', error.message);
};
```

### 文件操作

```typescript
// 暂停上传
file.pause();

// 恢复上传
file.resume();

// 取消上传
file.cancel();

// 重试上传
file.retry();

// 移除文件
file.remove();
```

### 批量操作

```typescript
// 全部暂停
uploader.pauseAll();

// 全部恢复
uploader.resumeAll();

// 全部取消
uploader.cancelAll();

// 全部重试
uploader.retryAll();

// 清空列表
uploader.clearFiles();
```

---

## 🔌 插件系统

file-ud.js 提供强大的插件系统，可以轻松扩展功能：

### 安装插件包

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

### 使用插件

```typescript
import { 
  FileValidatorPlugin,
  CompressImagePlugin,
  WatermarkPlugin
} from '@file-ud.js/plugins/uploader';
import { SmartRetryPlugin } from '@file-ud.js/plugins/retry';

// 文件验证
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,  // 10MB
  accept: ['image/*']
}));

// 图片压缩
uploader.use(new CompressImagePlugin({
  quality: 0.8,
  format: 'webp'
}));

// 添加水印
uploader.use(new WatermarkPlugin({
  text: '© MyCompany',
  position: 'bottom-right'
}));

// 智能重试
uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: 'exponential'
}));
```

📚 **详细插件文档**：[查看插件文档](../plugins/README.md)

---

## 💡 示例项目

查看完整的示例应用：

```bash
cd packages/example
npm run dev
```

示例包含：
- ✅ 基础上传
- ✅ 分片上传
- ✅ 断点续传
- ✅ 秒传功能
- ✅ 插件使用
- ✅ 进度展示
- ✅ 错误处理

---

## 🎯 高级用法

### 自定义上传逻辑

```typescript
const uploader = FileUD.createUploader("customUploader", {
  // 使用自定义上传函数
  action: async (formData, uploadFile) => {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': 'Bearer token'
      }
    });
    
    return await response.json();
  }
});
```

### 监听事件

```typescript
// 文件选择
uploader.on('change', (file) => {
  console.log('文件已选择:', file.fileName);
});

// 上传开始
uploader.on('files-start', (files) => {
  console.log('开始上传', files.length, '个文件');
});

// 上传完成
uploader.on('files-complete', (files) => {
  console.log('所有文件传输完成');
});

// 分片上传事件
uploader.on('chunk-success', (data) => {
  console.log(`分片 ${data.chunkIndex} 上传成功`);
});
```

### 响应式数据

```typescript
import { ref } from 'vue';

const files = ref([]);

uploader.onUpdate = (updatedFiles) => {
  files.value = updatedFiles;
};
```

在模板中使用：

```vue
<template>
  <div v-for="file in files" :key="file.fileId">
    <div>{{ file.fileName }}</div>
    <div>进度: {{ file.percent }}%</div>
    <div>大小: {{ file.formatSize }}</div>
    <div>已上传: {{ file.uploadedSize }}</div>
    <div>速度: {{ file.speed?.currentSpeedFormatted }}</div>
  </div>
</template>
```

---

## 🛠️ 开发指南

### 项目结构

```
packages/core/
├── src/
│   ├── uploader/          # 上传核心逻辑
│   │   ├── index.ts       # Uploader 类
│   │   ├── UploadFile.ts  # 文件实例类
│   │   └── uploadChunkManager.ts # 分片管理器
│   ├── types/             # TypeScript 类型定义
│   ├── utils/             # 工具函数
│   └── fileUD/            # FileUD 入口
└── package.json
```

### 本地开发

```bash
# 安装依赖
pnpm install

# 构建 core 包
pnpm --filter @file-ud.js/core build

# 运行示例
pnpm --filter example dev
```

---

## 📝 更新日志

### v0.1.2
- 修复 `multiple: false` 单文件模式下文件列表仍可能追加的问题。
- `updateConfig` 会自动同步内部 input 的 `multiple`、`accept` 属性。
- 修复源码开发环境 banner 版本可能显示为 `v0.0.0` 的问题。

### v0.1.1
- 修复默认插件继承逻辑。
- 补充单文件上传覆盖模式与插件架构文档。

### v0.1.0
- 首次发布 core 包。
- 支持分片上传、断点续传、秒传、插件系统、实时进度与 TypeScript 类型。

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

**报告 Bug**：[GitHub Issues](https://github.com/ChYuanJinlin/file-ud.js/issues)

**提出建议**：[Feature Requests](https://github.com/ChYuanJinlin/file-ud.js/discussions)

---

## 📄 许可证

MIT License
