import ChunkManager from "../chunkManager";
import { IFile, speedInfo, TimeInfo } from "../types/index";
import Transfer from "./Transfer";
import {
  computeTransferTime,
  formatFileSize,
  formatSpeed,
  generateFileId,
  logger,
} from "../utils";
import { FileUDError, ErrorCode } from "../fileUD/errors";
import UploadFile from "../uploader/UploadFile";
import Uploader from "../uploader";
import DownloadFile from "../downloader/DownloadFile";
import { XHRInterceptor } from "../xhr-intercepto";

export default class TransferFile<T extends TransferFile<T, any>, D = any> {
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
   * 上传下载时间统计信息
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
  proxy!: T;

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
  context: any;
  /** 表单数据对象,用于携带上传参数 */
  formData: FormData | null = null;
  chunkManager: ChunkManager | null = null;
  /** 是否处于重试状态 */
  isRetry?: boolean;
  size: number = 0;
  /** Promise resolve 回调引用 */
  resolve: ((value: any) => void | undefined) | undefined;

  /** Promise reject 回调引用 */
  reject: ((reason?: any) => void | undefined) | undefined;

  /** 文件在队列中的索引 */
  index?: number;
  sub: T | null;
  /** 取消上传的函数 */
  abort: IFile["abort"];
  /** 标记是否已计入总字节数（避免重试时重复累加） */
  public __hasCountedTotalBytes__: boolean = false;
  /** 当前文件已上传的字节数（用于普通上传计算总进度） */
  public __transferBytes__: number = 0;
  public type: string = "";

  // ==================== 速率计算内部状态 ====================

  /** 上次计算速率的时间戳 (毫秒) */
  protected lastUpdateTime: number = 0;

  /** 上次已传输的字节数 */
  protected lastTransferBytes: number = 0;

  /** 传输开始的时间戳 (毫秒) */
  protected transferStartTime: number = 0;
  constructor(file: IFile, transfer: Transfer) {
    this.fileId = generateFileId();
    this.url = file.url;
    this.transfer = transfer;
    this.fileName = file.fileName;
    this.File = file.File!;
    this.percent = file.percent;
    this.size = file.size || this.File?.size || 0;
    this.status = file.status;
    this.loading = false;
    this.extension = file.extension;
    this.sub = null;
    this.formatSize = file.formatSize;
    this.abort = file.abort;
    this.index = file.index!;
    this.isRetry = file.isRetry || false;
  }
  // 判断类型的辅助方法
  public isUploader(): boolean {
    return this.transfer.constructor.name === "Uploader";
  }

