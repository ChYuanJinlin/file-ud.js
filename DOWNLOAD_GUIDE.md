# FileUD 下载功能使用指南

## 📦 概述

FileUD 提供了与上传功能风格一致的下载管理器 `Downloader`，支持单文件/批量下载、进度监控、暂停/恢复/取消等功能。

## 🚀 快速开始

### 1. 基本使用

```typescript
import { Downloader } from '@file-ud/core';

// 创建下载器实例（单例模式）
const downloader = new Downloader({
  timeout: 30000,
  headers: {
    'Authorization': 'Bearer your-token'
  },
  autoStart: true // 自动开始下载
});

// 添加单个下载任务
const downloadTask = downloader.addFile('https://example.com/file.pdf', 'document.pdf');

// 监听下载进度
downloader.on('progress', (percent) => {
  console.log(`总进度: ${percent}%`);
});

// 监听单个文件完成
downloader.on('files-complete', (files) => {
  console.log('下载完成:', files);
});
```

### 2. 批量下载

```typescript
// 批量添加下载任务
const tasks = downloader.addFiles([
  'https://example.com/file1.pdf',
  'https://example.com/file2.mp4',
  {
    url: 'https://example.com/file3.zip',
    fileName: 'archive.zip',
    useBlob: true // 触发浏览器下载对话框
  }
]);

// 开始所有下载
await downloader.start();
```

### 3. 控制下载

```typescript
// 暂停所有下载
downloader.pauseAll();

// 恢复所有下载
downloader.resumeAll();

// 取消所有下载
downloader.cancelAll();

// 清空已完成的任务
downloader.clearFiles();
```

### 4. 单个文件控制

```typescript
const task = downloader.addFile('https://example.com/large-file.zip');

// 暂停单个文件
task.pause();

// 恢复单个文件
await task.resume();

// 取消单个文件
task.cancel();

// 移除文件
task.remove();
```

## 📊 获取下载状态

### 全局统计

```typescript
// 总进度百分比 (0-100)
console.log(downloader.totalPercent);

// 已下载字节数
console.log(downloader.transferredBytes);

// 总字节数
console.log(downloader.totalBytes);

// 格式化大小
console.log(downloader.transferredFormatSize); // "125.50 MB"
console.log(downloader.totalFormatSize);       // "256.80 MB"

// 下载速度
console.log(downloader.speed.currentSpeed);           // 1048576 (bytes/s)
console.log(downloader.speed.currentSpeedFormatted);  // "1.00 MB/s"
console.log(downloader.speed.averageSpeedFormatted);  // "856.23 KB/s"
```

### 单个文件状态

```typescript
const task = downloader.addFile('https://example.com/file.pdf');

// 文件属性
console.log(task.fileName);              // "file.pdf"
console.log(task.percent);               // 45 (进度百分比)
console.log(task.status);                // "UDLoading" | "success" | "paused" | "error" | "cancelled"
console.log(task.transferFormatSize);    // "45.23 MB" (已下载大小)
console.log(task.formatSize);            // "100.00 MB" (总大小)

// 速率信息
console.log(task.speed.currentSpeedFormatted);  // "2.50 MB/s"
console.log(task.speed.averageSpeedFormatted);  // "2.10 MB/s"

// 时间信息
console.log(task.transferTime.startTime);        // 1234567890 (开始时间戳)
console.log(task.transferTime.duration);         // 5000 (耗时毫秒)
console.log(task.transferTime.durationFormatted);// "5s" (格式化耗时)
```

## 🎯 高级用法

### 1. Blob 下载（触发浏览器下载对话框）

```typescript
const task = downloader.addFile({
  url: 'https://example.com/report.pdf',
  fileName: 'monthly-report.pdf',
  useBlob: true // 下载完成后自动触发浏览器保存对话框
});
```

### 2. 自定义请求头

```typescript
const task = downloader.addFile({
  url: 'https://api.example.com/download/secure-file',
  fileName: 'secret.pdf',
  headers: {
    'Authorization': 'Bearer token123',
    'X-Custom-Header': 'value'
  }
});
```

### 3. 文件回显（从服务端获取已下载的文件列表）

