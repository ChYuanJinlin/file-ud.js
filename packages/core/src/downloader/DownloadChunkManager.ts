import ChunkManager from "../chunkManager";
import TransferFile from "../transfer/TransferFile";
import { ChunkOptions } from "../types";
import DownloadFile from "./DownloadFile";
import { calculateFileMD5, formatFileSize, logger } from "../utils";
import Downloader from ".";

export default class DownloadChunkManager extends ChunkManager {
  private downloadFile: DownloadFile;

  /** 存储每个分片的 Blob 数据（流式写入不可用时的内存兜底） */
  private chunkBlobs: Map<number, Blob> = new Map();

  /** 流式写入的 FileHandle（File System Access API） */
  private streamFileHandle: FileSystemFileHandle | null = null;

  /** 流式写入的可写流 */
  private writable: FileSystemWritableFileStream | null = null;

  /** 待完成写入的 Promise 列表（fire-and-forget，不阻塞 PQueue worker） */
  private pendingWrites: Promise<void>[] = [];

  /** 🔑 已确认落盘的分片索引（仅流式模式使用，内存模式不写此 Set） */
  private _diskWrittenChunks: Set<number> = new Set();

  /** 🔑 doAfterStartReset() 保存 IndexedDB 时的安全快照。
   *    ensureWritableClosed() 的 pending writes 会追加新分片到 _diskWrittenChunks，
   *    若 close() 失败 → abort() → 磁盘数据丢失，需要回滚 IndexedDB 到这个安全状态，
   *    而不是全量删除。已 settle 的 writes 在磁盘上是安全的。 */
  private _safeDiskChunks: Set<number> = new Set();

  /** 上次写入 IndexedDB 进度的时间戳（节流用） */
  private _lastProgressSaveTime: number = 0;

  // ==================== 构造函数 ====================

  constructor(chunkOptions: ChunkOptions, file: TransferFile<any, any>) {
    super(chunkOptions, file);
    this.downloadFile = file as unknown as DownloadFile;

    // 🔑 读取下载限速配置
    const dlConfig = (this.downloadFile.dl as any).config as import("../types").DownloaderConfig | null;
    if (dlConfig?.maxDownloadSpeed && dlConfig.maxDownloadSpeed > 0) {
      this.maxSpeed = dlConfig.maxDownloadSpeed;
    }
  }

  // ==================== 抽象方法实现 ====================

  protected getTag(): string {
    return "DownloadChunkManager";
  }

  /**
   * 计算文件唯一标识
   *
   * - 若 this.fileHash 已设置（服务端返回的真实 MD5），直接返回
   * - 否则兜底用 fileName-fileSize，仅作为 onInitChunk → check-file 的临时传参
   */
  protected async computeFileIdentifier(): Promise<string> {
    if (this.fileHash && /^[a-f0-9]{32}$/i.test(this.fileHash)) {
      return this.fileHash;
    }
    const fileName = this.downloadFile.fileName || "download";
    const fileSize = this.downloadFile.getFileSize();
    return `${fileName}-${fileSize}`;
  }

