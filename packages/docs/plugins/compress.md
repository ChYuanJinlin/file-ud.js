# CompressImagePlugin — 图片压缩

**优先级**：10

智能压缩图片，支持尺寸调整、格式转换和质量控制。

## 基础用法

```ts
import { CompressImagePlugin } from "@file-ud.js/plugins/uploader";

uploader.use(new CompressImagePlugin({
  quality: 0.8,          // 压缩质量 0-1
  maxWidth: 1920,        // 最大宽度
  maxHeight: 1080,       // 最大高度
  format: "webp",        // 输出格式
}));
```

## 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `quality` | `number` | `0.8` | 压缩质量，0 - 1 |
| `maxWidth` | `number` | — | 最大宽度（px） |
| `maxHeight` | `number` | — | 最大高度（px） |
| `format` | `string` | `"jpeg"` | 输出格式：`jpeg` / `png` / `webp` |

## 使用场景

### 降低上传流量

```ts
uploader.use(new CompressImagePlugin({
  quality: 0.6,    // 中等压缩质量
  format: "webp",   // WebP 格式体积更小
}));
```

### 限制图片尺寸

```ts
uploader.use(new CompressImagePlugin({
  maxWidth: 1280,
  maxHeight: 720,
  quality: 0.85,
}));
```

### 保持原格式

```ts
uploader.use(new CompressImagePlugin({
  quality: 0.7,
  // 不指定 format，默认保持 jpeg
}));
```

## 质量选择建议

| 质量值 | 适用场景 | 压缩率 |
|--------|----------|--------|
| 0.9 - 1.0 | 需要高质量输出 | 低 |
| 0.7 - 0.9 | 常规使用 | 中 |
| 0.4 - 0.7 | 缩略图、预览 | 高 |
| < 0.4 | 仅做体积优化 | 很高（可能失真） |
