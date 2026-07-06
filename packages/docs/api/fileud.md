# FileUD 主类 API

`FileUD` 是库的核心入口类，所有静态方法，负责管理 Uploader/Downloader 实例、初始化日志系统。

## 导入

```ts
import { FileUD } from "@file-ud.js/core";
```

## 内部存储

FileUD 使用两个私有 `Map` 管理所有实例，确保多例隔离：

```ts
private static uploaders: Map<string, Uploader> = new Map();
private static downloaders: Map<string, Downloader> = new Map();
```

- 每个实例通过 **唯一名称** 标识，创建时存入 Map，销毁时移除
- 通过 `getUploaders()` / `getDownloaders()` 对外暴露访问
- 同名实例重复创建会自动销毁旧实例再创建新的

---

## 静态方法

### `startUDLogger(logConfig?)`

初始化库的日志系统。

```ts
public static startUDLogger(logConfig?: LogConfig): void
```

**参数**

| 参数       | 类型        | 必填 | 说明     |
| ---------- | ----------- | ---- | -------- |
| `logConfig` | `LogConfig` | 否   | 日志配置 |

**示例**

```ts
FileUD.startUDLogger({
  enabled: true,
  level: 1,            // INFO级别，生产环境建议
  showTimestamp: true,
  enableColors: true,
});
```

> 详细配置见 [日志（Logger）文档](./logger)。

---

### `createUploader(name, config?)`

创建一个上传器实例（多例模式）。如果同名实例已存在，会先销毁旧实例。

```ts
public static createUploader<T = any>(
  name: string,
  config?: UploaderConfig,
): Uploader<T>
```

**参数**

| 参数     | 类型               | 必填 | 说明                       |
| -------- | ------------------ | ---- | -------------------------- |
| `name`   | `string`           | 是   | 上传器唯一名称             |
| `config` | `UploaderConfig`  | 否   | 上传器配置                 |

**返回值**：`Uploader<T>` 实例。

**示例**

```ts
// 创建一个基础上传器
const uploader = FileUD.createUploader("avatarUploader", {
  action: "/api/upload",
  multiple: false,
  accept: ["image/*"],
  autoUpload: true,
});

// 创建分片上传器
const chunkUploader = FileUD.createUploader("videoUploader", {
  action: "/api/upload-chunk",
  multiple: true,
  chunkOptions: {
    chunkSize: 2 * 1024 * 1024,  // 2MB
    maxConcurrent: 3,
    retries: 3,
  },
});

// 创建自定义 action 的上传器
const customUploader = FileUD.createUploader("customUploader", {
  action: async (formData, uploadFile) => {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      headers: { Authorization: "Bearer token" },
    });
    return res.json();
  },
});
```

> 完整配置项见 [Uploader 配置文档](./uploader-config)。

---

### `createDownloader(name, config?)`

创建一个下载器实例（多例模式）。如果同名实例已存在，会先销毁旧实例。

```ts
public static createDownloader<T = any>(
  name: string,
  config?: DownloaderConfig,
): Downloader<T>
```

**参数**

| 参数     | 类型               | 必填 | 说明                       |
| -------- | ------------------ | ---- | -------------------------- |
| `name`   | `string`           | 是   | 下载器唯一名称             |
| `config` | `DownloaderConfig` | 否   | 下载器配置                 |

**返回值**：`Downloader<T>` 实例。

**示例**

```ts
// 创建基础下载器
const downloader = FileUD.createDownloader("fileDownloader", {
  action: "/api/download",
});

// 创建分片下载器
const chunkDownloader = FileUD.createDownloader("chunkDownloader", {
  action: "/api/download-chunk",
  timeout: 30000,
  chunkOptions: {
    chunkSize: 1024 * 1024,
    maxConcurrent: 5,
  },
  maxDownloadSpeed: 5 * 1024 * 1024, // 限速 5MB/s
});
```

> 完整配置项见 [Downloader 配置文档](./downloader-config)。

---

### `getUploaders(name?)`

获取上传器实例。不传 `name` 返回全部实例的 Map。

```ts
public static getUploaders(name?: string): Uploader | Map<string, Uploader>
```

**示例**

