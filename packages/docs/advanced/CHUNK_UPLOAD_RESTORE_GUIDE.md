# 分片上传回显功能使用指南

## 📋 问题背景

当用户从后端接口获取文件列表时，如果有一些文件是**分片上传**且**未完成**的，需要正确回显这些文件的上传进度。

**核心难点**：
- **普通上传**：只需要设置 `percent` 和 `status`
- **分片上传**：还需要初始化 `uploadChunkManager` 的状态（`completedChunks`、`totalChunks`、`chunks` 等）

---

## ✅ 解决方案

### 1. 扩展 IFile 接口

在 [IFile](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/types/index.ts) 接口中添加了分片上传回显所需的字段：

```typescript
export interface IFile {
  // ... 原有字段
  
  // ==================== 分片上传回显相关字段 ====================
  /* 总分片数（回显分片上传进度时需要） */
  totalChunks?: number;
  /* 已完成分片数（回显分片上传进度时需要） */
  completedChunks?: number;
  /* 已上传的分片索引数组（用于断点续传回显） */
  chunkIndexes?: number[];
  /* 文件哈希值（用于秒传/断点续传回显） */
  fileHash?: string;
  /* 服务端上传ID（用于断点续传回显） */
  uploadId?: string;
}
```

---

### 2. 自动初始化 uploadChunkManager

在 [UploadFile](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadFile.ts) 构造函数中，只要当前 uploader 配置了 `chunkOptions`，并且回显数据里存在 `totalChunks`，就会自动调用 `initChunkManagerFromRestore()` 方法初始化分片状态。

---

## 💡 使用示例

### 场景 1：从后端接口回显文件列表

假设后端返回的文件数据结构如下：

```json
{
  "fileId": "file_abc123",
  "fileName": "large-video.mp4",
  "url": "https://example.com/files/large-video.mp4",
  "size": 104857600,
  "status": "UDLoading",
  "totalChunks": 20,
  "completedChunks": 8,
  "chunkIndexes": [0, 1, 2, 3, 4, 5, 6, 7],
  "fileHash": "a1b2c3d4e5f6...",
  "uploadId": "upload_xyz789"
}
```

**前端代码**：

```typescript
import { FileUD, formatFileSize } from '@file-ud.js/core';
import type { IFile } from '@file-ud.js/core/types';

// 1. 创建 Uploader
const uploader = FileUD.createUploader("my-uploader", {
  action: '/api/upload',
  chunkOptions: {
    chunkSize: 5 * 1024 * 1024, // 5MB 分片
    maxConcurrent: 3,
  }
});

// 2. 从后端获取文件列表
async function loadFilesFromServer() {
  const response = await fetch('/api/files/list');
  const serverFiles = await response.json();
  
  // 3. 转换为 IFile 格式
  const filesToRestore: IFile[] = serverFiles.map((serverFile: any) => ({
    fileId: serverFile.fileId,
    fileName: serverFile.fileName,
    url: serverFile.url || "",
    size: serverFile.size,
    File: new File([], serverFile.fileName), // ⚠️ 注意：这里需要一个空的 File 对象
    status: serverFile.status,
    formatSize: formatFileSize(serverFile.size),
    
    // ✅ 关键：分片上传回显字段
    totalChunks: serverFile.totalChunks,
    completedChunks: serverFile.completedChunks,
    chunkIndexes: serverFile.chunkIndexes,
    fileHash: serverFile.fileHash,
    uploadId: serverFile.uploadId,
  }));
  
  // 4. 回显文件列表
  uploader.setFiles(filesToRestore);
}

// 5. 监听进度更新
uploader.onUpdate = (files) => {
  files.forEach(file => {
    if (file.status === "UDLoading") {
      console.log(`${file.fileName}: ${file.percent}% (${file.chunkManager?.completedChunks}/${file.chunkManager?.totalChunks} 分片)`);
    }
  });
};
```

---

### 场景 2：简化版回显（只有完成数量）

如果后端只返回完成数量，没有具体的分片索引：

```json
{
  "fileId": "file_abc123",
  "fileName": "large-video.mp4",
  "size": 104857600,
  "status": "UDLoading",
  "totalChunks": 20,
  "completedChunks": 8
}
```

**前端代码**：

```typescript
const filesToRestore: IFile[] = serverFiles.map((serverFile: any) => ({
  fileId: serverFile.fileId,
  fileName: serverFile.fileName,
  url: serverFile.url || "",
  size: serverFile.size,
  File: new File([], serverFile.fileName),
  status: serverFile.status,
  formatSize: formatFileSize(serverFile.size),
  
  // ✅ 只需提供总数量和完成数量
  totalChunks: serverFile.totalChunks,
  completedChunks: serverFile.completedChunks,
  // chunkIndexes 可选，不提供时会假设前 N 个分片已完成
}));

uploader.setFiles(filesToRestore);
```

---

### 场景 3：回显已完成的分片上传文件

如果文件已经上传完成：

```json
{
  "fileId": "file_abc123",
  "fileName": "large-video.mp4",
  "url": "https://example.com/files/large-video.mp4",
  "size": 104857600,
  "status": "success",
  "totalChunks": 20,
  "completedChunks": 20
}
```

