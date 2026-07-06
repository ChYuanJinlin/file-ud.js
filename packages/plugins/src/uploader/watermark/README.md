# 水印插件 (WatermarkPlugin)

## 📖 功能介绍

水印插件可以在上传前自动为图片添加文字或图片水印，保护版权和标识来源。

### ✨ 核心特性

- ✅ **双模式支持**：文字水印和图片水印
- ✅ **多位置选择**：5个预设位置（四角+中心）
- ✅ **透明度控制**：可调节水印透明度
- ✅ **样式自定义**：字体、颜色、大小均可配置
- ✅ **完全非侵入式**：通过插件系统实现，不改动核心代码

---

## 🚀 快速开始

### 1. 安装插件

```bash
npm install @file-ud.js/plugins
```

### 2. 基本使用 - 文字水印

```typescript
import { FileUD } from '@file-ud.js/core';
import { WatermarkPlugin } from '@file-ud.js/plugins/uploader';

const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload',
});

// 使用默认文字水印
uploader.use(new WatermarkPlugin({
  text: "© MyCompany"
}));
```

### 3. 图片水印

```typescript
uploader.use(new WatermarkPlugin({
  imageUrl: "https://example.com/logo.png",
  imageWidth: 100,
  imageHeight: 100,
  position: "bottom-right"
}));
```

---

## ⚙️ 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `text` | `string` | `"© FileUD"` | 水印文字内容 |
| `imageUrl` | `string` | `""` | 水印图片 URL（与 text 二选一） |
| `position` | `"top-left" \| "top-right" \| "bottom-left" \| "bottom-right" \| "center"` | `"bottom-right"` | 水印位置 |
| `opacity` | `number` | `0.6` | 透明度（0-1），0 完全透明，1 完全不透明 |
| `fontSize` | `number` | `24` | 字体大小（像素） |
| `color` | `string` | `"#ffffff"` | 字体颜色（CSS 颜色值） |
| `padding` | `number` | `20` | 边距（像素），水印距离边缘的距离 |
| `imageWidth` | `number` | `100` | 水印图片宽度（像素） |
| `imageHeight` | `number` | `100` | 水印图片高度（像素） |

---

## 📊 使用示例

### 示例 1：右下角文字水印

```typescript
new WatermarkPlugin({
  text: "© 2024 MyCompany",
  position: "bottom-right",
  fontSize: 28,
  color: "#ffffff",
  opacity: 0.7,
  padding: 30
});

// 效果：在图片右下角显示半透明白色文字
```

### 示例 2：居中品牌水印

```typescript
new WatermarkPlugin({
  text: "CONFIDENTIAL",
  position: "center",
  fontSize: 48,
  color: "#ff0000",
  opacity: 0.3,
  padding: 0
});

// 效果：在图片中央显示红色半透明大字
```

### 示例 3：左上角 Logo 水印

```typescript
new WatermarkPlugin({
  imageUrl: "https://cdn.example.com/logo.png",
  position: "top-left",
  imageWidth: 80,
  imageHeight: 80,
  opacity: 0.8,
  padding: 20
});

// 效果：在图片左上角显示公司 Logo
```

### 示例 4：平铺水印（高级技巧）

虽然插件不直接支持平铺，但可以通过多次调用实现：

```typescript
// 方案：使用较大的透明 PNG 作为水印图片
new WatermarkPlugin({
  imageUrl: "data:image/png;base64,iVBORw0KGgo...", // 平铺图案
  position: "center",
  opacity: 0.1,
  imageWidth: 400,
  imageHeight: 400
});
```

---

## 💡 高级用法

### 1. 根据图片尺寸动态调整

```typescript
uploader.use(new WatermarkPlugin({
  text: "© MyCompany",
  fontSize: 24,  // 固定大小
  
  // 或者在运行时动态计算
  onFileSelect: async (file, context) => {
    const img = new Image();
    const url = URL.createObjectURL(file.File);
    
    return new Promise((resolve) => {
      img.onload = () => {
        URL.revokeObjectURL(url);
        
        // 根据图片宽度动态调整字体大小
        const dynamicFontSize = Math.max(24, Math.floor(img.width / 50));
        
        // 更新插件配置（需要重新创建插件实例）
        resolve(file);
      };
      img.src = url;
    });
  }
}));
```

