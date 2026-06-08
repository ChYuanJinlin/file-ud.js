import ChunkManager from "../chunkManager";
import TransferFile from "../transfer/TransferFile";
import { ChunkOptions } from "../types/index";
import DownloadFile from "./DownloadFile";
import { formatFileSize, logger } from "../utils";
import Downloader from ".";

export default class DownloadChunkManager extends ChunkManager {
  private downloadFile: DownloadFile;

  /** 存储每个分片的 Blob 数据 */
  private chunkBlobs: Map<number, Blob> = new Map();

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
   * 下载场景暂不支持断点续传，始终从 0 开始
   */
  protected async doInit(): Promise<any> {
    logger.info(this.getTag(), "初始化下载任务", {
      fileName: this.downloadFile.fileName,
      totalChunks: this.totalChunks,
    });
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
   * 合并所有已下载分片，触发浏览器保存
   */
  protected async doMergeChunks(): Promise<Blob> {
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
   * 保存每个分片的 Blob 到内存 Map
   */
  protected doSaveChunkResult(chunkIndex: number, data: any): void {
    if (data instanceof Blob) {
      this.chunkBlobs.set(chunkIndex, data);
    }
  }

  /**
   * 合并完成后保存文件
   * - 如果有 fileHandle：流式写入磁盘（File System Access API）
   * - 否则：触发浏览器下载对话框
   */
  protected async doBeforeOnSuccess(mergeResult: any): Promise<void> {
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
   * start() 重置后清理之前的 Blob 缓存
   */
  protected doAfterStartReset(): void {
    this.chunkBlobs.clear();
  }
}
