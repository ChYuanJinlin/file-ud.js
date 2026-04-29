# setFiles 方法 - 文件回显功能

## 📖 功能说明

`setFiles` 方法允许你手动设置上传器的文件列表，用于**回显已上传的文件**。这在以下场景非常有用：

- ✅ **编辑页面**：用户打开编辑页面时，显示之前上传的文件
- ✅ **页面刷新**：从 localStorage 或 IndexedDB 恢复上传状态
- ✅ **服务端同步**：从服务端获取文件列表并显示
- ✅ **批量导入**：从其他系统导入文件列表

---

## 🚀 基本用法

### 1. 简单回显

```typescript
import { FileUD } from '@file-ud.js/core';

const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload'
});

// 回显文件列表
uploader.setFiles([
  {
    fileId: "file_001",
    fileName: "photo.jpg",
    File: new File([], "photo.jpg"), // 需要创建 File 对象
    url: "https://example.com/photo.jpg",
    percent: 100,
    status: "success",
    formatSize: "2.35 MB"
  }
]);
```

### 2. 从服务端加载

```typescript
// 从 API 获取已保存的文件
async function loadSavedFiles() {
  const response = await fetch('/api/user/files');
  const files = await response.json();
  
  // 转换为 UploadFile 格式
  const uploadFiles = files.map(file => ({
    fileId: file.id,
    fileName: file.name,
    File: new File([], file.name), // 注意：这里只是占位
    url: file.url,
    percent: 100,
    status: "success" as const,
    formatSize: formatFileSize(file.size),
    extension: getFileExtension(file.name)
  }));
  
  uploader.setFiles(uploadFiles);
}
```

### 3. 从 localStorage 恢复

```typescript
// 保存文件列表
function saveFilesToStorage() {
  const filesData = uploader.files.map(file => ({
    fileId: file.fileId,
    fileName: file.fileName,
    url: file.url,
    percent: file.percent,
    status: file.status,
    formatSize: file.formatSize
  }));
  
  localStorage.setItem('uploadFiles', JSON.stringify(filesData));
}

// 恢复文件列表
function restoreFilesFromStorage() {
  const saved = localStorage.getItem('uploadFiles');
  if (!saved) return;
  
  const filesData = JSON.parse(saved);
  
  // 注意：需要重新创建 File 对象
  const uploadFiles = filesData.map(data => ({
    ...data,
    File: new File([], data.fileName) // 占位文件
  }));
  
  uploader.setFiles(uploadFiles);
}
```

---

## ⚙️ 参数说明

### 方法签名

```typescript
public setFiles(files: Partial<UploadFile>[]): void
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `files` | `Partial<UploadFile>[]` | ✅ | 要回显的文件列表数组 |

### 文件对象字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fileId` | `string` | ✅ | 文件唯一标识 |
| `fileName` | `string` | ✅ | 文件名 |
| `File` | `File` | ✅ | File 对象（可以是占位） |
| `url` | `string` | ❌ | 文件访问 URL |
| `percent` | `number` | ❌ | 上传进度（0-100），默认 0 |
| `status` | `"pending" \| "uploading" \| "success" \| "fail" \| "cancelled"` | ❌ | 文件状态，默认 "pending" |
| `formatSize` | `string` | ❌ | 格式化后的文件大小，如 "2.35 MB" |
| `extension` | `string` | ❌ | 文件扩展名，如 ".jpg" |
| `index` | `number` | ❌ | 文件索引，自动生成 |

---

## 💡 使用示例

### 示例 1：编辑文章时回显附件