```typescript
// 假设从服务端获取了已下载的文件列表
const serverFiles = [
  {
    fileId: 'file-001',
    fileName: 'document.pdf',
    url: 'https://example.com/document.pdf',
    status: 'success',
    percent: 100,
    formatSize: '2.50 MB'
  },
  {
    fileId: 'file-002',
    fileName: 'video.mp4',
    url: 'https://example.com/video.mp4',
    status: 'UDLoading',
    percent: 50,
    formatSize: '150.00 MB'
  }
];

// 回显文件列表
downloader.setFiles(serverFiles);
```

### 4. 事件监听

```typescript
// 监听文件状态变化
downloader.on('change', (file) => {
  console.log('文件状态变化:', file.fileName, file.status);
});

// 监听下载进度
downloader.on('progress', (percent) => {
  console.log(`总进度: ${percent}%`);
});

// 监听更新（防抖 100ms）
downloader.on('update', (files) => {
  console.log('文件列表更新:', files.length);
});

// 监听错误
downloader.on('error', (error, file) => {
  console.error('下载失败:', file.fileName, error);
});

// 监听暂停
downloader.on('pause', (file) => {
  console.log('已暂停:', file.fileName);
});

// 监听恢复
downloader.on('resume', (file) => {
  console.log('已恢复:', file.fileName);
});

// 监听取消
downloader.on('cancel', (file) => {
  console.log('已取消:', file.fileName);
});

// 监听移除
downloader.on('remove', (file) => {
  console.log('已移除:', file.fileName);
});

// 监听批量开始
downloader.on('files-start', (files) => {
  console.log('开始下载:', files.length, '个文件');
});

// 监听批量完成
downloader.on('files-complete', (files) => {
  console.log('完成下载:', files.length, '个文件');
});
```

### 5. Vue 集成示例

```vue
<template>
  <div class="download-manager">
    <div v-for="file in files" :key="file.fileId" class="download-item">
      <span>{{ file.fileName }}</span>
      <el-progress :percentage="file.percent" />
      <span>{{ file.speed.currentSpeedFormatted }}</span>
      
      <el-button 
        @click="file.pause()" 
        v-if="file.status === 'UDLoading'"
      >
        暂停
      </el-button>
      <el-button 
        @click="file.resume()" 
        v-if="file.status === 'paused'"
      >
        继续
      </el-button>
      <el-button @click="file.cancel()">取消</el-button>
    </div>
    
    <div class="global-stats">
      <span>总进度: {{ downloader.totalPercent }}%</span>
      <span>速度: {{ downloader.speed.currentSpeedFormatted }}</span>
      <span>已下载: {{ downloader.transferredFormatSize }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Downloader } from '@file-ud/core';

const downloader = ref(new Downloader());
const files = ref([]);

onMounted(() => {
  // 监听更新，触发响应式刷新
  downloader.value.onUpdate = (updatedFiles) => {
    files.value = updatedFiles;
  };
  
  // 添加下载任务
  downloader.value.addFile('https://example.com/file.pdf');
});
</script>
```

### 6. React 集成示例

```tsx
import React, { useState, useEffect } from 'react';
import { Downloader } from '@file-ud/core';

const DownloadManager: React.FC = () => {
  const [downloader] = useState(() => new Downloader());
  const [files, setFiles] = useState([]);
  
  useEffect(() => {
    // 监听更新
    downloader.onUpdate = (updatedFiles) => {
      setFiles([...updatedFiles]);
    };
    
    // 添加下载任务
    downloader.addFile('https://example.com/file.pdf');
    
    return () => {
      downloader.cancelAll();
    };
  }, []);
  
  return (
    <div className="download-manager">
      {files.map(file => (
        <div key={file.fileId} className="download-item">
          <span>{file.fileName}</span>
          <progress value={file.percent} max="100" />
          <span>{file.speed.currentSpeedFormatted}</span>
          
          {file.status === 'UDLoading' && (
            <button onClick={() => file.pause()}>暂停</button>
          )}
          {file.status === 'paused' && (
            <button onClick={() => file.resume()}>继续</button>
          )}
          <button onClick={() => file.cancel()}>取消</button>
        </div>
      ))}
      
      <div className="global-stats">
        <span>总进度: {downloader.totalPercent}%</span>
        <span>速度: {downloader.speed.currentSpeedFormatted}</span>
      </div>
    </div>
  );
};

export default DownloadManager;
```

## 🔧 配置选项

### DownloaderConfig

