# Uploader 使用指南

## 简介

`Uploader` 是 `file-UD` 库中的文件上传模块，支持文件选择、表单校验、分片并发上传、断点续传、秒传（instant upload）、速率统计、进度跟踪等功能。

## 快速开始

### 1. 基础用法

```typescript
import { FileUD } from "@file-ud.js/core";

// 创建上传器实例
const uploader = FileUD.createUploader("myUploader", {
  action: "/api/upload",
  multiple: true,       // 支持多选
  autoUpload: true,     // 选择后自动开始上传
  accept: ["image/*", ".pdf"],
  maxSize: 10 * 1024 * 1024,   // 最大 10MB
  limit: 5,                     // 最多 5 个文件
});

// 设置成功回调
uploader.onSuccess = (response, file) => {
  console.log(`上传成功: ${file.fileName}`, response);
};

// 设置更新回调（所有文件列表变化时触发）
uploader.onUpdate = (files) => {
  files.forEach((file) => {
    console.log(`${file.fileName}: ${file.percent}%`);
  });
};

// 打开文件选择器
uploader.open();
```

### 单文件覆盖上传（头像 / Logo / 封面）

`multiple: false` 是单文件覆盖模式。头像、标签 Logo、封面图这类场景重新选择文件后，会自动用新文件替换当前文件；只有 `multiple: true` 时才会追加为文件列表。

```typescript
const logoUploader = FileUD.createUploader("tagLogoUploader", {
  action: "/api/upload-logo",
  multiple: false,
  accept: ["image/*"],
});

logoUploader.onUpdate = () => {
  console.log("上传中:", logoUploader.loading);
  console.log("总进度:", logoUploader.totalPercent);
};

logoUploader.open((file) => {
  console.log("当前文件:", file.fileName);
  console.log("本地预览地址:", file.url);
});
```

`open(fn)` 中的 `file.url` 是本地预览地址，小文件通常是 base64，大文件可能是 Object URL。它只适合前端预览；上传成功后的正式文件地址应从 `onSuccess(response)` 的服务端响应中读取。

Vue 3 中建议在组件挂载后创建一次上传器，卸载时销毁：

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { FileUD, type Uploader } from "@file-ud.js/core";

const uploaderRef = ref<Uploader | null>(null);
const percent = ref(0);
const loading = ref(false);
const fileName = ref("");
const previewUrl = ref("");
const serverUrl = ref("");

onMounted(() => {
  const uploader = FileUD.createUploader("vueLogoUploader", {
    action: "/api/upload-logo",
    multiple: false,
    accept: ["image/*"],
  });

  uploader.onUpdate = () => {
    loading.value = Boolean(uploader.loading);
    percent.value = uploader.totalPercent || 0;
  };

  uploader.onSuccess = (response) => {
    serverUrl.value = response.url;
  };

  uploaderRef.value = uploader;
});

onBeforeUnmount(() => {
  FileUD.destroyUploaders("vueLogoUploader");
  uploaderRef.value = null;
});

const openLogo = () => {
  uploaderRef.value?.open((file) => {
    fileName.value = file.fileName;
    previewUrl.value = file.url;
  });
};
</script>

<template>
  <button type="button" @click="openLogo">
    {{ loading ? "上传中" : "上传 Logo" }}：{{ percent }}%
  </button>
  <span v-if="fileName">{{ fileName }}</span>
  <img v-if="previewUrl" :src="previewUrl" alt="Logo 预览" style="width: 80px; height: 80px" />
  <input v-if="serverUrl" type="hidden" name="logoUrl" :value="serverUrl" />
</template>
```

### 2. 分片上传（断点续传 + 秒传）

```typescript
const uploader = FileUD.createUploader("chunkUploader", {
  action: "/api/upload-chunk",
  chunkOptions: {
    chunkSize: 2 * 1024 * 1024,   // 2MB 分片
    maxConcurrent: 3,              // 最多 3 个并发
    retries: 3,                    // 失败重试 3 次
    timeout: 10000,                // 单分片超时
    enableFileCache: true,         // 启用 IndexedDB 缓存（断点续传用）
  },
});

// 分片初始化回调（查询服务端已存在的分片）
uploader.onInitChunk = async (uploadFile, totalChunks, fileHash) => {
  const { data } = await checkFile({ fileHash });
  return {
    fileHash: data.fileHash,
    chunks: data.chunks || [],           // 已上传的分片索引
    isInstantUpload: data.isInstant,     // 秒传标记
  };
};

// 分片合并回调
uploader.onMergeChunk = async (chunkManager) => {
  const { data } = await mergeChunks({
    fileHash: chunkManager.fileHash,
    fileName: chunkManager.uploadFile.fileName,
    totalChunks: chunkManager.totalChunks,
  });
  return data;   // 返回的数据传给 onSuccess
};
```

### 3. 手动上传模式

```typescript
const uploader = FileUD.createUploader("manualUploader", {
  action: "/api/upload",
  autoUpload: false,   // 禁用自动上传
  multiple: true,
});

