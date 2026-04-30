# IndexedDB 文件缓存功能 - 无感续传实现

## 🎯 功能概述

通过 IndexedDB 持久化存储 File 对象，实现**真正的无感续传**体验。用户刷新页面或关闭浏览器后，重新打开页面时自动恢复文件，无需重新选择。

---

## ✨ 核心特性

1. ✅ **自动缓存**：用户选择文件时，自动将 File 对象保存到 IndexedDB
2. ✅ **智能恢复**：回显时根据 fileHash 自动从 IndexedDB 恢复 File 对象
3. ✅ **自动清理**：上传成功后自动清理缓存，避免占用过多存储空间
4. ✅ **配置可控**：通过 `enableFileCache` 配置项控制是否启用
5. ✅ **过期清理**：支持自动清理超过指定天数的缓存
6. ✅ **智能判断**：自动检测 [chunkOptions](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L247-L247) 配置，无需手动标记是否为分片上传

---

## 📋 配置说明

### ChunkOptions 新增字段

```typescript
export interface ChunkOptions {
  // ... 原有配置
  
  // ==================== 文件缓存配置 ====================
  /* 是否启用文件缓存（将 File 对象存储到 IndexedDB，默认 false） */
  enableFileCache?: boolean;
  
  /* 缓存保留天数，超过此天数的缓存将被自动清理（默认 7 天） */
  cacheRetentionDays?: number;
}
```

---

## 💡 使用示例

### 1. 启用文件缓存

```typescript
import { FileUD } from '@file-ud.js/core';

const uploader = FileUD.createUploader("my-uploader", {
  action: '/api/upload-chunk',
  chunkOptions: {
    chunkSize: 5 * 1024 * 1024,
    
    // ✅ 启用文件缓存
    enableFileCache: true,
    
    // ✅ 设置缓存保留天数（可选，默认 7 天）
    cacheRetentionDays: 14,
  }
});
```