```vue
<template>
  <div>
    <h3>文章附件</h3>
    <div v-for="file in files" :key="file.fileId">
      <a :href="file.url" target="_blank">{{ file.fileName }}</a>
      <button @click="removeFile(file)">删除</button>
    </div>
    
    <button @click="uploader.open()">添加新附件</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { FileUD } from '@file-ud.js/core';

const uploader = FileUD.createUploader("articleAttachments", {
  action: '/api/upload-article-file',
  multiple: true
});

const files = ref([]);

// 监听文件列表变化
uploader.onUpdate = (updatedFiles) => {
  files.value = updatedFiles;
};

// 加载文章时回显附件
onMounted(async () => {
  const article = await fetchArticle(articleId);
  
  // 回显已有的附件
  if (article.attachments && article.attachments.length > 0) {
    uploader.setFiles(article.attachments.map(attachment => ({
      fileId: attachment.id,
      fileName: attachment.name,
      File: new File([], attachment.name), // 占位文件
      url: attachment.url,
      percent: 100,
      status: "success" as const,
      formatSize: formatFileSize(attachment.size)
    })));
  }
});

// 删除附件
const removeFile = (file) => {
  file.remove();
};
</script>
```

---

### 示例 2：断点续传状态恢复

```typescript
// 保存上传进度
function saveUploadProgress() {
  const progress = uploader.files.map(file => ({
    fileId: file.fileId,
    fileName: file.fileName,
    File: file.File,
    url: file.url,
    percent: file.percent,
    status: file.status,
    formatSize: file.formatSize,
    chunkManager: file.chunkManager ? {
      fileHash: file.chunkManager.fileHash,
      totalChunks: file.chunkManager.totalChunks,
      uploadedChunks: file.chunkManager.uploadedChunks
    } : null
  }));
  
  localStorage.setItem('uploadProgress', JSON.stringify(progress));
}

// 恢复上传进度
function restoreUploadProgress() {
  const saved = localStorage.getItem('uploadProgress');
  if (!saved) return;
  
  const progress = JSON.parse(saved);
  
  uploader.setFiles(progress.map(p => ({
    fileId: p.fileId,
    fileName: p.fileName,
    File: p.File,
    url: p.url,
    percent: p.percent,
    status: p.status as any,
    formatSize: p.formatSize
  })));
  
  console.log('✅ 上传进度已恢复');
}
```

---

### 示例 3：批量导入文件

```typescript
// 从 CSV 文件导入文件列表
async function importFilesFromCSV(csvContent: string) {
  const rows = csvContent.split('\n').slice(1); // 跳过标题行
  
  const files = rows.map(row => {
    const [name, url, size] = row.split(',');
    
    return {
      fileId: generateId(),
      fileName: name.trim(),
      File: new File([], name.trim()),
      url: url.trim(),
      percent: 100,
      status: "success" as const,
      formatSize: size.trim()
    };
  });
  
  uploader.setFiles(files);
  console.log(`✅ 成功导入 ${files.length} 个文件`);
}
```

---

## 🔍 工作原理

### 执行流程

```
1. 调用 setFiles(files)
   ↓
2. 清空现有文件列表（调用 clearFiles）
   ↓
3. 遍历传入的文件数据
   ├─ 验证必要字段（fileId, fileName, File）
   ├─ 创建 UploadFile 实例
   └─ 添加到内部文件列表
   ↓
4. 更新全局统计信息
   ├─ 计算总字节数（totalBytes）
   ├─ 更新格式化大小（totalFormatSize）
   └─ 计算平均进度（totalPercent）
   ↓
5. 触发更新事件（triggerUpdate）
   ↓
6. UI 自动更新（响应式）
```

### 注意事项

1. **File 对象必需**：即使只是占位，也必须提供 File 对象
2. **自动清理**：调用 setFiles 会先清空现有文件
3. **状态管理**：可以设置任意状态（pending、success、fail 等）
4. **响应式更新**：通过 Vue 3 响应式系统，UI 会自动更新

---

## 🐛 常见问题

### Q1: 为什么必须提供 File 对象？

**原因**：[UploadFile](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L26-L943) 类依赖 File 对象进行后续操作（如重新上传、获取文件大小等）。

**解决方案**：
```typescript
// 方案1：使用空 File 对象作为占位
File: new File([], fileName)

// 方案2：如果可能，从服务器下载真实文件
File: await fetchFileFromServer(url)
```