uploader.open();       // 用户选择文件后不会自动开始

// 手动提交所有文件
button.onclick = async () => {
  await uploader.submit();
};

// 也可以在文件选择时拦截
uploader.onSelect = (file) => {
  // 返回 false 拒绝该文件
  return file.size < 100 * 1024 * 1024;
};
```

### 4. 自定义上传函数

```typescript
const uploader = FileUD.createUploader("customUploader", {
  action: async (formData, uploadFile) => {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      headers: {
        Authorization: "Bearer token",
      },
    });
    return await response.json();
  },
});
```

### 5. 文件操作

```typescript
// 从 uploader.files 获取文件实例
uploader.files.forEach((file) => {
  file.pause();     // 暂停（仅分片模式）
  file.resume();    // 恢复（仅分片模式）
  file.cancel();    // 取消
  file.retry();     // 重试
});
```

### 6. 批量操作

```typescript
uploader.pauseAll();    // 暂停所有
uploader.resumeAll();   // 恢复所有
uploader.cancelAll();   // 取消所有
uploader.retryAll();    // 重试所有失败/取消的任务
uploader.clearFiles();  // 清空列表
uploader.submit();      // 提交所有 pending 任务
```

### 7. 文件列表回显

```typescript
// 从服务端恢复文件列表（显示已上传的文件）
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

---

## API 参考

### UploaderConfig 配置

```typescript
interface UploaderConfig {
  /** 上传地址：字符串 URL 或函数 */
  action: string | ((formData: FormData, uploadFile: UploadFile) => any);
  /** 是否支持多选，默认 false。false 为单文件覆盖模式，true 为多文件追加列表 */
  multiple?: boolean;
  /** 接受的文件类型 */
  accept?: AcceptFileType[] | string[];
  /** 是否自动上传，默认 true */
  autoUpload?: boolean;
  /** 是否显示文件输入框，默认 false */
  show?: boolean;
  /** 挂载的元素 ID */
  elementId?: string;
  /** FormData 中文件的字段名，默认 "file" */
  file?: string | ((fileConfig: FileConfig) => void);
  /** 分片上传配置 */
  chunkOptions?: ChunkOptions | null;
  /** 文件数量限制，仅 multiple: true 时生效 */
  limit?: number;
  /** 单文件大小限制（字节） */
  maxSize?: number;
  /** 自定义请求头 */
  headers?: Record<string, any>;
  /** 最大同时传输文件数 */
  maxFileConcurrent?: number;
  /** 自定义 axios 实例 */
  axiosInstance?: AxiosInstance;
}
```

### ChunkOptions 分片配置

```typescript
interface ChunkOptions {
  /** 分片大小（字节） */
  chunkSize?: number;
  /** 分片最大并发数 */
  maxConcurrent?: number;
  /** 失败重试次数 */
  retries?: number | null;
  /** 重试延迟（毫秒） */
  retryDelay?: number;
  /** 单分片超时（毫秒） */
  timeout?: number;
  /** 是否启用 IndexedDB 缓存（断点续传用） */
  enableFileCache?: boolean;
  /** 缓存保留天数，默认 7 天 */
  cacheRetentionDays?: number;
}
```

### Uploader 方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `open(fn?)` | 打开文件选择器，`fn` 会接收当前选中的 `UploadFile` | `void` |
| `use(plugin)` | 注册插件 | `this` |
| `unuse(name)` | 移除插件 | `this` |
| `getPlugin(name?)` | 获取插件 | `IUDPlugin \| IUDPlugin[]` |
| `updateConfig(config)` | 动态更新配置 | `void` |
| `setFiles(files)` | 回显文件列表 | `void` |
| `clearFiles()` | 清空文件列表 | `void` |
| `pauseAll()` | 暂停所有进行中的上传 | `void` |
| `resumeAll()` | 恢复所有暂停的上传 | `void` |
| `cancelAll()` | 取消所有上传 | `void` |
| `retryAll()` | 重试所有失败/取消的任务 | `void` |
| `submit()` | 提交所有 pending 任务 | `Promise<void>` |

### Uploader 静态方法

| 方法 | 说明 |
|------|------|
| `Uploader.setDefaultPlugins(plugins)` | 设置全局默认插件 |

### Uploader 回调设置器

| 设置器 | 回调签名 | 说明 |
|--------|----------|------|
| `onSuccess = fn` | `(response, file) => void` | 单文件上传成功 |
| `onUpdate = fn` | `(files: UploadFile[]) => void` | 文件列表更新（进度/状态变化） |
| `onInitChunk = fn` | `(file, totalChunks, fileHash) => Promise` | 分片初始化（查已上传分片） |
| `onMergeChunk = fn` | `(chunkManager) => Promise` | 分片合并 |
| `onbeforeTransfer = fn` | `(file) => boolean \| Promise` | 上传前拦截 |
| `onSelect = fn` | `(file: File) => boolean \| Promise` | 文件选择时拦截 |

