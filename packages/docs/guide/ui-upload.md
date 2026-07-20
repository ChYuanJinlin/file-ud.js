# 第三方上传组件接入

很多业务已经在使用 Element Plus、Ant Design Upload、拖拽上传区或自定义文件选择按钮。这种场景下，不需要调用 `uploader.open()`，因为文件选择已经由外部组件完成。

从 `0.1.4` 开始，`Uploader` 提供了公开的外部文件接入口：

| 方法 | 说明 |
|------|------|
| `addFile(file, options?)` | 添加单个原生 `File` 对象 |
| `addFiles(files, options?)` | 添加多个 `File` 或 `FileList` |
| `appendFiles(files)` | `addFiles(files)` 的语义化别名，适合拖拽、多选等追加场景 |

这些方法会复用和 `open()` 相同的流程：插件 `onFileSelect`、`onSelect`、文件校验、预览地址生成、`beforeTransfer`、自动上传、进度统计都会正常生效。

## 接入思路

第三方上传组件只负责两件事：

1. 负责渲染按钮、拖拽区、文件列表等 UI。
2. 在拿到原生 `File` 后调用 `uploader.addFile(file)` 或 `uploader.addFiles(files)`。

file-ud.js 负责：

1. 执行统一的上传配置、插件和校验。
2. 维护上传文件队列、总进度、速度、状态。
3. 执行普通上传或分片上传。
4. 通过 `onUpdate`、`onSuccess`、`onError` 等回调同步状态。

## 单文件与多文件

`multiple` 控制文件队列语义：

| 配置 | 行为 |
|------|------|
| `multiple: false` | 单文件模式，重新选择时会替换当前文件，适合头像、Logo、封面 |
| `multiple: true` | 多文件模式，新文件会追加到队列，适合附件列表 |

单文件模式下，即使外部组件传入多个文件，SDK 也只会保留最后一个文件。

## Element Plus

Element Plus 的 `el-upload` 可以通过 `http-request` 接管默认上传逻辑，然后把文件交给 file-ud.js。

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { FileUD, type Uploader } from "@file-ud.js/core";

const percent = ref(0);
const loading = ref(false);
const previewUrl = ref("");
const serverUrl = ref("");

let uploader: Uploader | null = null;

onMounted(() => {
  uploader = FileUD.createUploader("elementLogoUploader", {
    action: "/api/upload-logo",
    multiple: false,
    accept: ["image/*"],
  });

  uploader.onUpdate = () => {
    loading.value = Boolean(uploader?.loading);
    percent.value = uploader?.totalPercent || 0;
  };

  uploader.onSuccess = (response) => {
    serverUrl.value = response.url;
  };

  uploader.on("change", (file) => {
    previewUrl.value = file.url;
  });
});

onBeforeUnmount(() => {
  FileUD.destroyUploaders("elementLogoUploader");
});

async function handleUpload(options: any) {
  await uploader?.addFile(options.file as File);
  options.onSuccess?.({}, options.file);
}
</script>

<template>
  <el-upload
    :show-file-list="false"
    :http-request="handleUpload"
    accept="image/*"
  >
    <el-button :loading="loading">上传 Logo</el-button>
  </el-upload>

  <img v-if="previewUrl" :src="previewUrl" width="120" />
  <p>进度：{{ percent }}%</p>
  <p v-if="serverUrl">服务端地址：{{ serverUrl }}</p>
</template>
```

`previewUrl` 来自本地预览地址，适合立即回显。真正保存到业务表单里的地址，应该使用 `onSuccess(response)` 中服务端返回的地址。

## Ant Design Upload

Ant Design Upload 可以通过 `customRequest` 接管上传。

```tsx
import { useEffect, useRef, useState } from "react";
import { Upload, Button, Progress } from "antd";
import type { UploadRequestOption } from "rc-upload/lib/interface";
import { FileUD, type Uploader } from "@file-ud.js/core";