**前端代码**：

```typescript
const filesToRestore: IFile[] = [{
  fileId: "file_abc123",
  fileName: "large-video.mp4",
  url: "https://example.com/files/large-video.mp4",
  size: 104857600,
  File: new File([], "large-video.mp4"),
  status: "success",
  formatSize: formatFileSize(104857600),
  
  totalChunks: 20,
  completedChunks: 20,
}];

uploader.setFiles(filesToRestore);

// 系统会自动：
// 1. 设置 percent = 100%
// 2. 设置 status = "success"
// 3. 标记所有分片为已上传
```

---

### 场景 4：混合回显（普通上传 + 分片上传）

```typescript
const filesToRestore: IFile[] = [
  // 普通上传文件
  {
    fileId: "file_001",
    fileName: "photo.jpg",
    url: "https://example.com/photo.jpg",
    size: 2464154,
    File: new File([], "photo.jpg"),
    status: "success",
    percent: 100,
    formatSize: "2.35 MB",
  },
  
  // 分片上传文件（进行中）
  {
    fileId: "file_002",
    fileName: "video.mp4",
    url: "",
    size: 262144000,
    File: new File([], "video.mp4"),
    status: "UDLoading",
    formatSize: formatFileSize(262144000),
    totalChunks: 50,
    completedChunks: 25,
    chunkIndexes: [0, 1, 2, ..., 24],
  },
  
  // 分片上传文件（已完成）
  {
    fileId: "file_003",
    fileName: "archive.zip",
    url: "https://example.com/archive.zip",
    size: 157286400,
    File: new File([], "archive.zip"),
    status: "success",
    formatSize: formatFileSize(157286400),
    totalChunks: 30,
    completedChunks: 30,
  },
];

uploader.setFiles(filesToRestore);
```

---

## 🔍 工作原理

### 初始化流程

```
用户调用 setFiles(files)
  ↓
遍历每个文件，创建 UploadFile 实例
  ↓
检测：up.config?.chunkOptions
  ↓
如果为 true，创建 uploadChunkManager
  ↓
检测：file.totalChunks !== undefined
  ↓
调用 initChunkManagerFromRestore(file)
  ↓
1. 设置 totalChunks ✅
2. 设置 completedChunks ✅
3. 初始化 chunks 数组 ✅
4. 标记已上传的分片 ✅
5. 设置 fileHash 和 uploadId ✅
6. 计算并设置 percent ✅
7. 如果全部完成，设置 status = "success" ✅
  ↓
回显完成，UI 显示正确的进度
```

---

### 进度计算逻辑

```typescript
// 分片上传的进度计算公式
const percent = Math.round(
  (completedChunks / totalChunks) * 100
);

// 示例：
// completedChunks = 8, totalChunks = 20
// percent = Math.round((8 / 20) * 100) = 40%
```

---

## 📊 后端接口设计建议

### 推荐的数据结构

```typescript
interface ServerFileResponse {
  // 基本信息
  fileId: string;
  fileName: string;
  url: string;
  size: number;
  status: "pending" | "UDLoading" | "success" | "fail" | "cancelled";
  
  // 分片上传信息（存在 totalChunks 时，前端会按分片回显处理）
  totalChunks?: number;           // 总分片数
  completedChunks?: number;       // 已完成分片数
  chunkIndexes?: number[]; // 已上传的分片索引数组
  fileHash?: string;              // 文件哈希值
  uploadId?: string;              // 服务端上传ID
  
  // 时间戳
  createdAt: number;
  updatedAt: number;
}
```

---

### 后端查询接口示例

```javascript
// GET /api/files/:fileId/chunk-progress
// 查询某个文件的分片上传进度

app.get('/api/files/:fileId/chunk-progress', async (req, res) => {
  const { fileId } = req.params;
  
  // 1. 从数据库查询文件信息
  const file = await db.files.findById(fileId);
  
  if (!file) {
    return res.status(404).json({ error: '文件不存在' });
  }
  
  // 2. 如果是分片上传，查询分片进度
  if (file.totalChunks > 0) {
    const chunks = await db.chunks.find({
      fileId: fileId,
      uploaded: true
    });
    
    return res.json({
      fileId: file.id,
      fileName: file.name,
      url: file.url,
      size: file.size,
      status: file.status,
      totalChunks: file.totalChunks,
      completedChunks: chunks.length,
      chunkIndexes: chunks.map(c => c.index),
      fileHash: file.fileHash,
      uploadId: file.uploadId,
    });
  }
  
  // 3. 普通上传，直接返回
  return res.json({
    fileId: file.id,
    fileName: file.name,
    url: file.url,
    size: file.size,
    status: file.status,
  });
});
```

---

## 🐛 常见问题

### Q1: File 对象怎么处理？

**问题**：回显时，后端不会返回完整的 `File` 对象，但 [IFile](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/types/index.ts) 接口要求必须有 `File` 字段。

**解决方案**：创建一个空的 `File` 对象，只保留文件名：

```typescript
File: new File([], serverFile.fileName)
```

