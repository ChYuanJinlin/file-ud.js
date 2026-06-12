import ChunkManager from "../chunkManager";
import TransferFile from "../transfer/TransferFile";
import { ChunkOptions } from "../types/index";
import DownloadFile from "./DownloadFile";
import { formatFileSize, logger } from "../utils";
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

  protected async computeFileIdentifier(): Promise<string> {
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

    // 获取文件唯一标识
    const fileHash = await this.computeFileIdentifier();

    // ========== 断点续传 / 秒下检查 ==========
    const downloader = this.downloadFile.transfer;
    let initResult: any = null;
    let isResuming = false;

    if (downloader.onInitChunkCallback) {
      try {
        logger.debug(this.getTag(), "调用 onInitChunk 回调检查秒下/断点续传", {
          fileName: this.downloadFile.fileName,
          fileHash,
        });

        initResult = await downloader.onInitChunkCallback(
          this.downloadFile as any,
          this.totalChunks,
          fileHash,
        );

        if (initResult?.fileHash) {
          logger.info(this.getTag(), "初始化回调返回成功", {
            fileName: this.downloadFile.fileName,
          });

          // ✅ 秒下：文件已在本地（全部下载完成）
          if (
            initResult.isInstantDownload === true ||
            (initResult.chunks &&
              Array.isArray(initResult.chunks) &&
              initResult.chunks.length === this.totalChunks)
          ) {
            logger.info(this.getTag(), "⚡ 秒下，文件已在本地", {
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

            // 秒下文件设置速度（瞬时完成）
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

          // ✅ 断点续传：部分分片已在本地
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

            logger.info(this.getTag(), "✅ 断点续传，已恢复部分分片", {
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
      } catch (error) {
        // 回调失败不阻塞下载，回退到全新下载
        logger.warn(this.getTag(), "断点续传检查失败，将全新下载", error);
      }
    }

    // 🔑 如果启用了文件缓存且回调没有返回分片，尝试从 IndexedDB 恢复进度
    if (
      this.config.enableFileCache &&
      !isResuming &&
      this.completedChunks === 0
    ) {
      try {
        const { loadDownloadProgress } = await import("../utils/fileCache");
        const progress = await loadDownloadProgress(fileHash);

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
        }
      } catch (error) {
        logger.warn(this.getTag(), "从 IndexedDB 恢复进度失败", error);
      }
    }

    // ========== 初始化流式写入或内存模式 ==========
    if (this.downloadFile.fileHandle) {
      this.streamFileHandle = this.downloadFile.fileHandle;
    } else if (
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
    if (!this.config.enableFileCache) return;

    // 节流：每 2 秒或最后一个分片时才写入
    const now = Date.now();
    const isLastChunk = this.completedChunks + 1 >= this.totalChunks;
    if (!isLastChunk && now - this._lastProgressSaveTime < 2000) return;
    this._lastProgressSaveTime = now;

    try {
      const fileHash = await this.computeFileIdentifier();

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

    // 🔑 下载完成后清理 IndexedDB 中的进度缓存
    if (this.config.enableFileCache) {
      try {
        const fileHash = await this.computeFileIdentifier();
        const { removeDownloadProgress } = await import("../utils/fileCache");
        await removeDownloadProgress(fileHash);
        logger.debug(this.getTag(), "已清理下载进度缓存");
      } catch (error) {
        logger.warn(this.getTag(), "清理下载进度缓存失败", error);
      }
    }
  }

  /**
   * start() 重置后清理之前的 Blob 缓存和流式写入状态
   */
  protected doAfterStartReset(): void {
    this.chunkBlobs.clear();
    this.pendingWrites = [];

    // 清理上次可能未关闭的写流
    if (this.writable) {
      this.writable.close().catch(() => {});
      this.writable = null;
    }
    this.streamFileHandle = null;
  }
}
