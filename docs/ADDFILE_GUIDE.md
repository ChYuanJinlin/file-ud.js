# addFile 方法 - 添加单个文件

## 📖 功能说明

`addFile` 方法用于**添加单个文件**到上传器。与 [addFiles](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L417-L430)（数组）不同，这个方法接受**单个文件对象**作为参数，使用更便捷。

### 核心特性

- ✅ **单文件操作**：直接传入单个文件对象，无需包装成数组
- ✅ **灵活模式**：支持追加模式（默认）和清空模式
- ✅ **类型安全**：完整的 TypeScript 类型定义
- ✅ **自动去重**：检测重复的 fileId，避免重复添加
- ✅ **响应式更新**：UI 自动刷新显示

---

## 🚀 基本用法

### 1. 追加单个文件（默认）

```typescript
import { FileUD } from '@file-ud.js/core';

const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload'
});

// 添加单个文件（追加到现有列表）
uploader.addFile({
  fileId: "file_001",
  fileName: "photo.jpg",
  File: new File([], "photo.jpg"),
  url: "",
  percent: 0,
  status: "pending"
});
```

### 2. 清空后添加单个文件

```typescript
// 清空现有文件，然后添加新文件
uploader.addFile(
  {
    fileId: "file_002",
    fileName: "document.pdf",
    File: new File([], "document.pdf"),
    url: "",
    percent: 100,
    status: "success"
  },
  { clear: true }
);
```

### 3. 从原生 File 对象快速添加

```typescript
// HTML 文件输入框
<input type="file" @change="handleFileSelect" />

<script setup>
const handleFileSelect = (event) => {
  const nativeFile = event.target.files[0];
  
  if (nativeFile) {
    uploader.addFile({
      fileId: generateUniqueId(),
      fileName: nativeFile.name,
      File: nativeFile, // 直接使用原生 File 对象
      url: "",
      percent: 0,
      status: "pending"
    });
  }
};
</script>
```

---

## ⚙️ 参数说明

### 方法签名

```typescript
public addFile(
  file: Partial<UploadFile>,
  options?: { clear?: boolean }
): void
```

### 参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `file` | `Partial<UploadFile>` | ✅ | - | 要添加的单个文件对象 |
| `options.clear` | `boolean` | ❌ | `false` | 是否清空现有文件 |

### 文件对象字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fileId` | `string` | ✅ | 文件唯一标识 |
| `fileName` | `string` | ✅ | 文件名 |
| `File` | `File` | ✅ | File 对象 |
| `url` | `string` | ❌ | 文件访问 URL |
| `percent` | `number` | ❌ | 上传进度（0-100），默认 0 |
| `status` | `"pending" \| "UDLoading" \| "success" \| "fail" \| "cancelled"` | ❌ | 文件状态，默认 "pending" |
| `formatSize` | `string` | ❌ | 格式化后的文件大小 |
| `extension` | `string` | ❌ | 文件扩展名 |

---

## 💡 使用示例

### 示例 1：拖拽上传单个文件

```vue
<template>
  <div 
    class="drop-zone"
    @dragover.prevent
    @drop="handleDrop"
  >
    拖拽文件到此处
  </div>
</template>

<script setup lang="ts">
import { FileUD } from '@file-ud.js/core';

const uploader = FileUD.createUploader("dropzone", {
  action: '/api/upload'
});

const handleDrop = (event: DragEvent) => {
  event.preventDefault();
  
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  
  // 只处理第一个文件
  const file = files[0];
  
  uploader.addFile({
    fileId: generateId(),
    fileName: file.name,
    File: file,
    url: "",
    percent: 0,
    status: "pending"
  });
};
</script>
```

---

### 示例 2：粘贴上传图片

```vue
<template>
  <div 
    tabindex="0"
    @paste="handlePaste"
    class="paste-area"
  >
    在此处粘贴图片
  </div>
</template>

<script setup lang="ts">
const handlePaste = (event: ClipboardEvent) => {
  const items = event.clipboardData?.items;
  if (!items) return;
  
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      const file = items[i].getAsFile();
      
      if (file) {
        uploader.addFile({
          fileId: `pasted_${Date.now()}`,
          fileName: `pasted-image-${Date.now()}.png`,
          File: file,
          url: "",
          percent: 0,
          status: "pending"
        });
        
        break; // 只处理第一张图片
      }
    }
  }
};
</script>
```

---

### 示例 3：条件性添加文件

```typescript
// 根据文件大小决定是否添加
const handleFileSelect = (nativeFile: File) => {
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (nativeFile.size > maxSize) {
    alert(`文件太大，最大支持 ${formatFileSize(maxSize)}`);
    return;
  }
  
  uploader.addFile({
    fileId: generateId(),
    fileName: nativeFile.name,
    File: nativeFile,
    url: "",
    percent: 0,
    status: "pending"
  });
};
```

---

### 示例 4：批量选择但逐个添加