### 2. 结合压缩插件使用

```typescript
import { 
  WatermarkPlugin, 
  CompressImagePlugin, 
  FileValidatorPlugin 
} from '@file-ud.js/plugins/uploader';

uploader.use([
  // 1. 文件校验
  new FileValidatorPlugin({
    maxSize: 10 * 1024 * 1024,
    accept: ['image/*']
  }),
  
  // 2. 添加水印（先加水印）
  new WatermarkPlugin({
    text: "© MyCompany",
    position: "bottom-right"
  }),
  
  // 3. 图片压缩（后压缩，减小文件大小）
  new CompressImagePlugin({
    quality: 0.8,
    format: "webp"
  })
]);
```

### 3. 条件性添加水印

```typescript
// 只为特定类型的图片添加水印
const shouldAddWatermark = (file: File) => {
  // 只对照片添加水印，不对截图添加
  return file.size > 1024 * 1024; // 大于 1MB 的图片
};

if (shouldAddWatermark(selectedFile)) {
  uploader.use(new WatermarkPlugin({
    text: "© MyCompany"
  }));
}
```

---

## 🔍 工作原理

### 文字水印流程

```
1. 用户选择图片
   ↓
2. 插件拦截文件（onFileSelect 钩子）
   ↓
3. 创建 Canvas 并绘制原图
   ↓
4. 设置文字样式（字体、颜色、透明度）
   ↓
5. 计算文字位置（根据 position 和 padding）
   ↓
6. 在 Canvas 上绘制文字
   ↓
7. 导出为新的 File 对象
   ↓
8. 替换原文件，继续上传流程
```

### 图片水印流程

```
1. 用户选择图片
   ↓
2. 加载水印图片（处理跨域）
   ↓
3. 创建 Canvas 并绘制原图
   ↓
4. 计算水印图片位置和尺寸
   ↓
5. 在 Canvas 上绘制水印图片
   ↓
6. 导出为新的 File 对象
   ↓
7. 替换原文件，继续上传流程
```

---

## 🎯 最佳实践

### 1. 选择合适的透明度

| 用途 | 推荐透明度 | 说明 |
|------|-----------|------|
| **版权保护** | 0.3 - 0.5 | 明显但不影响观看 |
| **品牌标识** | 0.6 - 0.8 | 清晰可见 |
| **防伪标记** | 0.1 - 0.2 | 隐约可见，不影响主体 |
| **重要声明** | 0.7 - 0.9 | 非常醒目 |

### 2. 位置选择建议

| 位置 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **bottom-right** ⭐ | 通用推荐 | 不遮挡主体，符合习惯 | 容易被裁剪 |
| **center** | 防盗用 | 难以去除 | 影响观看体验 |
| **top-left** | 品牌展示 | 第一眼看到 | 可能遮挡重要内容 |
| **bottom-left** | 次要信息 | 低调不显眼 | 容易被忽略 |
| **top-right** | 时间戳等 | 符合阅读习惯 | 同上 |

### 3. 字体大小设置

```typescript
// ❌ 不推荐：固定小字体，大图看不清
new WatermarkPlugin({
  fontSize: 12  // 太小！
});

// ✅ 推荐：根据图片尺寸动态调整
const getFontSize = (imageWidth: number) => {
  return Math.max(24, Math.floor(imageWidth / 50));
};

new WatermarkPlugin({
  fontSize: 28,  // 适合 1920px 宽度的图片
});
```

### 4. 颜色选择

```typescript
// 白色文字 + 黑色描边（提高对比度）
new WatermarkPlugin({
  color: "#ffffff",
  // 注意：当前版本不支持描边，可以自行扩展
});

// 深色背景用浅色文字
new WatermarkPlugin({
  color: "#ffffff"  // 白色
});

// 浅色背景用深色文字
new WatermarkPlugin({
  color: "#000000"  // 黑色
});
```

