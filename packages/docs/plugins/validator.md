# FileValidatorPlugin — 文件验证

**优先级**：0（最高）

验证文件大小、类型、是否为空，支持自定义验证函数。

## 基础用法

```ts
import { FileValidatorPlugin } from "@file-ud.js/plugins/uploader";

uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,    // 最大 10MB
  minSize: 1024,                 // 最小 1KB
  accept: ["image/*", ".pdf"],   // 允许的文件类型
  allowEmpty: false,             // 禁止空文件
}));
```

## 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxSize` | `number` | `Infinity` | 最大文件大小（字节） |
| `minSize` | `number` | `0` | 最小文件大小（字节） |
| `accept` | `string[]` | `["*"]` | 允许的文件类型，支持 MIME 和扩展名 |
| `allowEmpty` | `boolean` | `false` | 是否允许空文件 |

## 使用场景

### 限制文件大小

```ts
uploader.use(new FileValidatorPlugin({
  maxSize: 50 * 1024 * 1024,  // 最大 50MB
  minSize: 1024,               // 最小 1KB
}));
```

### 限制文件类型

```ts
// 只允许图片和 PDF
uploader.use(new FileValidatorPlugin({
  accept: ["image/*", ".pdf"],
}));

// 只允许特定图片格式
uploader.use(new FileValidatorPlugin({
  accept: ["image/jpeg", "image/png", "image/webp"],
}));
```

### 禁止空文件

```ts
uploader.use(new FileValidatorPlugin({
  allowEmpty: false,
}));
```