```typescript
// 用户选择多个文件，但逐个添加并验证
const handleMultipleSelect = async (nativeFiles: File[]) => {
  for (const file of nativeFiles) {
    // 对每个文件进行单独验证
    const isValid = await validateFile(file);
    
    if (isValid) {
      uploader.addFile({
        fileId: generateId(),
        fileName: file.name,
        File: file,
        url: "",
        percent: 0,
        status: "pending"
      });
    } else {
      console.warn(`跳过无效文件: ${file.name}`);
    }
  }
};
```

---

## 🔍 与相关方法对比

| 方法 | 参数类型 | 是否清空 | 适用场景 |
|------|---------|---------|---------|
| **[addFile](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L458-L497)** | 单个对象 | 可选 | 添加单个文件 |
| **[addFiles](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L417-L430)** | 数组 | 可选 | 批量添加文件 |
| **[appendFiles](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L347-L415)** | 数组 | 否 | 追加多个文件 |
| **[setFiles](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L263-L308)** | 数组 | 是 | 回显文件列表 |

### 等价关系

```typescript
// 以下两种写法等价
uploader.addFile(file);
uploader.appendFiles([file]);

// 以下两种写法等价
uploader.addFile(file, { clear: true });
uploader.setFiles([file]);
```

---

## 🐛 常见问题

### Q1: 如何生成唯一的 fileId？

**方案1**：使用时间戳
```typescript
fileId: `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
```

**方案2**：使用 UUID 库
```typescript
import { v4 as uuidv4 } from 'uuid';

fileId: uuidv4()
```

**方案3**：基于文件内容 Hash
```typescript
import SparkMD5 from 'spark-md5';

async function getFileId(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = SparkMD5.ArrayBuffer.hash(buffer);
  return `file_${hash}`;
}
```

---

### Q2: 添加的文件会立即开始上传吗？

**取决于配置**：

```typescript
// 情况1：autoUpload: true（默认）
const uploader = FileUD.createUploader("test", {
  action: '/api/upload',
  autoUpload: true  // ✅ 添加后立即开始上传
});

uploader.addFile(fileData); // 立即上传

// 情况2：autoUpload: false
const uploader = FileUD.createUploader("test", {
  action: '/api/upload',
  autoUpload: false  // ❌ 需要手动触发
});

uploader.addFile(fileData); // 仅添加到列表
uploader.upload();           // 手动开始上传
```

---

### Q3: 如何防止重复添加相同文件？

**方法1**：检查 fileId
```typescript
const isDuplicate = uploader.files.some(f => f.fileId === newFileId);

if (!isDuplicate) {
  uploader.addFile(fileData);
}
```

**方法2**：检查文件名和大小
```typescript
const isDuplicate = uploader.files.some(f => 
  f.fileName === newFile.name && f.File.size === newFile.size
);

if (!isDuplicate) {
  uploader.addFile({
    fileId: generateId(),
    fileName: newFile.name,
    File: newFile,
    // ...
  });
}
```

---

### Q4: 添加失败的文件如何处理？

```typescript
try {
  uploader.addFile(fileData);
} catch (error) {
  console.error('添加文件失败:', error);
  
  // 显示错误提示
  showToast('文件添加失败，请重试');
}
```

---

## 📝 最佳实践

### 1. 始终验证必要字段

```typescript
function safeAddFile(fileData: Partial<UploadFile>) {
  if (!fileData.fileId || !fileData.fileName || !fileData.File) {
    console.error('缺少必要字段');
    return;
  }
  
  uploader.addFile(fileData);
}
```

### 2. 处理异步操作

```typescript
async function addFileWithPreview(nativeFile: File) {
  // 生成预览 URL
  const previewUrl = URL.createObjectURL(nativeFile);
  
  uploader.addFile({
    fileId: generateId(),
    fileName: nativeFile.name,
    File: nativeFile,
    url: previewUrl, // 设置预览 URL
    percent: 0,
    status: "pending"
  });
}
```

### 3. 结合插件使用

```typescript
import { FileValidatorPlugin } from '@file-ud.js/plugins';

// 先添加验证插件
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,
  accept: ['image/*']
}));

// 然后添加文件（会自动验证）
uploader.addFile({
  fileId: generateId(),
  fileName: "photo.jpg",
  File: photoFile
});
```

---

## 🎯 应用场景总结

| 场景 | 说明 | 示例 |
|------|------|------|
| **拖拽上传** | 用户拖拽单个文件 | 拖拽区域组件 |
| **粘贴上传** | 从剪贴板粘贴图片 | 富文本编辑器 |
| **扫码上传** | 扫描二维码获取文件信息 | 移动端应用 |
| **API 同步** | 从服务端获取单个文件 | 文件分享链接 |
| **快速添加** | 简化单文件操作流程 | 头像上传 |

---

## 📚 相关 API

- [addFiles()](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L417-L430) - 批量添加文件
- [appendFiles()](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L347-L415) - 追加文件列表
- [setFiles()](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L263-L308) - 设置文件列表（清空后）
- [files](file://d:\yjl\file-UD\packages\core\src\uploader\index.ts#L48-L48) - 当前文件列表

---

## 🤝 贡献指南

如有问题或建议，欢迎提交 Issue！

**GitHub Issues**: [https://github.com/your-repo/file-ud/issues](https://github.com/your-repo/file-ud/issues)