**原因**：
- 回显的文件不需要再次上传（除非用户点击重试）
- `uploadChunkManager` 在初始化时只需要文件名和大小
- 如果用户点击重试，需要重新选择文件或从服务器下载

---

### Q2: 如果没有 chunkIndexes 怎么办？

**解决方案**：可以只提供 `completedChunks`，系统会假设前 N 个分片已完成：

```typescript
{
  totalChunks: 20,
  completedChunks: 8,
  // chunkIndexes 不提供
}

// 系统会自动标记 chunks[0] ~ chunks[7] 为 true
```

---

### Q3: 回显后如何继续上传？

**解决方案**：用户点击"重试"按钮即可：

```vue
<template>
  <button @click="file.retry()" v-if="file.status === 'UDLoading'">
    继续上传
  </button>
</template>
```

**工作原理**：
1. 调用 `file.retry()`
2. [uploadChunkManager](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadChunkManager.ts) 会检查 `chunks` 数组
3. 跳过已上传的分片，只上传未完成的分片
4. 实现断点续传

---

### Q4: 如何区分普通上传和分片上传？

**解决方案**：通过 `chunkManager` 或 `totalChunks` 判断：

```typescript
files.forEach(file => {
  if (file.chunkManager || file.totalChunks !== undefined) {
    console.log(`分片上传: ${file.fileName}`);
    console.log(`进度: ${file.chunkManager?.completedChunks}/${file.chunkManager?.totalChunks}`);
  } else {
    console.log(`普通上传: ${file.fileName}`);
    console.log(`进度: ${file.percent}%`);
  }
});
```

---

### Q5: 回显的文件能删除吗？

**可以**。调用 `file.remove()` 即可：

```typescript
// 删除回显的文件
file.remove();

// 如果需要同时删除服务端文件
async function deleteFile(file) {
  await fetch(`/api/files/${file.fileId}`, { method: 'DELETE' });
  file.remove();
}
```

---

## 📝 最佳实践

### 1. 后端返回完整的分片信息

```typescript
// ✅ 推荐：返回完整的分片信息
{
  totalChunks: 20,
  completedChunks: 8,
  chunkIndexes: [0, 1, 2, 3, 4, 5, 6, 7],
  fileHash: "a1b2c3d4...",
  uploadId: "upload_xyz"
}

// ❌ 不推荐：只返回部分信息
{
  completedChunks: 8
  // 缺少 totalChunks，无法计算百分比
}
```

---

### 2. 前端缓存文件哈希值

```typescript
// 首次上传时，保存 fileHash
uploader.onSuccess = (response, file) => {
  if (file.chunkManager) {
    console.log('文件哈希:', file.chunkManager.fileHash);
    // 可以将 fileHash 发送到后端保存
  }
};

// 回显时，使用保存的 fileHash
{
  fileId: "file_abc123",
  fileHash: savedFileHash, // 从本地缓存或后端获取
  // ...
}
```

---

### 3. 处理回显失败的情况

```typescript
try {
  uploader.setFiles(filesToRestore);
} catch (error) {
  console.error('回显文件失败:', error);
  // 降级处理：只显示文件名，不显示进度
  filesToRestore.forEach(file => {
    file.status = "pending";
    file.percent = 0;
  });
  uploader.setFiles(filesToRestore);
}
```

---

### 4. 监听回显完成事件

```typescript
// 目前没有专门的回显完成事件，可以使用 onUpdate
uploader.onUpdate = (files) => {
  const restoredFiles = files.filter(f => f.status !== "pending");
  if (restoredFiles.length > 0) {
    console.log(`回显了 ${restoredFiles.length} 个文件`);
  }
};
```

---

## 🎯 总结

### 核心要点

1. ✅ **扩展 IFile 接口**：添加 `totalChunks`、`completedChunks`、`chunkIndexes`、`fileHash`、`uploadId` 等字段
2. ✅ **自动初始化**：在 [UploadFile](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadFile.ts) 构造函数中检测并初始化 [uploadChunkManager](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadChunkManager.ts)
3. ✅ **进度计算**：基于 `completedChunks / totalChunks` 计算百分比
4. ✅ **断点续传**：回显后可以继续上传，自动跳过已完成的分片

### 适用场景

- ✅ 用户上传中断后刷新页面
- ✅ 多设备同步上传进度
- ✅ 后台任务管理界面
- ✅ 文件传输历史记录

### 兼容性

- ✅ 不影响普通上传
- ✅ 不影响新的分片上传
- ✅ 向后兼容，旧代码无需修改

---

## 🤝 相关 API

- [setFiles()](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/index.ts) - 回显文件列表
- [retry()](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadFile.ts) - 重试/继续上传
- [cancel()](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadFile.ts) - 取消上传
- [remove()](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadFile.ts) - 移除文件

---

## 📚 参考资料

- [SETFILES_GUIDE.md](./SETFILES_GUIDE.md) - setFiles 使用指南
- [uploadChunkManager.ts](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadChunkManager.ts) - 分片管理器源码
- [UploadFile.ts](https://github.com/ChYuanJinlin/file-ud.js/blob/main/packages/core/src/uploader/UploadFile.ts) - 上传文件类源码
