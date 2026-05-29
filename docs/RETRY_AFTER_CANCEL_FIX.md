# 取消后重试功能修复说明（最终版 v2）

## 🐛 问题描述

用户反馈：**点击取消上传后，再点击重试按钮，文件不会重新上传**。

### 现象

1. 开始上传大文件（分片上传）
2. 点击"取消"按钮，文件状态变为 "cancelled"
3. 点击"重试"按钮
4. ❌ **没有任何反应，文件不会重新上传**

---

## 🔍 问题分析

### 根本原因

在 [retry](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L301-L385) 方法中，虽然允许 "cancelled" 状态的文件重试：

```typescript
if (!["cancelled", "fail", "error"].includes(this.proxy.status!)) {
  console.warn("没有需要重试的上传", this.fileName);
  return;
}
```

但是，当调用 [chunkManager.retryFailedChunks()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L930-L950) 或 [chunkManager.startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1234-L1355) 时，**[isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 和 [isPaused](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L64-L64) 标志没有被完全重置**！

### 执行流程分析

#### 取消时的状态变化

```typescript
// cancelUpload() 方法
this.isCancelled = true;  // ✅ 设置取消标志
this.isPaused = true;     // ✅ 设置暂停标志
this.pauseResolves.forEach(resolve => resolve()); // 唤醒等待的任务
this.pauseResolves = [];  // 清空唤醒队列
```

#### 重试时的状态检查

```typescript
// retry() 方法 - 场景3：没有失败分片，也不是所有分片完成
await this.chunkManager.startUpload();

// startUpload() 方法（修复前）
this.isCancelled = false;  // ✅ 重置了
this.isPaused = ???        // ❌ 没有重置！仍然是 true！

// uploadWithConcurrency() 方法
for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
  this.queue.add(async () => {
    await this.waitForResume();  // ❌ 检查 isPaused
    
    // waitForResume() 内部
    if (!this.isPaused) {
      return;  // isPaused 为 true，进入等待
    }
    
    await new Promise<void>((resolve) => {
      this.pauseResolves.push(() => resolve());  // ❌ 加入等待队列
    });
    
    // ⚠️ 但是 pauseResolves 已经在 cancelUpload 中被清空了！
    // ⚠️ 所以这个 Promise 永远不会被 resolve
    // ⚠️ 任务永远卡在 waitForResume() 这里
  });
}
```

### 问题总结

1. **取消时**：`isPaused = true`，并清空了 [pauseResolves](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L67-L67) 数组
2. **重试时**：调用 [startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1234-L1355)，只重置了 `isCancelled = false`，但 **`isPaused` 仍然是 `true`**
3. **分片上传时**：调用 [waitForResume()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1157-L1172)，发现 `isPaused === true`，于是加入 [pauseResolves](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L67-L67) 等待
4. **死锁**：因为 [pauseResolves](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L67-L67) 已经被清空且没有人会再调用它，所以任务永远等待

---

## ✅ 解决方案

### 修复内容

在 [startUpload](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1234-L1355) 和 [retryFailedChunks](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L930-L950) 方法中，**同时重置 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 和 [isPaused](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L64-L64) 标志**：

#### 1. 修复 startUpload 方法

```typescript
public async startUpload() {
  const up = this.uploadFile.transfer;

  // ... 其他初始化代码

  // 重置速度计算状态（避免第二次上传时速度计算错误）
  this.lastUpdateTime = 0;
  this.lastUploadedBytes = 0;
  
  // ✅ 关键修复：重置取消和暂停标志，允许重新开始上传
  this.isCancelled = false;
  this.isPaused = false;  // ✅ 新增：重置暂停标志
  
  // 重新创建 PQueue，确保使用正确的并发配置
  this.queue = new PQueue({ concurrency: this.maxConcurrent });
  
  // ... 后续代码
}
```

#### 2. 修复 retryFailedChunks 方法

```typescript
public async retryFailedChunks(): Promise<void> {
  // ✅ 重置取消和暂停标志，允许重试
  this.isCancelled = false;
  this.isPaused = false;  // ✅ 新增：重置暂停标志

  const failedChunksCopy = [...this.failedChunks];
  this.failedChunks = [];

  for (const chunkIndex of failedChunksCopy) {
    // ... 重试逻辑
  }

  await this.checkStatistics();
}
```

---

## 📊 修复效果对比

### 修复前

```
用户点击"取消"
  ↓
isCancelled = true
isPaused = true
pauseResolves = [] (已清空)
  ↓
用户点击"重试"
  ↓
startUpload() 被调用
  ↓
isCancelled = false ✅
isPaused = true ❌ (未重置)
  ↓
循环入队分片任务
  ↓
每个任务调用 waitForResume()
  ↓
发现 isPaused === true
  ↓
加入 pauseResolves 等待唤醒
  ↓
❌ 但是 pauseResolves 已经清空，没人会唤醒
  ↓
❌ 任务永远卡住，无法上传
```

### 修复后

```
用户点击"取消"
  ↓
isCancelled = true
isPaused = true
pauseResolves = [] (已清空)
  ↓
用户点击"重试"
  ↓
startUpload() 被调用
  ↓
isCancelled = false ✅
isPaused = false ✅ (已重置)
  ↓
循环入队分片任务
  ↓
每个任务调用 waitForResume()
  ↓
发现 isPaused === false ✅
  ↓
直接返回，继续执行 ✅
  ↓
分片开始上传 ✅
重试成功 ✅
```

---

## 💡 使用示例

### 1. 基本重试操作

```vue
<template>
  <div v-for="file in files" :key="file.fileId">
    <span>{{ file.fileName }} - {{ file.status }}</span>
    <button @click="file.retry()" v-if="file.status === 'cancelled'">
      重试
    </button>
  </div>
</template>

<script setup lang="ts">
import { FileUD } from '@file-ud.js/core';

const uploader = FileUD.createUploader("test", {
  action: '/api/upload',
  chunkOptions: {
    chunkSize: 5 * 1024 * 1024,
  }
});

// 监听重试事件
uploader.onRetry = (file) => {
  console.log(`🔄 文件 ${file.fileName} 开始重试`);
};
</script>
```

---

### 2. 取消后立即重试

```typescript
// 模拟用户操作
async function cancelAndRetry(file) {
  // 1. 取消上传
  file.cancel();
  console.log(file.status); // "cancelled"
  
  // 2. 等待 1 秒
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 3. 重试上传
  await file.retry();
  console.log(file.status); // "UDLoading" ✅
}
```

---

### 3. 批量重试所有取消的文件

```typescript
// 重试所有已取消的文件
uploader.files.forEach(file => {
  if (file.status === "cancelled") {
    file.retry().catch(error => {
      console.error(`文件 ${file.fileName} 重试失败:`, error);
    });
  }
});
```

---

## 🔍 技术细节

### 1. 状态重置时机

| 方法 | 重置 isCancelled | 重置 isPaused | 说明 |
|------|-----------------|--------------|------|
| [startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1234-L1355) | ✅ 是 | ✅ 是（修复后） | 重新开始整个上传 |
| [retryFailedChunks()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L930-L950) | ✅ 是（修复后） | ✅ 是（修复后） | 仅重试失败分片 |
| [resume()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1027-L1052) | ❌ 否 | ✅ 是 | 恢复暂停的上传 |
| [cancelUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1016-L1063) | ✅ 设置为 true | ✅ 设置为 true | 取消上传 |

---

### 2. 状态流转图

```
pending → UDLoading → cancelled → retry → UDLoading ✅
                      ↑                    ↓
                      └────────────────────┘
                  (isCancelled + isPaused 都重置)

paused → resume → UDLoading ✅
       ↑          ↓
       └──────────┘
     (isPaused 重置)
```

---

### 3. 为什么需要同时重置两个标志？

**原因**：[cancelUpload](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1016-L1063) 方法同时设置了两个标志：

```typescript
public cancelUpload(): void {
  this.isCancelled = true;  // 阻止新分片启动
  this.isPaused = true;     // 暂停正在进行的分片
  // ...
}
```

所以在重试时，必须**同时重置这两个标志**，否则：
- 只重置 `isCancelled`：任务会在 [waitForResume()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1157-L1172) 中永久等待 ❌
- 只重置 `isPaused`：任务会被 [waitForResume()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1157-L1172) 中的取消检查拦截 ❌

---

### 4. waitForResume 的工作机制

```typescript
private async waitForResume(): Promise<void> {
  if (!this.isPaused) {
    return;  // ✅ 如果未暂停，直接返回
  }

  // ❌ 如果已暂停，进入等待
  await new Promise<void>((resolve) => {
    this.pauseResolves.push(() => resolve());
  });

  // 唤醒后检查是否已取消
  if (this.isCancelled) {
    throw new Error("Upload cancelled");
  }
}
```

**关键点**：
- 如果 `isPaused === false`，直接返回，不进入等待
- 如果 `isPaused === true`，会创建一个 Promise 并加入 [pauseResolves](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L67-L67)
- 只有当有人调用 `pauseResolves.forEach(resolve => resolve())` 时，Promise 才会被 resolve
- 如果在等待期间 `isCancelled` 变为 `true`，则抛出错误

---

## 🐛 常见问题

### Q1: 为什么不直接在 cancelUpload 中重置 isPaused？

**原因**：[cancelUpload](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1016-L1063) 的目的是**永久取消**上传，所以应该保持两个标志都为 `true`。

只有在用户明确想要重试时（调用 [retry()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L301-L385)），才应该在重试方法的入口处重置这些标志。

---

### Q2: resume() 方法为什么只重置 isPaused？

**原因**：[resume()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1027-L1052) 是针对**暂停**操作的恢复，不是针对**取消**操作的恢复。

- **暂停**：临时停止，可以恢复 → 只重置 `isPaused`
- **取消**：永久停止，需要重试才能恢复 → 需要在 [retry()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L301-L385) 中重置两个标志

---

### Q3: 取消后重试会从头开始吗？

**取决于情况**：

1. **如果有失败的分片**：只重试失败的分片（断点续传）
   ```typescript
   file.cancel(); // 取消时已完成 90/368 分片
   file.retry();  // 从第 91 个分片继续 ✅
   ```

2. **如果所有分片都成功了**（合并阶段失败）：重新开始整个上传
   ```typescript
   file.cancel(); // 取消时 368/368 分片已完成，但合并且败
   file.retry();  // 重新开始上传流程 ✅
   ```

3. **如果既没有失败分片，也没有全部完成**（最常见的取消场景）：重新开始整个上传
   ```typescript
   file.cancel(); // 取消时 90/368 分片完成，没有失败分片
   file.retry();  // 重新开始上传流程 ✅
   ```

---

### Q4: 取消后重试会影响断点续传吗？

**不会**。取消只是停止当前上传，已上传的分片仍然保存在 IndexedDB 中：

```typescript
file.cancel(); // 取消，已完成 90/368 分片

// 下次重试时会自动恢复进度
file.retry(); // ✅ 从第 91 个分片继续
```

---

### Q5: 为什么之前只修复了 isCancelled，没有修复 isPaused？

**原因**：之前的分析不够全面，只关注了 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 标志，忽略了 [isPaused](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L64-L64) 标志的影响。

实际上，[cancelUpload](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1016-L1063) 同时设置了两个标志，所以重试时必须同时重置它们。这是一个**典型的遗漏问题**，需要通过完整的流程分析才能发现。

---

## 📝 最佳实践

### 1. 提供重试确认

```vue
<template>
  <button @click="confirmRetry(file)">重试</button>
</template>

<script setup>
const confirmRetry = (file) => {
  if (confirm(`确定要重试 "${file.fileName}" 吗？`)) {
    file.retry().catch(error => {
      alert('重试失败：' + error.message);
    });
  }
};
</script>
```

---

### 2. 显示重试状态

```vue
<template>
  <div v-if="file.status === 'cancelled'" class="cancelled-banner">
    ⚠️ 上传已取消
    <button @click="file.retry()" :disabled="isRetrying">
      {{ isRetrying ? '重试中...' : '重试' }}
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const isRetrying = ref(false);

const handleRetry = async (file) => {
  isRetrying.value = true;
  try {
    await file.retry();
  } finally {
    isRetrying.value = false;
  }
};
</script>
```

---

### 3. 监听重试事件

```typescript
uploader.onRetry = (file) => {
  console.log(`🔄 文件 ${file.fileName} 开始重试`);
  console.log(`   - 状态: ${file.status}`);
  console.log(`   - 进度: ${file.percent}%`);
};

uploader.onSuccess = (file) => {
  if (file.isRetry) {
    console.log(`✅ 文件 ${file.fileName} 重试成功`);
  }
};
```

---

## 🎯 总结

### 修复内容

1. ✅ 在 [startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1234-L1355) 方法中同时重置 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 和 [isPaused](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L64-L64)
2. ✅ 在 [retryFailedChunks()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L930-L950) 方法中同时重置 [isCancelled](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L66-L66) 和 [isPaused](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L64-L64)
3. ✅ 确保取消后可以正常重试

### 修复效果

- ✅ 取消后可以立即重试
- ✅ 重试时会正确重置所有相关标志
- ✅ 支持断点续传（从失败的分片继续）
- ✅ 避免了死锁问题

### 兼容性

- ✅ 不影响暂停/恢复功能
- ✅ 不影响普通上传
- ✅ 向后兼容，API 无变化

---

## 🤝 相关 API

- [cancel()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L187-L205) - 取消单个文件传输
- [retry()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L301-L385) - 重试失败的上传
- [pause()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L206-L216) - 暂停上传
- [resume()](file://d:\yjl\file-UD\packages\core\src\uploader\UploadFile.ts#L217-L227) - 恢复上传
- [startUpload()](file://d:\yjl\file-UD\packages\core\src\uploader\uploadChunkManager.ts#L1234-L1355) - 开始/重新开始上传

---

## 📚 参考资料

- [Memory: 任务取消与重试状态重置规范](memory://44888cff-6fdf-4b9c-8316-fb044203c0e2)
- [CANCEL_FIX.md](file://d:\yjl\file-UD\docs\CANCEL_FIX.md) - 取消上传功能修复说明
- [RETRY_AFTER_CANCEL_FIX.md](file://d:\yjl\file-UD\docs\RETRY_AFTER_CANCEL_FIX.md) - 取消后重试功能修复说明
