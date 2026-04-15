# 秒传功能使用指南

## 📋 概述

秒传是指当用户上传一个文件时，如果服务端已经存在相同的文件（通过 MD5 哈希判断），则直接返回成功，无需实际上传文件内容。这可以大幅提升用户体验，节省带宽和存储空间。

---

## 🎯 核心原理

1. **前端计算文件 MD5** → 生成唯一标识 `fileHash`
2. **调用服务端接口** → 检查该 `fileHash` 是否已存在
3. **服务端判断**：
   - ✅ 文件存在 → 返回所有分片已完成 → **秒传成功**
   - ⚠️ 部分分片存在 → 返回已上传分片列表 → **断点续传**
   - ❌ 文件不存在 → 返回空列表 → **正常上传**

---

## 💻 前端实现

### 1. 配置 onInit 回调

```typescript
import Uploader from '@file-ud/core';

const uploader = new Uploader({
  chunkOptions: {
    chunkSize: 5 * 1024 * 1024, // 5MB
    enableResume: true,
    maxConcurrent: 5,
    retries: 3,
  },
});

// ✅ 配置 onInit 回调（支持秒传 + 断点续传）
uploader.onInit = async (file, totalChunks, fileHash) => {
  console.log('初始化上传任务:', {
    fileName: file.fileName,
    fileSize: file.File.size,
    totalChunks,
    fileHash,
  });

  try {
    // 步骤 1: 检查文件是否存在（秒传检查）
    const checkResponse = await fetch('/api/check-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        fileHash, 
        fileName: file.fileName 
      }),
    });

    const checkData = await checkResponse.json();

    if (checkData.exists) {
      // ✅ 秒传成功！文件已存在
      console.log('✅ 秒传成功！');
      
      return {
        uploadId: checkData.uploadId,
        uploadedChunks: Array.from(
          { length: totalChunks }, 
          (_, i) => i
        ), // 所有分片都已上传
      };
    }

    // 步骤 2: 获取已上传分片（断点续传）
    const progressResponse = await fetch(
      `/api/get-uploaded-chunks?fileHash=${fileHash}`
    );
    const progressData = await progressResponse.json();

    // 步骤 3: 创建上传任务
    const createResponse = await fetch('/api/create-upload-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileHash,
        fileName: file.fileName,
        fileSize: file.File.size,
        totalChunks,
        chunkSize: 5 * 1024 * 1024,
      }),
    });

    const createData = await createResponse.json();

    // 步骤 4: 返回 uploadId 和已上传分片列表
    return {
      uploadId: createData.uploadId,
      uploadedChunks: progressData.uploadedChunks || [],
    };
  } catch (error) {
    console.error('初始化上传任务失败:', error);
    throw error;
  }
};
```

---

### 2. 添加文件并上传

```typescript
// 选择文件
const input = document.getElementById('fileInput') as HTMLInputElement;
input.addEventListener('change', async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files || files.length === 0) return;

  // 添加到上传队列
  uploader.selectFiles(Array.from(files));
  
  // 开始上传
  await uploader.startUploadAll();
});
```

---

### 3. 监听上传事件

```typescript
// 监听秒传成功
uploader.on('success', (file) => {
  console.log('✅ 文件上传成功:', {
    fileName: file.fileName,
    fileId: file.fileId,
    response: file.response,
  });
});

// 监听上传进度
uploader.on('progress', (file) => {
  console.log('📊 上传进度:', {
    fileName: file.fileName,
    percent: file.percent,
    status: file.status,
  });
});

// 监听错误
uploader.on('error', (file, error) => {
  console.error('❌ 上传失败:', {
    fileName: file.fileName,
    error: error.message,
  });
});
```

---

## 🔧 后端实现（Node.js 示例）

### 1. 秒传检查接口

