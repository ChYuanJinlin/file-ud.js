# 📚 file-UD 完整文档索引

欢迎使用 file-UD！这里整理了所有相关文档，帮助你快速上手和深入使用。

---

## 🎯 快速导航

### 📘 核心文档

| 文档 | 说明 | 链接 |
|------|------|------|
| **Core 包文档** | 核心上传库的完整 API 文档 | [查看](./packages/core/README.md) |
| **插件系统总览** | 插件系统介绍和使用指南 | [查看](./packages/plugins/README.md) |
| **新增功能说明** | 最新功能和更新日志 | [查看](./NEW_FEATURES.md) |

---

### 🔌 插件文档

#### 1. 文件验证插件
**位置**: [`packages/plugins/src/validator/README.md`](./packages/plugins/src/validator/README.md)

**功能**:
- ✅ 文件大小验证（最小/最大）
- ✅ 文件类型验证
- ✅ 空文件检测
- ✅ 自定义验证函数
- ✅ 错误消息定制

**快速示例**:
```typescript
import { FileValidatorPlugin } from '@file-ud.js/plugins';

uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,    // 10MB
  accept: ['image/*'],
  allowEmpty: false
}));
```

---

#### 2. 图片压缩插件
**位置**: [`packages/plugins/src/compress/README.md`](./packages/plugins/src/compress/README.md)

**功能**:
- ✅ 智能图片压缩
- ✅ 尺寸调整
- ✅ 格式转换（JPEG/PNG/WebP）
- ✅ 质量可控
- ✅ 实时反馈

**快速示例**:
```typescript
import { CompressImagePlugin } from '@file-ud.js/plugins';

uploader.use(new CompressImagePlugin({
  quality: 0.8,
  maxWidth: 1920,
  maxHeight: 1080,
  format: "webp"
}));
```

---

#### 3. 水印插件
**位置**: [`packages/plugins/src/watermark/README.md`](./packages/plugins/src/watermark/README.md)

**功能**:
- ✅ 文字水印
- ✅ 图片水印
- ✅ 多位置选择（5个预设位置）
- ✅ 透明度控制
- ✅ 样式自定义

**快速示例**:
```typescript
import { WatermarkPlugin } from '@file-ud.js/plugins';

// 文字水印
uploader.use(new WatermarkPlugin({
  text: "© MyCompany",
  position: "bottom-right",
  opacity: 0.6
}));

// 图片水印
uploader.use(new WatermarkPlugin({
  imageUrl: "https://example.com/logo.png",
  position: "top-left"
}));
```

---

#### 4. 智能重试插件
**位置**: [`packages/plugins/src/retry/README.md`](./packages/plugins/src/retry/README.md)

**功能**:
- ✅ 三种重试策略（固定延迟、指数退避、线性增长）
- ✅ 可配置重试次数
- ✅ 智能错误过滤
- ✅ 自动状态清理
- ✅ 完全非侵入式

**快速示例**:
```typescript
import { SmartRetryPlugin } from '@file-ud.js/plugins';

uploader.use(new SmartRetryPlugin({
  maxRetries: 3,
  strategy: "exponential",
  initialDelay: 1000,
  maxDelay: 30000
}));
```

---

## 📖 学习路径

### 🌱 新手入门

1. **阅读 Core 包文档**
   - 了解基本 API
   - 学习创建上传器
   - 掌握文件操作

2. **运行示例项目**
   ```bash
   cd packages/example
   npm run dev
   ```

3. **尝试基础功能**
   - 单文件传输
   - 多文件传输
   - 进度显示

---

### 🚀 进阶使用

1. **学习分片上传**
   - 配置分片大小
   - 实现断点续传
   - 处理合并逻辑

2. **使用插件系统**
   - 添加文件验证
   - 启用图片压缩
   - 添加水印功能

3. **自定义上传逻辑**
   - 自定义 action 函数
   - 监听事件
   - 错误处理

---

### 💎 高级技巧

1. **开发自定义插件**
   - 实现 IUDPlugin 接口
   - 利用事件钩子
   - 管理插件状态

2. **性能优化**
   - 调整并发数量
   - 优化分片大小
   - 使用 Web Worker

3. **安全加固**
   - 前端 + 后端双重验证
   - 检查文件魔数
   - 防止 CSRF 攻击

---

## 🎨 常见场景示例

### 场景 1：头像上传

```typescript
import { FileValidatorPlugin, CompressImagePlugin } from '@file-ud.js/plugins';

const avatarUploader = FileUD.createUploader("avatar", {
  action: '/api/upload-avatar',
  multiple: false
});

avatarUploader.use([
  new FileValidatorPlugin({
    maxSize: 2 * 1024 * 1024,  // 2MB
    accept: ['image/jpeg', 'image/png']
  }),
  new CompressImagePlugin({
    quality: 0.8,
    maxWidth: 512,
    maxHeight: 512,
    format: 'jpeg'
  })
]);
```

---

### 场景 2：相册批量上传

