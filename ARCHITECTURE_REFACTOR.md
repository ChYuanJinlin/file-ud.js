# FileUD 架构重构完成

## 📋 概述

本次重构完成了 FileUD 核心架构的优化，建立了清晰的继承关系和职责划分。

## 🏗️ 新架构

### 核心类层次

```
File (基类) ← 所有文件传输的父类
├── UploadFile (上传)
└── DownloadFile (下载)

FileManager (统一管理器)
├── 管理 UploadFile 和 DownloadFile
├── 支持文件回显
└── 提供统一 API
```

### 目录结构

```
packages/core/src/fileUD/
├── File.ts              # 核心文件基类
├── UploadFile.ts        # 上传文件类（继承 File）
├── DownloadFile.ts      # 下载文件类（继承 File）
├── FileManager.ts       # 统一管理器（新增）
├── errors.ts            # 错误定义
└── index.ts             # 导出入口
```

## 🚀 使用示例

### 1. 使用 FileManager（推荐）

```typescript
import { FileManager } from 'file-ud';

// 创建管理器
const manager = new FileManager(
  { action: '/api/upload' },  // Uploader 配置
  { action: '/api/download' }  // Downloader 配置
);

// 添加上传任务
const uploadFile = manager.addUploadFile({
  fileId: 'file-001',
  File: fileObject,
  fileName: 'document.pdf'
});

// 添加下载任务
const downloadFile = manager.addDownloadFile('https://example.com/file.pdf', {
  fileName: 'downloaded.pdf'
});

// 回显文件列表（从服务端获取）
manager.setFiles([
  {
    fileId: 'file-002',
    fileName: 'existing.pdf',
    status: 'success',
    percent: 100,
    type: 'upload'
  },
  {
    fileId: 'file-003',
    fileName: 'partial.docx',
    status: 'uploading',
    percent: 50,
    type: 'upload'
  }
]);

// 开始传输
await manager.start('file-001');

// 批量操作
manager.pauseAll();
manager.resumeAll();
manager.cancelAll();
manager.retryAll();

// 监听事件
manager.on('update', (files) => {
  console.log('文件状态更新:', files);
});

manager.on('error', (error) => {
  console.error('传输错误:', error);
});
```

### 2. 使用独立的 Uploader/Downloader（向后兼容）

```typescript
import { Uploader, Downloader } from 'file-ud';

// 上传
const uploader = new Uploader({
  action: '/api/upload',
  maxConcurrent: 3
});

uploader.addFile(fileObject);
uploader.start();

// 下载
const downloader = new Downloader({
  action: '/api/download'
});

downloader.add('https://example.com/file.pdf');
downloader.start();
```

## ✨ 关键改进

### 1. 清晰的职责划分

- **File 基类**：文件本身的属性和行为（进度、速率、状态）
- **UploadFile/DownloadFile**：上传/下载特有的业务逻辑
- **Uploader/Downloader**：任务调度和管理
- **FileManager**：统一管理入口，支持上传和下载

### 2. 代码复用

通用逻辑在 File 基类中实现：
- ✅ 统一的 XHR 拦截器（网络检查、全局 headers）
- ✅ 通用的进度处理和速率计算
- ✅ 生命周期回调（onSuccess/onError）
- ✅ XHR 工厂方法（createXHR）

### 3. 易于扩展

新增传输类型只需继承 File 基类：

```typescript
import File from 'file-ud/File';

class FTPFile extends File {
  public async transfer(): Promise<void> {
    // FTP 传输逻辑
  }
}
```

### 4. 向后兼容

保留了 Uploader 和 Downloader，现有代码无需修改。

## 📊 对比旧架构

| 特性 | 旧架构 | 新架构 |
|------|--------|--------|
| 基类名称 | TransferFile | File |
| 位置 | transfer/ | fileUD/ |
| 统一管理 | ❌ 无 | ✅ FileManager |
| 文件回显 | ⚠️ 分散 | ✅ 集中管理 |
| 代码复用 | ⚠️ 部分重复 | ✅ 完全复用 |
| 扩展性 | ⚠️ 一般 | ✅ 优秀 |

## 🔧 迁移指南

### 从 TransferFile 迁移到 File

```typescript
// 旧代码
import TransferFile from 'file-ud/transfer/TransferFile';

class MyFile extends TransferFile {
  // ...
}

// 新代码
import File from 'file-ud/fileUD/File';

class MyFile extends File {
  // ...
}
```

### 从独立管理器迁移到 FileManager

```typescript
// 旧代码
const uploader = new Uploader(config);
const downloader = new Downloader(config);

// 新代码
const manager = new FileManager(uploaderConfig, downloaderConfig);
```

## 📝 下一步计划

1. ✅ ~~创建 File 基类~~
2. ✅ ~~重构 UploadFile 和 DownloadFile~~
3. ✅ ~~创建 FileManager~~
4. ⏳ 删除 TransferFile.ts（确认不再使用后）
5. ⏳ 完善文档和示例
6. ⏳ 编写单元测试

## 🎉 总结

新的架构更加清晰、灵活和易于维护：
- **File** 作为核心基类，封装所有通用逻辑
- **FileManager** 提供统一的管理入口
- **向后兼容**，不影响现有代码
- **易于扩展**，支持新的传输类型