```typescript
interface DownloaderConfig {
  /** 下载接口地址（可选，主要用于回显） */
  action?: string;
  
  /** 默认超时时间（毫秒） */
  timeout?: number;
  
  /** 默认请求头 */
  headers?: Record<string, string>;
  
  /** 是否自动开始下载（默认 true） */
  autoStart?: boolean;
  
  /** Axios 实例（可选，用于自定义配置） */
  axiosInstance?: any;
}
```

### DownloadOptions

```typescript
interface DownloadOptions {
  /** 下载链接 */
  url: string;
  
  /** 文件名 */
  fileName?: string;
  
  /** 是否使用 Blob 方式下载（触发浏览器下载对话框） */
  useBlob?: boolean;
  
  /** 超时时间（毫秒） */
  timeout?: number;
  
  /** 请求头 */
  headers?: Record<string, string>;
  
  /** Axios 实例（可选） */
  axiosInstance?: any;
}
```

## 📝 API 参考

### Downloader 类

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `addFile(options, fileName?)` | 添加单个下载任务 | `DownloadFile` |
| `addFiles(optionsList)` | 批量添加下载任务 | `DownloadFile[]` |
| `setFiles(files)` | 设置文件列表（回显） | `void` |
| `clearFiles()` | 清空文件列表 | `void` |
| `start()` | 开始所有下载 | `Promise<void>` |
| `pauseAll()` | 暂停所有下载 | `void` |
| `resumeAll()` | 恢复所有下载 | `void` |
| `cancelAll()` | 取消所有下载 | `void` |
| `updateConfig(config)` | 动态更新配置 | `void` |

### DownloadFile 类

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `start()` | 开始下载 | `Promise<T>` |
| `pause()` | 暂停下载 | `void` |
| `resume()` | 恢复下载 | `Promise<void>` |
| `cancel()` | 取消下载 | `void` |
| `remove()` | 移除文件 | `void` |

### 属性

#### Downloader

| 属性 | 类型 | 说明 |
|------|------|------|
| `files` | `DownloadFile[]` | 所有下载任务列表 |
| `activeFiles` | `DownloadFile[]` | 活跃下载任务列表 |
| `totalPercent` | `number` | 总进度百分比 (0-100) |
| `totalBytes` | `number` | 总字节数 |
| `transferredBytes` | `number` | 已下载字节数 |
| `totalFormatSize` | `string` | 总大小格式化字符串 |
| `transferredFormatSize` | `string` | 已下载大小格式化字符串 |
| `speed` | `SpeedInfo` | 全局速度信息 |

#### DownloadFile

| 属性 | 类型 | 说明 |
|------|------|------|
| `fileName` | `string` | 文件名 |
| `percent` | `number` | 进度百分比 (0-100) |
| `status` | `string` | 状态：pending/UDLoading/success/paused/error/cancelled |
| `transferFormatSize` | `string` | 已下载大小格式化字符串 |
| `formatSize` | `string` | 总大小格式化字符串 |
| `speed` | `SpeedInfo` | 速度信息 |
| `transferTime` | `TimeInfo` | 时间统计信息 |

## ⚠️ 注意事项

1. **单例模式**：`Downloader` 采用单例模式，多次 `new Downloader()` 会返回同一实例
2. **自动开始**：默认 `autoStart: true`，添加任务后会自动开始下载
3. **Blob 下载**：设置 `useBlob: true` 会在下载完成后自动触发浏览器保存对话框
4. **网络检查**：下载前会自动检查网络状态，无网络时会抛出错误
5. **响应式更新**：通过 `onUpdate` 回调实现防抖更新（100ms），适合 Vue/React 集成
6. **循环依赖**：内部使用延迟导入避免循环依赖问题，无需担心

## 🎉 总结

FileUD 的下载功能与上传功能保持完全一致的设计风格：

- ✅ **相同的继承体系**：Downloader 继承 Transfer，DownloadFile 继承 TransferFile
- ✅ **相同的 API 风格**：pause/resume/cancel 等方法命名一致
- ✅ **相同的响应式桥接**：Proxy 模式实现自动更新
- ✅ **相同的事件系统**：emit/on 事件机制
- ✅ **相同的工具函数**：formatSpeed、formatFileSize 等复用
- ✅ **相同的错误处理**：统一的 FileUDError 和 ErrorCode

这使得开发者可以无缝切换上传和下载功能，降低学习成本！
