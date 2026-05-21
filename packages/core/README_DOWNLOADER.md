# Downloader 使用指南

## 简介

`Downloader` 是 `file-UD` 库中的文件下载模块，提供与 `Uploader` 对称的 API 设计，支持单文件/批量下载、进度跟踪、速率统计、暂停/恢复等功能。

## 快速开始

### 1. 基础用法

```typescript
import { Downloader } from '@file-ud.js/core';

// 创建下载器实例
const downloader = new Downloader({
  timeout: 30000,        // 超时时间（毫秒）
  maxConcurrent: 3,      // 最大并发数
  autoStart: true,       // 自动开始下载
  headers: {             // 自定义请求头
    'Authorization': 'Bearer token'
  }
});

// 添加单个下载任务
const file = downloader.add('https://example.com/file.pdf', {
  fileName: 'document.pdf'  // 可选：自定义文件名
});

// 监听下载进度
downloader.onUpdate((files) => {
  files.forEach(file => {
    console.log(`${file.fileName}: ${file.percent}%`);
  });
});

// 监听下载完成
downloader.on('success', (file) => {
  console.log(`下载完成: ${file.fileName}`);
});
```

### 2. 批量下载

```typescript
// 批量添加下载任务
const files = downloader.addBatch([
  'https://example.com/file1.pdf',
  'https://example.com/file2.jpg',
  { 
    url: 'https://example.com/file3.zip',
    fileName: 'archive.zip'
  }
]);

// 等待所有下载完成
Promise.all(files.map(f => f.start())).then(() => {
  console.log('所有文件下载完成');
});
```

### 3. 手动控制下载

```typescript
// 禁用自动开始
const downloader = new Downloader({ autoStart: false });

// 添加下载任务
const file = downloader.add('https://example.com/large-file.zip');

// 手动开始下载
file.start();

// 暂停下载
file.pause();

// 恢复下载
file.resume();

// 取消下载
file.cancel();

// 重试下载
file.retry();
```

### 4. 全局统计信息

```typescript
// 获取全局下载进度
console.log(downloader.totalPercent);        // 总进度百分比
console.log(downloader.transferredFormatSize); // 已下载大小（格式化）
console.log(downloader.totalFormatSize);       // 总大小（格式化）
console.log(downloader.transferSpeed.currentSpeedFormatted); // 当前速度

// 监听更新
downloader.onUpdate(() => {
  console.log(`全局进度: ${downloader.totalPercent}%`);
  console.log(`下载速度: ${downloader.transferSpeed.currentSpeedFormatted}`);
});
```

### 5. 插件系统

```typescript
// 创建自定义插件
const myPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  
  // 下载前钩子
  beforeDownload: async (file, context) => {
    console.log(`准备下载: ${file.fileName}`);
    return true; // 返回 false 可阻止下载
  },
  
  // 进度钩子
  onProgress: (percent, file, context) => {
    if (percent % 10 === 0) {
      console.log(`${file.fileName}: ${percent}%`);
    }
  },
  
  // 成功钩子
  onSuccess: (blob, file, context) => {
    console.log(`下载成功: ${file.fileName}`);
  }
};

// 注册插件
downloader.use(myPlugin);
```

### 6. Vue 响应式集成

```vue
<script setup>
import { ref } from 'vue';
import { Downloader } from '@file-ud.js/core';

const downloader = new Downloader();

// 创建响应式桥接层
const globalStats = ref({
  totalPercent: 0,
  transferredFormatSize: '0 B',
  transferSpeed: { currentSpeedFormatted: '0 B/s' }
});

const files = ref([]);

// 同步更新
downloader.onUpdate((fileList) => {
  files.value = fileList;
  globalStats.value = {
    totalPercent: downloader.totalPercent,
    transferredFormatSize: downloader.transferredFormatSize,
    transferSpeed: downloader.transferSpeed
  };
});

// 添加下载任务
const addDownload = () => {
  downloader.add('https://example.com/file.pdf');
};
</script>

<template>
  <div>
    <button @click="addDownload">添加下载</button>
    
    <div v-if="files.length">
      <h3>全局统计</h3>
      <p>进度: {{ globalStats.totalPercent }}%</p>
      <p>已下载: {{ globalStats.transferredFormatSize }}</p>
      <p>速度: {{ globalStats.transferSpeed.currentSpeedFormatted }}</p>
      
      <h3>文件列表</h3>
      <div v-for="file in files" :key="file.fileId">
        <p>{{ file.fileName }}: {{ file.percent }}%</p>
        <button @click="file.pause()">暂停</button>
        <button @click="file.resume()">恢复</button>
        <button @click="file.cancel()">取消</button>
      </div>
    </div>
  </div>
</template>
```