export function AntdLogoUploader() {
  const uploaderRef = useRef<Uploader | null>(null);
  const [percent, setPercent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [serverUrl, setServerUrl] = useState("");

  useEffect(() => {
    const uploader = FileUD.createUploader("antdLogoUploader", {
      action: "/api/upload-logo",
      multiple: false,
      accept: ["image/*"],
    });

    uploader.onUpdate = () => {
      setLoading(Boolean(uploader.loading));
      setPercent(uploader.totalPercent || 0);
    };

    uploader.onSuccess = (response) => {
      setServerUrl(response.url);
    };

    uploader.on("change", (file) => {
      setPreviewUrl(file.url);
    });

    uploaderRef.current = uploader;

    return () => {
      FileUD.destroyUploaders("antdLogoUploader");
    };
  }, []);

  const customRequest = async (options: UploadRequestOption) => {
    try {
      await uploaderRef.current?.addFile(options.file as File);
      options.onSuccess?.({}, options.file as any);
    } catch (error) {
      options.onError?.(error as Error);
    }
  };

  return (
    <>
      <Upload
        showUploadList={false}
        customRequest={customRequest}
        accept="image/*"
      >
        <Button loading={loading}>上传 Logo</Button>
      </Upload>

      {previewUrl && <img src={previewUrl} width={120} />}
      <Progress percent={percent} />
      {serverUrl && <div>服务端地址：{serverUrl}</div>}
    </>
  );
}
```

React 中不要在组件每次 render 时重新 `createUploader`。建议用 `useEffect` 创建一次，并在卸载时销毁。

## 复用组件内置文件列表

上面的示例为了让状态来源更清晰，关闭了组件库自己的文件列表。如果你想复用 Element Plus 或 Ant Design Upload 的内置列表，需要把 file-ud.js 的状态桥接回组件的回调。

注意：`addFile()` / `addFiles()` 的 `Promise` 只表示文件已经交给 SDK 处理，不代表服务端已经上传完成。真正的完成状态应该来自 `uploader.onSuccess`。

```ts
async function customRequest(options: any) {
  const uploader = uploaderRef.current;
  if (!uploader) return;

  uploader.onUpdate = () => {
    options.onProgress?.({ percent: uploader.totalPercent || 0 });
  };

  uploader.onSuccess = (response) => {
    options.onSuccess?.(response, options.file);
  };

  await uploader.addFile(options.file as File);
}
```

如果一个页面里同时有多个上传入口，建议每个入口创建独立的命名实例，例如 `FileUD.createUploader("avatar")`、`FileUD.createUploader("attachments")`，避免不同组件互相覆盖回调。

## 拖拽或自定义 input

如果你没有使用 UI 组件库，也可以直接把 `FileList` 交给 `addFiles`：

```ts
dropArea.addEventListener("drop", async (event) => {
  event.preventDefault();

  const files = event.dataTransfer?.files;
  if (!files?.length) return;

  await uploader.addFiles(files);
});
```

自定义 `<input type="file">` 也是同样的方式：

```ts
input.addEventListener("change", async () => {
  if (!input.files?.length) return;

  await uploader.addFiles(input.files);
  input.value = "";
});
```

## 常见问题

### 为什么不直接用第三方组件自己的上传？

可以用，但那样分片上传、断点续传、秒传、插件、全局进度等能力就绕过了 file-ud.js。接入 `addFile` / `addFiles` 后，UI 组件只管交互，上传能力仍然统一由 SDK 管理。

### `options.onSuccess` 是服务端上传成功吗？

不是。Element Plus / Ant Design 的 `onSuccess` 只是告诉 UI 组件“这次自定义请求已经接管成功”。真正的服务端上传成功回调，请使用 `uploader.onSuccess`。

### 单文件重新上传进度会从 0 开始吗？

会。`multiple: false` 下新文件会替换当前文件，新文件的 `percent` 从 `0` 开始重新计算。
