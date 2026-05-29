import ChunkManager from "../chunkManager";
import Downloader from "../downloader";
import DownloadFile from "../downloader/DownloadFile";
import { IFile, speedInfo, TimeInfo } from "../types";
import Uploader from "../uploader";
import UploadFile from "../uploader/UploadFile";
import { computeTransferTime, generateFileId, logger } from "../utils";
import Transfer from "./Transfer";

export default class TransferFile<T, D = any> {
  /**
   * 上传速率统计信息
   * 包含瞬时速度、平均速度及其格式化字符串
   * 通过 Proxy 自动触发全局速率聚合
   */
  public speed: speedInfo = {
    currentSpeed: 0,
    averageSpeed: 0,
    currentSpeedFormatted: "0 B/s",
    averageSpeedFormatted: "0 B/s",
  };

  /**
   * 上传时间统计信息
   * 记录文件从开始到结束的完整耗时
   * 通过 Proxy 自动触发 UI 更新
   */
  public transferTime: TimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 文件唯一标识符 */
  fileId: string;
  /** Proxy 代理对象,用于实现响应式更新 */
  proxy: T;

  /** 文件预览 URL (Object URL) */
  url: string;

  /** 文件名称 */
  fileName: string;

  /** 原始 File 对象 */
  File: File;

  /** 上传进度百分比 (0-100) */
  percent: number | undefined;
  /** 所属的 Uploader 实例 */
  public transfer: Transfer;
  /** 是否正在上传 */
  loading: boolean;

  /** 文件传输状态 */
  status: IFile["status"];
  isCancel: boolean = false;
  /** 文件扩展名 */
  extension: string | undefined;

  public hashPercent = 0;
  public hashLoading = false;
  /** 格式化后的文件大小,如 "5.23 MB" */
  formatSize: string | undefined;

  /** 当前文件已上传的大小（格式化字符串），如 "45.23 MB" */
  transferFormatSize: string = "0 B";

  /** 表单数据对象,用于携带上传参数 */
  formData: FormData | null = null;
  chunkManager: ChunkManager | null = null;
  /** 是否处于重试状态 */
  isRetry?: boolean;

  /** Promise resolve 回调引用 */
  resolve: ((value: any) => void | undefined) | undefined;

  /** Promise reject 回调引用 */
  reject: ((reason?: any) => void | undefined) | undefined;

  /** 文件在队列中的索引 */
  index?: number;

  /** 取消上传的函数 */
  abort: IFile["abort"];
  /** 标记是否已计入总字节数（避免重试时重复累加） */
  public __hasCountedTotalBytes__: boolean = false;
  /** 当前文件已上传的字节数（用于普通上传计算总进度） */
  public __transferBytes__: number = 0;

  constructor(file: IFile, ud: Uploader<T> | Downloader<T>) {
    this.fileId = generateFileId();
    this.url = file.url;

    this.transfer = ud as unknown as Transfer;

    this.fileName = file.fileName;
    this.File = file.File!;
    this.percent = file.percent;
    this.status = file.status;
    this.loading = false;
    this.extension = file.extension;
    this.formatSize = file.formatSize;
    this.proxy = null as any; // 代理对象将在外部创建后赋值
    this.abort = file.abort;
    this.index = file.index!;
    this.isRetry = file.isRetry || false;
  }

  /**
   * 开始上传
   *
   * 统一的上传入口，自动根据配置选择分片上传或普通上传：
   * - **分片上传**: 调用 uploadChunkManager.startUpload()
   * - **普通上传**: 调用 upload() 方法
   *
   * @example
   * ```typescript
   * // 手动上传模式
   * const file = uploader.addFile(fileObject);
   *
   * // 用户点击按钮时
   * button.onclick = () => {
   *   file.start();
   * };
   * ```
   *
   * @remarks
   * - 如果文件已经在上传中，会忽略此次调用
   * - 如果文件已上传成功，会抛出警告
   * - 这是异步操作，建议在 UI 上显示加载状态
   */
  public async start(
    UDChunkManager:
      | DownloadFile["downloadChunkManager"]
      | UploadFile["uploadChunkManager"],
  ): Promise<T> {
    return new Promise(async (resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      let type = UDChunkManager instanceof DownloadFile ? "下载" : "上传";
      try {
        if (UDChunkManager) {
          // 分片上传
          logger.info("UploadFile", `开始分片${type}: ${this.fileName}`, {
            fileId: this.fileId,
            fileName: this.fileName,
          });
          await UDChunkManager.startUpload();
        } else {
          // 普通上传
          logger.info("UploadFile", `开始普通${type}: ${this.fileName}`, {
            fileId: this.fileId,
            fileName: this.fileName,
          });
          const res =
            (await type) === "上传"
              ? (this as unknown as UploadFile).upload()
              : Promise.resolve();
          resolve(res);
        }
      } catch (error) {
        logger.error("UploadFile", `文件 ${this.fileName} ${type}失败`, error);
        this.onError(error);
        this.reject(error);
        throw error;
      }
    });
  }

  public onScuccess(res: D) {
    this.transfer["runHook"]("onSuccess", res, this, this.transfer);
    this.transfer.successCallback?.(res, this.proxy);
    this.transfer.activeFiles.splice(
      this.transfer.activeFiles.indexOf(this),
      1,
    );
    (this.transfer as unknown as Uploader<T>)?.remObjectUrls(this.url);

    // 添加 fileId 到日志参数中，供监控模块提取
    logger.info("UploadFile", `文件传输成功: ${this.fileName}`, {
      fileId: this.fileId,
      fileName: this.fileName,
      fileSize: this.File.size,
    });

    // ✅ 关键修复：更新全局统计信息（总进度、总大小）
    this.transfer.updateGlobalStats();
    this.transfer.triggerUpdate();

    if (!this.transfer.activeFiles.length) {
      this.transfer.emit("files-complete", this.transfer.files);
      console.log("所有文件传输完成");
      computeTransferTime(this.transfer.transferTime).end();
      this.transfer.transferTime.startTime = 0;
    }
  }

  public onError(err: any) {
    const up = this.transfer;
    if (this.isCancel) {
      logger.warn("UploadFile", `文件传输被取消: ${this.fileName}`, {
        fileId: this.fileId,
        fileName: this.fileName,
        fileSize: this.File.size,
      });
      return;
    }
    // 添加 fileId 到错误日志中，供监控模块提取
    logger.error("UploadFile", `文件传输失败: ${this.fileName}`, {
      fileId: this.fileId,
      fileName: this.fileName,
      fileSize: this.File.size,
      error: err.message || err,
    });

    this.up["runHook"]("onError", err, this, this.context);
    up.emit("error", new FileUDError(ErrorCode.UPLOAD_FAILED, err).toJSON());
  }
}
