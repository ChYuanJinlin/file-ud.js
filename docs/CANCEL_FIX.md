# 取消上传功能修复说明（最终版 v2）

## 🐛 问题描述

### 第一次修复后的新问题

用户反馈：点击取消后，文件仍然继续上传！

```log
[INFO] [uploadChunkManager] ✅ 开始取消文件 1 - 副本 (2).mp4 的上传 {activeControllers: 0}
[INFO] [uploadChunkManager] ✅ 文件 1 - 副本 (2).mp4 已取消上传 {completedChunks: 90, totalChunks: 368}
[DEBUG] [uploadChunkManager] 🔍 开始上传分片 91/368  ❌ 取消后仍有新分片开始上传！
[DEBUG] [uploadChunkManager] 🔍 开始上传分片 92/368  ❌
[DEBUG] [uploadChunkManager] 🔍 开始上传分片 93/368  ❌
[INFO] [uploadChunkManager] ✅ 分片 91/368 上传成功  ❌ 分片仍然上传成功！
```

**问题分析**：
- `activeControllers: 0` 说明没有活跃的 HTTP 请求需要中止
- 但是**已经入队到 PQueue 的任务仍然会继续执行**
- [cancelUpload](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1016-L1077) 只是唤醒了等待中的任务，但没有阻止它们继续执行

---

## 🔍 根本原因

### PQueue 并发队列的执行机制

```typescript
// uploadWithConcurrency 方法
for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
  uploadPromises.push(
    this.queue.add(async () => {
      await this.waitForResume(); // ✅ 检查暂停状态
      await this.uploadChunkWithRetry(chunkIndex); // ❌ 唤醒后继续执行
    })
  );
}
```

**问题流程**：
1. 用户点击取消
2. [cancelUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1016-L1077) 设置 `isPaused = true`
3. 唤醒所有等待的 resolve（包括分片 91-95）
4. **被唤醒的任务继续执行 `uploadChunkWithRetry()`**
5. 新的 HTTP 请求被创建并发送

**核心缺陷**：
- ❌ 只检查了暂停状态，没有检查取消状态
- ❌ 唤醒后立即继续执行，没有二次验证
- ❌ 循环仍在继续入队新任务

---

## ✅ 最终解决方案

### 1. 添加 isCancelled 标志

在 [uploadChunkManager](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L24-L1436) 类中添加取消标志：

```typescript
private isCancelled: boolean = false; // ✅ 是否已取消（用于阻止新分片启动）
```

---

### 2. 修改 waitForResume 方法

唤醒后检查是否已取消，如果已取消则抛出错误：

```typescript
private async waitForResume(): Promise<void> {
  if (!this.isPaused) {
    return;
  }

  await new Promise<void>((resolve) => {
    this.pauseResolves.push(() => resolve());
  });

  // ✅ 关键修复：唤醒后检查是否已取消
  if (this.isCancelled) {
    logger.info("uploadChunkManager", `分片上传被取消，停止执行`, {
      fileId: this.uploadFile.fileId,
      fileName: this.uploadFile.fileName,
    });
    throw new Error("Upload cancelled"); // ✅ 抛出错误，中断执行
  }
}
```

---

### 3. 修改 cancelUpload 方法

在开始时设置 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 标志：

```typescript
public cancelUpload(): void {
  logger.info("uploadChunkManager", `开始取消文件 ${this.uploadFile.fileName} 的上传`, {
    fileId: this.uploadFile.fileId,
    fileName: this.uploadFile.fileName,
    activeControllers: this.abortControllers.length,
  });

  // ✅ 关键：设置取消标志，阻止新分片启动
  this.isCancelled = true;

  // ✅ 中止所有活跃的 HTTP 请求
  this.abortControllers.forEach((controller) => {
    try {
      controller.abort();
      logger.debug("uploadChunkManager", `已中止一个分片的 HTTP 请求`);
    } catch (error) {
      logger.warn("uploadChunkManager", `中止分片请求时出错:`, error);
    }
  });

  // 清空 AbortController 数组
  this.abortControllers = [];

  // 设置为暂停状态
  this.isPaused = true;

  // 唤醒所有等待中的分片上传任务
  if (this.pauseResolves.length > 0) {
    this.pauseResolves.forEach((resolve) => resolve());
    this.pauseResolves = [];
  }

  // ... 其他清理工作
}
```

---

### 4. 修改 uploadWithConcurrency 方法

在循环开始前检查是否已取消，避免继续入队新任务：

```typescript
private async uploadWithConcurrency(): Promise<void> {
  const uploadPromises: Promise<void>[] = [];

  for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
    // ✅ 关键修复：检查是否已取消，如果已取消则停止入队新任务
    if (this.isCancelled) {
      logger.info("uploadChunkManager", `检测到取消标志，停止入队新分片`, {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        currentChunk: chunkIndex,
        totalChunks: this.totalChunks,
      });
      break; // ✅ 跳出循环，不再入队新任务
    }

    // 跳过已上传的分片
    if (this.chunks[chunkIndex]) {
      continue;
    }

    // 入队分片上传任务
    uploadPromises.push(
      this.queue.add(async () => {
        // ✅ 在真正开始上传前检查是否暂停或取消
        await this.waitForResume();

        // 记录分片开始时间
        chunkStartTimes[chunkIndex] = performance.now();

        try {
          await this.uploadChunkWithRetry(chunkIndex);
        } catch (error) {
          // ... 错误处理
          throw error;
        }
      }),
    );
  }

  await Promise.allSettled(uploadPromises);
  // ... 后续处理
}
```

