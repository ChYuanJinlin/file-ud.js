import ChunkManager from "../chunkManager";
import TransferFile from "../transfer/TransferFile";
import { ChunkOptions } from "../types/index";
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

  /** 上次写入 IndexedDB 进度的时间戳（节流用） */
  private _lastProgressSaveTime: number = 0;

  // ==================== 构造函数 ====================

  constructor(chunkOptions: ChunkOptions, file: TransferFile<any, any>) {
    super(chunkOptions, file);
    this.downloadFile = file as unknown as DownloadFile;
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

    console.log(
      `[DownloadChunkManager] doInit() 入口, fileName=${this.downloadFile.fileName},` +
        ` completedChunks=${this.completedChunks}, totalChunks=${this.totalChunks}`,
    );

    const downloader = this.downloadFile.transfer;
    let initResult: any = null;
    let isResuming = false;

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
            console.log(
              `[DownloadChunkManager] ⚠️ onInitChunk 返回的 fileHash 不是有效 MD5: "${initResult.fileHash}", 将继续用 computeFileIdentifier 兜底`,
            );
          }

          // ✅ 秒下：仅当回调显式标记 isInstantDownload 时生效
          if (initResult.isInstantDownload === true) {
            logger.info(this.getTag(), "⚡ 秒下（回调标记），文件已在本地", {
              fileName: this.downloadFile.fileName,
            });
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
            };
            const dl = this.downloadFile.transfer;
            dl.updateGlobalStats();
            dl.triggerUpdate();
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
      console.log(
        `[DownloadChunkManager] 💡 fileHash 兜底值: ${this.fileHash} (非 MD5，将用于 IndexedDB key)`,
      );
    }

    // ========== Step 2: IndexedDB 恢复（用 this.fileHash 作为 key） ==========
    if (this.config.enableFileCache && this.fileHash) {
      try {
        console.log(
          `[DownloadChunkManager] 🔍 尝试从 IndexedDB 恢复进度, fileHash=${this.fileHash}, enableFileCache=${this.config.enableFileCache}`,
        );
        const { loadDownloadProgress } = await import("../utils/fileCache");
        const progress = await loadDownloadProgress(this.fileHash);

        console.log(
          `[DownloadChunkManager] 📦 IndexedDB 查询结果:`,
          progress
            ? `找到 ${progress.chunkIndexes.length}/${progress.totalChunks} 个已完成分片`
            : "未找到进度记录",
        );

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
                  //    无论新下载还是重试，都清理 IndexedDB 并重新下载
                  //    - 重试：用户可能手动删除了文件
                  //    - 新下载：showSaveFilePicker 创建的空文件，旧 IndexedDB 记录
                  //      指向的是之前其他位置的下载，chunk 数据无法复用
                  console.log(
                    `[DownloadChunkManager] 🗑️ 磁盘文件为空（用户可能删了或选了新位置），清理 IndexedDB 并重新下载`,
                  );
                  shouldDeleteCache = true;
                  fileVerified = false;
                } else if (diskSize !== expectedSize) {
                  // 文件大小不匹配 → 可能是其他文件，IndexedDB 记录仍有效（旧文件可能在别处）
                  console.log(
                    `[DownloadChunkManager] ⚠️ 磁盘文件大小不匹配: disk=${diskSize}, expected=${expectedSize}, IndexedDB 记录保留`,
                  );
                  fileVerified = false;
                  shouldDeleteCache = false;
                } else {
                  // 🔑 大小一致 → 进一步校验 MD5 哈希
                  if (this.fileHash && /^[a-f0-9]{32}$/i.test(this.fileHash)) {
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
                    // 无真实哈希可用，仅靠大小校验
                    fileVerified = true;
                  }
                }
              } catch (getFileErr) {
                // getFile() 失败：文件不存在 / 被删除 / 权限被撤销
                // 无论何种场景，文件都不可用，清理 IndexedDB 并重新下载
                console.log(
                  `[DownloadChunkManager] 🗑️ fileHandle.getFile() 失败（文件不可用），清理 IndexedDB 并重新下载, err=`,
                  getFileErr,
                );
                shouldDeleteCache = true;
                fileVerified = false;
              }
            }

            if (fileVerified) {
              console.log(
                `[DownloadChunkManager] ⚡ 秒下，文件已通过磁盘+哈希双验证, fileName=${this.downloadFile.fileName}`,
              );
              this.isInstantTransfer = true;
              this.downloadFile.proxy.percent = 100;
              this.downloadFile.proxy.status = "success";
              this.downloadFile.proxy.speed = {
                currentSpeed: 0,
                averageSpeed: 0,
                currentSpeedFormatted: "0 B/s",
                averageSpeedFormatted: "0 B/s",
              };
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
    if (!isResuming && initResult) {
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
            this.isInstantTransfer = true;
            this.completedChunks = this.totalChunks;
            this.chunks = new Array(this.totalChunks).fill(true);
            this.countedChunks = new Set(
              Array.from({ length: this.totalChunks }, (_, i) => i),
            );
            this.totalChunkSize = this.downloadFile.getFileSize();
            this.downloadFile.proxy.percent = 100;
            this.downloadFile.proxy.status = "success";
            this.downloadFile.proxy.speed = {
              currentSpeed: 0,
              averageSpeed: 0,
              currentSpeedFormatted: "0 B/s",
              averageSpeedFormatted: "0 B/s",
            };
            const dl = this.downloadFile.transfer;
            dl.updateGlobalStats();
            dl.triggerUpdate();
            return initResult;
          }
        }
      } catch {
        // 文件不存在或无法访问 → 继续正常下载
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

    console.log(
      `[DownloadChunkManager] doInit() 完成, completedChunks=${this.completedChunks}, ` +
        `isResuming=${isResuming}, hasWritable=${!!this.writable}`,
    );

    return initResult || { chunks: [] };
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
      return this.streamFileHandle;
    }

    // 内存模式兜底
    const allChunks: Blob[] = [];

    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.chunkBlobs.get(i);
      if (chunk) {
        allChunks.push(chunk);
      }
    }

    if (allChunks.length === 0) {
      // 🔑 秒下场景：文件已在磁盘完整，直接返回 FileHandle
      const fh = this.downloadFile.fileHandle || this.streamFileHandle;
      if (fh && this.isInstantTransfer) {
        logger.info(this.getTag(), "⚡ 秒下合并：文件已在本地磁盘，跳过合并");
        return fh;
      }
      logger.warn(this.getTag(), "没有可合并的分片");
      return new Blob();
    }

    const mergedBlob = new Blob(allChunks);
    logger.info(this.getTag(), "分片合并完成", {
      fileName: this.downloadFile.fileName,
      totalChunks: allChunks.length,
      size: formatFileSize(mergedBlob.size),
    });

    return mergedBlob;
  }

  // ==================== 覆写钩子 ====================

  /**
   * 保存每个分片的 Blob 数据 + 自动缓存下载进度到 IndexedDB
   *
   * - 流式模式：fire-and-forget 写入（不 await，PQueue worker 立即继续下载下一个分片）
   * - 内存模式：存储到 chunkBlobs Map 中，待合并时一次性拼接
   */
  protected async doSaveChunkResult(chunkIndex: number, data: any): Promise<void> {
    if (!(data instanceof Blob)) return;

    // 🔑 流式模式：fire-and-forget 写盘，不阻塞 PQueue worker 获取下一个分片
    if (this.writable) {
      const position = chunkIndex * this.chunkSize;
      this.pendingWrites.push(
        this.writable.write({ type: "write", position, data }),
      );
    } else {
      // 内存兜底模式
      this.chunkBlobs.set(chunkIndex, data);
    }

    // 🔑 如果启用了文件缓存，保存下载进度到 IndexedDB
    this.saveProgressToCacheSoft(chunkIndex);
  }

  /**
   * 将下载进度存入 IndexedDB（节流，最多每 2 秒写一次）
   */
  private async saveProgressToCacheSoft(chunkIndex: number): Promise<void> {
    if (!this.config.enableFileCache) {
      console.log(
        `[DownloadChunkManager] ⚠️ enableFileCache=false，跳过保存`,
      );
      return;
    }

    // 节流：每 2 秒或最后一个分片时才写入
    const now = Date.now();
    const isLastChunk = this.completedChunks + 1 >= this.totalChunks;
    if (!isLastChunk && now - this._lastProgressSaveTime < 2000) return;
    this._lastProgressSaveTime = now;

    try {
      // 🔑 使用 this.fileHash（真实 MD5，已在 doInit 中从服务端获取）
      const fileHash = this.fileHash || await this.computeFileIdentifier();

      // 收集所有已完成分片（含当前正在保存的）
      const chunkIndexes: number[] = [];
      for (let i = 0; i < this.totalChunks; i++) {
        if (this.chunks[i]) {
          chunkIndexes.push(i);
        }
      }
      if (!chunkIndexes.includes(chunkIndex)) {
        chunkIndexes.push(chunkIndex);
      }

      console.log(
        `[DownloadChunkManager] 💾 保存下载进度到 IndexedDB: ${chunkIndexes.length}/${this.totalChunks} 分片, fileHash=${fileHash}`,
      );

      const { saveDownloadProgress } = await import("../utils/fileCache");
      await saveDownloadProgress(
        fileHash,
        this.downloadFile.fileName,
        this.downloadFile.getFileSize(),
        this.totalChunks,
        chunkIndexes,
      );
    } catch (error) {
      // 缓存失败不阻塞下载
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
   */
  protected doAfterStartReset(): void {
    this.chunkBlobs.clear();

    // 🔑 不在此处关闭 writable —— 它的关闭是异步的，必须 await 才能确保
    //    文件锁已释放。关闭逻辑移到 ensureWritableClosed() 中统一处理。
    this.streamFileHandle = null;

    // 🔑 清理分片 headers 队列，避免上一次取消残留的 Range 头干扰
    this.downloadFile._chunkHeadersQueue = [];

    // 🔑 重置分片下载相关的状态，避免重试时使用旧数据
    this._lastProgressSaveTime = 0;
  }

  /**
   * 异步清理：等待所有 pending writes 完成 + 关闭上次的 writable
   *
   * ⚠️ 必须 await 调用，确保 writable 完全关闭、文件锁释放后，
   *    doInit() 才能安全调用 createWritable()，否则会因锁冲突抛 InvalidStateError。
   */
  public async ensureWritableClosed(): Promise<void> {
    console.log(
      `[DownloadChunkManager] ensureWritableClosed() 入口, pendingWrites=${this.pendingWrites.length}, hasWritable=${!!this.writable}`,
    );

    // 1. 等待所有 fire-and-forget 写入完成（加超时防止永久挂起）
    if (this.pendingWrites.length > 0) {
      try {
        // 🔑 加 5 秒超时，防止 pending writes 永远不 resolve
        await Promise.race([
          Promise.allSettled(this.pendingWrites),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("ensureWritableClosed: 等待写入超时")), 5000),
          ),
        ]);
        console.log(`[DownloadChunkManager] pendingWrites 全部完成`);
      } catch (e: any) {
        console.warn(`[DownloadChunkManager] pendingWrites 超时或失败:`, e.message);
      }
      this.pendingWrites = [];
    }

    // 2. 🔑 关闭上次可能未关闭的写流并 await 其完成
    if (this.writable) {
      try {
        await this.writable.close();
        console.log(`[DownloadChunkManager] writable 已关闭`);
      } catch (_) {
        console.warn(`[DownloadChunkManager] writable.close() 失败:`, _);
      }
      this.writable = null;
    }

    console.log(`[DownloadChunkManager] ensureWritableClosed() 完成`);
  }
}
