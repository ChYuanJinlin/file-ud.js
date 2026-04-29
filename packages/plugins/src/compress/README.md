# 图片压缩插件 (CompressImagePlugin)

## 📖 功能介绍

图片压缩插件可以在上传前自动压缩图片文件，减少文件大小和带宽占用，提升上传速度。

### ✨ 核心特性

- ✅ **智能压缩**：基于 Canvas 的图片压缩算法
- ✅ **尺寸调整**：自动缩放超出限制的图片尺寸
- ✅ **格式转换**：支持 JPEG、PNG、WebP 格式互转
- ✅ **质量可控**：可配置压缩质量（0-1）
- ✅ **实时反馈**：显示压缩前后的文件大小对比
- ✅ **完全非侵入式**：通过插件系统实现，不改动核心代码

---

## 🚀 快速开始

### 1. 安装插件

```bash
npm install @file-ud.js/plugins
```

### 2. 基本使用

```typescript
import { FileUD } from '@file-ud.js/core';
import { CompressImagePlugin } from '@file-ud.js/plugins';

const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload',
  // ... 其他配置
});

// 使用默认配置
uploader.use(new CompressImagePlugin());
```

### 3. 自定义配置

```typescript
uploader.use(new CompressImagePlugin({
  quality: 0.7,           // 压缩质量 70%
  maxWidth: 1920,         // 最大宽度 1920px
  maxHeight: 1080,        // 最大高度 1080px
  format: "webp",         // 输出 WebP 格式
  showInfo: true          // 显示压缩信息
}));
```

---

## ⚙️ 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `quality` | `number` | `0.8` | 压缩质量（0-1），值越小压缩率越高 |
| `maxWidth` | `number` | `1920` | 最大宽度（像素），超出会自动等比缩放 |
| `maxHeight` | `number` | `1080` | 最大高度（像素），超出会自动等比缩放 |
| `format` | `"jpeg" \| "png" \| "webp"` | `"jpeg"` | 输出格式 |
| `showInfo` | `boolean` | `true` | 是否在控制台显示压缩信息 |
| `onCompressStart` | `(file: UploadFile) => void` | - | 压缩开始时的回调 |
| `onCompressComplete` | `(file: UploadFile, compressedFile: File) => void` | - | 压缩完成时的回调 |

---

## 📊 压缩效果示例

### 示例 1：JPEG 压缩

```typescript
new CompressImagePlugin({
  quality: 0.8,
  format: "jpeg"
});

// 原始图片: 5.23 MB (4000x3000)
// 压缩后:   1.25 MB (1920x1440)
// 压缩率:   76.1%
```

### 示例 2：WebP 格式（推荐）

```typescript
new CompressImagePlugin({
  quality: 0.75,
  format: "webp"
});

// 原始图片: 5.23 MB (4000x3000)
// 压缩后:   0.85 MB (1920x1440)
// 压缩率:   83.7%
```

### 示例 3：高质量 PNG

```typescript
new CompressImagePlugin({
  quality: 0.95,
  format: "png",
  maxWidth: 3840,
  maxHeight: 2160
});

// 原始图片: 12.50 MB (6000x4000)
// 压缩后:   3.20 MB (3840x2560)
// 压缩率:   74.4%
```

---

## 💡 高级用法

### 1. 监听压缩事件

```typescript
uploader.use(new CompressImagePlugin({
  onCompressStart: (file) => {
    console.log(`🔄 开始压缩: ${file.fileName}`);
  },
  onCompressComplete: (file, compressedFile) => {
    console.log(`✅ 压缩完成: ${compressedFile.size} bytes`);
  }
}));
```

### 2. 根据图片类型动态配置

```typescript
uploader.use(new CompressImagePlugin({
  // 对于照片使用 JPEG，对于图标使用 PNG
  format: "jpeg",
  quality: 0.8,
  maxWidth: 1920,
  maxHeight: 1080
}));

// 如果需要更精细的控制，可以创建多个 uploader
const photoUploader = FileUD.createUploader("photos", {
  action: '/api/upload-photo'
});
photoUploader.use(new CompressImagePlugin({
  format: "jpeg",
  quality: 0.85
}));

const iconUploader = FileUD.createUploader("icons", {
  action: '/api/upload-icon'
});
iconUploader.use(new CompressImagePlugin({
  format: "png",
  quality: 0.95,
  maxWidth: 512,
  maxHeight: 512
}));
```

### 3. 结合其他插件使用

```typescript
import { 
  CompressImagePlugin, 
  FileValidatorPlugin, 
  WatermarkPlugin 
} from '@file-ud.js/plugins';

uploader.use([
  // 1. 文件校验（优先级最高）
  new FileValidatorPlugin({
    maxSize: 10 * 1024 * 1024, // 10MB
    accept: ['image/*']
  }),
  
  // 2. 添加水印
  new WatermarkPlugin({
    text: "© MyCompany",
    position: "bottom-right"
  }),
  
  // 3. 图片压缩（最后执行）
  new CompressImagePlugin({
    quality: 0.8,
    format: "webp"
  })
]);
```

