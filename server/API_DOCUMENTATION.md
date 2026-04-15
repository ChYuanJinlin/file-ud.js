# 秒传和断点续传接口使用文档

## 📋 概述

服务端已实现完整的秒传和断点续传功能，通过以下接口实现：

1. **秒传检查** (`POST /check-file`) - 检查文件是否已存在
2. **获取已上传分片** (`GET /get-uploaded-chunks`) - 断点续传时获取进度
3. **创建上传任务** (`POST /create-upload-task`) - 初始化上传任务
4. **分片上传** (`POST /upload-chunk`) - 上传单个分片
5. **合并分片** (`POST /merge-chunks`) - 合并所有分片为完整文件

---

## 🔧 接口详细说明

### 1. 秒传检查接口

**功能**：检查文件是否已存在于服务器，如果存在则直接返回文件信息（实现秒传）

**请求**：
```http
POST http://localhost:3000/check-file
Content-Type: application/json

{
  "fileHash": "abc123def456",
  "fileName": "test.mp4"
}
```

**响应（文件已存在 - 秒传成功）**：
```json
{
  "success": true,
  "message": "文件已存在，秒传成功",
  "data": {
    "exists": true,
    "fileName": "test.mp4",
    "fileSize": 10485760,
    "fileHash": "abc123def456",
    "url": "http://localhost:3000/uploads/test.mp4",
    "uploadedAt": 1712345678901
  }
}
```

**响应（文件不存在 - 需要上传）**：
```json
{
  "success": true,
  "message": "文件不存在，需要上传",
  "data": {
    "exists": false,
    "uploadedChunks": []
  }
}
```

---

### 2. 获取已上传分片列表（断点续传）

**功能**：获取指定文件已上传的分片索引数组，用于断点续传时恢复上传进度

**请求**：
```http
GET http://localhost:3000/get-uploaded-chunks?fileHash=abc123def456
```

**响应**：
```json
{
  "success": true,
  "data": {
    "fileHash": "abc123def456",
    "fileName": "test.mp4",
    "totalChunks": 100,
    "uploadedChunks": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "chunkSize": 5242880,
    "fileSize": 10485760
  }
}
```

**说明**：
- `uploadedChunks`: 已上传的分片索引数组
- 如果文件从未上传过，返回空数组 `[]`
- 前端可根据此数组跳过已上传的分片

---

### 3. 创建上传任务

**功能**：在开始上传前创建任务记录，用于断点续传时追踪进度

**请求**：
```http
POST http://localhost:3000/create-upload-task
Content-Type: application/json

{
  "fileHash": "abc123def456",
  "fileName": "test.mp4",
  "fileSize": 10485760,
  "totalChunks": 100,
  "chunkSize": 5242880
}
```

**响应**：
```json
{
  "success": true,
  "message": "上传任务创建成功",
  "data": {
    "fileHash": "abc123def456",
    "fileName": "test.mp4",
    "fileSize": 10485760,
    "totalChunks": 100,
    "chunkSize": 5242880,
    "uploadedChunks": [],
    "createdAt": 1712345678901,
    "updatedAt": 1712345678901
  }
}
```

---

### 4. 分片上传

**功能**：上传单个文件分片，支持断点续传

**请求**：
```http
POST http://localhost:3000/upload-chunk
Content-Type: multipart/form-data

FormData:
  file: <File>                    # 分片文件
  chunkIndex: 0                   # 分片索引（从0开始）
  totalChunks: 100                # 总分片数
  fileName: "test.mp4"            # 原始文件名
  fileHash: "abc123def456"        # 文件MD5哈希（用于断点续传）
```

**响应**：
```json
{
  "success": true,
  "message": "分片上传成功",
  "chunkIndex": 0
}
```

**说明**：
- 分片文件会保存为 `uploads/{fileHash}-{chunkIndex}`
- 上传成功后会自动更新任务记录中的 `uploadedChunks` 数组
- 如果 `fileHash` 为空，则使用 `fileName` 作为标识（不推荐）

---

### 5. 合并分片

**功能**：将所有分片合并为完整文件

**请求**：
```http
POST http://localhost:3000/merge-chunks
Content-Type: application/json

{
  "fileName": "test.mp4",
  "totalChunks": 100,
  "originalName": "原始文件名.mp4",
  "fileHash": "abc123def456"
}
```

**响应**：
```json
{
  "success": true,
  "message": "文件合并成功",
  "data": {
    "filename": "test.mp4",
    "path": "uploads/test.mp4",
    "url": "http://localhost:3000/uploads/test.mp4",
    "fileHash": "abc123def456"
  }
}
```

**说明**：
- 合并成功后会创建秒传记录 `uploads/hash_{fileHash}.json`
- 后续相同文件上传时可直接秒传
- 会自动删除分片文件和任务记录

---

## 🔄 完整上传流程

### 首次上传流程

```
1. 前端计算文件 MD5
   ↓
2. 调用 POST /check-file 检查文件是否存在
   ↓ (文件不存在)
3. 调用 POST /create-upload-task 创建上传任务
   ↓
4. 循环上传所有分片 POST /upload-chunk
   ↓
5. 调用 POST /merge-chunks 合并分片
   ↓
6. 上传完成，文件可访问
```

### 断点续传流程

```
1. 前端计算文件 MD5
   ↓
2. 调用 POST /check-file 检查文件是否存在
   ↓ (文件不存在)
3. 调用 GET /get-uploaded-chunks?fileHash=xxx 获取已上传分片
   ↓
4. 跳过已上传的分片，只上传未完成的分片
   ↓
5. 调用 POST /merge-chunks 合并分片
   ↓
6. 上传完成
```

