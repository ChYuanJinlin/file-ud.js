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
   * 初始化下载任务
   *
   * 如果用户提供了 fileHandle 直接使用；否则尝试调用 showSaveFilePicker
   * 让用户选择保存位置，实现流式写入磁盘（内存峰值 = 并发数 × 分片大小）。
   *
   * 若 API 不可用或用户取消，回退到内存累积模式。
   */
  protected async doInit(): Promise<any> {
    logger.info(this.getTag(), "初始化下载任务", {
      fileName: this.downloadFile.fileName,
      totalChunks: this.totalChunks,
    });

    // 尝试获取 FileHandle 以启用流式写入
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
      this.writable = await this.streamFileHandle.createWritable();
      logger.info(this.getTag(), "✅ 启用流式写入磁盘", {
        fileName: this.downloadFile.fileName,
      });
    } else {
      logger.info(this.getTag(), "⚠️ 流式写入不可用，使用内存模式");
    }

    return { chunks: [] };
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
   * - 流式模式：关闭 writable 完成磁盘写入，返回 FileHandle（文件已在磁盘，无需合并）
   * - 内存模式：将 chunkBlobs Map 中的分片按顺序拼接为单一 Blob
   */
  protected async doMergeChunks(): Promise<Blob | FileSystemFileHandle> {
    // 🔑 流式模式：关闭写入流，文件已完整落盘
    if (this.writable && this.streamFileHandle) {
      try {
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
   * 保存每个分片的 Blob 数据
   *
   * - 流式模式：通过 writable.write(data, position) 直接写入磁盘，写入后 Blob 即可被 GC
   * - 内存模式：存储到 chunkBlobs Map 中，待合并时一次性拼接
   */
  protected async doSaveChunkResult(chunkIndex: number, data: any): Promise<void> {
    if (!(data instanceof Blob)) return;

    // 🔑 流式模式：按分片偏移量写入磁盘，支持乱序到达
    if (this.writable) {
      const position = chunkIndex * this.chunkSize;
      await this.writable.write({ type: "write", position, data });
      return; // Blob 写入完毕，可以被 GC 回收
    }

    // 内存兜底模式
    this.chunkBlobs.set(chunkIndex, data);
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
  }

  /**
   * start() 重置后清理之前的 Blob 缓存和流式写入状态
   */
  protected doAfterStartReset(): void {
    this.chunkBlobs.clear();

    // 清理上次可能未关闭的写流
    if (this.writable) {
      this.writable.close().catch(() => {});
      this.writable = null;
    }
    this.streamFileHandle = null;
  }
}