```javascript
const fs = require('fs');
const path = require('path');

// 秒传检查接口
app.post('/api/check-file', async (req, res) => {
  const { fileHash, fileName } = req.body;
  
  // 检查秒传记录文件
  const hashRecordPath = path.join(__dirname, 'uploads', `hash_${fileHash}.json`);
  
  if (fs.existsSync(hashRecordPath)) {
    // ✅ 文件已存在，秒传成功
    const record = JSON.parse(fs.readFileSync(hashRecordPath, 'utf-8'));
    
    res.json({
      success: true,
      exists: true,
      uploadId: record.uploadId,
      fileName: record.fileName,
      fileSize: record.fileSize,
      url: record.url,
      uploadedAt: record.uploadedAt,
    });
  } else {
    // ❌ 文件不存在
    res.json({
      success: true,
      exists: false,
    });
  }
});
```

---

### 2. 获取已上传分片接口

```javascript
// 获取已上传分片接口
app.get('/api/get-uploaded-chunks', async (req, res) => {
  const { fileHash } = req.query;
  
  // 读取任务记录
  const taskPath = path.join(__dirname, 'uploads', 'tasks', `${fileHash}.json`);
  
  if (fs.existsSync(taskPath)) {
    const task = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
    
    // 提取已上传的分片索引
    const uploadedChunks = task.chunks
      .filter(chunk => chunk.uploaded)
      .map(chunk => chunk.index);
    
    res.json({
      success: true,
      fileHash,
      fileName: task.filename,
      totalChunks: task.totalChunks,
      uploadedChunks,
      chunkSize: task.chunkSize,
      fileSize: task.size,
    });
  } else {
    res.json({
      success: true,
      fileHash,
      uploadedChunks: [],
    });
  }
});
```

---

### 3. 创建上传任务接口

```javascript
// 创建上传任务接口
app.post('/api/create-upload-task', async (req, res) => {
  const { fileHash, fileName, fileSize, totalChunks, chunkSize } = req.body;
  
  // 创建任务记录
  const task = {
    id: fileHash,
    filename: fileName,
    size: fileSize,
    chunkSize,
    totalChunks,
    chunks: Array.from({ length: totalChunks }, (_, i) => ({
      index: i,
      uploaded: false,
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  
  // 保存任务记录
  const taskPath = path.join(__dirname, 'uploads', 'tasks', `${fileHash}.json`);
  fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
  
  res.json({
    success: true,
    uploadId: fileHash,
    ...task,
  });
});
```

---

### 4. 合并分片时创建秒传记录

```javascript
// 合并分片接口
app.post('/api/merge-chunks', async (req, res) => {
  const { fileName, totalChunks, originalName, fileHash } = req.body;
  
  try {
    // ... 合并分片逻辑 ...
    
    // ✅ 合并成功后，创建秒传记录
    const hashRecord = {
      uploadId: fileHash,
      fileName: originalName || fileName,
      fileSize: /* 文件大小 */,
      fileHash,
      url: `/uploads/${fileName}`,
      uploadedAt: Date.now(),
    };
    
    const hashRecordPath = path.join(__dirname, 'uploads', `hash_${fileHash}.json`);
    fs.writeFileSync(hashRecordPath, JSON.stringify(hashRecord, null, 2));
    
    // 清理任务记录和分片文件
    // ...
    
    res.json({
      success: true,
      message: '文件合并成功',
      data: {
        filename: fileName,
        url: `/uploads/${fileName}`,
        fileHash,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
```

---

## 📊 工作流程图

```
用户选择文件
    ↓
前端计算 MD5 → fileHash
    ↓
调用 onInit(file, totalChunks, fileHash)
    ↓
服务端检查 fileHash 是否存在
    ↓
┌─────────────┬──────────────┬──────────────┐
│  文件已存在  │ 部分分片存在  │  文件不存在   │
│  (秒传)     │ (断点续传)    │ (首次上传)    │
└─────────────┴──────────────┴──────────────┘
    ↓              ↓               ↓
返回所有分片   返回已上传分片   返回空列表
    ↓              ↓               ↓
前端跳过上传   跳过已上传分片   上传所有分片
    ↓              ↓               ↓
直接触发成功   继续上传剩余    正常上传流程
    ↓              ↓               ↓
  完成 ✅       完成 ✅         完成 ✅
```

