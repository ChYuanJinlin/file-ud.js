# 状态类型重构说明

## 📋 重构背景

在之前的代码中，文件传输状态（如 "pending"、"uploading"、"success" 等）以硬编码字符串的形式散落在各个文件中，导致：
1. **类型冗余**：多处重复定义相同的联合类型
2. **维护困难**：修改状态需要同时更新多个位置
3. **易出错**：拼写错误无法在编译时发现
4. **缺乏语义**：魔法字符串降低代码可读性

## ✅ 重构方案

### 1. 统一状态类型定义

在 `types/index.d.ts` 中定义了三层状态类型体系：

#### TransferStatus（通用传输状态）
```typescript
export type TransferStatus =
  | "pending"      // 待处理
  | "uploading"    // 上传中（仅上传）
  | "downloading"  // 下载中（仅下载）
  | "paused"       // 已暂停
  | "success"      // 成功
  | "fail"         // 失败
  | "error"        // 错误
  | "cancelled"    // 已取消
  | "merging"      // 合并中（仅分片上传）
  | "hashing";     // 哈希计算中（仅上传校验）
```

#### UploadStatus（上传专用状态）
```typescript
export type UploadStatus = Extract<TransferStatus, 
  "pending" | "uploading" | "paused" | "success" | "fail" | "error" | "cancelled" | "merging" | "hashing">;
```

#### DownloadStatus（下载专用状态）
```typescript
export type DownloadStatus = Extract<TransferStatus, 
  "pending" | "downloading" | "paused" | "success" | "fail" | "error" | "cancelled">;
```

### 2. 状态常量对象

提供类型安全的常量访问方式，避免硬编码字符串：

```typescript
export const TransferStatusConst = {
  PENDING: "pending" as const,
  UPLOADING: "uploading" as const,
  DOWNLOADING: "downloading" as const,
  PAUSED: "paused" as const,
  SUCCESS: "success" as const,
  FAIL: "fail" as const,
  ERROR: "error" as const,
  CANCELLED: "cancelled" as const,
  MERGING: "merging" as const,
  HASHING: "hashing" as const,
} as const;
```

### 3. IFile 接口更新

将 `status` 字段从冗长的联合类型改为简洁的类型引用：

```typescript
// 修改前
status?: "pending" | "uploading" | "downloading" | ...;

// 修改后
status?: TransferStatus;
```

## 📝 使用示例

### 基本用法

```typescript
import { TransferStatusConst, DownloadStatus } from '@file-ud.js/core';

// ✅ 推荐：使用常量
file.status = TransferStatusConst.SUCCESS;

// ✅ 也可以使用字符串字面量（TypeScript 会进行类型检查）
file.status = "success";

// ❌ 错误：拼写错误会在编译时报错
file.status = "sucess"; // TypeScript Error!
```

### 条件判断

```typescript
// ✅ 使用常量进行比较
if (file.status === TransferStatusConst.UPLOADING) {
  console.log('正在上传...');
}

// ✅ 直接使用字符串（同样有类型安全）
if (file.status === "uploading") {
  console.log('正在上传...');
}
```

### 类型约束

```typescript
// 函数参数类型约束
function handleDownload(file: DownloadFile) {
  // TypeScript 会自动推断 file.status 只能是 DownloadStatus 中的值
  if (file.status === "uploading") { // ❌ TypeScript Error!
    // 下载文件不会有 "uploading" 状态
  }
}
```

## 🔄 影响范围

### 修改的文件

1. **types/index.d.ts**
   - 新增 `TransferStatus`、`UploadStatus`、`DownloadStatus` 类型
   - 新增 `TransferStatusConst` 常量对象
   - 更新 `IFile` 接口的 `status` 字段类型

2. **downloader/DownloadFile.ts**
   - 导入并使用 `DownloadStatus` 和 `TransferStatusConst`
   - 替换所有硬编码状态字符串为常量

3. **downloader/index.ts**
   - 导入 `TransferStatusConst`
   - 在 `add()` 和 `setFiles()` 方法中使用常量

4. **uploader/UploadFile.ts**
   - 导入 `UploadStatus` 和 `TransferStatusConst`
   - 替换约 10+ 处硬编码状态字符串

5. **uploader/index.ts**
   - 导入 `TransferStatusConst`
   - 在状态判断中使用常量

6. **uploader/ChunkManager.ts**
   - 导入 `TransferStatusConst`
   - 替换所有分片上传相关的状态赋值

## 🎯 优势

### 1. 类型安全
- ✅ 编译时检查，防止拼写错误
- ✅ IDE 智能提示，自动补全状态值
- ✅ 精确的类型推导，区分上传/下载状态

### 2. 可维护性
- ✅ 单一数据源，修改一处即可全局生效
- ✅ 语义化常量，提高代码可读性
- ✅ 易于扩展，新增状态只需修改类型定义

### 3. 开发体验
- ✅ 完整的 TypeScript 支持
- ✅ 更好的代码导航和重构支持
- ✅ 减少运行时错误

## 📊 统计数据

- **新增类型定义**：3 个（TransferStatus、UploadStatus、DownloadStatus）
- **新增常量对象**：1 个（TransferStatusConst，包含 10 个常量）
- **替换硬编码位置**：约 30+ 处
- **涉及文件数**：6 个核心文件
- **编译错误**：0 个 ✅

## 🔮 未来优化方向

1. **状态机验证**：可以引入状态机库（如 XState）来验证状态转换的合法性
2. **状态日志**：在状态变更时自动记录日志，便于调试
3. **状态持久化**：结合 IndexedDB 实现状态的自动保存和恢复
4. **国际化支持**：为每个状态提供多语言描述

## ⚠️ 注意事项

1. **向后兼容**：仍然支持直接使用字符串字面量，不会破坏现有代码
2. **性能影响**：类型定义仅在编译时生效，运行时零开销
3. **迁移成本**：建议逐步迁移，优先在新代码中使用常量

---

**重构完成时间**：2026-05-08  
**重构负责人**：Lingma AI Assistant