  /**
   * 初始化下载任务（含断点续传 / 秒下检查）
   *
   * 1. 调用 onInitChunkCallback 检查已下载分片（断点续传 / 秒下）
   * 2. 如果用户提供了 fileHandle 直接使用；否则尝试调用 showSaveFilePicker
   *    让用户选择保存位置，实现流式写入磁盘（内存峰值 = 并发数 × 分片大小）。
   * 3. 若 API 不可用或用户取消，回退到内存累积模式。
   */
  protected async doInit(): Promise<any> {
    logger.info(this.getTag(), "初始化下载任务", {
      fileName: this.downloadFile.fileName,
      totalChunks: this.totalChunks,
    });

    const downloader = this.downloadFile.transfer;
    let initResult: any = null;
    let isResuming = false;
    const isRetry = !!(this.downloadFile.proxy as any).isRetry;

    // ========== Step 0: 本地磁盘秒下检查（优先于一切网络请求） ==========
    // 🔑 如果有 fileHandle，直接检查本地磁盘文件是否已完成。
    //    无需依赖服务端或回调，下载器自己看磁盘就行了。
    if (!this.isInstantTransfer) {
      const fileHandle = this.downloadFile.fileHandle || this.streamFileHandle;
      if (fileHandle) {
        try {
          const diskFile = await fileHandle.getFile();
          if (diskFile.size > 0 && diskFile.size === this.downloadFile.getFileSize()) {
            logger.info(this.getTag(), "⚡ 秒下：本地磁盘文件已完整", {
              fileName: this.downloadFile.fileName,
              fileSize: diskFile.size,
            });
            this.markInstantDownload();
            return null;
          }
        } catch {
          // 磁盘文件不可访问，走正常下载流程
        }
      }
    }

    // ========== Step 1: 服务端回调 → 获取真实 MD5（优先，为 IndexedDB 提供正确 key） ==========
    // 🔑 下载端没有本地 File 对象，无法调用 calculateFileMD5()。
    //     必须先调服务端 check-file 获取真实 MD5，再用它做 IndexedDB key，
    //     这样索引键才能与上传端的 MD5 一致，实现正确的秒下/续传判断。
    if (downloader.onInitChunkCallback) {
      try {
        const tempKey = await this.computeFileIdentifier();

        logger.debug(this.getTag(), "调用 onInitChunk 回调获取服务端哈希", {
          fileName: this.downloadFile.fileName,
          tempKey,
        });

        initResult = await downloader.onInitChunkCallback(
          this.downloadFile as any,
          this.totalChunks,
          tempKey,
        );

        if (initResult?.fileHash) {
          // 🔑 验证是否为真实 MD5（32 位 hex），不是则仍然用 computeFileIdentifier 兜底
          if (/^[a-f0-9]{32}$/i.test(initResult.fileHash)) {
            this.fileHash = initResult.fileHash;
            logger.info(this.getTag(), "已获取服务端真实文件哈希", {
              fileName: this.downloadFile.fileName,
              fileHash: this.fileHash,
            });
          } else {
            // onInitChunk 返回的 fileHash 不是有效 MD5，将继续用 computeFileIdentifier 兜底
          }

          // ✅ 秒下：仅当回调显式标记 isInstantDownload 时生效
          if (initResult.isInstantDownload === true) {
            logger.info(this.getTag(), "⚡ 秒下（回调标记），文件已在本地", {
              fileName: this.downloadFile.fileName,
            });
            this.markInstantDownload();
            return initResult;
          }
        }
      } catch (error) {
        // 回调失败不阻塞下载，回退到全新下载
        logger.warn(this.getTag(), "服务端哈希查询失败，将全新下载", error);
      }
    }

    // 🔑 兜底：如果 onInitChunk 未返回有效 MD5（fileHash 未设置），用computeFileIdentifier 生成
    if (!this.fileHash) {
      this.fileHash = await this.computeFileIdentifier();
    }

    // ========== Step 2: IndexedDB 恢复（用 this.fileHash 作为 key） ==========
    // 🔑 saveProgressToCacheSoft 仅当 writable.write() 确认落盘后才保存 IndexedDB
    //    (流式模式)，或 chunkBlobs 已在内存（内存模式）。若 close() 失败回退 abort(),
    //    ensureWritableClosed() 已同步清理 IndexedDB。因此这里恢复的所有进度都是可信的。
    if (this.config.enableFileCache && this.fileHash) {
      try {
        const { loadDownloadProgress } = await import("../utils/fileCache");
        const progress = await loadDownloadProgress(this.fileHash);

        if (progress && progress.chunkIndexes.length > 0) {
          logger.info(this.getTag(), "✅ 从 IndexedDB 恢复下载进度", {
            fileName: progress.fileName,
            completedChunks: progress.chunkIndexes.length,
            totalChunks: progress.totalChunks,
          });

          this.completedChunks = 0;
          progress.chunkIndexes.forEach((index: number) => {
            if (index >= 0 && index < this.totalChunks) {
              this.chunks[index] = true;
              this.completedChunks++;
              this.countedChunks.add(index);
              this.totalChunkSize += this.chunkSize;
            }
          });
          this.updateProgress();
          isResuming = true;

          const dl = this.downloadFile.transfer;
          dl.updateGlobalStats();
          dl.triggerUpdate();

          // ✅ 秒下：IndexedDB 显示所有分片已下载
          if (this.completedChunks === this.totalChunks) {
            // 🔑 必须验证磁盘文件真实存在且 MD5 一致
            const fileHandle = this.downloadFile.fileHandle || this.streamFileHandle;
            let fileVerified = false;
            let shouldDeleteCache = false; // 只有文件确实损坏才删除 IndexedDB

            if (fileHandle) {
              try {
                const diskFile = await fileHandle.getFile();
                const diskSize = diskFile.size;
                const expectedSize = this.downloadFile.getFileSize();

                if (diskSize === 0) {
                  // 🔑 磁盘文件大小为 0 → 不可能是一个已完成的有效下载
                  shouldDeleteCache = true;
                  fileVerified = false;
                } else if (diskSize !== expectedSize) {
                  fileVerified = false;
                  shouldDeleteCache = false;
                } else {
                  // 🔑 大小一致 → 进一步校验 MD5 哈希（仅对中小文件，大文件跳过避免卡死 UI）
                  if (this.fileHash && /^[a-f0-9]{32}$/i.test(this.fileHash)) {
                    const MAX_MD5_SIZE = 50 * 1024 * 1024; // >50MB 跳过 MD5
                    if (diskSize <= MAX_MD5_SIZE) {
                      try {
                        const computedHash = await calculateFileMD5(diskFile);
                        fileVerified = computedHash === this.fileHash;
                        if (!fileVerified) {
                          logger.warn(
                            this.getTag(),
                            `磁盘文件大小一致但 MD5 不匹配 → 内容已变更, expected=${this.fileHash.slice(0, 8)}..., computed=${computedHash.slice(0, 8)}...`,
                          );
                          shouldDeleteCache = true; // 文件确实损坏，清理缓存
                        }
                      } catch {
                        // 哈希计算失败，回退到大小校验
                        fileVerified = true;
                      }
                    } else {
                      // 大文件仅靠大小校验，避免 MD5 计算阻塞 UI 30-60s
                      fileVerified = true;
                    }
                  } else {
                    // 无真实哈希可用，仅靠大小校验
                    fileVerified = true;
                  }
                }
              } catch (getFileErr) {
                // getFile() 失败：文件被删除 / 权限被撤销
                shouldDeleteCache = true;
                fileVerified = false;
              }
            }

            if (fileVerified) {
              this.markInstantDownload();
              return initResult;
            }

            // 🔑 内存模式秒下兜底：无 fileHandle 时无法验证本地磁盘文件，
            //    但 IndexedDB 显示全部分片已完成 → 可信秒下
            if (!fileHandle && !shouldDeleteCache) {
              logger.info(this.getTag(), "⚡ 秒下（内存模式兜底），IndexedDB 全量完成", {
                fileName: this.downloadFile.fileName,
              });
              this.markInstantDownload();
              return initResult;
            }

            // 文件不存在 / 无法验证
            if (shouldDeleteCache) {
              // 只有 MD5 不匹配（文件确实损坏）才清理 IndexedDB
              logger.warn(
                this.getTag(),
                "IndexedDB 记录显示全部下载完成，但磁盘文件哈希不匹配，将清除缓存并重新下载",
                { fileHandleExists: !!fileHandle },
              );
              if (this.config.enableFileCache) {
                try {
                  const { removeDownloadProgress } =
                    await import("../utils/fileCache");
                  await removeDownloadProgress(this.fileHash);
                } catch {
                  // IndexedDB 清理失败不阻塞
                }
              }
            } else {
              // 新文件句柄 / getFile() 失败 → 保留 IndexedDB 记录
              logger.info(
                this.getTag(),
                "IndexedDB 记录保留（文件句柄指向新位置或无权限），继续正常下载",
                { fileHandleExists: !!fileHandle },
              );
            }

            // 重置完成状态，继续走正常下载流程
            this.completedChunks = 0;
            this.chunks = new Array(this.totalChunks).fill(false);
            this.countedChunks.clear();
            this.totalChunkSize = 0;
            this.updateProgress();
            isResuming = false;

            const dl2 = this.downloadFile.transfer;
            dl2.updateGlobalStats();
            dl2.triggerUpdate();
            // 不 return，继续往下走到正常下载流程
          }
        }
      } catch (error) {
        logger.warn(this.getTag(), "从 IndexedDB 恢复进度失败", error);
      }
    }

    // ========== Step 3: 服务端断点续传（用已有 chunks 列表恢复） ==========
    // 🔑 重试时跳过服务端断点续传：与 Step 2 同理，doAfterStartReset() 已清空本地分片数据，
    //    服务端返回的 chunks（对下载场景通常是全量列表）会标记分片为"已完成"但无实际数据。
    if (!isResuming && initResult && !isRetry) {
      if (
        initResult.chunks &&
        Array.isArray(initResult.chunks) &&
        initResult.chunks.length > 0
      ) {
        this.completedChunks = 0;
        initResult.chunks.forEach((index: number) => {
          if (index >= 0 && index < this.totalChunks) {
            this.chunks[index] = true;
            this.completedChunks++;
            this.countedChunks.add(index);
            this.totalChunkSize += this.chunkSize;
          }
        });
        this.updateProgress();
        isResuming = true;

        logger.info(this.getTag(), "✅ 服务端回调恢复分片", {
          completedChunks: this.completedChunks,
          totalChunks: this.totalChunks,
          percent: Math.round(
            (this.completedChunks / this.totalChunks) * 100,
          ),
        });

        const dl = this.downloadFile.transfer;
        dl.updateGlobalStats();
        dl.triggerUpdate();
      }
    }

    // ========== 初始化流式写入或内存模式 ==========
    // 🔑 如果 fileHandle 已存在（首次下载已选择或回显），直接复用
    if (this.downloadFile.fileHandle) {
      this.streamFileHandle = this.downloadFile.fileHandle;
    } else if (
      // 🔑 重试时不弹出文件选择对话框（用户已在首次下载时选择或取消过）
      !(this.downloadFile as any).isRetry &&
      typeof window !== "undefined" &&
      typeof (window as any).showSaveFilePicker === "function"
    ) {
      try {
        this.streamFileHandle = await (window as any).showSaveFilePicker({
          suggestedName: this.downloadFile.fileName,
        });
        // 🔑 回写到 downloadFile.fileHandle，确保重试时可复用同一句柄
        //    （doAfterStartReset() 会清空 streamFileHandle，但 downloadFile.fileHandle 不受影响）
        this.downloadFile.fileHandle = this.streamFileHandle;
      } catch (_e: any) {
        // 用户取消文件选择 → 回退到内存模式
        logger.info(this.getTag(), "用户取消文件选择，回退到内存模式");
      }
    }

    // 🔑 秒下检查：用户可能通过 showSaveFilePicker 选择了已有文件
    //    此时 IndexedDB 无记录（已在上次完成后清理），但磁盘文件完整
    //    必须在 createWritable 之前检测，否则不含 keepExistingData 会截断文件
    if (this.streamFileHandle && !isResuming) {
      try {
        const diskFile = await this.streamFileHandle.getFile();
        if (diskFile.size === this.downloadFile.getFileSize()) {
          // 🔑 大小一致 → 进一步校验 MD5 哈希，防止同大小不同内容的文件被误判
          let hashMatch = true;
          const expectedHash = this.fileHash || initResult?.fileHash || "";
          if (
            expectedHash &&
            /^[a-f0-9]{32}$/i.test(expectedHash)
          ) {
            try {
              const computedHash = await calculateFileMD5(diskFile);
              hashMatch = computedHash === expectedHash;
              if (!hashMatch) {
                logger.warn(
                  this.getTag(),
                  `showSaveFilePicker 选中文件大小一致但 MD5 不匹配 → 文件内容不同, expected=${expectedHash.slice(0, 8)}..., computed=${computedHash.slice(0, 8)}...`,
                );
              }
            } catch {
              // 哈希计算失败，回退到大小校验
            }
          }

          if (hashMatch) {
            logger.info(this.getTag(), "⚡ 秒下：磁盘文件已通过大小+哈希双验证", {
              fileName: this.downloadFile.fileName,
              fileSize: diskFile.size,
            });
            this.markInstantDownload();
            return initResult;
          }
        }
      } catch {
        // 文件不存在或无法访问 → 继续正常下载
      }
    }

    // 🔑 磁盘断点续传检测：无 IndexedDB 记录（isResuming=false），但磁盘文件有部分数据
    //    （例如换浏览器后重新选择同一文件，或 IndexedDB 被清理）。
    //    根据文件大小反算已完成的完整分片数，标记后从断点继续。
    //    必须在 createWritable 之前检测，否则不含 keepExistingData 会截断已有数据。
    if (this.streamFileHandle && !isResuming) {
      try {
        const diskFile = await this.streamFileHandle.getFile();
        const fileSize = this.downloadFile.getFileSize();
        // 完整文件已在上面秒下检查处理（diskFile.size === fileSize），
        // 这里只处理有部分数据但未完成的文件
        if (diskFile.size > 0 && diskFile.size < fileSize) {
          const completedFromDisk = Math.floor(diskFile.size / this.chunkSize);
          if (completedFromDisk > 0 && completedFromDisk < this.totalChunks) {
            logger.info(this.getTag(), "🔄 从磁盘文件恢复下载进度（无 IndexedDB 记录）", {
              fileName: this.downloadFile.fileName,
              diskSize: diskFile.size,
              completedChunks: completedFromDisk,
              totalChunks: this.totalChunks,
            });

            this.completedChunks = 0;
            for (let i = 0; i < completedFromDisk; i++) {
              this.chunks[i] = true;
              this.completedChunks++;
              this.countedChunks.add(i);
              this.totalChunkSize += this.chunkSize;
            }
            this.updateProgress();
            isResuming = true;

            const dl = this.downloadFile.transfer;
            dl.updateGlobalStats();
            dl.triggerUpdate();
          }
        }
      } catch {
        // 磁盘文件不可访问，继续正常下载
      }
    }

    // 🔑 磁盘验证：若 IndexedDB 声称有已完成分片（isResuming=true），但磁盘文件
    //    为空或大小为 0，说明上一次 ensureWritableClosed() 的 close() 失败导致
    //    abort 重置了文件。此时 IndexedDB 进度不可信，必须清理并全新下载。
    //    防止 createWritable({ keepExistingData: true }) 在空文件上打开 →
    //    已恢复的分片被跳过 → 文件出现空洞损坏。
    if (this.streamFileHandle && isResuming) {
      try {
        const diskFile = await this.streamFileHandle.getFile();
        const minExpectedSize = this.completedChunks * this.chunkSize;
        if (diskFile.size === 0) {
          this.completedChunks = 0;
          this.chunks = new Array(this.totalChunks).fill(false);
          this.countedChunks.clear();
          this.totalChunkSize = 0;
          isResuming = false;
          if (this.config.enableFileCache && this.fileHash) {
            try {
              const { removeDownloadProgress } =
                await import("../utils/fileCache");
              await removeDownloadProgress(this.fileHash);
            } catch {}
          }
        } else if (diskFile.size < minExpectedSize) {
          // 磁盘文件过小，IndexedDB 进度可能落后
        }
      } catch (diskErr: any) {
      }
    }

    if (this.streamFileHandle) {
      // 🔑 断点续传时保留已有数据，全新下载时截断文件
      this.writable = await this.streamFileHandle.createWritable(
        isResuming ? { keepExistingData: true } : undefined,
      );
      logger.info(this.getTag(), isResuming ? "✅ 启用流式写入磁盘（续传模式）" : "✅ 启用流式写入磁盘", {
        fileName: this.downloadFile.fileName,
        keepExistingData: isResuming,
      });
    } else {
      logger.info(this.getTag(), "⚠️ 流式写入不可用，使用内存模式");
    }

    return initResult || { chunks: [] };
  }