---

## 🎯 关键要点

### 1. 秒传判断条件

```typescript
// ChunkManager 内部判断逻辑
if (
  initResult.uploadedChunks &&
  Array.isArray(initResult.uploadedChunks) &&
  initResult.uploadedChunks.length === this.totalChunks
) {
  // ✅ 秒传成功！
  // 标记所有分片为已上传
  for (let i = 0; i < this.totalChunks; i++) {
    this.uploadedChunks[i] = true;
    this.countedChunks.add(i);
  }
  this.completedChunks = this.totalChunks;
  this.totalUploadedSize = this.uploadFile.File.size;
  
  return; // 直接返回，跳过上传
}
```

---

### 2. 三种场景对比

| 场景 | uploadedChunks 长度 | 前端行为 | 用户体验 |
|------|-------------------|---------|---------|
| **秒传** | `=== totalChunks` | 跳过上传，直接成功 | ⚡ 瞬间完成 |
| **断点续传** | `> 0 && < totalChunks` | 只上传未完成的分片 | 🔄 从断点继续 |
| **首次上传** | `=== 0` 或 `undefined` | 上传所有分片 | 📤 正常上传 |

---

### 3. 性能优化建议

#### **前端优化**
- ✅ 使用 Web Worker 计算 MD5，避免阻塞主线程
- ✅ 缓存文件 MD5，相同文件无需重复计算
- ✅ 显示"秒传中..."提示，提升用户体验

#### **后端优化**
- ✅ 使用 Redis 缓存文件哈希映射，加速查询
- ✅ 定期清理过期的任务记录
- ✅ 使用数据库索引优化 fileHash 查询

---

## 🧪 测试场景

### 测试 1：首次上传

```typescript
// 第一次上传文件 A.mp4
uploader.selectFiles([fileA]);
await uploader.startUploadAll();
// 结果：正常上传，耗时取决于文件大小和网络速度
```

---

### 测试 2：秒传

```typescript
// 第二次上传相同的文件 A.mp4
uploader.selectFiles([fileA]);
await uploader.startUploadAll();
// 结果：✅ 秒传成功，几乎瞬间完成（< 100ms）
```

---

### 测试 3：断点续传

```typescript
// 上传过程中中断
uploader.selectFiles([fileB]);
await uploader.startUploadAll();
// 上传到 50% 时中断...

// 重新上传相同的文件 B.mp4
uploader.selectFiles([fileB]);
await uploader.startUploadAll();
// 结果：🔄 从 50% 继续上传，跳过已完成的分片
```

---

## 📝 注意事项

1. **MD5 计算性能**
   - 大文件计算 MD5 可能耗时较长（几秒到几十秒）
   - 建议显示进度条，告知用户正在计算指纹

2. **服务端存储**
   - 秒传记录需要持久化存储（文件系统或数据库）
   - 定期清理过期的任务和秒传记录

3. **安全性**
   - MD5 可能存在碰撞风险，生产环境建议使用 SHA-256
   - 验证文件大小和哈希值的一致性

4. **兼容性**
   - 如果未配置 `onInit` 回调，降级到本地 IndexedDB 存储
   - 本地模式不支持秒传，仅支持断点续传

---

## 🎉 总结

通过配置 `onInit` 回调，你可以轻松实现：

- ✅ **秒传**：相同文件无需重复上传
- ✅ **断点续传**：上传中断后可从断点继续
- ✅ **进度恢复**：刷新页面后自动恢复上传进度
- ✅ **用户体验**：大幅提升大文件上传体验

现在你的文件上传系统已经具备了企业级的秒传和断点续传能力！🚀
