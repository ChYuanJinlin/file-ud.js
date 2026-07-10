# 文件验证插件 (FileValidatorPlugin)

## 📖 功能介绍

文件验证插件在文件传输前进行全面的校验，确保文件符合业务要求，避免无效或恶意文件传输到服务器。

### ✨ 核心特性

- ✅ **大小验证**：支持最小/最大文件大小限制
- ✅ **类型验证**：基于 MIME 类型或文件扩展名
- ✅ **空文件检测**：防止上传空文件
- ✅ **自定义验证**：支持自定义验证函数
- ✅ **错误消息定制**：可自定义所有错误提示
- ✅ **最高优先级**：在所有插件之前执行（priority: 0）
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
import { FileValidatorPlugin } from '@file-ud.js/plugins/uploader';

const uploader = FileUD.createUploader("myUploader", {
  action: '/api/upload',
});

// 使用默认配置（无限制）
uploader.use(new FileValidatorPlugin());
```

### 3. 常用配置

```typescript
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,    // 最大 10MB
  minSize: 1024,                 // 最小 1KB
  accept: ['image/*', 'video/*'], // 仅图片和视频
  allowEmpty: false              // 不允许空文件
}));
```

---

## ⚙️ 配置选项

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxSize` | `number` | `Infinity` | 最大文件大小（字节） |
| `minSize` | `number` | `0` | 最小文件大小（字节） |
| `accept` | `string[]` | `[]` | 允许的文件类型（MIME 类型或扩展名） |
| `allowEmpty` | `boolean` | `false` | 是否允许空文件 |
| `customValidate` | `(file: File, error: typeof FileUDError) => boolean \| Promise<boolean>` | - | 自定义验证函数 |
| `messages` | `object` | `{}` | 自定义错误消息 |

### messages 配置项

| 键名 | 函数签名 | 默认消息 |
|------|---------|---------|
| `maxSize` | `(max: number, current: number) => string` | "文件 {fileName} 太大，最大 {maxSize}" |
| `minSize` | `(min: number, current: number) => string` | "文件 {fileName} 太小，最小 {minSize}" |
| `accept` | `(accept: string[], fileName: string) => string` | "文件 {fileName} 类型不支持" |
| `empty` | `() => string` | "文件 {fileName} 是空文件" |
| `custom` | `(fileName: string) => string` | "文件 {fileName} 验证失败" |

---

## 📊 使用示例

### 示例 1：图片上传验证

```typescript
uploader.use(new FileValidatorPlugin({
  maxSize: 5 * 1024 * 1024,      // 最大 5MB
  accept: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  allowEmpty: false,
  messages: {
    maxSize: (max, current) => 
      `图片不能超过 ${formatFileSize(max)}，当前 ${formatFileSize(current)}`,
    accept: (accept, fileName) => 
      `只支持 JPG、PNG、GIF、WebP 格式的图片`
  }
}));
```

### 示例 2：视频上传验证

```typescript
uploader.use(new FileValidatorPlugin({
  maxSize: 100 * 1024 * 1024,    // 最大 100MB
  minSize: 1024 * 1024,          // 最小 1MB
  accept: ['video/mp4', 'video/webm', 'video/ogg'],
  messages: {
    minSize: (min, current) => 
      `视频文件不能小于 ${formatFileSize(min)}`,
    maxSize: (max, current) => 
      `视频文件不能超过 ${formatFileSize(max)}`
  }
}));
```

### 示例 3：文档上传验证

```typescript
uploader.use(new FileValidatorPlugin({
  maxSize: 20 * 1024 * 1024,     // 最大 20MB
  accept: [
    '.pdf',
    '.doc', '.docx',
    '.xls', '.xlsx',
    '.ppt', '.pptx'
  ],
  messages: {
    accept: () => 
      '只支持 PDF、Word、Excel、PowerPoint 格式的文档'
  }
}));
```

### 示例 4：自定义验证逻辑

```typescript
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,
  accept: ['image/*'],
  
  // 自定义验证：检查图片尺寸
  customValidate: async (file, ErrorClass) => {
    if (!file.type.startsWith('image/')) {
      return true; // 非图片文件跳过此验证
    }
    
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        
        // 检查图片尺寸
        if (img.width < 800 || img.height < 600) {
          console.warn(`图片尺寸太小: ${img.width}x${img.height}`);
          resolve(false); // 验证失败
        } else {
          resolve(true);  // 验证通过
        }
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(false);
      };
      
      img.src = url;
    });
  },
  
  messages: {
    custom: (fileName) => 
      `图片 ${fileName} 尺寸不符合要求（最小 800x600）`
  }
}));
```

---

## 💡 高级用法

### 1. 动态验证规则