---

## 🐛 常见问题

### Q1: 水印图片跨域加载失败？

**错误信息**：`Tainted canvases may not be exported`

**原因**：水印图片来自不同域名，且未设置 CORS。

**解决方案**：
```typescript
// 方案1：确保水印图片服务器支持 CORS
// 在图片服务器响应头中添加：
// Access-Control-Allow-Origin: *

// 方案2：使用 Base64 编码的水印图片
const watermarkBase64 = "data:image/png;base64,iVBORw0KGgo...";

new WatermarkPlugin({
  imageUrl: watermarkBase64
});

// 方案3：将水印图片托管到同域名下
new WatermarkPlugin({
  imageUrl: "/assets/watermark.png"  // 同域名
});
```

### Q2: 文字水印显示乱码？

**原因**：Canvas 默认字体不支持中文。

**解决方案**：
```typescript
// 指定支持中文的字体
new WatermarkPlugin({
  text: "版权所有",
  // Canvas font 格式: "size family"
  // 注意：当前插件使用 Arial，可能需要扩展支持自定义字体
});
```

### Q3: 水印位置不准确？

**原因**：padding 设置不当或图片尺寸特殊。

**解决方案**：
```typescript
// 调整 padding
new WatermarkPlugin({
  position: "bottom-right",
  padding: 30  // 增加边距
});
```

### Q4: 可以同时添加文字和图片水印吗？

**当前限制**：插件只支持一种水印类型（文字或图片）。

** workaround**：
```typescript
// 方案：创建一个包含文字的图片作为水印
const createTextWatermarkImage = (text: string): string => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 400;
  canvas.height = 100;
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '48px Arial';
  ctx.fillText(text, 20, 70);
  
  return canvas.toDataURL();
};

new WatermarkPlugin({
  imageUrl: createTextWatermarkImage("© MyCompany"),
  imageWidth: 400,
  imageHeight: 100
});
```

---

## 📈 性能建议

### 1. 优化水印图片

- 使用 PNG 格式（支持透明）
- 尺寸不要过大（建议 100-200px）
- 提前压缩水印图片

```typescript
// ✅ 推荐：小而清晰的水印
new WatermarkPlugin({
  imageUrl: "/watermark-small.png",
  imageWidth: 100,
  imageHeight: 100
});

// ❌ 不推荐：过大的水印
new WatermarkPlugin({
  imageUrl: "/watermark-huge.png",
  imageWidth: 1000,  // 太大！
  imageHeight: 1000
});
```

### 2. 批量上传优化

水印添加在主线程执行，大批量上传时可能阻塞 UI：

```typescript
// 限制并发数量
uploader.updateConfig({
  chunkOptions: {
    maxConcurrent: 2
  }
});
```

---

## 🎨 设计建议

### 1. 版权保护水印

```typescript
new WatermarkPlugin({
  text: "© 2024 MyCompany. All rights reserved.",
  position: "center",
  fontSize: 36,
  color: "#ffffff",
  opacity: 0.3,
  padding: 0
});
```

### 2. 品牌标识水印

```typescript
new WatermarkPlugin({
  imageUrl: "https://cdn.mycompany.com/logo-transparent.png",
  position: "top-left",
  imageWidth: 120,
  imageHeight: 40,
  opacity: 0.9,
  padding: 20
});
```

### 3. 草稿/预览水印

```typescript
new WatermarkPlugin({
  text: "DRAFT",
  position: "center",
  fontSize: 72,
  color: "#ff0000",
  opacity: 0.2,
  padding: 0
});
```

---

## 📝 更新日志

### v1.0.0 (2024-01-XX)
- ✨ 首次发布
- ✅ 支持文字水印
- ✅ 支持图片水印
- ✅ 5种位置选择
- ✅ 透明度控制
- ✅ 自定义样式

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

**报告 Bug**：[GitHub Issues](https://github.com/your-repo/file-ud/issues)

**提出建议**：[Feature Requests](https://github.com/your-repo/file-ud/discussions)