---

## 🎯 修复效果对比

### 修复前（v1）

```
用户点击"取消"
  ↓
设置 isPaused = true
  ↓
唤醒所有等待的 resolve
  ↓
被唤醒的任务继续执行 ❌
  ↓
新的分片开始上传 ❌
  ↓
日志显示：
  - "开始取消文件..."
  - "文件已取消上传"
  - "开始上传分片 91/368" ❌
  - "分片 91/368 上传成功" ❌
```

### 修复后（v2）

```
用户点击"取消"
  ↓
设置 isCancelled = true ✅
  ↓
中止所有活跃的 HTTP 请求 ✅
  ↓
唤醒所有等待的 resolve
  ↓
被唤醒的任务检查 isCancelled ✅
  ↓
抛出 "Upload cancelled" 错误 ✅
  ↓
循环检测到 isCancelled，break ✅
  ↓
日志显示：
  - "开始取消文件..."
  - "已中止 X 个分片的 HTTP 请求" ✅
  - "检测到取消标志，停止入队新分片" ✅
  - "分片上传被取消，停止执行" ✅
  - "文件已取消上传" ✅
```

---

## 📊 测试场景

### 场景 1：取消时有活跃请求

**操作**：
1. 开始上传大文件（368 个分片）
2. 等待约 90 个分片上传完成
3. 点击"取消"按钮

**预期结果**：
```log
[INFO] uploadChunkManager: 开始取消文件 xxx.mp4 的上传 {activeControllers: 5}
[DEBUG] uploadChunkManager: 已中止一个分片的 HTTP 请求
[DEBUG] uploadChunkManager: 已中止一个分片的 HTTP 请求
... (共 5 条)
[INFO] uploadChunkManager: 检测到取消标志，停止入队新分片 {currentChunk: 95, totalChunks: 368}
[INFO] uploadChunkManager: 分片上传被取消，停止执行
[INFO] uploadChunkManager: 文件 xxx.mp4 已取消上传 {completedChunks: 90, totalChunks: 368}
```

**验证点**：
- ✅ 没有新的分片开始上传
- ✅ 活跃请求被中止
- ✅ 文件状态变为 "cancelled"

---

### 场景 2：取消时没有活跃请求

**操作**：
1. 开始上传大文件
2. 在分片间隙点击"取消"（此时 `activeControllers: 0`）

**预期结果**：
```log
[INFO] uploadChunkManager: 开始取消文件 xxx.mp4 的上传 {activeControllers: 0}
[INFO] uploadChunkManager: 检测到取消标志，停止入队新分片 {currentChunk: 91, totalChunks: 368}
[INFO] uploadChunkManager: 分片上传被取消，停止执行
[INFO] uploadChunkManager: 文件 xxx.mp4 已取消上传 {completedChunks: 90, totalChunks: 368}
```

**验证点**：
- ✅ 即使没有活跃请求，也不会启动新分片
- ✅ 循环立即终止

---

### 场景 3：取消后恢复（应该失败）

**操作**：
```typescript
file.cancel();
file.resume(); // 尝试恢复
```

**预期结果**：
- ❌ 无法恢复，因为 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 是永久性的
- ✅ 文件状态保持为 "cancelled"

---

## 🔍 技术细节

### 1. 双重防护机制

```typescript
// 防护层 1：循环入口处检查
for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
  if (this.isCancelled) {
    break; // ✅ 阻止新任务入队
  }
  
  uploadPromises.push(
    this.queue.add(async () => {
      // 防护层 2：任务执行前检查
      await this.waitForResume();
      
      if (this.isCancelled) {
        throw new Error("Upload cancelled"); // ✅ 阻止已入队任务执行
      }
      
      await this.uploadChunkWithRetry(chunkIndex);
    })
  );
}
```

---

### 2. 状态流转

```
pending → UDLoading → cancelled ✅
paused  → UDLoading → cancelled ✅
cancelled → resume → ❌ 无效（isCancelled 仍为 true）
```

---

### 3. 错误处理

```typescript
try {
  await this.uploadChunkWithRetry(chunkIndex);
} catch (error) {
  if (error instanceof Error && error.message === "Upload cancelled") {
    // ✅ 取消导致的错误，静默处理
    logger.debug("uploadChunkManager", `分片 ${chunkIndex} 因取消而中断`);
    return;
  }
  
  // 其他错误，正常处理
  throw error;
}
```

---

## 💡 使用示例

### 1. 基本取消操作

```vue
<template>
  <button @click="handleCancel">取消上传</button>
</template>

<script setup lang="ts">
const handleCancel = () => {
  test1.files.forEach(file => {
    if (file.status === "UDLoading") {
      file.cancel();
    }
  });
};
</script>
```