```typescript
// 根据用户等级设置不同的文件大小限制
const getUserMaxSize = (userLevel: number) => {
  switch (userLevel) {
    case 'vip': return 100 * 1024 * 1024;  // VIP: 100MB
    case 'premium': return 50 * 1024 * 1024; // 高级: 50MB
    default: return 10 * 1024 * 1024;       // 普通: 10MB
  }
};

const userLevel = getCurrentUserLevel();

uploader.use(new FileValidatorPlugin({
  maxSize: getUserMaxSize(userLevel),
  accept: ['image/*', 'video/*']
}));
```

### 2. 组合多个验证器

```typescript
// 为不同类型的文件创建不同的验证规则
const imageValidator = new FileValidatorPlugin({
  maxSize: 5 * 1024 * 1024,
  accept: ['image/*']
});

const videoValidator = new FileValidatorPlugin({
  maxSize: 100 * 1024 * 1024,
  accept: ['video/*']
});

// 根据文件类型选择验证器
uploader.onSelect = async (file) => {
  if (file.type.startsWith('image/')) {
    uploader.use(imageValidator);
  } else if (file.type.startsWith('video/')) {
    uploader.use(videoValidator);
  }
  return true;
};
```

### 3. 异步验证（如调用 API）

```typescript
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,
  
  // 异步验证：检查文件是否在黑名单中
  customValidate: async (file) => {
    try {
      const response = await fetch('/api/check-file-hash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hash: await calculateMD5(file),
          fileName: file.name
        })
      });
      
      const result = await response.json();
      return !result.isBlocked; // 如果文件被阻止，返回 false
    } catch (error) {
      console.error('文件验证失败:', error);
      return true; // 验证服务异常时，默认通过
    }
  },
  
  messages: {
    custom: (fileName) => 
      `文件 ${fileName} 已被禁止上传`
  }
}));
```

### 4. 结合其他插件使用

```typescript
import { 
  FileValidatorPlugin, 
  CompressImagePlugin, 
  WatermarkPlugin 
} from '@file-ud.js/plugins/uploader';

uploader.use([
  // 1. 文件验证（优先级最高，最先执行）
  new FileValidatorPlugin({
    maxSize: 10 * 1024 * 1024,
    accept: ['image/*']
  }),
  
  // 2. 添加水印
  new WatermarkPlugin({
    text: "© MyCompany"
  }),
  
  // 3. 图片压缩
  new CompressImagePlugin({
    quality: 0.8
  })
]);
```

---

## 🔍 验证流程

```
1. 用户选择文件
   ↓
2. 插件拦截文件（onFileSelect 钩子，priority: 0）
   ↓
3. 空文件检查
   ├─ 失败 → 抛出 FILE_EMPTY 错误
   └─ 通过 ↓
   
4. 最小大小检查
   ├─ 失败 → 抛出 FILE_TOO_SMALL 错误
   └─ 通过 ↓
   
5. 最大大小检查
   ├─ 失败 → 抛出 FILE_TOO_LARGE 错误
   └─ 通过 ↓
   
6. 文件类型检查
   ├─ 失败 → 抛出 INVALID_TYPE 错误
   └─ 通过 ↓
   
7. 自定义验证
   ├─ 失败 → 抛出 FILE_CORRUPTED 错误
   └─ 通过 ↓
   
8. 验证通过，继续上传流程
```

---

## 🎯 最佳实践

### 1. 合理设置文件大小限制

| 文件类型 | 推荐最大值 | 说明 |
|---------|-----------|------|
| **头像** | 1-2 MB | 小尺寸图片 |
| **普通照片** | 5-10 MB | 平衡质量和大小 |
| **高清照片** | 10-20 MB | 保留更多细节 |
| **短视频** | 50-100 MB | 1-2 分钟视频 |
| **长视频** | 200-500 MB | 需要分片上传 |
| **文档** | 10-20 MB | PDF、Word 等 |
| **压缩包** | 100-500 MB | 需要断点续传 |

### 2. 精确的文件类型限制

```typescript
// ❌ 不推荐：过于宽松
new FileValidatorPlugin({
  accept: ['*/*']  // 允许所有文件
});

// ✅ 推荐：明确指定类型
new FileValidatorPlugin({
  accept: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
  ]
});

// ✅ 或使用通配符
new FileValidatorPlugin({
  accept: ['image/*']  // 所有图片类型
});
```

### 3. 友好的错误提示

```typescript
new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,
  accept: ['image/*'],
  
  messages: {
    maxSize: (max, current) => {
      const ratio = (current / max).toFixed(1);
      return `文件大小超出限制 ${ratio} 倍，请压缩后重新上传（最大 ${formatFileSize(max)}）`;
    },
    accept: (accept, fileName) => {
      const ext = fileName.split('.').pop()?.toUpperCase();
      return `不支持 .${ext} 格式，请转换为 JPG、PNG 或 WebP 格式`;
    }
  }
});
```