---

### Q2: 如何保留现有文件并添加新文件？

**当前行为**：[setFiles](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L263-L319) 会清空现有文件。

**解决方案**：
```typescript
// 手动合并文件列表
const existingFiles = uploader.files;
const newFiles = [...existingFiles, ...filesToAdd];

uploader.setFiles(newFiles);
```

---

### Q3: 回显的文件能重新上传吗？

**可以**，但需要注意：

```typescript
// 回显已上传的文件
uploader.setFiles([{
  fileId: "file_001",
  fileName: "photo.jpg",
  File: new File([], "photo.jpg"), // ⚠️ 这是空文件
  url: "https://example.com/photo.jpg",
  percent: 100,
  status: "success"
}]);

// 如果需要重新上传，用户必须重新选择文件
// 因为占位的 File 对象没有实际内容
```

---

### Q4: 如何区分回显的文件和新上传的文件？

**方案1**：使用自定义字段
```typescript
uploader.setFiles([{
  fileId: "file_001",
  fileName: "photo.jpg",
  File: new File([], "photo.jpg"),
  status: "success",
  isRestored: true  // ✅ 自定义标记
}]);

// 在模板中区分
<div v-for="file in files" :key="file.fileId">
  <span v-if="(file as any).isRestored">📁 已存在</span>
  <span v-else>⬆️ 新上传</span>
</div>
```

**方案2**：根据状态判断
```typescript
// 回显的文件通常 status 为 "success"
// 新上传的文件 status 为 "pending" 或 "uploading"
```

---

## 📝 最佳实践

### 1. 始终验证必要字段

```typescript
function safeSetFiles(files: any[]) {
  const validFiles = files.filter(file => {
    if (!file.fileId || !file.fileName || !file.File) {
      console.warn('跳过无效文件:', file);
      return false;
    }
    return true;
  });
  
  uploader.setFiles(validFiles);
}
```

### 2. 处理异步数据

```typescript
async function loadAndDisplayFiles() {
  try {
    const response = await fetch('/api/files');
    const data = await response.json();
    
    const files = data.map(item => ({
      fileId: item.id,
      fileName: item.name,
      File: new File([], item.name),
      url: item.url,
      percent: 100,
      status: "success" as const
    }));
    
    uploader.setFiles(files);
  } catch (error) {
    console.error('加载文件失败:', error);
  }
}
```

### 3. 结合持久化存储

```typescript
// 自动保存到 localStorage
uploader.onUpdate = (files) => {
  const data = files.map(f => ({
    fileId: f.fileId,
    fileName: f.fileName,
    url: f.url,
    percent: f.percent,
    status: f.status
  }));
  
  localStorage.setItem('uploader_files', JSON.stringify(data));
};

// 页面加载时恢复
onMounted(() => {
  const saved = localStorage.getItem('uploader_files');
  if (saved) {
    const files = JSON.parse(saved).map(f => ({
      ...f,
      File: new File([], f.fileName)
    }));
    uploader.setFiles(files);
  }
});
```

---

## 🎯 应用场景总结

| 场景 | 说明 | 示例 |
|------|------|------|
| **编辑页面** | 显示已上传的附件 | 文章编辑器、表单编辑 |
| **状态恢复** | 页面刷新后恢复上传列表 | 断点续传、进度保存 |
| **数据同步** | 从服务端同步文件列表 | 多端同步、协作编辑 |
| **批量导入** | 从外部系统导入文件 | CSV 导入、API 集成 |
| **历史记录** | 显示用户上传历史 | 个人中心、文件管理 |

---

## 📚 相关 API

- [clearFiles()](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L227-L239) - 清空文件列表
- [onUpdate](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L391-L391) - 文件列表更新回调
- [files](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L48-L48) - 当前文件列表

---

## 🤝 贡献指南

如有问题或建议，欢迎提交 Issue！

**GitHub Issues**: [https://github.com/your-repo/file-ud/issues](https://github.com/your-repo/file-ud/issues)
