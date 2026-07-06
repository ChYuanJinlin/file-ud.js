# 插件系统

## 概述

file-ud.js 提供了强大的插件系统，允许你通过非侵入式的方式扩展上传功能。所有插件都实现 `IUDPlugin` 接口，可以在不修改核心代码的情况下添加新功能。

## 设计理念

### 非侵入式扩展

- **零核心代码修改**：所有功能通过插件实现
- **向后兼容**：不影响现有功能和 API
- **可选启用**：用户可以选择性使用插件

### 优先级机制

每个插件可以设置 `priority`（数字越小越先执行）：

| 优先级区间 | 用途 | 示例 |
|-----------|------|------|
| 0 - 5 | 验证类插件 | FileValidatorPlugin |
| 10 - 20 | 处理类插件 | CompressImagePlugin、SmartRetryPlugin |
| 20 - 50 | 辅助类插件 | WatermarkPlugin |

## 安装

```bash
npm install @file-ud.js/plugins
```

## 快速使用

```ts
import { FileUD } from "@file-ud.js/core";
import {
  FileValidatorPlugin,
  CompressImagePlugin,
} from "@file-ud.js/plugins/uploader";
import { SmartRetryPlugin } from "@file-ud.js/plugins/retry";

const uploader = FileUD.createUploader("myUploader", {
  action: "/api/upload",
});

// 注册多个插件
uploader.use([
  new FileValidatorPlugin({ maxSize: 10 * 1024 * 1024 }),
  new CompressImagePlugin({ quality: 0.8 }),
  new SmartRetryPlugin({ maxRetries: 3 }),
]);
```

推荐导入路径：

| 场景 | 导入路径 |
| --- | --- |
| 上传插件 | `@file-ud.js/plugins/uploader` |
| 下载插件 | `@file-ud.js/plugins/downloader` |
| 通用插件 | `@file-ud.js/plugins/retry` |
| 自定义插件基类 | `@file-ud.js/plugins` |

### 执行顺序

插件按 `priority` 从小到大依次执行：

```
文件选择
  ↓
FileValidatorPlugin (priority: 0)    →  验证文件合法性
  ↓
CompressImagePlugin  (priority: 10)  →  压缩图片
  ↓
WatermarkPlugin      (priority: 20)  →  添加水印
  ↓
上传开始
  ↓
SmartRetryPlugin     (priority: 10)  →  失败时自动重试
  ↓
上传完成
```

## 内置插件

| 插件 | 优先级 | 说明 |
|------|--------|------|
| [文件验证](./validator) | 0 | 验证文件大小、类型、空文件检测 |
| [图片压缩](./compress) | 10 | 智能压缩、尺寸调整、格式转换 |
| [水印](./watermark) | 20 | 文字/图片水印，5 个预设位置 |
| [智能重试](./retry) | 10 | 三种重试策略，智能错误过滤 |

## 开发自定义插件

所有插件必须实现 `IUDPlugin` 接口，推荐继承 `BasePlugin` 基类：

```ts
import { BasePlugin } from "@file-ud.js/plugins";
import type { UploadFile, PluginContext } from "@file-ud.js/core/types";

class MyPlugin extends BasePlugin {
  name = "my-plugin";
  priority = 50;

  async onFileSelect(
    file: UploadFile,
    context: PluginContext
  ): Promise<UploadFile> {
    console.log("文件已选择:", file.fileName);
    return file;
  }
}

uploader.use(new MyPlugin());
```

完整开发指南参见各内置插件的源码实现。
