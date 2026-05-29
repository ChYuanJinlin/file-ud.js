# 分片上传回显功能 - 快速开始

## 🎯 问题场景

用户从后端接口获取文件列表时，如果有**分片上传未完成**的文件，需要正确回显上传进度。

---

## ✅ 解决方案（3步搞定）

### 第1步：后端返回分片信息

```json
{
  "fileId": "file_abc123",
  "fileName": "large-video.mp4",
  "status": "UDLoading",
  "isChunkUpload": true,
  "totalChunks": 20,
  "completedChunks": 8,
  "chunkIndexes": [0, 1, 2, 3, 4, 5, 6, 7],
  "fileHash": "a1b2c3d4...",
  "uploadId": "upload_xyz"
}
```

### 第2步：前端转换为 IFile 格式

```typescript
import { IFile } from '@file-ud.js/core/types';

const filesToRestore: IFile[] = serverFiles.map((serverFile) => ({
  fileId: serverFile.fileId,
  fileName: serverFile.fileName,
  url: serverFile.url || "",
  File: new File([], serverFile.fileName), // ⚠️ 创建空的 File 对象
  status: serverFile.status,
  
  // ✅ 关键：分片上传回显字段
  isChunkUpload: serverFile.isChunkUpload,
  totalChunks: serverFile.totalChunks,
  completedChunks: serverFile.completedChunks,
  chunkIndexes: serverFile.chunkIndexes,
  fileHash: serverFile.fileHash,
  uploadId: serverFile.uploadId,
}));
```

### 第3步：调用 setFiles 回显

```typescript
uploader.setFiles(filesToRestore);
```

**完成！** 🎉 系统会自动：
- ✅ 初始化 uploadChunkManager 状态
- ✅ 计算并显示进度百分比
- ✅ 标记已上传的分片
- ✅ 支持断点续传（点击重试即可继续）

---

## 💡 示例代码

### 完整示例

```typescript
import { FileUD } from '@file-ud.js/core';
import { IFile } from '@file-ud.js/core/types';

// 1. 创建 Uploader
const uploader = FileUD.createUploader("my-uploader", {
  action: '/api/upload',
  chunkOptions: {
    chunkSize: 5 * 1024 * 1024,
  }
});

// 2. 从后端获取文件列表
async function loadFiles() {
  const response = await fetch('/api/files/list');
  const serverFiles = await response.json();
  
  // 3. 转换格式
  const filesToRestore: IFile[] = serverFiles.map(file => ({
    fileId: file.fileId,
    fileName: file.fileName,
    url: file.url || "",
    File: new File([], file.fileName),
    status: file.status,
    isChunkUpload: file.isChunkUpload,
    totalChunks: file.totalChunks,
    completedChunks: file.completedChunks,
    chunkIndexes: file.chunkIndexes,
    fileHash: file.fileHash,
    uploadId: file.uploadId,
  }));
  
  // 4. 回显
  uploader.setFiles(filesToRestore);
}

// 5. 监听进度
uploader.onUpdate = (files) => {
  files.forEach(file => {
    if (file.chunkManager) {
      console.log(
        `${file.fileName}: ${file.percent}% ` +
        `(${file.chunkManager.completedChunks}/${file.chunkManager.totalChunks} 分片)`
      );
    }
  });
};
```

---

## 🔍 测试方法

### 在示例应用中测试

1. **启动示例应用**
   ```bash
   npm run dev
   ```

2. **打开浏览器控制台**

3. **点击"📦 模拟后端回显分片上传"按钮**

4. **观察输出**
   ```
   🔄 开始模拟后端回显分片上传文件...
   ✅ 回显完成，共回显 2 个文件
   
   文件列表:
   - large-video-restored.mp4: UDLoading, 40% (8/20 分片)
   - archive-restored.zip: success, 100% (15/15 分片)
   ```

5. **点击"重试"按钮**
   - 未完成的文件会从第 9 个分片继续上传
   - 已完成的文件保持不变

---

## 📊 核心原理

### 自动初始化流程

```
setFiles(files)
  ↓
检测 file.isChunkUpload === true
  ↓
创建 uploadChunkManager
  ↓
调用 initChunkManagerFromRestore()
  ↓
1. 设置 totalChunks
2. 设置 completedChunks
3. 初始化 chunks 数组
4. 标记已上传的分片
5. 计算 percent = (completedChunks / totalChunks) * 100
6. 如果全部完成，设置 status = "success"
  ↓
UI 显示正确的进度
```

---

## 🐛 常见问题

### Q1: File 对象怎么处理？

```typescript
// ✅ 正确做法：创建空的 File 对象
File: new File([], serverFile.fileName)

// ❌ 错误做法：不传或传 null
File: null // 会导致类型错误
```

---

### Q2: 如果没有 chunkIndexes 怎么办？

```typescript
// ✅ 可以只提供 completedChunks
{
  isChunkUpload: true,
  totalChunks: 20,
  completedChunks: 8,
  // chunkIndexes 可选
}

// 系统会假设前 8 个分片已完成
```

---

### Q3: 回显后如何继续上传？

```vue
<template>
  <button @click="file.retry()">继续上传</button>
</template>
```

系统会自动跳过已上传的分片，只上传未完成的分片。

---

## 📚 相关文档

- [CHUNK_UPLOAD_RESTORE_GUIDE.md](file://d:\yjl\file-UD\docs\CHUNK_UPLOAD_RESTORE_GUIDE.md) - 详细使用指南
- [SETFILES_GUIDE.md](file://d:\yjl\file-UD\docs\SETFILES_GUIDE.md) - setFiles 基础用法
- [CANCEL_FIX.md](file://d:\yjl\file-UD\docs\CANCEL_FIX.md) - 取消上传功能说明
- [RETRY_AFTER_CANCEL_FIX.md](file://d:\yjl\file-UD\docs\RETRY_AFTER_CANCEL_FIX.md) - 取消后重试说明

---

## 🎉 总结

### 优势

- ✅ **零配置**：只需提供分片信息，系统自动处理
- ✅ **智能计算**：自动计算进度百分比
- ✅ **断点续传**：回显后可以继续上传
- ✅ **向后兼容**：不影响普通上传和新的分片上传

### 适用场景

- ✅ 用户上传中断后刷新页面
- ✅ 多设备同步上传进度
- ✅ 后台任务管理界面
- ✅ 文件传输历史记录

现在你可以轻松实现分片上传的回显功能了！🚀