### 4. 前端 + 后端双重验证

```typescript
// 前端验证（用户体验）
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024,
  accept: ['image/*']
}));

// 后端验证（安全性）
// 在服务器端再次验证文件大小和类型
// 不要完全信任前端验证！
```

---

## 🐛 常见问题

### Q1: 为什么设置了 accept 但还是能选择其他类型文件？

**原因**：`accept` 属性只是提示浏览器过滤文件选择器，用户可以手动选择"所有文件"绕过。

**解决方案**：
```typescript
// 前端验证只是第一道防线，必须在后端再次验证
uploader.use(new FileValidatorPlugin({
  accept: ['image/*']
}));

// 后端验证（Node.js 示例）
app.post('/api/upload', (req, res) => {
  const file = req.files.file;
  
  // 再次检查 MIME 类型
  if (!file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: '只支持图片文件' });
  }
  
  // 继续处理...
});
```

### Q2: 如何获取详细的验证错误信息？

```typescript
uploader.onError = (error) => {
  console.log('错误码:', error.code);
  console.log('错误消息:', error.message);
  console.log('上下文:', error.context);
  
  // 根据错误码显示不同的提示
  switch (error.code) {
    case 'FILE_TOO_LARGE':
      showToast('文件太大，请压缩后上传');
      break;
    case 'INVALID_TYPE':
      showToast('文件格式不支持');
      break;
    default:
      showToast(error.message);
  }
};
```

### Q3: 自定义验证函数如何抛出错误？

```typescript
uploader.use(new FileValidatorPlugin({
  customValidate: async (file, ErrorClass) => {
    // 方式1：返回 false（使用默认错误消息）
    if (file.size === 0) {
      return false;
    }
    
    // 方式2：抛出自定义错误（推荐）
    if (isCorrupted(file)) {
      throw ErrorClass.FILE_CORRUPTED
        .setMessage('文件已损坏，请重新选择')
        .setContext({ fileName: file.name });
    }
    
    return true;
  }
}));
```

### Q4: 验证会影响性能吗？

**影响很小**：
- 大小和类型验证：O(1)，几乎无开销
- 自定义验证：取决于你的实现
  - 同步验证：可能阻塞主线程
  - 异步验证：不会阻塞

**优化建议**：
```typescript
// ✅ 推荐：异步验证
customValidate: async (file) => {
  // 耗时操作放在异步函数中
  return await someAsyncCheck(file);
}

// ❌ 不推荐：同步验证中的耗时操作
customValidate: (file) => {
  // 这会阻塞主线程
  expensiveSyncOperation(file);
  return true;
}
```

---

## 📈 安全建议

### 1. 不要信任前端验证

```typescript
// 前端验证只是为了提升用户体验
uploader.use(new FileValidatorPlugin({
  maxSize: 10 * 1024 * 1024
}));

// 必须在后端再次验证！
// 攻击者可以绕过前端验证
```

### 2. 检查文件魔数（Magic Number）

```typescript
// 高级验证：检查文件真实类型
uploader.use(new FileValidatorPlugin({
  customValidate: async (file) => {
    const buffer = await readFileHeader(file, 4);
    const magicNumber = buffer.toString('hex');
    
    // JPEG: FFD8FF
    // PNG: 89504E47
    // GIF: 47494638
    
    if (file.type === 'image/jpeg' && !magicNumber.startsWith('ffd8ff')) {
      return false; // 伪造的 JPEG 文件
    }
    
    return true;
  }
}));
```

### 3. 限制文件数量

```typescript
// 虽然 FileValidatorPlugin 不直接支持数量限制
// 但可以在 onSelect 回调中实现
let fileCount = 0;
const MAX_FILES = 10;

uploader.onSelect = (file) => {
  if (fileCount >= MAX_FILES) {
    alert(`最多只能上传 ${MAX_FILES} 个文件`);
    return false;
  }
  fileCount++;
  return true;
};
```

---

## 📝 更新日志

### v0.1.1
- 补充插件架构、默认插件、卸载插件与按场景引入插件的文档说明。

### v0.1.0
- 首次发布文件验证插件。
- 支持大小验证、类型验证、空文件检测、自定义验证函数、错误消息定制与最高优先级执行。

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

**报告 Bug**：[GitHub Issues](https://github.com/ChYuanJinlin/file-ud.js/issues)

**提出建议**：[Feature Requests](https://github.com/ChYuanJinlin/file-ud.js/discussions)