  /**
   * 标记为秒下（instant download），设置所有状态为已完成
   */
  private markInstantDownload(): void {
    this.isInstantTransfer = true;
    this.completedChunks = this.totalChunks;
    this.totalChunkSize = this.downloadFile.getFileSize();
    this.countedChunks = new Set(
      Array.from({ length: this.totalChunks }, (_, i) => i),
    );
    this.chunks = new Array(this.totalChunks).fill(true);
    this.downloadFile.proxy.percent = 100;
    this.downloadFile.proxy.status = "success";
    this.downloadFile.proxy.speed = {
      currentSpeed: 0,
      averageSpeed: 0,
      currentSpeedFormatted: "0 B/s",
      averageSpeedFormatted: "0 B/s",
      estimatedTimeRemaining: 0,
      estimatedTimeFormatted: "已完成",
    };
    const dl = this.downloadFile.transfer;
    dl.updateGlobalStats();
    dl.triggerUpdate();
  }

  /**
   * 下载单个分片（Range 请求）
   */
  protected async doChunkTransfer(
    chunkIndex: number,
    signal?: AbortSignal,
  ): Promise<{ data: Blob; chunkSize: number }> {
    const fileSize = this.downloadFile.getFileSize();
    const chunkSize = this.chunkSize;
    const start = chunkIndex * chunkSize;
    const end = Math.min(start + chunkSize - 1, fileSize - 1);

    const blob = await this.downloadFile.downloadChunk(start, end, signal);

    return { data: blob, chunkSize: blob.size };
  }