```ts
// 获取指定上传器
const avatarUploader = FileUD.getUploaders("avatarUploader");

// 获取全部上传器
const allUploaders = FileUD.getUploaders();
allUploaders.forEach((uploader, name) => {
  console.log(`Uploader: ${name}`);
});
```

---

### `getDownloaders(name?)`

获取下载器实例。不传 `name` 返回全部实例的 Map。

```ts
public static getDownloaders(name?: string): Downloader | Map<string, Downloader>
```

**示例**

```ts
// 获取指定下载器
const fileDownloader = FileUD.getDownloaders("fileDownloader");

// 获取全部下载器
const allDownloaders = FileUD.getDownloaders();
allDownloaders.forEach((downloader, name) => {
  console.log(`Downloader: ${name}`);
});
```

---

### `destroyUploaders(name?)`

销毁上传器实例。不传 `name` 则销毁所有。

```ts
public static destroyUploaders(name?: string): void
```

**示例**

```ts
// 销毁指定上传器（移除 DOM 元素 + 清理文件列表）
FileUD.destroyUploaders("avatarUploader");

// 销毁全部上传器
FileUD.destroyUploaders();
```

> 销毁一个上传器时会：清除文件列表、移除绑定的 `<input>` 元素、从内部 Map 中删除。

---

### `destroyDownloaders(name?)`

销毁下载器实例。不传 `name` 则销毁所有。

```ts
public static destroyDownloaders(name?: string): void
```

**示例**

```ts
// 销毁指定下载器
FileUD.destroyDownloaders("fileDownloader");

// 销毁全部下载器
FileUD.destroyDownloaders();
```

> 销毁一个下载器时会：清空 `files` 和 `activeFiles`，从内部 Map 中删除。

---

## 生命周期管理

推荐应用级管理模式：

```ts
// 1. 应用初始化时开启日志
FileUD.startUDLogger({
  enabled: true,
  level: import.meta.env.PROD ? 2 : 0,
});

// 2. 创建业务实例
const uploader = FileUD.createUploader("appUploader", {
  action: "/api/upload",
});
const downloader = FileUD.createDownloader("appDownloader", {
  action: "/api/download",
});

// 3. 后续按名称获取/复用
const existing = FileUD.getUploaders("appUploader");
if (existing) {
  existing.open(); // 打开文件选择器
}

// 4. 页面卸载时清理
window.addEventListener("beforeunload", () => {
  FileUD.destroyUploaders();
  FileUD.destroyDownloaders();
});
```

---

## 相关类型

### `UploaderConfig`

继承自 `UDConfig<UploadFile>`，新增以下字段：

```ts
interface UploaderConfig extends UDConfig<UploadFile> {
  multiple?: boolean;       // 是否支持多选
  accept?: AcceptFileType[] | string[]; // 接受的文件类型
  show?: false;             // 是否显示文件输入框
  elementId?: string;       // 挂载的元素ID
  autoUpload?: boolean;     // 是否自动上传
  action: string | ((formData: FormData, transferFile: UploadFile) => string | Promise<any>);
  file?: string | ((FileConfig: FileConfig) => void);
}
```

### `DownloaderConfig`

继承自 `UDConfig<DownloadFile>`，新增以下字段：

```ts
interface DownloaderConfig extends UDConfig<DownloadFile> {
  timeout?: number;         // 默认超时时间
  action: string | ((transferFile: DownloadFile) => string | Promise<any>);
  axiosOptions?: AxiosRequestConfig;
  maxDownloadSpeed?: number; // 下载最大速率限制（bytes/秒）
}
```

### `UDConfig<T>`

上传/下载器的通用基类配置：

```ts
interface UDConfig<T = any> {
  chunkOptions?: ChunkOptions | null;  // 分片配置
  axiosInstance?: AxiosInstance;       // 自定义 axios 实例
  limit?: number;                       // 文件数量限制
  maxSize?: number;                     // 文件大小限制（字节）
  headers?: Record<string, any>;        // 请求头
  maxFileConcurrent?: number;           // 最大同时传输文件数
}
```

### `LogConfig`

```ts
interface LogConfig {
  enabled?: boolean;        // 是否启用日志（默认 true）
  level?: 0 | 1 | 2 | 3;   // 日志级别
  showTimestamp?: boolean;  // 是否显示时间戳（默认 true）
  enableColors?: boolean;   // 是否启用颜色
}
```
