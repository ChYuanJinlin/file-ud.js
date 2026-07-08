# 快速开始

## 安装

```bash
# npm
npm install @file-ud.js/core

# pnpm
pnpm add @file-ud.js/core

# yarn
yarn add @file-ud.js/core

# bun
bun add @file-ud.js/core
```

官方插件包按需安装：

```bash
# npm
npm install @file-ud.js/plugins

# pnpm
pnpm add @file-ud.js/plugins

# yarn
yarn add @file-ud.js/plugins

# bun
bun add @file-ud.js/plugins
```

## 基本使用

### Uploader 上传

```typescript
import { FileUD } from "@file-ud.js/core";

// 创建上传器
const uploader = FileUD.createUploader("myUploader", {
  action: "/api/upload",
  multiple: true,
  autoUpload: true,
});

// 监听上传成功
uploader.onSuccess = (response, file) => {
  console.log("上传成功:", response);
};

// 打开文件选择器
uploader.open();
```

### Downloader 下载

```typescript
import { FileUD } from "@file-ud.js/core";

// 创建下载器
const downloader = FileUD.createDownloader("myDownloader", {
  action: "https://example.com/file.pdf",
});

// 监听下载完成
downloader.onSuccess = (response, file) => {
  console.log("下载完成:", file.fileName);
};

// 添加下载任务
downloader.downloadFile({
  url: "https://example.com/file.pdf",
  fileName: "document.pdf",
});
```

## 下一步

- 深入了解 [Uploader 上传器](/guide/uploader) 的高级用法
- 查看 [Downloader 下载器](/guide/downloader) 的分片下载与流式写入
- 查阅 [API 参考](/api/uploader-config) 获取完整配置项