### UploadFile 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `fileId` | `string` | 文件唯一标识 |
| `fileName` | `string` | 文件名 |
| `File` | `File` | 原始 File 对象 |
| `url` | `string` | 文件预览 URL（Object URL） |
| `size` | `number` | 文件大小（字节） |
| `percent` | `number` | 上传进度 (0-100) |
| `status` | `string` | 状态：pending / UDLoading / paused / success / fail / error / cancelled |
| `speed` | `speedInfo` | 速率信息（瞬时/平均速度、预计剩余时间） |
| `formatSize` | `string` | 格式化文件大小 |
| `transferFormatSize` | `string` | 已上传大小格式化字符串 |
| `hashPercent` | `number` | MD5 计算进度 (0-100) |
| `hashLoading` | `boolean` | 是否正在计算 MD5 |

### UploadFile 方法

| 方法 | 说明 |
|------|------|
| `start(chunkManager)` | 开始上传 |
| `pause()` | 暂停上传（仅分片模式） |
| `resume()` | 恢复上传（仅分片模式） |
| `cancel()` | 取消上传 |
| `retry()` | 重试上传 |

### 事件

通过 `uploader.on(eventName, callback)` 监听：

| 事件名 | 回调参数 | 说明 |
|--------|----------|------|
| `change` | `(file: UploadFile)` | 用户选择文件 |
| `progress` | `(percent: number)` | 全局进度 |
| `pause` | `(file: UploadFile)` | 文件暂停 |
| `resume` | `(file: UploadFile)` | 文件恢复 |
| `cancel` | `(file: UploadFile)` | 文件取消 |
| `retry` | `(file: UploadFile)` | 文件重试 |
| `remove` | `(file: UploadFile)` | 文件移除 |
| `files-start` | `(files: UploadFile[])` | 批量开始 |
| `files-complete` | `(files: TransferFile[])` | 批量完成 |
| `chunk-success` | `(data: ChunkSuccessData)` | 分片上传成功 |
| `chunk-error` | `(data: ChunkErrorData)` | 分片上传失败 |
| `chunk-upload-start` | `(data: ChunkStartData)` | 分片上传开始 |
| `instant-upload` | `(data)` | 秒传成功（文件已存在） |
| `merging` | `(data)` | 分片合并中 |
| `merge-success` | `(data)` | 分片合并完成 |
| `merge-error` | `(data)` | 分片合并失败 |
| `error` | `(error: FileUDErrorJSON)` | 上传错误 |

---

## 插件系统

```typescript
const myPlugin = {
  name: "my-upload-plugin",
  version: "1.0.0",
  priority: 50,       // 数字越小越优先执行

  install: (transfer, options) => {
    console.log("插件初始化");
  },

  onFileSelect: async (file, context) => {
    console.log(`选择了文件: ${file.fileName}`);
    return file;     // 可修改 file 后返回，返回 false 拒绝
  },

  beforeTransfer: async (file, context) => {
    return true;     // 返回 false 阻止上传
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

  destroy: () => {
    console.log("插件销毁");
  },
};

uploader.use(myPlugin);
```

### 插件管理

```typescript
// 卸载当前实例中的插件，并触发插件 destroy 钩子
uploader.unuse("file-validator-plugin");

// 获取指定插件，或获取当前实例全部插件
const validatorPlugin = uploader.getPlugin("file-validator-plugin");
const plugins = uploader.getPlugin();
```

如果每个上传器都需要同一组插件，可以在创建上传器之前设置全局默认插件：

```typescript
import { Uploader } from "@file-ud.js/core";
import { FileValidatorPlugin } from "@file-ud.js/plugins/uploader";
import { SmartRetryPlugin } from "@file-ud.js/plugins/retry";

Uploader.setDefaultPlugins([
  new FileValidatorPlugin({ maxSize: 10 * 1024 * 1024 }),
  new SmartRetryPlugin({ maxRetries: 3 }),
]);

const uploader = FileUD.createUploader("myUploader", {
  action: "/api/upload",
});
```

全局默认插件只影响之后创建的实例；已经创建好的实例不会自动追加。需要清空时传入空数组：

```typescript
Uploader.setDefaultPlugins([]);
```

---

## 上传流程说明

### 普通上传流程
```
open() → 用户选择文件 → onFileSelect 钩子 → onSelect 回调
  → 校验(size/type/limit) → handleFile(生成预览URL)
  → beforeTransfer 钩子 → FormData 构建
  → XMLHttpRequest 上传 → 进度回调 → 成功 → onSuccess
```

### 分片上传流程
```
open() → 用户选择文件 → 校验 → 计算 MD5（增量哈希）
  → onInitChunk 回调（查服务端已存在分片）
  → IndexedDB 恢复（如启用 enableFileCache）
  → 秒传检查（全部已完成 → 跳过上传）
  → 并发上传缺失分片
  → 全部分片上传完成
  → onMergeChunk 回调（服务端合并分片）
  → onSuccess
```

### 文件状态流转
```
pending → UDLoading → merging → success
                   → paused → UDLoading（恢复）
                   → cancelled / fail / error → retry → UDLoading
```