### 秒传流程

```
1. 前端计算文件 MD5
   ↓
2. 调用 POST /check-file 检查文件是否存在
   ↓ (文件已存在)
3. 直接返回文件信息，无需上传
   ↓
4. 秒传完成
```

---

## 📁 文件存储结构

```
server/uploads/
├── tasks/                          # 上传任务记录目录
│   ├── abc123def456.json          # 文件哈希对应的任务记录
│   └── xyz789uvw012.json
├── hash_abc123def456.json         # 秒传记录（文件哈希 -> 文件信息）
├── hash_xyz789uvw012.json
├── abc123def456-0                 # 分片文件
├── abc123def456-1
├── abc123def456-2
├── ...
└── test.mp4                        # 合并后的完整文件
```

### 任务记录文件格式

`uploads/tasks/{fileHash}.json`:
```json
{
  "fileHash": "abc123def456",
  "fileName": "test.mp4",
  "fileSize": 10485760,
  "totalChunks": 100,
  "chunkSize": 5242880,
  "uploadedChunks": [0, 1, 2, 3, 4],
  "createdAt": 1712345678901,
  "updatedAt": 1712345678901
}
```

### 秒传记录文件格式

`uploads/hash_{fileHash}.json`:
```json
{
  "fileName": "test.mp4",
  "fileSize": 10485760,
  "fileHash": "abc123def456",
  "url": "http://localhost:3000/uploads/test.mp4",
  "uploadedAt": 1712345678901
}
```

---

## 💡 前端集成示例

### 使用 axios 调用接口

```javascript
import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

// 1. 计算文件 MD5（使用 spark-md5 或其他库）
async function calculateFileMD5(file) {
  // 实现 MD5 计算逻辑
  return 'abc123def456';
}

// 2. 检查文件是否存在（秒传）
async function checkFile(fileHash, fileName) {
  const response = await axios.post(`${BASE_URL}/check-file`, {
    fileHash,
    fileName
  });
  return response.data;
}

// 3. 获取已上传分片（断点续传）
async function getUploadedChunks(fileHash) {
  const response = await axios.get(`${BASE_URL}/get-uploaded-chunks`, {
    params: { fileHash }
  });
  return response.data.data.uploadedChunks;
}

// 4. 创建上传任务
async function createUploadTask(fileHash, fileName, fileSize, totalChunks, chunkSize) {
  const response = await axios.post(`${BASE_URL}/create-upload-task`, {
    fileHash,
    fileName,
    fileSize,
    totalChunks,
    chunkSize
  });
  return response.data;
}

// 5. 上传分片
async function uploadChunk(file, chunkIndex, totalChunks, fileName, fileHash) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('chunkIndex', chunkIndex);
  formData.append('totalChunks', totalChunks);
  formData.append('fileName', fileName);
  formData.append('fileHash', fileHash);

  const response = await axios.post(`${BASE_URL}/upload-chunk`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
}

// 6. 合并分片
async function mergeChunks(fileName, totalChunks, originalName, fileHash) {
  const response = await axios.post(`${BASE_URL}/merge-chunks`, {
    fileName,
    totalChunks,
    originalName,
    fileHash
  });
  return response.data;
}

// 完整上传流程
async function uploadFileWithResume(file) {
  const fileHash = await calculateFileMD5(file);
  
  // 步骤 1: 检查文件是否存在（秒传）
  const checkResult = await checkFile(fileHash, file.name);
  
  if (checkResult.data.exists) {
    console.log('秒传成功！', checkResult.data);
    return checkResult.data;
  }
  
  // 步骤 2: 分片
  const chunkSize = 5 * 1024 * 1024; // 5MB
  const totalChunks = Math.ceil(file.size / chunkSize);
  
  // 步骤 3: 创建上传任务
  await createUploadTask(fileHash, file.name, file.size, totalChunks, chunkSize);
  
  // 步骤 4: 获取已上传分片（断点续传）
  const uploadedChunks = await getUploadedChunks(fileHash);
  
  // 步骤 5: 上传未完成的分片
  for (let i = 0; i < totalChunks; i++) {
    if (uploadedChunks.includes(i)) {
      console.log(`分片 ${i} 已上传，跳过`);
      continue;
    }
    
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    await uploadChunk(chunk, i, totalChunks, file.name, fileHash);
    console.log(`分片 ${i} 上传完成`);
  }
  
  // 步骤 6: 合并分片
  const mergeResult = await mergeChunks(fileHash, totalChunks, file.name, fileHash);
  console.log('文件合并成功！', mergeResult);
  
  return mergeResult;
}
```

---

## 🎯 关键要点

1. **文件哈希计算**：前端需要计算文件的 MD5 哈希值，用于唯一标识文件
2. **断点续传**：通过 `fileHash` 追踪上传进度，失败后可从断点继续
3. **秒传**：相同文件（相同 MD5）无需重复上传，直接返回已有文件
4. **分片命名**：使用 `{fileHash}-{chunkIndex}` 命名分片文件，避免冲突
5. **任务记录**：上传过程中维护 `uploadedChunks` 数组，支持断点恢复
6. **清理机制**：合并成功后自动删除分片文件和任务记录

---

## 🚀 启动服务器

```bash
cd server
node main.js
```

服务器将在 `http://localhost:3000` 启动，所有接口即可使用。