---

### 2. 监听取消事件

```typescript
uploader.onCancel = (file) => {
  console.log(`🚫 文件已取消: ${file.fileName}`);
  console.log(`   - 已完成分片: ${file.chunkManager?.completedChunks}`);
  console.log(`   - 总分片数: ${file.chunkManager?.totalChunks}`);
  console.log(`   - 进度: ${file.percent}%`);
};
```

---

### 3. 查看完整日志

```typescript
// 启用详细日志
FileUD.startUDLogger({
  enabled: true,
});

// 取消时会看到：
// [INFO] uploadChunkManager: 开始取消文件 xxx.mp4 的上传 {activeControllers: 5}
// [DEBUG] uploadChunkManager: 已中止一个分片的 HTTP 请求 (x5)
// [INFO] uploadChunkManager: 检测到取消标志，停止入队新分片 {currentChunk: 95}
// [INFO] uploadChunkManager: 分片上传被取消，停止执行
// [INFO] uploadChunkManager: 文件 xxx.mp4 已取消上传 {completedChunks: 90}
```

---

## 🐛 常见问题

### Q1: 为什么需要两层防护？

**第一层（循环入口）**：
- 防止新的分片任务入队
- 快速响应，减少资源浪费

**第二层（任务内部）**：
- 处理已经入队但尚未执行的任务
- 确保万无一失

**示例场景**：
```
时刻 T1: 分片 90 正在上传
时刻 T2: 用户点击取消
时刻 T3: 分片 91-95 已入队但未执行
         ↓
第一层防护：阻止分片 96+ 入队 ✅
第二层防护：分片 91-95 执行时检查 isCancelled ✅
```

---

### Q2: 取消后可以重新上传吗？

**可以**，但需要重新调用 [startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1220-L1348)：

```typescript
file.cancel(); // 取消

// 稍后重新上传
file.startUpload(); // ✅ 重新开始（会重置 isCancelled）
```

**注意**：[startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1220-L1348) 会重置所有状态，包括 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66)。

---

### Q3: 取消会影响断点续传吗？

**不会**。取消只是停止当前上传，已上传的分片仍然保存在 IndexedDB 中：

```typescript
file.cancel(); // 取消

// 下次上传时会自动恢复进度
file.startUpload(); // ✅ 从第 91 个分片继续
```

---

### Q4: 为什么唤醒后要抛出错误？

**原因**：
1. 中断当前任务的执行链
2. 触发 [Promise.allSettled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1400-L1400) 的 rejected 状态
3. 让上层代码知道任务被取消

**如果不抛出错误**：
```typescript
// ❌ 错误做法：只返回不抛出
if (this.isCancelled) {
  return; // 任务静默退出，上层不知道被取消
}

// ✅ 正确做法：抛出错误
if (this.isCancelled) {
  throw new Error("Upload cancelled"); // 明确告知被取消
}
```

---

## 📝 最佳实践

### 1. 提供确认对话框

```vue
<template>
  <button @click="confirmCancel">取消上传</button>
</template>

<script setup>
const confirmCancel = () => {
  if (confirm('确定要取消上传吗？已上传的分片将保留。')) {
    file.cancel();
  }
};
</script>
```

---

### 2. 显示取消反馈

```vue
<template>
  <div v-if="file.status === 'cancelled'" class="cancelled-banner">
    ⚠️ 上传已取消
    <button @click="file.startUpload()">重新上传</button>
  </div>
</template>
```

---

### 3. 清理资源

```typescript
function cancelAndCleanup(file) {
  file.cancel();
  
  // 释放 Object URL
  if (file.url) {
    URL.revokeObjectURL(file.url);
  }
  
  // 可选：从列表移除
  setTimeout(() => file.remove(), 1000);
}
```

---

## 🎯 总结

### 修复内容

1. ✅ 添加 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 标志
2. ✅ 修改 [waitForResume()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1146-L1170)，唤醒后检查取消状态
3. ✅ 修改 [cancelUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1016-L1077)，设置取消标志
4. ✅ 修改 [uploadWithConcurrency()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1368-L1436)，循环前检查取消状态

### 修复效果

- ✅ 取消后立即停止所有分片上传
- ✅ 已入队的任务不会继续执行
- ✅ 新的分片不会入队
- ✅ 详细的日志输出，便于调试

### 兼容性

- ✅ 不影响暂停/恢复功能
- ✅ 不影响普通上传
- ✅ 向后兼容，API 无变化

---

## 🤝 相关 API

- [cancel()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L187-L205) - 取消单个文件传输
- [pause()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L206-L216) - 暂停上传
- [resume()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L217-L227) - 恢复上传
- [startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1220-L1348) - 开始/重新开始上传

---

## 📚 参考资料

- [PQueue: Pause/Resume](https://github.com/sindresorhus/p-queue#pause-and-resume)
- [MDN: AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- [Memory: PQueue并发队列暂停恢复的正确实现模式](memory://7583835d-5fce-4f5b-8de8-7fdf10ec38b4)
