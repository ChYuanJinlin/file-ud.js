# 高级指南文档地图

这里是高级指南的文档地图，主要记录上传器内部行为、状态恢复、缓存、取消和重试等实现细节。

如果只是想查看公开 API，优先看：

- [快速开始](/guide/getting-started)
- [Uploader 上传器](/guide/uploader)
- [Downloader 下载器](/guide/downloader)
- [API 参考](/api/uploader-config)

## 文档地图

| 文档 | 适合阅读的场景 | 重点内容 |
| --- | --- | --- |
| [SETFILES_GUIDE.md](./SETFILES_GUIDE.md) | 需要把后端已有文件回显到上传列表 | `setFiles`、文件回显、服务端数据转换、已有文件状态 |
| [ADDFILE_GUIDE.md](./ADDFILE_GUIDE.md) | 需要手动追加单个文件或批量文件 | `addFile`、`addFiles`、`appendFiles` 的区别 |
| [CHUNK_UPLOAD_RESTORE_QUICKSTART.md](./CHUNK_UPLOAD_RESTORE_QUICKSTART.md) | 想快速接入分片上传回显和继续上传 | 最小配置、后端字段、前端回显流程 |
| [CHUNK_UPLOAD_RESTORE_GUIDE.md](./CHUNK_UPLOAD_RESTORE_GUIDE.md) | 需要完整理解分片恢复机制 | 分片状态、hash、已上传分片、继续上传、合并 |
| [INDEXEDDB_FILE_CACHE.md](./INDEXEDDB_FILE_CACHE.md) | 需要刷新页面后恢复本地 File 对象 | IndexedDB 缓存、过期清理、重新选择文件 |
| [CANCEL_FIX.md](./CANCEL_FIX.md) | 排查取消上传后仍继续执行的问题 | 取消标志、暂停队列、任务中断边界 |
| [RETRY_AFTER_CANCEL_FIX.md](./RETRY_AFTER_CANCEL_FIX.md) | 排查取消后重试卡住或无进度的问题 | `isCancelled`、`isPaused`、重试入口状态重置 |

## 推荐阅读顺序

1. 普通文件列表回显：先读 [SETFILES_GUIDE.md](./SETFILES_GUIDE.md)，再读 [ADDFILE_GUIDE.md](./ADDFILE_GUIDE.md)。
2. 分片上传恢复：先读 [CHUNK_UPLOAD_RESTORE_QUICKSTART.md](./CHUNK_UPLOAD_RESTORE_QUICKSTART.md)，再读 [CHUNK_UPLOAD_RESTORE_GUIDE.md](./CHUNK_UPLOAD_RESTORE_GUIDE.md)。
3. 页面刷新恢复：读 [INDEXEDDB_FILE_CACHE.md](./INDEXEDDB_FILE_CACHE.md)，确认浏览器缓存和文件重新选择流程。
4. 异常状态排查：读 [CANCEL_FIX.md](./CANCEL_FIX.md) 和 [RETRY_AFTER_CANCEL_FIX.md](./RETRY_AFTER_CANCEL_FIX.md)。

## 文档定位

当前目录位于 `packages/docs/advanced`，面向需要深入理解状态恢复、缓存、取消、重试和排障细节的使用者与维护者。公开 API 的基础说明仍放在指南和 API 参考中。
