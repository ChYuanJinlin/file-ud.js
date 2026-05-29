# Downloader 重构说明

## 🎯 设计理念

Downloader 采用简洁的 API 设计，分为两类场景：

### 1. **受管理的下载**（通过 Downloader 实例）
- 用户调用 `downloadFile(url, fileName)` 添加下载任务
- 自动添加到 [files](file://d:\yjl\file-UD\packages\core\src\downloader\index.ts#L28-L28) 列表
- 自动触发下载
- 支持进度监控、暂停/恢复/取消等控制

### 2. **直接下载**（静态方法）
- 调用 `Downloader.saveFile(fileName, url)` 
- 不经过 Downloader 管理
- 直接触发浏览器下载对话框
- 适合一次性下载场景

## 📝 API 设计

### Downloader 实例方法

#### `downloadFile(url, fileName?, options?)`
添加单个下载任务并自动开始下载

```typescript
const downloader = new Downloader();

// 基本用法
const task = downloader.downloadFile(
  'https://example.com/file.pdf',
  'document.pdf'
);

// 带选项
const task = downloader.downloadFile(
  'https://example.com/large-file.zip',
  'archive.zip',
  {
    useBlob: true,        // 触发浏览器下载对话框
    timeout: 60000,       // 超时时间
    headers: {            // 自定义请求头
      'Authorization': 'Bearer token'
    }
  }
);

// 监听进度
task.on('progress', (percent) => {
  console.log(`进度: ${percent}%`);
});

// 控制下载
task.pause();
task.resume();
task.cancel();
```

#### `downloadFiles(tasks)`
批量添加下载任务

```typescript
const tasks = downloader.downloadFiles([
  {
    url: 'https://example.com/file1.pdf',
    fileName: 'doc1.pdf'
  },
  {
    url: 'https://example.com/file2.mp4',
    fileName: 'video.mp4',
    options: {
      useBlob: true
    }
  }
]);

// 返回 DownloadFile 数组
tasks.forEach(task => {
  console.log(task.fileName);
});
```

#### `start()`
手动开始所有待下载任务（当 `autoStart: false` 时使用）

```typescript
const downloader = new Downloader({ autoStart: false });

downloader.downloadFile('https://example.com/file.pdf');
downloader.downloadFile('https://example.com/video.mp4');

// 手动开始所有下载
await downloader.start();
```

### Downloader 静态方法

#### `saveFile(fileName, url)`
直接保存文件到本地（触发浏览器下载对话框）

```typescript
import { Downloader } from '@file-ud/core';

// 不需要创建 Downloader 实例
await Downloader.saveFile('report.pdf', 'https://example.com/report.pdf');

console.log('文件已保存');
```

## 🔄 与旧设计的对比

### 旧设计（复杂）
```typescript
// ❌ 需要传递复杂的配置对象
const task = downloader.addFile({
  url: 'https://example.com/file.pdf',
  fileName: 'document.pdf',
  useBlob: true,
  timeout: 30000,
  headers: {}
});

// ❌ 需要手动调用 start()
downloader.start();

// ❌ 冗余的方法
downloader.setFiles(files);     // 文件回显
downloader.clearFiles();        // 清空列表
downloader.cancelAll();         // 全部取消
downloader.pauseAll();          // 全部暂停
downloader.resumeAll();         // 全部恢复
```

### 新设计（简洁）
```typescript
// ✅ 简单的参数列表
const task = downloader.downloadFile(
  'https://example.com/file.pdf',
  'document.pdf',
  { useBlob: true }  // 只需要额外选项
);

// ✅ 自动开始下载（可配置）
// 无需手动调用 start()

// ✅ 精简的方法
// 移除了 setFiles、clearFiles、cancelAll 等冗余方法
// 用户可以直接操作 files 数组或调用单个文件的方法
```

## 💡 使用场景

### 场景 1：批量下载管理器
```typescript
const downloader = new Downloader({
  autoStart: true,
  timeout: 30000
});

// 监听全局进度
downloader.onUpdate((files) => {
  console.log('总进度:', downloader.totalPercent + '%');
  console.log('速度:', downloader.speed.currentSpeedFormatted);
});

// 添加多个下载任务
downloader.downloadFiles([
  { url: 'https://example.com/file1.pdf', fileName: 'doc1.pdf' },
  { url: 'https://example.com/file2.pdf', fileName: 'doc2.pdf' },
  { url: 'https://example.com/file3.pdf', fileName: 'doc3.pdf' }
]);
```

### 场景 2：单个文件下载
```typescript
const downloader = new Downloader();

const task = downloader.downloadFile(
  'https://example.com/large-video.mp4',
  'video.mp4'
);

// 监听单个文件进度
task.on('progress', (percent) => {
  console.log(`${task.fileName}: ${percent}%`);
});

// 用户点击暂停按钮
document.getElementById('pause-btn').onclick = () => {
  task.pause();
};

// 用户点击继续按钮
document.getElementById('resume-btn').onclick = () => {
  task.resume();
};
```

### 场景 3：快速下载（不管理）
```typescript
import { Downloader } from '@file-ud/core';

// 一键下载，无需管理
async function handleDownload() {
  try {
    await Downloader.saveFile('template.docx', 'https://example.com/template.docx');
    alert('下载成功！');
  } catch (error) {
    alert('下载失败：' + error.message);
  }
}
```

## 🎨 架构优势

### 1. **API 简洁**
- `downloadFile(url, fileName, options?)` - 参数清晰
- 不需要构造复杂的配置对象
- 符合直觉的使用方式

### 2. **职责明确**
- **Downloader 实例**：管理下载任务列表，提供进度监控和控制
- **saveFile 静态方法**：一次性下载，不纳入管理

### 3. **避免冗余**
- 移除了 [setFiles](file://d:\yjl\file-UD\packages\core\src\downloader\index.ts#L185-L222)、[clearFiles](file://d:\yjl\file-UD\packages\core\src\downloader\index.ts#L227-L237)、[cancelAll](file://d:\yjl\file-UD\packages\core\src\downloader\index.ts#L242-L246) 等方法
- 用户可以通过以下方式实现相同功能：
  ```typescript
  // 清空列表
  downloader.files = [];
  downloader.activeFiles = [];
  
  // 取消所有下载
  downloader.files.forEach(file => file.cancel());
  
  // 暂停所有下载
  downloader.files.forEach(file => file.pause());
  ```

### 4. **类型统一**
- 使用 [DownloadOptions](file://d:\yjl\file-UD\packages\core\src\types\index.d.ts#L584-L597) 作为统一的配置类型
- [downloadFile](file://d:\yjl\file-UD\packages\core\src\downloader\index.ts#L113-L172) 方法的第三个参数是 `Omit<DownloadOptions, 'url' | 'fileName'>`
- 避免重复定义类型

## 📊 代码量对比

| 项目 | 旧设计 | 新设计 | 变化 |
|------|--------|--------|------|
| 行数 | ~490 行 | ~310 行 | ⬇️ -37% |
| 公共方法数 | 15+ | 5 | ⬇️ -67% |
| 复杂度 | 高 | 低 | ⬇️ 简化 |

## ✅ 总结

新的 Downloader 设计更加简洁和直观：

1. ✅ **核心方法**：`downloadFile(url, fileName, options?)`
2. ✅ **批量方法**：`downloadFiles(tasks)`
3. ✅ **静态方法**：`saveFile(fileName, url)` - 快速下载
4. ✅ **继承 Transfer**：复用文件列表管理和统计功能
5. ✅ **避免冗余**：移除不必要的方法，保持 API 精简

这种设计既满足了下载任务管理的需求，又提供了快速下载的便捷方式，同时保持了代码的简洁性和可维护性！🚀