---

## 🔍 工作原理

### 压缩流程

```
1. 用户选择图片
   ↓
2. 插件拦截文件（onFileSelect 钩子）
   ↓
3. 创建 Image 对象加载图片
   ↓
4. 计算目标尺寸（不超过 maxWidth/maxHeight）
   ↓
5. 创建 Canvas 并绘制图片
   ↓
6. 使用 canvas.toBlob() 压缩并转换为指定格式
   ↓
7. 生成新的 File 对象
   ↓
8. 替换原文件，继续上传流程
```

### 尺寸计算逻辑

```typescript
// 如果宽度超过限制
if (width > maxWidth) {
  height = Math.floor(height * (maxWidth / width));
  width = maxWidth;
}

// 如果高度超过限制
if (height > maxHeight) {
  width = Math.floor(width * (maxHeight / height));
  height = maxHeight;
}
```

---

## 🎯 最佳实践

### 1. 选择合适的格式

| 格式 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **JPEG** | 照片、渐变图 | 兼容性好，压缩率高 | 不支持透明 |
| **PNG** | 图标、截图、文字 | 无损压缩，支持透明 | 文件较大 |
| **WebP** ⭐ | 通用推荐 | 压缩率高，支持透明 | 旧浏览器兼容性差 |

### 2. 根据用途选择质量

| 用途 | 推荐质量 | 说明 |
|------|---------|------|
| **缩略图** | 0.5 - 0.6 | 小尺寸，低质量即可 |
| **普通展示** | 0.7 - 0.8 | 平衡质量和大小 |
| **高清展示** | 0.85 - 0.9 | 需要较高清晰度 |
| **专业摄影** | 0.9 - 0.95 | 保留更多细节 |

### 3. 设置合理的尺寸限制

```typescript
// ❌ 不推荐：尺寸过大，浪费带宽
new CompressImagePlugin({
  maxWidth: 8000,  // 太大！
  maxHeight: 6000
});

// ✅ 推荐：根据实际展示需求设置
new CompressImagePlugin({
  maxWidth: 1920,  // Full HD
  maxHeight: 1080
});

// ✅ 移动端优化
new CompressImagePlugin({
  maxWidth: 1280,  // 适合手机屏幕
  maxHeight: 720
});
```

---

## 🐛 常见问题

### Q1: 为什么压缩后图片变模糊？

**原因**：压缩质量设置过低或尺寸缩小太多。

**解决方案**：
```typescript
// 提高质量
new CompressImagePlugin({
  quality: 0.9,  // 从 0.8 提高到 0.9
  maxWidth: 2560, // 增加最大尺寸
  maxHeight: 1440
});
```

### Q2: WebP 格式在某些浏览器不显示？

**原因**：旧版浏览器不支持 WebP。

**解决方案**：
```typescript
// 检测浏览器支持
const supportWebP = document.createElement('canvas')
  .toDataURL('image/webp')
  .indexOf('data:image/webp') === 0;

uploader.use(new CompressImagePlugin({
  format: supportWebP ? 'webp' : 'jpeg'
}));
```

### Q3: 压缩会改变文件名吗？

**是的**，如果改变了格式，文件扩展名会相应变化。

```typescript
// 原始文件: photo.png
// 压缩配置: format: "jpeg"
// 结果文件: photo.jpeg
```

如果不想改变扩展名，保持格式一致：
```typescript
new CompressImagePlugin({
  format: "jpeg",  // 如果原图是 JPEG，就用 JPEG
});
```

### Q4: 压缩会影响透明度吗？

- **JPEG**：❌ 不支持透明，透明区域会变成白色
- **PNG**：✅ 完全支持透明
- **WebP**：✅ 支持透明

如果需要保留透明，使用 PNG 或 WebP：
```typescript
new CompressImagePlugin({
  format: "png",  // 或 "webp"
  quality: 0.9
});
```

---

## 📈 性能建议

### 1. 大图片优化

对于超大图片（>10MB），可以先缩小尺寸再压缩：

```typescript
new CompressImagePlugin({
  maxWidth: 1920,   // 先缩小尺寸
  maxHeight: 1080,
  quality: 0.8      // 再降低质量
});
```

### 2. 批量上传优化

批量上传时，压缩会在主线程执行，可能阻塞 UI。可以考虑：

```typescript
// 方案1：限制并发数量
uploader.updateConfig({
  chunkOptions: {
    maxConcurrent: 2  // 最多同时压缩2张图片
  }
});

// 方案2：使用 Web Worker（未来版本支持）
```

---

## 📝 更新日志

### v1.0.0 (2024-01-XX)
- ✨ 首次发布
- ✅ 支持 JPEG、PNG、WebP 格式
- ✅ 智能尺寸调整
- ✅ 可配置压缩质量
- ✅ 实时压缩信息显示

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

**报告 Bug**：[GitHub Issues](https://github.com/your-repo/file-ud/issues)

**提出建议**：[Feature Requests](https://github.com/your-repo/file-ud/discussions)