## API 参考

### Downloader 配置

```typescript
interface downloaderConfigs {
  action?: string;              // 下载基础 URL
  method?: 'GET' | 'POST';      // 请求方法
  headers?: Record<string, string>;  // 自定义请求头
  timeout?: number;             // 超时时间（毫秒）
  maxConcurrent?: number;       // 最大并发数
  autoStart?: boolean;          // 是否自动开始下载
}
```

### Downloader 方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `add(url, options)` | 添加下载任务 | `DownloadFile` |
| `addBatch(urls)` | 批量添加下载任务 | `DownloadFile[]` |
| `use(plugin)` | 注册插件 | `this` |
| `unuse(name)` | 移除插件 | `this` |
| `clearFiles()` | 清空所有任务 | `void` |
| `pauseAll()` | 暂停所有任务 | `void` |
| `resumeAll()` | 恢复所有任务 | `void` |
| `cancelAll()` | 取消所有任务 | `void` |
| `retryAll()` | 重试所有失败任务 | `void` |

### DownloadFile 方法

| 方法 | 说明 |
|------|------|
| `start()` | 开始下载 |
| `pause()` | 暂停下载 |
| `resume()` | 恢复下载 |
| `cancel()` | 取消下载 |
| `retry()` | 重试下载 |
| `remove()` | 从列表中移除 |

### 事件

| 事件名 | 回调参数 | 说明 |
|--------|----------|------|
| `update` | `(files: DownloadFile[])` | 文件列表更新 |
| `success` | `(file: DownloadFile)` | 单个文件下载成功 |
| `error` | `(error)` | 下载错误 |
| `pause` | `(file: DownloadFile)` | 暂停下载 |
| `resume` | `(file: DownloadFile)` | 恢复下载 |
| `cancel` | `(file: DownloadFile)` | 取消下载 |
| `retry` | `(file: DownloadFile)` | 重试下载 |
| `remove` | `(file: DownloadFile)` | 移除文件 |
| `files-start` | `(files: DownloadFile[])` | 批量下载开始 |
| `files-complete` | `(files: DownloadFile[])` | 批量下载完成 |

## 与 Uploader 的对比

| 特性 | Uploader | Downloader |
|------|----------|------------|
| 初始化 | `create(config)` + 文件选择器 | 直接实例化 |
| 添加任务 | 用户选择文件 | `add(url)` 手动添加 |
| 核心类 | `UploadFile` | `DownloadFile` |
| 分片支持 | ✅ 支持分片上传 | ❌ 暂不支持 |
| 秒传支持 | ✅ 支持 | ❌ 不适用 |
| 断点续传 | ✅ 支持 | ⏸️ 计划中 |

## 注意事项

1. **跨域问题**：下载外部资源时需注意 CORS 配置
2. **大文件下载**：建议设置合理的 `timeout` 和启用断点续传（未来版本）
3. **浏览器限制**：浏览器环境下无法指定保存路径，由浏览器决定
4. **内存管理**：下载完成后及时清理不再需要的 `DownloadFile` 实例

## 未来规划

- [ ] 支持断点续传
- [ ] 支持多线程下载
- [ ] 支持 P2P 下载
- [ ] 支持下载队列优先级
- [ ] 支持离线缓存