**关键点**：
- ✅ 系统会自动检测 [chunkOptions](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L247-L247) 是否存在
- ✅ 如果存在，自动创建 [ChunkManager](file://d:\yjl\file-UD\packages\core\src\uploader\ChunkManager.ts#L24-L1484)
- ❌ **不需要**在 [IFile](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L321-L400) 中设置 `isChunkUpload: true`

---

### 2. 首次上传（自动缓存）

```vue
<template>
  <button @click="selectFile">选择文件</button>
</template>

<script setup lang="ts">
const selectFile = () => {
  uploader.open();
};

// 用户选择文件后
uploader.onSelect = (file) => {
  console.log('✅ 文件已自动缓存到 IndexedDB');
  console.log('文件哈希:', file.chunkManager?.fileHash);
};
</script>
```

**工作流程**：
1. 用户选择文件
2. 计算文件 Hash
3. ✅ **自动将 File 对象保存到 IndexedDB**（以 fileHash 为 key）
4. 开始上传分片

---

### 3. 回显未完成文件（自动恢复）

```typescript
// 从后端获取未完成的上传任务
const tasks = await fetch('/api/upload-tasks?status=uploading').then(r => r.json());

// 转换为 IFile 格式
const filesToRestore: IFile[] = tasks.map(task => ({
  fileId: task.taskId,
  fileName: task.fileName,
  url: "",
  File: new File([], task.fileName), // ⚠️ 空 File 占位
  status: "uploading",
  
  // ✅ 关键：提供分片进度信息
  totalChunks: task.totalChunks,
  completedChunks: task.completedChunks,
  uploadedChunkIndexes: task.uploadedChunks,
  fileHash: task.fileHash, // ✅ 用于从 IndexedDB 恢复文件
  uploadId: task.uploadId,
}));

// 回显文件列表
uploader.setFiles(filesToRestore);

// ✅ 系统会自动：
// 1. 检测到 up.config.chunkOptions 存在 → 创建 ChunkManager
// 2. 检测到 file.totalChunks 存在 → 调用 initChunkManagerFromRestore()
// 3. 检测到 enableFileCache = true → 尝试从 IndexedDB 恢复 File
// 4. 根据 fileHash 查找并恢复 File 对象
// 5. 用户可以直接点击"重试"继续上传，无需重新选择文件
```

**关键改进**：
- ❌ **不需要**设置 `isChunkUpload: true`
- ✅ 系统通过检查 [chunkOptions](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L247-L247) 自动判断是否为分片上传
- ✅ 代码更简洁，减少冗余配置

---

### 4. 手动管理缓存

```typescript
import { 
  saveFileToCache,
  restoreFileFromCache,
  removeFileFromCache,
  clearAllFileCache,
  getCacheStats,
  cleanExpiredCache
} from '@file-ud.js/core/utils';

// 1. 手动保存文件到缓存
async function manualSave(file: File) {
  const hash = await calculateFileMD5(file);
  await saveFileToCache(hash, file);
  console.log('✅ 文件已手动缓存');
}

// 2. 手动恢复文件
async function manualRestore(hash: string) {
  const file = await restoreFileFromCache(hash);
  if (file) {
    console.log('✅ 成功恢复文件:', file.name);
  } else {
    console.log('❌ 未找到缓存文件');
  }
}

// 3. 手动删除缓存
async function manualRemove(hash: string) {
  await removeFileFromCache(hash);
  console.log('✅ 缓存已删除');
}

// 4. 清空所有缓存
async function clearCache() {
  await clearAllFileCache();
  console.log('✅ 所有缓存已清空');
}

// 5. 查看缓存统计
async function showStats() {
  const stats = await getCacheStats();
  console.log(`缓存文件数: ${stats.count}`);
  console.log(`总大小: ${formatFileSize(stats.totalSize)}`);
}

// 6. 清理过期缓存
async function cleanOldCache() {
  const deletedCount = await cleanExpiredCache(7); // 清理 7 天前的缓存
  console.log(`已清理 ${deletedCount} 个过期缓存`);
}
```

---

## 🔍 工作原理

### 完整流程图

```
用户选择文件
  ↓
计算文件 Hash
  ↓
✅ 自动调用 saveFileToCache(hash, file)
  ↓
将 File 转换为 ArrayBuffer
  ↓
保存到 IndexedDB（key = fileHash）
  ↓
开始上传分片...
  ↓
上传完成
  ↓
✅ 自动调用 removeFileFromCache(hash)
  ↓
清理缓存，释放存储空间
```

---

### 回显恢复流程

```
后端返回未完成的任务列表
  ↓
前端调用 setFiles(filesToRestore)
  ↓
遍历每个文件，创建 UploadFile 实例
  ↓
检测：up.config?.chunkOptions 是否存在？
  ↓
✅ 是 → 创建 ChunkManager
  ↓
检测：file.totalChunks !== undefined？
  ↓
✅ 是 → 调用 initChunkManagerFromRestore()
  ↓
初始化分片状态（totalChunks、completedChunks等）
  ↓
检测：enableFileCache = true && File.size === 0？
  ↓
✅ 是 → 调用 restoreFileFromCache(fileHash)
  ↓
从 IndexedDB 读取 ArrayBuffer
  ↓
转换回 File 对象
  ↓
验证文件名和大小
  ↓
✅ 替换空 File 对象
  ↓
用户点击"重试"
  ↓
直接继续上传，无需重新选择文件 ✅
```

---

## 📊 API 参考

### saveFileToCache

```typescript
/**
 * 保存 File 对象到 IndexedDB
 * 
 * @param fileHash - 文件哈希值（作为主键）
 * @param file - File 对象
 * @returns Promise<void>
 */
export async function saveFileToCache(fileHash: string, file: File): Promise<void>
```

---

### restoreFileFromCache

```typescript
/**
 * 从 IndexedDB 恢复 File 对象
 * 
 * @param fileHash - 文件哈希值
 * @returns Promise<File | null> - 如果找到则返回 File 对象，否则返回 null
 */
export async function restoreFileFromCache(fileHash: string): Promise<File | null>
```

---

### removeFileFromCache

```typescript
/**
 * 删除指定文件的缓存
 * 
 * @param fileHash - 文件哈希值
 * @returns Promise<void>
 */
export async function removeFileFromCache(fileHash: string): Promise<void>
```

---

### clearAllFileCache

```typescript
/**
 * 清空所有文件缓存
 * 
 * @returns Promise<void>
 */
export async function clearAllFileCache(): Promise<void>
```

---

### getCacheStats

```typescript
/**
 * 获取缓存统计信息
 * 
 * @returns Promise<{ count: number; totalSize: number }>
 */
export async function getCacheStats(): Promise<{ 
  count: number;      // 缓存文件数量
  totalSize: number;  // 总大小（字节）
}>
```

---

### cleanExpiredCache

```typescript
/**
 * 清理过期缓存（超过指定天数的缓存）
 * 
 * @param days - 保留天数，默认 7 天
 * @returns Promise<number> - 删除的记录数
 */
export async function cleanExpiredCache(days: number = 7): Promise<number>
```

---

## 🐛 常见问题

### Q1: 为什么移除了 isChunkUpload 字段？

**答**：因为这是一个**冗余字段**。

**原因**：
1. ✅ 系统已经通过 [chunkOptions](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L247-L247) 配置判断是否为分片上传
2. ✅ 如果配置了 [chunkOptions](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L247-L247)，系统会自动创建 [ChunkManager](file://d:\yjl\file-UD\packages\core\src\uploader\ChunkManager.ts#L24-L1484)
3. ❌ 在 [IFile](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L321-L400) 中重复声明会导致配置不一致的风险

**改进前**：
```typescript
// ❌ 需要同时配置两处
const uploader = FileUD.createUploader("test", {
  chunkOptions: { chunkSize: 5 * 1024 * 1024 }
});

uploader.addFile({
  isChunkUpload: true, // ❌ 冗余配置
  totalChunks: 20,
  // ...
});
```

**改进后**：
```typescript
// ✅ 只需配置一次
const uploader = FileUD.createUploader("test", {
  chunkOptions: { chunkSize: 5 * 1024 * 1024 }
});

uploader.addFile({
  // ❌ 不需要 isChunkUpload
  totalChunks: 20, // ✅ 系统自动识别为分片上传
  // ...
});
```

---

### Q2: 缓存会占用多少存储空间？

**答**：取决于用户上传的文件大小和数量。

**示例**：
- 10 个 100MB 的文件 = 1GB
- 建议定期调用 `cleanExpiredCache()` 清理过期缓存
- 上传成功后会自动清理，不会长期占用

---

### Q3: 如果 IndexedDB 满了怎么办？

**答**：IndexedDB 有存储配额限制（通常是磁盘空间的 50%）。

**处理策略**：
1. 捕获错误并降级到"重新选择文件"模式
2. 提示用户清理浏览器数据
3. 自动清理过期缓存释放空间

```typescript
try {
  await saveFileToCache(hash, file);
} catch (error) {
  if (error.name === 'QuotaExceededError') {
    console.warn('IndexedDB 存储空间不足，跳过缓存');
    // 降级：不清空 File 对象，但标记需要重新选择
  }
}
```

---

### Q4: 缓存的文件安全吗？

**答**：是的，非常安全。

**安全措施**：
1. ✅ IndexedDB 是浏览器本地存储，外部无法访问
2. ✅ 每个域名有独立的存储空间，跨域隔离
3. ✅ 用户清除浏览器数据时会一并清除
4. ✅ 上传成功后自动清理，不留痕迹

---

### Q5: 如何禁用文件缓存？

**答**：设置 `enableFileCache: false` 或不设置该配置项（默认为 false）。

```typescript
const uploader = FileUD.createUploader("test", {
  action: '/api/upload',
  chunkOptions: {
    enableFileCache: false, // ❌ 禁用缓存
  }
});
```

---

### Q6: 缓存的文件会在什么时候被清理？

**答**：有三种清理时机：

1. ✅ **上传成功后**：自动清理（推荐）
2. ✅ **定期清理**：调用 `cleanExpiredCache(days)` 清理过期缓存
3. ✅ **手动清理**：调用 `removeFileFromCache(hash)` 或 `clearAllFileCache()`

---

### Q6: 如果用户选择了错误的文件怎么办？

**答**：[reselectAndContinue()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L1077-L1170) 方法会验证文件名和大小：

```typescript
try {
  await file.reselectAndContinue(wrongFile);
} catch (error) {
  if (error.code === ErrorCode.FILE_NAME_MISMATCH) {
    alert('请选择正确的文件：' + task.fileName);
  }
}
```

如果启用了缓存，系统会优先使用缓存的文件，避免用户重新选择。

---

## 🎯 最佳实践

### 1. 根据文件大小决定是否启用缓存

```typescript
const uploader = FileUD.createUploader("smart-cache", {
  action: '/api/upload',
  chunkOptions: {
    // 只对大文件启用缓存（> 10MB）
    enableFileCache: true,
  }
});

// 在 onSelect 中判断
uploader.onSelect = (file) => {
  if (file.File.size < 10 * 1024 * 1024) {
    // 小文件不缓存
    file.chunkManager.config.enableFileCache = false;
  }
};
```

---

### 2. 定期清理过期缓存

```typescript
// 每天凌晨清理 7 天前的缓存
setInterval(async () => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    const deletedCount = await cleanExpiredCache(7);
    console.log(`已清理 ${deletedCount} 个过期缓存`);
  }
}, 60 * 60 * 1000); // 每小时检查一次
```

---

### 3. 监控缓存使用情况

```typescript
// 定期上报缓存统计
async function reportCacheStats() {
  const stats = await getCacheStats();
  
  // 发送到监控系统
  await fetch('/api/metrics/cache', {
    method: 'POST',
    body: JSON.stringify({
      cacheCount: stats.count,
      cacheSize: stats.totalSize,
      timestamp: Date.now(),
    }),
  });
}

// 每小时上报一次
setInterval(reportCacheStats, 60 * 60 * 1000);
```

---

### 4. 提供用户清理入口

```vue
<template>
  <div class="cache-manager">
    <h3>缓存管理</h3>
    <p>缓存文件数: {{ stats.count }}</p>
    <p>总大小: {{ formatFileSize(stats.totalSize) }}</p>
    
    <button @click="handleCleanCache">清理过期缓存</button>
    <button @click="handleClearAll">清空所有缓存</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getCacheStats, cleanExpiredCache, clearAllFileCache } from '@file-ud.js/core/utils';

const stats = ref({ count: 0, totalSize: 0 });

onMounted(async () => {
  stats.value = await getCacheStats();
});

const handleCleanCache = async () => {
  const deletedCount = await cleanExpiredCache(7);
  alert(`已清理 ${deletedCount} 个过期缓存`);
  stats.value = await getCacheStats();
};

const handleClearAll = async () => {
  if (confirm('确定要清空所有缓存吗？')) {
    await clearAllFileCache();
    alert('已清空所有缓存');
    stats.value = await getCacheStats();
  }
};
</script>
```

---

## 📝 总结

### 优势

- ✅ **无感续传**：用户刷新页面后无需重新选择文件
- ✅ **自动管理**：上传成功后自动清理，无需手动干预
- ✅ **配置灵活**：可根据需求启用/禁用
- ✅ **安全可靠**：浏览器本地存储，跨域隔离
- ✅ **智能判断**：自动检测 [chunkOptions](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L247-L247)，无需冗余配置

### 适用场景

- ✅ 大文件上传（> 100MB）
- ✅ 网络不稳定环境
- ✅ 需要长时间暂停/恢复的场景
- ✅ 对用户体验要求极高的产品

### 注意事项

- ⚠️ 会占用本地存储空间，需定期清理
- ⚠️ 仅适用于现代浏览器（支持 IndexedDB）
- ⚠️ 移动端存储空间有限，谨慎使用

---

## 🤝 相关 API

- [saveFileToCache()](file://d:\yjl\file-UD\packages\core\src\utils\fileCache.ts#L58-L96) - 保存文件到缓存
- [restoreFileFromCache()](file://d:\yjl\file-UD\packages\core\src\utils\fileCache.ts#L103-L143) - 从缓存恢复文件
- [removeFileFromCache()](file://d:\yjl\file-UD\packages\core\src\utils\fileCache.ts#L150-L173) - 删除指定缓存
- [clearAllFileCache()](file://d:\yjl\file-UD\packages\core\src\utils\fileCache.ts#L180-L201) - 清空所有缓存
- [getCacheStats()](file://d:\yjl\file-UD\packages\core\src\utils\fileCache.ts#L208-L232) - 获取缓存统计
- [cleanExpiredCache()](file://d:\yjl\file-UD\packages\core\src\utils\fileCache.ts#L239-L291) - 清理过期缓存

---

现在你可以实现真正的**无感续传**功能了！🎉