```typescript
import { 
  FileValidatorPlugin, 
  CompressImagePlugin,
  SmartRetryPlugin 
} from '@file-ud.js/plugins';

const photoUploader = FileUD.createUploader("photos", {
  action: '/api/upload-photo',
  multiple: true,
  chunkOptions: {
    chunkSize: 2 * 1024 * 1024,
    maxConcurrent: 3
  }
});

photoUploader.use([
  new FileValidatorPlugin({
    maxSize: 10 * 1024 * 1024,  // 10MB
    accept: ['image/*']
  }),
  new CompressImagePlugin({
    quality: 0.85,
    maxWidth: 1920,
    maxHeight: 1080,
    format: 'webp'
  }),
  new SmartRetryPlugin({
    maxRetries: 3,
    strategy: 'exponential'
  })
]);
```

---

### 场景 3：视频上传

```typescript
import { FileValidatorPlugin, SmartRetryPlugin } from '@file-ud.js/plugins';

const videoUploader = FileUD.createUploader("videos", {
  action: '/api/upload-video',
  chunkOptions: {
    chunkSize: 5 * 1024 * 1024,  // 5MB 分片
    maxConcurrent: 2,
    enableResume: true
  }
});

videoUploader.use([
  new FileValidatorPlugin({
    maxSize: 500 * 1024 * 1024,  // 500MB
    accept: ['video/mp4', 'video/webm']
  }),
  new SmartRetryPlugin({
    maxRetries: 5,
    strategy: 'exponential',
    initialDelay: 2000
  })
]);

// 实现断点续传
videoUploader.onInitChunk = async (uploadFile) => {
  const { data } = await checkFile({
    fileHash: uploadFile.chunkManager?.fileHash
  });
  
  return {
    chunks: data.chunks || [],
    fileHash: data.fileHash
  };
};
```

---

### 场景 4：带水印的图片上传

```typescript
import { 
  FileValidatorPlugin, 
  WatermarkPlugin, 
  CompressImagePlugin 
} from '@file-ud.js/plugins';

const watermarkedUploader = FileUD.createUploader("watermarked", {
  action: '/api/upload-watermarked'
});

watermarkedUploader.use([
  // 1. 验证文件
  new FileValidatorPlugin({
    maxSize: 10 * 1024 * 1024,
    accept: ['image/*']
  }),
  
  // 2. 添加水印
  new WatermarkPlugin({
    text: "© MyCompany 2024",
    position: "bottom-right",
    fontSize: 28,
    opacity: 0.7
  }),
  
  // 3. 压缩图片
  new CompressImagePlugin({
    quality: 0.8,
    format: 'webp'
  })
]);
```

---

## 🐛 故障排查

### 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 上传失败 | 网络问题 | 检查网络连接，使用 SmartRetryPlugin |
| 文件太大 | 超过限制 | 调整 maxSize 或使用分片上传 |
| 类型不支持 | accept 配置错误 | 检查 MIME 类型或扩展名 |
| 压缩后模糊 | 质量设置过低 | 提高 quality 值（0.8-0.9） |
| 水印不显示 | 跨域问题 | 使用同域名图片或 Base64 |
| 进度不更新 | 未监听 onUpdate | 添加 onUpdate 回调 |

### 调试技巧

```typescript
// 启用详细日志
FileUD.startUDLogger({
  enabled: true,
  level: 0  // DEBUG 级别
});

// 监听所有事件
uploader.on('*', (event, data) => {
  console.log('事件:', event, '数据:', data);
});

// 检查文件状态
console.log('文件列表:', uploader.files);
console.log('全局进度:', uploader.totalPercent);
console.log('已上传大小:', uploader.uploadedSize);
console.log('总大小:', uploader.totalFormatSize);
```

---

## 📞 获取帮助

### 官方资源

- 📖 **完整文档**: [GitHub Wiki](https://github.com/your-repo/file-ud/wiki)
- 💬 **讨论区**: [GitHub Discussions](https://github.com/your-repo/file-ud/discussions)
- 🐛 **问题反馈**: [GitHub Issues](https://github.com/your-repo/file-ud/issues)
- 📧 **邮件支持**: support@file-ud.com

### 社区资源

- Stack Overflow: 使用 `file-ud` 标签提问
- Discord: 加入官方 Discord 服务器
- Twitter: 关注 [@file_ud](https://twitter.com/file_ud)

---

## 🎓 视频教程

即将推出：
- [ ] 快速入门教程
- [ ] 分片上传详解
- [ ] 插件开发指南
- [ ] 性能优化技巧

---

## 📝 更新日志

查看所有版本的更新：
- [v1.0.0](./CHANGELOG.md) - 首次发布

---

## 🤝 贡献指南

我们欢迎社区贡献！

**如何贡献**:
1. Fork 仓库
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

**贡献内容**:
- 🐛 修复 Bug
- ✨ 新增功能
- 📖 改进文档
- 🧪 添加测试
- 🌍 国际化支持

---

## 📄 许可证

MIT License - 查看 [LICENSE](./LICENSE) 文件了解详情

---

## ⭐ 支持我们

如果这个项目对你有帮助，请给我们一个 Star！

[![GitHub stars](https://img.shields.io/github/stars/your-repo/file-ud?style=social)](https://github.com/your-repo/file-ud)

---

**最后更新**: 2024-01-XX
