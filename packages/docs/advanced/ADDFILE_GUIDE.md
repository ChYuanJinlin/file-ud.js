# addFile / addFiles 添加文件

`Uploader.addFile` 和 `Uploader.addFiles` 用于把外部拿到的原生 `File` 对象交给 file-ud.js。

它们适合这些场景：

- 第三方 UI 上传组件：Element Plus、Ant Design Upload 等。
- 自定义 `<input type="file">`。
- 拖拽上传。
- 剪贴板粘贴图片。
- 业务中已有 `File` 对象，不想再调用 `uploader.open()`。

## 和 open 的区别

| 方法 | 谁负责选文件 | 适合场景 |
|------|--------------|----------|
| `uploader.open(fn?)` | file-ud.js 内部创建的 input | 快速接入，直接弹出文件选择框 |
| `uploader.addFile(file)` | 外部组件或业务代码 | 接入现有 UI 上传组件 |
| `uploader.addFiles(files)` | 外部组件或业务代码 | 拖拽、多选、批量添加 |

`addFile` / `addFiles` 会复用和 `open()` 相同的上传流程，包括插件、校验、预览地址、上传前拦截、自动上传、分片上传和进度统计。

## 方法签名

```ts
addFile(file: File, options?: { clear?: boolean }): Promise<void>

addFiles(files: File[] | FileList, options?: { clear?: boolean }): Promise<void>

appendFiles(files: File[] | FileList): Promise<void>
```

| 参数 | 说明 |
|------|------|
| `file` | 单个原生 `File` 对象 |
| `files` | 原生 `File[]` 或 `FileList` |
| `options.clear` | 传 `true` 时会先清空当前文件列表，再处理新文件 |

一般情况下不需要手动传 `clear: true`。如果是单文件场景，直接设置 `multiple: false` 即可，SDK 会自动替换当前文件。

## 基础用法

```ts
import { FileUD } from "@file-ud.js/core";

const uploader = FileUD.createUploader("logoUploader", {
  action: "/api/upload-logo",
  multiple: false,
  accept: ["image/*"],
});

uploader.onUpdate = () => {
  console.log("上传中:", uploader.loading);
  console.log("总进度:", uploader.totalPercent);
};

uploader.onSuccess = (response, file) => {
  console.log("服务端响应:", response);
  console.log("上传成功文件:", file.fileName);
};

input.addEventListener("change", async () => {
  const file = input.files?.[0];
  if (!file) return;

  await uploader.addFile(file);
  input.value = "";
});
```

## 单文件覆盖

头像、Logo、封面这类场景建议使用 `multiple: false`：

```ts
const uploader = FileUD.createUploader("avatarUploader", {
  action: "/api/avatar",
  multiple: false,
});

await uploader.addFile(file);
```

当重新选择文件时，SDK 会用新文件替换当前文件，新文件进度从 `0` 开始重新计算。

如果外部组件误传了多个文件，`multiple: false` 下只会保留最后一个：

```ts
await uploader.addFiles(fileList);
```

## 多文件追加

附件列表、多图上传等场景使用 `multiple: true`：

```ts
const uploader = FileUD.createUploader("attachmentsUploader", {
  action: "/api/attachments",
  multiple: true,
  limit: 9,
});

await uploader.addFiles(files);
```

`appendFiles(files)` 是 `addFiles(files)` 的语义化别名：

```ts
await uploader.appendFiles(files);
```

## 拖拽上传

```ts
dropArea.addEventListener("dragover", (event) => {
  event.preventDefault();
});

dropArea.addEventListener("drop", async (event) => {
  event.preventDefault();

  const files = event.dataTransfer?.files;
  if (!files?.length) return;

  await uploader.addFiles(files);
});
```

## 粘贴上传

```ts
document.addEventListener("paste", async (event) => {
  const files = Array.from(event.clipboardData?.files || []);
  if (!files.length) return;

  await uploader.addFiles(files);
});
```

## 接入第三方上传组件

第三方上传组件通常提供自定义上传入口，例如：

- Element Plus：`http-request`
- Ant Design Upload：`customRequest`

在这些入口中拿到 `File` 后调用：

```ts
await uploader.addFile(file);
```

完整示例见 [第三方上传组件接入](/guide/ui-upload)。

## 注意事项

`addFile()` / `addFiles()` 的 `Promise` 表示文件已经交给 SDK 处理，并不表示服务端已经上传完成。

服务端上传成功请监听：

```ts
uploader.onSuccess = (response, file) => {
  console.log(response, file);
};
```

本地预览地址请监听：

```ts
uploader.on("change", (file) => {
  console.log(file.url);
});
```

错误处理可以监听全局错误事件或插件错误钩子，具体取决于你的接入方式。
