# WatermarkPlugin — 水印

**优先级**：20

支持文字水印和图片水印，5 个预设位置，可自定义透明度与样式。

## 基础用法

### 文字水印

```ts
import { WatermarkPlugin } from "@file-ud.js/plugins/uploader";

uploader.use(new WatermarkPlugin({
  text: "© MyCompany",
  position: "bottom-right",
  opacity: 0.6,
}));
```

### 图片水印

```ts
import { WatermarkPlugin } from "@file-ud.js/plugins/uploader";

uploader.use(new WatermarkPlugin({
  imageUrl: "https://example.com/logo.png",
  position: "top-left",
  imageWidth: 100,
  imageHeight: 100,
}));
```

## 配置参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | `string` | — | 水印文字 |
| `imageUrl` | `string` | — | 水印图片 URL |
| `position` | `string` | `"center"` | 位置：`center` / `top-left` / `top-right` / `bottom-left` / `bottom-right` |
| `opacity` | `number` | `0.5` | 透明度，0 - 1 |
| `imageWidth` | `number` | — | 图片水印宽度（px） |
| `imageHeight` | `number` | — | 图片水印高度（px） |

> **注意**：`text` 和 `imageUrl` 二选一。同时提供时，优先使用 `imageUrl`。

## 使用场景

### 品牌保护

```ts
uploader.use(new WatermarkPlugin({
  imageUrl: "/brand-logo.png",
  position: "bottom-right",
  imageWidth: 120,
  imageHeight: 40,
  opacity: 0.7,
}));
```

### 版权声明

```ts
uploader.use(new WatermarkPlugin({
  text: "© 2024 All Rights Reserved",
  position: "center",
  opacity: 0.3,
}));
```

### 角标水印

```ts
uploader.use(new WatermarkPlugin({
  text: "预览版",
  position: "top-right",
  opacity: 0.5,
}));
```
