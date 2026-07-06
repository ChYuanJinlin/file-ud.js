# Uploader 上传器

## 简介

`Uploader` 是 file-UD 库的文件上传模块，支持文件选择、表单校验、分片并发上传、断点续传、秒传、速率统计等功能。

## 基础用法

```typescript
import { FileUD } from "@file-ud.js/core";

const uploader = FileUD.createUploader("myUploader", {
  action: "/api/upload",
  multiple: true,
  autoUpload: true,
  accept: ["image/*", ".pdf"],
  maxSize: 10 * 1024 * 1024,  // 10MB
  limit: 5,                     // 最多 5 个文件
});

uploader.onSuccess = (response, file) => {
  console.log(`上传成功: ${file.fileName}`, response);
};

uploader.onUpdate = (files) => {
  files.forEach((file) => {
    console.log(`${file.fileName}: ${file.percent}%`);
  });
};

uploader.open();
```

## 分片上传（断点续传 + 秒传）

```typescript
const uploader = FileUD.createUploader("chunkUploader", {
  action: "/api/upload-chunk",
  chunkOptions: {
    chunkSize: 2 * 1024 * 1024,    // 2MB 分片
    maxConcurrent: 3,               // 最多 3 个并发
    retries: 3,                     // 失败重试 3 次
    timeout: 10000,                 // 单分片超时
    enableFileCache: true,          // 启用 IndexedDB 缓存
  },
});

// 分片初始化回调
uploader.onInitChunk = async (uploadFile, totalChunks, fileHash) => {
  const { data } = await checkFile({ fileHash });
  return {
    fileHash: data.fileHash,
    chunks: data.chunks || [],
    isInstantUpload: data.isInstant,
  };
};

// 分片合并回调
uploader.onMergeChunk = async (chunkManager) => {
  const { data } = await mergeChunks({
    fileHash: chunkManager.fileHash,
    fileName: chunkManager.uploadFile.fileName,
    totalChunks: chunkManager.totalChunks,
  });
  return data;
};
```

## 手动上传模式

```typescript
const uploader = FileUD.createUploader("manualUploader", {
  action: "/api/upload",
  autoUpload: false,
  multiple: true,
});

uploader.open();  // 仅选择文件，不自动上传

// 手动触发上传
button.onclick = async () => {
  await uploader.submit();
};

// 文件选择时拦截
uploader.onSelect = (file) => {
  return file.size < 100 * 1024 * 1024;
};
```

## 自定义上传函数

```typescript
const uploader = FileUD.createUploader("customUploader", {
  action: async (formData, uploadFile) => {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      headers: { Authorization: "Bearer token" },
    });
    return await response.json();
  },
});
```

## 文件操作

```typescript
// 单个文件操作
file.pause();     // 暂停（仅分片模式）
file.resume();    // 恢复（仅分片模式）
file.cancel();    // 取消
file.retry();     // 重试

// 批量操作
uploader.pauseAll();
uploader.resumeAll();
uploader.cancelAll();
uploader.retryAll();
uploader.clearFiles();
uploader.submit();    // 提交所有 pending 任务
```

## 文件列表回显

```typescript
uploader.setFiles([
  {
    fileId: "file-001",
    fileName: "document.pdf",
    url: "https://cdn.example.com/document.pdf",
    size: 5484052,
    percent: 100,
    status: "success",
    formatSize: "5.23 MB",
  },
]);
```

## 上传流程

### 普通上传

```
open() → 用户选择文件 → onFileSelect 钩子 → onSelect 回调
  → 校验(size/type/limit) → handleFile
  → beforeTransfer 钩子 → 构建 FormData
  → XMLHttpRequest 上传 → 进度回调 → onSuccess
```

### 分片上传

```
open() → 用户选择文件 → 校验 → 计算 MD5（增量哈希）
  → onInitChunk 回调（查服务端已存在分片）
  → IndexedDB 恢复（如启用 enableFileCache）
  → 秒传检查（全部已完成 → 跳过上传）
  → 并发上传缺失分片 → 全部分片完成
  → onMergeChunk 回调（服务端合并分片）
  → onSuccess
```

### 状态流转

```
pending → UDLoading → merging → success
                   → paused → UDLoading（恢复）
                   → cancelled / fail / error → retry → UDLoading
```

## 插件系统

```typescript
const myPlugin = {
  name: "my-upload-plugin",
  version: "1.0.0",
  priority: 50,

  onFileSelect: async (file, context) => {
    console.log(`选择了文件: ${file.fileName}`);
    return file;
  },

  beforeTransfer: async (file, context) => {
    return true;
  },

  onProgress: (percent, file, context) => {
    console.log(`${file.fileName}: ${percent}%`);
  },

  onSuccess: (response, file, context) => {
    console.log(`✅ ${file.fileName} 上传成功`);
  },

  onError: (error, file, context) => {
    console.error(`❌ ${file.fileName} 上传失败:`, error);
  },
};

uploader.use(myPlugin);
```
