# 高级指南与排障文档

这里存放 core 包相关的深度说明。它和快速开始、API 参考分工不同：快速开始负责告诉使用者如何上手，这里负责解释 core 内部状态、恢复流程、异常边界和排障思路。

## 什么时候看这里

- 你需要做文件回显、编辑页回填、服务端已有文件恢复。
- 你需要接入分片上传，并支持刷新页面后继续上传。
- 你需要解释取消、暂停、继续、重试之间的状态变化。
- 你需要排查上传列表进度不动、取消后还在跑、重试后卡住等问题。
- 你需要维护 core 源码，想知道某个历史修复为什么存在。

## 文档导航

| 分类 | 文档 | 说明 |
| --- | --- | --- |
| 文件列表 | [SETFILES_GUIDE.md](./SETFILES_GUIDE.md) | 说明如何用 `setFiles` 把后端文件回显到上传器列表，适合编辑页和详情页回填。 |
| 文件列表 | [ADDFILE_GUIDE.md](./ADDFILE_GUIDE.md) | 说明 `addFile`、`addFiles`、`appendFiles` 的使用差异，适合手动添加、拖拽、粘贴场景。 |
| 分片恢复 | [CHUNK_UPLOAD_RESTORE_QUICKSTART.md](./CHUNK_UPLOAD_RESTORE_QUICKSTART.md) | 最短路径接入分片上传回显，适合先跑通功能。 |
| 分片恢复 | [CHUNK_UPLOAD_RESTORE_GUIDE.md](./CHUNK_UPLOAD_RESTORE_GUIDE.md) | 完整解释分片恢复字段、状态转换、继续上传和合并逻辑。 |
| 本地缓存 | [INDEXEDDB_FILE_CACHE.md](./INDEXEDDB_FILE_CACHE.md) | 说明如何使用 IndexedDB 缓存 File 对象，以及缓存失效后的重新选择流程。 |
| 状态修复 | [CANCEL_FIX.md](./CANCEL_FIX.md) | 说明取消上传时如何真正停止等待中的分片任务。 |
| 状态修复 | [RETRY_AFTER_CANCEL_FIX.md](./RETRY_AFTER_CANCEL_FIX.md) | 说明取消后重试为什么要同时重置取消和暂停状态。 |
| 文档地图 | [map.md](./map.md) | 按场景整理所有高级文档和推荐阅读顺序。 |

## 推荐路径

如果你是第一次接入，建议按这个顺序读：

1. [SETFILES_GUIDE.md](./SETFILES_GUIDE.md)：先理解文件列表如何回显。
2. [ADDFILE_GUIDE.md](./ADDFILE_GUIDE.md)：再理解新增文件和回显文件的区别。
3. [CHUNK_UPLOAD_RESTORE_QUICKSTART.md](./CHUNK_UPLOAD_RESTORE_QUICKSTART.md)：跑通分片上传回显。
4. [CHUNK_UPLOAD_RESTORE_GUIDE.md](./CHUNK_UPLOAD_RESTORE_GUIDE.md)：补齐分片状态、hash、已上传分片和合并细节。
5. [INDEXEDDB_FILE_CACHE.md](./INDEXEDDB_FILE_CACHE.md)：处理刷新页面后的 File 对象恢复。
6. [CANCEL_FIX.md](./CANCEL_FIX.md) 和 [RETRY_AFTER_CANCEL_FIX.md](./RETRY_AFTER_CANCEL_FIX.md)：理解异常状态和重试边界。

## 目录维护规则

- 入门和 API 说明优先放在 [快速开始](/guide/getting-started)、[Uploader 指南](/guide/uploader)、[Downloader 指南](/guide/downloader) 或 [API 参考](/api/uploader-config)。
- core 内部实现、历史问题、状态机和排障说明放在当前 `advanced` 目录。
- 文档之间使用相对链接，不使用本机 `file://` 绝对路径。
- 源码引用统一指向 GitHub 的 `packages/core/src` 文件，不依赖 npm 包内是否包含源码。
- 链接源码时尽量指向源码文件和核心符号，少依赖固定行号，避免代码变动后链接失效。

## 发布说明

这些文档属于 `packages/docs` 文档站。构建或部署文档站时，它们会作为 `/advanced/` 栏目发布。