  /**
   * 合并所有已下载分片
   *
   * - 流式模式：等待所有 fire-and-forget 写入完成后关闭 writable
   * - 内存模式：将 chunkBlobs Map 中的分片按顺序拼接为单一 Blob
   */
  protected async doMergeChunks(): Promise<Blob | FileSystemFileHandle> {
    const dl = this.downloadFile.transfer as any;
    let result: Blob | FileSystemFileHandle;

    try {
      // 🔑 流式模式：等待所有 fire-and-forget 写入完成，再关闭流
      if (this.writable && this.streamFileHandle) {
        try {
          if (this.pendingWrites.length > 0) {
            await Promise.all(this.pendingWrites);
            this.pendingWrites = [];
          }
          await this.writable.close();
          logger.info(this.getTag(), "✅ 流式写入完成，文件已落盘", {
            fileName: this.downloadFile.fileName,
          });
        } finally {
          this.writable = null;
        }
        result = this.streamFileHandle;
      } else {
        // 内存模式兜底
        const allChunks: Blob[] = [];

        for (let i = 0; i < this.totalChunks; i++) {
          const chunk = this.chunkBlobs.get(i);
          if (chunk) {
            allChunks.push(chunk);
          }
        }

        if (allChunks.length === 0) {
          // 🔑 秒下场景：文件已在本地，无需合并分片
          const fh = this.downloadFile.fileHandle || this.streamFileHandle;
          if (fh && this.isInstantTransfer) {
            // 流式/FileHandle 模式：直接返回磁盘文件句柄
            logger.info(this.getTag(), "⚡ 秒下合并：文件已在本地磁盘，跳过合并");
            result = fh;
          } else if (this.isInstantTransfer) {
            // 内存模式秒下兜底：无 fileHandle，服务端+IndexedDB 双确认文件已完整
            // 返回空 Blob，doBeforeOnSuccess 会跳过保存（size=0）
            logger.info(this.getTag(), "⚡ 秒下合并（内存模式）：文件已在本地，跳过合并");
            result = new Blob();
          } else {
            logger.warn(this.getTag(), "没有可合并的分片");
            result = new Blob();
          }
        } else {
          result = new Blob(allChunks);
          logger.info(this.getTag(), "分片合并完成", {
            fileName: this.downloadFile.fileName,
            totalChunks: allChunks.length,
            size: formatFileSize(result.size),
          });
        }
      }

      dl.emit("merge-success", { file: this.downloadFile.proxy });
      return result;
    } catch (error) {
      dl.emit("merge-error", {
        file: this.downloadFile.proxy,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ==================== 覆写钩子 ====================

  /**
   * 保存每个分片的 Blob 数据 + 自动缓存下载进度到 IndexedDB
   *
   * - 流式模式：fire-and-forget 写入（不 await，PQueue worker 立即继续下载下一个分片）
   * - 内存模式：存储到 chunkBlobs Map 中，待合并时一次性拼接
   *
   * 🔑 IndexedDB 安全性：仅当磁盘写入确认完成后才保存进度。避免 cancel 时
   *    write 尚未 flush → close() 未保住数据 → abort() 丢弃 → IndexedDB 却标记"已完成"
   *    → 重试时跳过这些分片 → 文件出现空洞损坏。
   */
  protected async doSaveChunkResult(chunkIndex: number, data: any): Promise<void> {
    if (!(data instanceof Blob)) return;

    // 🔑 流式模式：fire-and-forget 写盘，不阻塞 PQueue worker 获取下一个分片
    if (this.writable) {
      const position = chunkIndex * this.chunkSize;
      const writeP = this.writable
        .write({ type: "write", position, data })
        .then(async () => {
          // ✅ 磁盘写入完成 → 标记落盘 → 才允许存 IndexedDB
          this._diskWrittenChunks.add(chunkIndex);
          // 🔑 必须 return IndexedDB 保存的 Promise，让 writeP 链正确等待
          //    否则 ensureWritableClosed() 的 allSettled 不等 IndexedDB 写完就认为完成
          await this.saveProgressToCacheSoft(chunkIndex);
        })
        .catch((err) => {
          console.error(
            `[DownloadChunkManager] ❌ 分片 ${chunkIndex} 写入磁盘失败:`,
            err,
          );
        });
      this.pendingWrites.push(writeP);
    } else {
      // 内存兜底模式：Blob 已在 chunkBlobs Map 中，100% 可恢复
      this.chunkBlobs.set(chunkIndex, data);
      // 内存模式数据不会因 cancel 丢失，直接保存 IndexedDB
      this.saveProgressToCacheSoft(chunkIndex);
    }
  }

  /**
   * 将下载进度存入 IndexedDB（节流，最多每 2 秒写一次）
   *
   * 🔑 流式模式：仅保存 _diskWrittenChunks 中已确认落盘的分片，防止
   *    cancel→abort 丢弃数据后 IndexedDB 仍标记"已完成"→重试跳过→文件损坏。
   *    内存模式：chunkBlobs Map 存于内存，cancel 不丢数据，直接用 this.chunks[]。
   */
  private async saveProgressToCacheSoft(chunkIndex: number): Promise<void> {
    if (!this.config.enableFileCache) return;

    // 节流：每 2 秒或最后一个分片时才写入
    const now = Date.now();
    const isLastChunk = this.completedChunks + 1 >= this.totalChunks;
    if (!isLastChunk && now - this._lastProgressSaveTime < 2000) return;
    this._lastProgressSaveTime = now;

    try {
      const fileHash = this.fileHash || await this.computeFileIdentifier();

      // 🔑 合并 _diskWrittenChunks（本轮写入）+ this.chunks[]（从 IndexedDB 恢复的历史完成分片）。
      //    重试后 doInit() 恢复的历史分片被跳过（不再写入磁盘），不在 _diskWrittenChunks 中。
      //    若只存 _diskWrittenChunks 会覆盖 IndexedDB 丢失历史进度 → 下次重试倒退 ❌。
      const chunkIndexes: number[] = [];
      const merged = new Set<number>(this._diskWrittenChunks);
      for (let i = 0; i < this.totalChunks; i++) {
        if (this.chunks[i]) merged.add(i);
      }
      // 确保当前分片也包含在内（可能在 .then() 回调时序中还未标记为 completed）
      merged.add(chunkIndex);
      for (const idx of merged) {
        chunkIndexes.push(idx);
      }

      chunkIndexes.sort((a, b) => a - b);

      const { saveDownloadProgress } = await import("../utils/fileCache");
      await saveDownloadProgress(
        fileHash,
        this.downloadFile.fileName,
        this.downloadFile.getFileSize(),
        this.totalChunks,
        chunkIndexes,
      );
    } catch (error) {
      logger.warn(this.getTag(), "保存下载进度失败", error);
      console.error("[DownloadChunkManager] ❌ 保存下载进度失败:", error);
    }
  }

  /**
   * 合并完成后保存文件
   *
   * - 流式模式：文件已在写入流关闭时落盘，无需额外操作
   * - 内存模式：如果有 fileHandle 则流式写入，否则触发浏览器下载对话框
   */
  protected async doBeforeOnSuccess(mergeResult: any): Promise<void> {
    // 流式模式：文件已在磁盘，无需操作
    if (mergeResult instanceof FileSystemFileHandle) {
      return;
    }

    // 内存模式：Blob 形式，需要保存
    if (mergeResult instanceof Blob && mergeResult.size > 0) {
      if (this.downloadFile.fileHandle) {
        await DownloadFile.writeToFileHandle(
          this.downloadFile.fileHandle,
          mergeResult,
        );
      } else {
        Downloader.saveBlob(this.downloadFile.fileName, mergeResult);
      }
    }

    // 🔑 下载完成后保留 IndexedDB 进度缓存作为"秒下"标记
    //    下次下载同一文件时，IndexedDB 显示 92/92 → 验证磁盘文件 → 秒下跳过下载
    //    不在此处清理，由 doInit() 中的磁盘验证逻辑决定是否需要清理（文件损坏 / 被删除时）
    if (this.config.enableFileCache) {
      try {
        const fileHash = this.fileHash || await this.computeFileIdentifier();
        const { saveDownloadProgress } = await import("../utils/fileCache");
        // 保存最终完成状态（全部 chunks 已完成），作为下次秒下的依据
        const allIndexes = Array.from({ length: this.totalChunks }, (_, i) => i);
        await saveDownloadProgress(
          fileHash,
          this.downloadFile.fileName,
          this.downloadFile.getFileSize(),
          this.totalChunks,
          allIndexes,
        );
        logger.debug(this.getTag(), "已保存下载完成标记到 IndexedDB");
      } catch (error) {
        logger.warn(this.getTag(), "保存下载完成标记失败", error);
      }
    }
  }

  /**
   * start() 重置后清理之前的 Blob 缓存和流式写入状态
   *
   * 🔑 在此处将 _diskWrittenChunks 保存到 IndexedDB，但 NOT clear()。
   *    clear() 推迟到 ensureWritableClosed() 的最终保存完成后执行：
   *    - doAfterStartReset() 保存时，_diskWrittenChunks 含已 settle 的分片
   *    - ensureWritableClosed() 等待 pending writes → 新 settle 的分片被
   *      .then() 加入 _diskWrittenChunks → 最终保存含完整集合 → 覆盖写入 ✅
   *    - 如果 doAfterStartReset() 就 clear()，最终保存只剩几个零碎分片 → 覆盖掉
   *      刚刚保存的完整记录 → 进度倒退 ❌
   */
  protected async doAfterStartReset(): Promise<void> {
    // 🔑 保留已完成分片的数据，重试时避免全部重新下载：
    //    - 内存模式：chunkBlobs Map 中已存有已完成分片的 Blob 数据
    //    - 流式模式：ensureWritableClosed() 改用 close() 保留磁盘上已写入的分片数据
    //    doInit() 从 IndexedDB 恢复进度 → transferWithConcurrency 跳过已完成分片
    //    → 只需下载缺失分片，不用从 0% 重新开始。
    if (this.chunkBlobs.size === 0) {
      this.chunkBlobs.clear();
    }

    // 🔑 清除上一轮可能残留的安全快照（如果 ensureWritableClosed 没执行到清理）
    this._safeDiskChunks.clear();

    // 🔑 合并 _diskWrittenChunks（本轮写入）+ this.chunks[]（从 IndexedDB 恢复的历史完成分片）
    //    保存到 IndexedDB，避免覆盖丢失历史进度。
    //    重试时 doInit() 从 IndexedDB 恢复分片 → transferWithConcurrency 跳过它们 →
    //    不再写入磁盘 → 不在 _diskWrittenChunks 中。若只存 _diskWrittenChunks 会覆盖
    //    IndexedDB 丢失历史进度 → 下次重试进度倒退 ❌。
    if (this.config.enableFileCache) {
      const allCompleted = new Set<number>(this._diskWrittenChunks);
      for (let i = 0; i < this.totalChunks; i++) {
        if (this.chunks[i]) allCompleted.add(i);
      }
      if (allCompleted.size > 0) {
        try {
          const chunkIndexes = Array.from(allCompleted).sort((a, b) => a - b);
          const fileHash =
            this.fileHash || (await this.computeFileIdentifier());
          const { saveDownloadProgress } = await import("../utils/fileCache");
          await saveDownloadProgress(
            fileHash,
            this.downloadFile.fileName,
            this.downloadFile.getFileSize(),
            this.totalChunks,
            chunkIndexes,
          );
          // 🔑 保存安全快照：这些分片的 write 已 settle，磁盘上数据是安全的。
          //    ensureWritableClosed() 等待 pending writes 追加新分片后，
          //    若 close() 失败，用此快照回滚 IndexedDB（而非全量删除）。
          this._safeDiskChunks = new Set(this._diskWrittenChunks);
        } catch (_err) {
          console.warn(
            `[DownloadChunkManager] doAfterStartReset 保存 IndexedDB 失败:`,
            _err,
          );
        }
      } else {
        this._safeDiskChunks.clear();
      }
    }

    // 🔑 不在此处清理 _diskWrittenChunks！如果立即 clear()，ensureWritableClosed()
    //    等待 pending writes 时 .then() 回调只能添加新 settle 的零散分片，
    //    最终保存的 IndexedDB 记录会覆盖掉上面刚存的完整记录，只剩少数分片。
    //    _diskWrittenChunks 的清理由 ensureWritableClosed() 在最终保存后统一执行。
    //    原因：最终保存会把新增 settle 的分片合并写入 IndexedDB，完整度 >= 上面那次。
    //
    //    旧标记指向的上次 writable 已关闭，数据或在磁盘（close 成功）或已丢失（abort）。
    //    重试的 doInit() 会从 IndexedDB 恢复进度 —— 若 IndexedDB 已被 abort 路径清理，
    //    会从零重新下载，_diskWrittenChunks 也将重新填充。

    // 🔑 不在此处关闭 writable —— 它的关闭是异步的，必须 await 才能确保
    //    文件锁已释放。关闭逻辑移到 ensureWritableClosed() 中统一处理。
    this.streamFileHandle = null;

    // 🔑 清理分片 headers 队列，避免上一次取消残留的 Range 头干扰
    this.downloadFile._chunkHeadersQueue = [];

    // 🔑 重置分片下载相关的状态，避免重试时使用旧数据
    this._lastProgressSaveTime = 0;
  }

  /**
   * 异步清理：关闭上次的 writable，释放文件锁。
   *
   * ⚠️ 必须 await 调用，确保 writable 完全关闭、文件锁释放后，
   *    doInit() 才能安全调用 createWritable()，否则会因锁冲突抛 InvalidStateError。
   *
   * 🔑 竞态修复：先置 null this.writable，再异步 close。
   *    否则旧 PQueue 残留的 doSaveChunkResult 回调会在 close() 进行中
   *    检查 if (this.writable) → 仍为非 null → writable.write() 写入正在关闭的流
   *    → 浏览器抛出 "Cannot write to a closing writable stream"。
   *
   * 🔑 数据安全：先等待 pendingWrites 全部 settle → write.then() 中会更新
   *    _diskWrittenChunks → 再 close() flush 缓冲区 → 磁盘数据完整。
   *    若 close() 失败退化为 abort()，磁盘数据丢失，必须同步清理 IndexedDB。
   */
  public async ensureWritableClosed(): Promise<void> {
    const oldWritable = this.writable;
    this.writable = null;

    if (this.pendingWrites.length > 0) {
      await Promise.allSettled(this.pendingWrites);
    }
    this.pendingWrites = [];

    if (oldWritable) {
      try {
        await oldWritable.close();

        if (this.config.enableFileCache) {
          const allCompleted = new Set<number>(this._diskWrittenChunks);
          for (let i = 0; i < this.totalChunks; i++) {
            if (this.chunks[i]) allCompleted.add(i);
          }
          if (allCompleted.size > 0) {
            try {
              const fileHash =
                this.fileHash || (await this.computeFileIdentifier());
              const chunkIndexes = Array.from(allCompleted).sort((a, b) => a - b);
              const { saveDownloadProgress } = await import(
                "../utils/fileCache"
              );
              await saveDownloadProgress(
                fileHash,
                this.downloadFile.fileName,
                this.downloadFile.getFileSize(),
                this.totalChunks,
                chunkIndexes,
              );
            } catch (_finalSaveErr) {
              console.warn(
                `[DownloadChunkManager] 最终保存进度失败:`,
                _finalSaveErr,
              );
            }
          }
        }

        this._diskWrittenChunks.clear();
        this._safeDiskChunks.clear();
      } catch (_closeErr) {
        console.warn(
          `[DownloadChunkManager] ⚠️ close() 失败，回退 abort(), err=`,
          _closeErr,
        );
        try {
          await oldWritable.abort();
        } catch (__) {
          console.warn(`[DownloadChunkManager] writable abort 也失败了:`, __);
        }

        // 🔑 abort 路径：合并 _safeDiskChunks + this.chunks[]（历史已完成分片）。
        //    abort 可能只丢弃未 flush 的本轮数据，历史分片在磁盘上仍然安全。
        //    doInit() 的磁盘验证会兜底：若文件真被清空，会清理 IndexedDB 重新下载。
        if (this.config.enableFileCache && this.fileHash) {
          try {
            const allSafe = new Set<number>(this._safeDiskChunks);
            for (let i = 0; i < this.totalChunks; i++) {
              if (this.chunks[i]) allSafe.add(i);
            }
            if (allSafe.size > 0) {
              const safeIndexes = Array.from(allSafe).sort((a, b) => a - b);
              const { saveDownloadProgress } = await import(
                "../utils/fileCache"
              );
              await saveDownloadProgress(
                this.fileHash,
                this.downloadFile.fileName,
                this.downloadFile.getFileSize(),
                this.totalChunks,
                safeIndexes,
              );
            } else {
              const { removeDownloadProgress } =
                await import("../utils/fileCache");
              await removeDownloadProgress(this.fileHash);
            }
          } catch (_cacheErr) {
            console.warn(
              `[DownloadChunkManager] abort 路径 IndexedDB 操作失败:`,
              _cacheErr,
            );
          }
        }
        this._safeDiskChunks.clear();
      }
    }
  }
}