  public isDownloader(): boolean {
    return this.transfer.constructor.name === "Downloader";
  }
  /**
   * 开始传输
   *
   * 统一的传输入口，自动根据配置选择分片传输或普通传输：
   * - **分片传输**: 调用 chunkManager.start()
   * - **普通传输**: 由子类实现具体逻辑
   *
   * @example
   * ```typescript
   * // 手动传输模式
   * const file = uploader.addFile(fileObject);
   *
   * // 用户点击按钮时
   * button.onclick = () => {
   *   file.start();
   * };
   * ```
   *
   * @remarks
   * - 如果文件已经在传输中，会忽略此次调用
   * - 如果文件已传输成功，会抛出警告
   * - 这是异步操作，建议在 UI 上显示加载状态
   */
  public async start(chunkManager: ChunkManager | null): Promise<D> {
    // 分片传输
    const isDownload = this.isDownloader();
    const type = isDownload ? "下载" : "上传";

    return new Promise<D>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      (async () => {
        try {
          if (chunkManager) {
            logger.info(
              isDownload ? "DownloadFile" : "UploadFile",
              `开始分片${type}: ${this.fileName}`,
              {
                fileId: this.fileId,
                fileName: this.fileName,
              },
            );
            await (chunkManager as any).start();
          } else {
            logger.info(
              isDownload ? "DownloadFile" : "UploadFile",
              `开始普通${type}: ${this.fileName}`,
              {
                fileId: this.fileId,
                fileName: this.fileName,
              },
            );
            let data: D;
            if (this instanceof UploadFile) {
              data = await this.upload();
            } else {
              // 下载
              data = await (this as unknown as DownloadFile).download();
            }
            resolve(data);
          }
        } catch (error) {
          logger.error(
            isDownload ? "DownloadFile" : "UploadFile",
            `文件 ${this.fileName} ${type}失败`,
            error,
          );
          this.onError(error);
          reject(error);
        }
      })();
    });
  }

  // ==================== 取消 / 暂停 / 恢复 / 重试（基类统一实现） ====================

  /**
   * 取消当前传输
   */
  public cancel(fn: ((next: () => void) => void) | void): void {
    console.log(
      `[TransferFile] cancel() 被调用, fileName=${this.fileName}, proxyStatus=${this.proxy.status}`,
    );

    if (this.proxy.status !== "UDLoading" && this.proxy.status !== "paused") {
      const type = this.isDownloader() ? "下载" : "上传";
      console.warn(`[TransferFile] 没有需要取消的${type}: ${this.fileName}, 当前状态=${this.proxy.status}`);
      return;
    }

    console.log(`[TransferFile] ✅ 状态检查通过，执行取消: ${this.fileName}`);

    // 🔑 标记取消状态，防止 onError() 中被 abort 触发的异步错误覆盖 proxy.status
    this.isCancel = true;

    const next = () => {
      const cm = this.getChunkManager();
      if (cm) {
        console.log(`[TransferFile] 调用 chunkManager.cancel(): ${this.fileName}`);
        cm.cancel();
      } else {
        console.log(`[TransferFile] 无 chunkManager，调用 abort(): ${this.fileName}`);
        this.abort?.();
      }
      this.transfer.totalTransferredBytes -= this.getFileSize();
      this.transfer.emit("cancel", this.proxy as any);
      console.log(`[TransferFile] cancel() 完成, proxyStatus=${this.proxy.status}`);
    };

    fn ? fn(next) : next();
  }

  /**
   * 暂停传输（仅分片传输支持）
   */
  public pause(): void {
    if (this.proxy.status !== "UDLoading") {
      console.warn(
        `文件 ${this.fileName} 当前状态为 ${this.proxy.status},无法暂停`,
      );
      return;
    }

    const cm = this.getChunkManager();
    if (cm) {
      (cm as any).pause();
    } else {
      console.warn("该模式不支持暂停", this.fileName);
    }
    this.transfer.emit("pause", this.proxy as any);
  }

  /**
   * 恢复传输（仅分片传输支持）
   */
  public async resume(): Promise<void> {
    if (this.proxy.status !== "paused") {
      console.warn(
        `文件 ${this.fileName} 当前状态为 ${this.proxy.status},无法恢复`,
      );
      return;
    }

    const cm = this.getChunkManager();
    if (cm) {
      await (cm as any).resume();
    } else {
      console.warn("该模式不支持恢复", this.fileName);
    }
    this.transfer.emit("resume", this.proxy as any);
  }

  /**
   * 重试传输
   */
  public async retry(): Promise<void> {
    console.log(
      `[TransferFile] retry() 被调用, fileName=${this.fileName}, proxyStatus=${this.proxy.status}`,
    );

    if (!["cancelled", "fail", "error"].includes(this.proxy.status!)) {
      const type = this.isDownloader() ? "下载" : "上传";
      console.warn(
        `[TransferFile] 没有需要重试的${type}: ${this.fileName}, 当前状态=${this.proxy.status}`,
      );
      return;
    }

    console.log(`[TransferFile] ✅ 状态检查通过，开始重试: ${this.fileName}`);

    const cm = this.getChunkManager();
    console.log(`[TransferFile] getChunkManager() 返回:`, cm ? "有(分片模式)" : "null(普通模式)");

    if (cm) {
      try {
        const hasFailedChunks = cm.getFailedChunksCount() > 0;
        const allChunksCompleted = cm.completedChunks === cm.totalChunks;

        console.log(
          `[TransferFile] 重试详情: hasFailedChunks=${hasFailedChunks}, ` +
          `allChunksCompleted=${allChunksCompleted}, ` +
          `completedChunks=${cm.completedChunks}/${cm.totalChunks}, ` +
          `isCancelled=${(cm as any).isCancelled}, isPaused=${(cm as any).isPaused}`,
        );

        logger.info(
          this.isDownloader() ? "DownloadFile" : "UploadFile",
          `文件 ${this.fileName} 开始重试`,
          {
            fileId: this.fileId,
            fileName: this.fileName,
            status: this.proxy.status,
            completedChunks: cm.completedChunks,
            totalChunks: cm.totalChunks,
            hasFailedChunks,
            allChunksCompleted,
          },
        );

        // 🔑 重置取消/重试标志，清除上一次 cancel 的残留状态
        this.isCancel = false;
        this.proxy.isCancel = false;
        this.proxy.isRetry = true;
        this.proxy.status = "UDLoading";

        console.log(`[TransferFile] ✅ 已重置标志, proxyStatus=${this.proxy.status}`);

        // 🔑 始终走 start() 路径，统一初始化入口
        //   原因：取消后的异步清理可能残留 failedChunks，若走 retryFailedChunks()
        //   会绕过 doAfterStartReset/doInit/writable 创建 → retry 完全无效。
        //   retryAll 能工作正是因为调用时机更早，失败分片还没入队。
        console.log(
          `[TransferFile] 调用 chunkManager.start(), completedChunks=${cm.completedChunks}, totalChunks=${cm.totalChunks}`,
        );
        await (cm as any).start().catch((err: any) => {
          console.error(`[TransferFile] ❌ start() 抛出异常:`, err);
          logger.error(
            this.isDownloader() ? "DownloadFile" : "UploadFile",
            `文件 ${this.fileName} 重试失败`,
            err,
          );
          this.onError(err);
        });
        console.log(`[TransferFile] start() 完成, proxyStatus=${this.proxy.status}`);
      } catch (syncErr: any) {
        console.error(`[TransferFile] ❌ retry() 同步异常:`, syncErr);
        this.onError(syncErr);
      }
    } else {
      logger.info(
        this.isDownloader() ? "DownloadFile" : "UploadFile",
        `文件 ${this.fileName} 开始普通重试`,
      );
      // 🔑 重置取消标志，与分片路径保持一致。否则 download() 内保存文件失败时
      //    isCancel 仍为 true → onError 被跳过 → status 残留 "success" 但 percent 未到 100
      this.isCancel = false;
      this.proxy.isCancel = false;
      this.proxy.isRetry = true;
      this.proxy.percent = 0;
      this.proxy.status = "UDLoading";
      // 🔑 cancel 的 finally 清理已将文件移出 activeFiles，
      //    重试时需要重新加入，否则 onSuccess 中统计和 files-complete 事件会错乱
      if (!this.transfer.activeFiles.includes(this as any)) {
        this.transfer.activeFiles.push(this as any);
      }

      await this.doRetryTransfer().catch((err: any) => {
        logger.error(
          this.isDownloader() ? "DownloadFile" : "UploadFile",
          `文件 ${this.fileName} 重试失败`,
          err,
        );
        this.onError(err);
      });
    }
    this.proxy.isRetry = false;
    this.transfer.emit("retry", this.proxy as any);
  }

  /**
   * 执行普通传输的重试（模板方法，由子类覆写）
   * - UploadFile: 重试上传 → 调用 upload()
   * - DownloadFile: 重试下载 → 调用 download()
   */
  protected async doRetryTransfer(): Promise<any> {
    // 子类覆写
  }

  public onSuccess(res: D) {
    const isDownload = this.isDownloader();

    // ✅ 基类统一设置传输成功状态（普通/分片 上传/下载 均走此路径）
    this.proxy.status = "success";

    this.transfer["runHook"]("onSuccess", res, this, this.transfer);

    this.transfer.successCallback?.(res, this.proxy);

    // 🔑 只在文件确实在 activeFiles 中时才移除，避免 splice(-1, 1) 误删其他文件
    const afIdx = this.transfer.activeFiles.indexOf(this);
    if (afIdx !== -1) {
      this.transfer.activeFiles.splice(afIdx, 1);
    }
    if (!isDownload) {
      (this.transfer as unknown as Uploader<T>)?.remObjectUrls?.(this.url);
    }

    // 添加 fileId 到日志参数中，供监控模块提取
    logger.info(
      isDownload ? "DownloadFile" : "UploadFile",
      `文件传输成功: ${this.fileName}`,
      {
        fileId: this.fileId,
        fileName: this.fileName,
        fileSize: this.File?.size ?? this.size ?? 0,
      },
    );

    // ✅ 关键修复：更新全局统计信息（总进度、总大小）
    this.transfer.updateGlobalStats();
    this.transfer.triggerUpdate();

    if (!this.transfer.activeFiles.length) {
      this.transfer.emit("files-complete", this.transfer.files);
      console.log("所有文件传输完成");

      computeTransferTime(this.transfer.transferTime).end();
      this.transfer.transferTime.startTime = 0;

      if (this.sub) {
        (this.sub as any).currentQueue = [];
        (this.sub as any).assignedFiles = new Set<T>();
        (this.sub as any).xhrToFileMap = new WeakMap<XMLHttpRequest, T>();
        (this.sub as any).interceptor.assignedFiles = new Set<T>();
        (this.sub as any).interceptor.restore();
      }
    }
  }

  public onError(err: any) {
    const up = this.transfer;
    const isDownload = this.isDownloader();
    if (this.isCancel) {
      logger.warn(
        isDownload ? "DownloadFile" : "UploadFile",
        `文件传输被取消: ${this.fileName}`,
        {
          fileId: this.fileId,
          fileName: this.fileName,
          fileSize: this.File?.size ?? this.size ?? 0,
        },
      );
      return;
    }

    // 添加 fileId 到错误日志中，供监控模块提取
    logger.error(
      isDownload ? "DownloadFile" : "UploadFile",
      `文件传输失败: ${this.fileName}`,
      {
        fileId: this.fileId,
        fileName: this.fileName,
        fileSize: this.File?.size ?? this.size ?? 0,
        error: err.message || err,
      },
    );

    // ✅ 修复：移除不存在的 this.up 和 this.context 引用
    // 错误处理应该由 transfer 实例来处理
    this.status = "error";
    up.emit(
      "error",
      new FileUDError(
        isDownload ? ErrorCode.DOWNLOAD_FAILED : ErrorCode.UPLOAD_FAILED,
        err,
      ).toJSON(),
    );
  }

  public initInterceptor(): void {
    const instance = this.constructor as any;
    this.sub = instance;
    if (instance.interceptor) return;

    instance.interceptor = XHRInterceptor.getInstance<T>(
      this.transfer.constructor.name,
      {
        name: this.transfer.constructor.name,

        getGlobalHeaders: (file: any) => {
          const configHeaders =
            (file.constructor.name === "UploadFile" ? file.up : file.dl)?.config
              ?.headers || {};

          // 🔑 分片下载时，从队列 shift 取出当前 XHR 对应的 Range 头
          //     并发安全：每个 XHR 的 send() 消费一个 entry，不会互相覆盖
          const chunkHeaders =
            file._chunkHeadersQueue?.length > 0
              ? file._chunkHeadersQueue.shift()!
              : {};

          return { ...configHeaders, ...chunkHeaders };
        },

        onProgress: (file, event) => {
          file.handleProgress(event);
        },

        onAbort: (file, xhr) => {
          // 🔑 累加模式：并发分片会产生多个 XHR，file.abort 需能取消所有
          if (!(file as any).__xhrAbortCallbacks) {
            (file as any).__xhrAbortCallbacks = [];
          }
          (file as any).__xhrAbortCallbacks.push(() => {
            if (xhr.readyState !== XMLHttpRequest.DONE) {
              xhr.abort();
            }
          });
          file.abort = () => {
            const callbacks = (file as any).__xhrAbortCallbacks || [];
            callbacks.forEach((fn: () => void) => {
              try {
                fn();
              } catch (_) {}
            });
            (file as any).__xhrAbortCallbacks = [];
            file.proxy.isCancel = true;
            file.proxy.status = "cancelled";
          };
        },

        getFileQueue: () => instance.currentQueue,
        getFileFromXHR: (xhr) => instance.xhrToFileMap.get(xhr) || null,
        // ✅ 设置 XHR 与文件的映射
        setFileToXHR: (xhr, file) => {
          instance.xhrToFileMap.set(xhr, file);
        },
        markFileAsAssigned: (file) => instance.assignedFiles.add(file),

        unmarkFileAsAssigned: (file) => instance.assignedFiles.delete(file),
      },
    );
  }

  // ==================== 进度 & 速率计算 ====================

  /**
   * 处理传输进度事件（供 XHRInterceptor 回调）
   *
   * 统一流程：
   * 1. 调用子类的 {@link updateLocalProgress} 更新当前文件的本体进度/字节数
   * 2. 更新格式化后的已传输大小
   * 3. 调用子类的 {@link calculateGlobalProgress} 计算全局统计
   * 4. 调用 {@link calculateSpeed} 计算并更新速率
   * 5. 发射 progress 事件
   *
   * @param event - XHR 进度事件对象
   */
  public handleProgress(event: ProgressEvent): void {
    const transfer = this.transfer;

    // 1. 子类差异化：更新当前文件进度/字节数
    this.updateLocalProgress(event);

    // 2. 更新格式化后的已传输大小
    this.proxy.transferFormatSize = formatFileSize(this.__transferBytes__);

    // 3. 子类差异化：计算全局进度
    this.calculateGlobalProgress(event);

    // 4. 计算速率
    this.calculateSpeed(this.__transferBytes__);

    // 5. 发射进度事件
    transfer.emit("progress", transfer.totalPercent);
  }

  /**
   * 更新当前文件的进度和已传输字节数（模板方法，由子类实现）
   *
   * - **普通传输**：从 event.loaded/event.total 直接计算百分比
   * - **分片传输**：由分片管理器独立维护进度，此处无需额外操作
   *
   * @param event - XHR 进度事件对象
   */
  protected updateLocalProgress(_event: ProgressEvent): void {
    // 子类重写
  }

  /**
   * 获取文件对应的分片管理器（模板方法，由子类实现）
   * - UploadFile 返回 uploadChunkManager
   * - DownloadFile 返回 downloadChunkManager
   */
  protected getChunkManager(): ChunkManager | null {
    return null;
  }

  /**
   * 获取文件大小（字节数），兼容上传（有 File 对象）和下载（无 File 对象）场景
   */
  public getFileSize(): number {
    return this.File?.size || this.size || 0;
  }

  /**
   * 计算全局传输进度（统一实现，子类只需覆写 getChunkManager / getFileSize）
   *
   * 汇总所有活动文件的传输进度，更新 transfer 实例上的全局统计
   *
   * @param _event - XHR 进度事件对象
   */
  protected calculateGlobalProgress(_event: ProgressEvent): void {
    const transfer = this.transfer;

    let totalTransferredBytes = 0;
    let currentTotalBytes = 0;
    let totalFilesSize = 0;

    transfer.files.forEach((file) => {
      const fileSize = file.getFileSize();
      if (fileSize > 0) {
        totalFilesSize += fileSize;
      }

      // 只统计活跃中的文件，避免已完成文件的字节被重复累加
      const isActive = this.getChunkManager()
        ? ["UDLoading", "paused", "fail"].includes(file.status!)
        : file.status === "UDLoading" || file.status === "paused";

      if (isActive) {
        currentTotalBytes += fileSize;

        const chunkManager = file.getChunkManager();
        if (chunkManager) {
          // 分片传输：使用 chunkManager 的已传输字节数
          totalTransferredBytes += chunkManager.totalChunkSize;
        } else {
          // 普通传输：使用 __transferBytes__
          totalTransferredBytes += file.__transferBytes__ || 0;
        }
      }
    });

    transfer.transferredBytes = totalTransferredBytes;
    transfer.totalBytes = totalFilesSize;
    transfer.totalFormatSize = formatFileSize(totalFilesSize);

    if (currentTotalBytes > 0) {
      // 已知总大小：精确计算加权百分比
      transfer.totalPercent = Math.min(
        100,
        Math.floor((totalTransferredBytes / currentTotalBytes) * 100),
      );
    } else if (this.getChunkManager()) {
      // 分片传输：保持当前值不变
      transfer.totalPercent = transfer.totalPercent;
    } else {
      // 未知总大小（如下载无 Content-Length 头）：使用当前文件的 percent
      transfer.totalPercent = this.proxy.percent || 0;
    }
  }

  /**
   * 计算传输速率（带防抖优化）
   *
   * 采用最小时间间隔采样策略，避免高频进度回调导致数值剧烈抖动。
   * 瞬时速度基于最近两个有效采样点计算，平均速度基于总耗时和总字节数计算。
   *
   * @param loadedBytes - 当前已传输的字节数
   */
  protected calculateSpeed(loadedBytes: number): void {
    const now = Date.now();

    // 初始化传输开始时间（首次调用）
    if (this.transferStartTime === 0) {
      this.transferStartTime = now;
      this.lastUpdateTime = now;
      this.lastTransferBytes = loadedBytes;
      return;
    }

    // 防抖：最小时间间隔采样（100ms）
    // 避免高频回调导致计算开销过大和数值抖动
    const timeDiff = now - this.lastUpdateTime;
    if (timeDiff < 100) {
      return;
    }

    // 计算瞬时速度（bytes/s）
    // 公式：(当前字节 - 上次字节) / 时间差（秒）
    const bytesDiff = loadedBytes - this.lastTransferBytes;
    const currentSpeed = (bytesDiff / timeDiff) * 1000;

    // 计算平均速度（bytes/s）
    // 公式：总字节 / 总耗时（秒）
    const totalTime = now - this.transferStartTime;
    const averageSpeed = totalTime > 0 ? (loadedBytes / totalTime) * 1000 : 0;

    // 更新速率信息到 Proxy 对象
    // 通过 Proxy.set 陷阱自动触发 Transfer.triggerUpdate()
    this.proxy.speed = {
      currentSpeed,
      averageSpeed,
      currentSpeedFormatted: formatSpeed(currentSpeed),
      averageSpeedFormatted: formatSpeed(averageSpeed),
    };

    // 更新内部状态，为下次计算做准备
    this.lastUpdateTime = now;
    this.lastTransferBytes = loadedBytes;
  }
}
