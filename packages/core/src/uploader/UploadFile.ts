import axios, { AxiosProgressEvent, Canceler } from "axios";
import { IFile, UploadSpeedInfo, UploadTimeInfo } from "../types";
import Uploader from ".";
import ChunkManager from "./ChunkManager";
import {
  createReactiveUploadFile,
  formatSpeed,
  formatDuration,
  formatFileSize,
  logger,
  checkNetworkStatus,
  computeUploadTime,
} from "../utils";
import { ErrorCode, FileUDError } from "../fileUD/errors";

/**
 * 文件上传实例类
 * 负责单个文件的上传逻辑、状态管理、速率计算和生命周期控制
 *
 * @template T - 上传成功后的响应数据类型
 */
export default class UploadFile<T = any> {
  [x: string]: any;

  /** 文件唯一标识符 */
  fileId: string;

  /** 文件预览 URL (Object URL) */
  url: string;

  /** 文件名称 */
  fileName: string;

  /** 原始 File 对象 */
  File: File;

  /** 上传进度百分比 (0-100) */
  percent: number | undefined;

  /** 文件上传状态 */
  status: IFile["status"];
  isCancel: boolean = false;
  /** 文件扩展名 */
  extension: string | undefined;
  public hashPercent = 0;
  public hashLoading = false;
  /** 格式化后的文件大小,如 "5.23 MB" */
  formatSize: string | undefined;

  /** 当前文件已上传的大小（格式化字符串），如 "45.23 MB" */
  uploadedFormatSize: string = "0 B";

  /** 表单数据对象,用于携带上传参数 */
  formData: FormData | null = null;

  /** 是否处于重试状态 */
  isRetry?: boolean;

  /** Promise resolve 回调引用 */
  resolve: ((value: any) => void | undefined) | undefined;

  /** Promise reject 回调引用 */
  reject: ((reason?: any) => void | undefined) | undefined;

  /** 文件在队列中的索引 */
  index?: number;

  /** 是否正在上传 */
  loading: boolean;

  /** 取消上传的函数 */
  abort: IFile["abort"];

  /** Proxy 代理对象,用于实现响应式更新 */
  proxy: UploadFile;

  /** 所属的 Uploader 实例 */
  public __uploader__: Uploader;

  /**
   * 分片管理器实例
   * 每个文件拥有独立的 ChunkManager,实现并发控制、断点续传和失败隔离
   */
  public chunkManager: ChunkManager | null = null;

  /**
   * 上传速率统计信息
   * 包含瞬时速度、平均速度及其格式化字符串
   * 通过 Proxy 自动触发全局速率聚合
   */
  public uploadSpeed: UploadSpeedInfo = {
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
  public uploadTime: UploadTimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 静态文件列表(已废弃,使用 Uploader.files) */
  static files: UploadFile[] = [];

  /** 文件元数据(可扩展) */
  metadata: any;

  /**
   * 全局共享的 WeakMap
   * 用于存储 XHR 实例与文件上下文的映射关系,支持拦截器透明注入
   */
  private static xhrToFileMap = new WeakMap<XMLHttpRequest, UploadFile>();

  /**
   * 全局共享的当前上传文件队列
   * 用于在拦截器中查找匹配的 FormData
   */
  private static currentUploadQueue: UploadFile[] = [];

  /**
   * 跟踪已分配到 XHR 的文件集合
   * 用于按顺序分配 XHR 实例,避免冲突
   */
  private static assignedFiles = new Set<UploadFile>();

  // ==================== 速率计算内部状态 ====================

  /** 上次计算速率的时间戳 (毫秒) */
  private lastUpdateTime: number = 0;

  /** 上次已上传的字节数 */
  private lastUploadedBytes: number = 0;

  /** 上传开始的时间戳 (毫秒) */
  private uploadStartTime: number = 0;

  /** 标记是否已计入总字节数（避免重试时重复累加） */
  public __hasCountedTotalBytes__: boolean = false;

  /** 当前文件已上传的字节数（用于普通上传计算总进度） */
  public __uploadedBytes__: number = 0;

  constructor(file: IFile, up: Uploader<T>) {
    this.fileId = file.fileId;
    this.url = file.url;
    this.fileName = file.fileName;
    this.File = file.File;
    this.percent = file.percent;
    this.status = file.status;
    this.File = file.File;

    this.loading = false;
    this.extension = file.extension;
    this.formatSize = file.formatSize;
    this.abort = file.abort;
    this.index = file.index!;
    this.isRetry = file.isRetry || false;
    this.__uploader__ = file.__uploader__!;

    this.proxy = createReactiveUploadFile(this, up);
    // 如果是分片上传（检查 chunkOptions 配置）,在构造时就创建 ChunkManager
    if (up.config?.chunkOptions) {
      this.chunkManager = new ChunkManager(up.config.chunkOptions, this);

      // ✅ 如果回显数据中包含分片信息，初始化 ChunkManager 状态
      if (file.totalChunks !== undefined) {
        this.initChunkManagerFromRestore(file);
      }
    }
    // 关键：在发起请求前设置拦截器，建立当前文件与 XHR 的映射
    this.setupInterceptor(this);
    return this.proxy;
  }

  /**
   * 从回显数据初始化 ChunkManager 状态
   * 用于后端接口返回的文件列表回显场景
   *
   * @param file - 包含分片上传信息的文件对象
   */
  private async initChunkManagerFromRestore(file: IFile): Promise<void> {
    if (!this.chunkManager) {
      logger.warn(
        "UploadFile",
        "initChunkManagerFromRestore: chunkManager 不存在",
      );
      return;
    }

    logger.info(
      "UploadFile",
      `从回显数据初始化分片上传状态: ${this.fileName}`,
      {
        fileId: this.fileId,
        totalChunks: file.totalChunks,
        completedChunks: file.completedChunks,
        uploadedChunkIndexes: file.uploadedChunkIndexes?.length || 0,
        fileHash: file.fileHash,
        uploadId: file.uploadId,
      },
    );

    // 1. 设置总分片数
    if (file.totalChunks !== undefined) {
      this.chunkManager.totalChunks = file.totalChunks;
    }

    // 2. 设置已完成分片数
    if (file.completedChunks !== undefined) {
      this.chunkManager.completedChunks = file.completedChunks;
    }

    // 3. 初始化已上传分片数组
    if (file.totalChunks !== undefined) {
      this.chunkManager.uploadedChunks = new Array(file.totalChunks).fill(
        false,
      );
    }

    // 4. 标记已上传的分片
    if (file.uploadedChunkIndexes && file.uploadedChunkIndexes.length > 0) {
      file.uploadedChunkIndexes.forEach((index) => {
        if (
          this.chunkManager &&
          index >= 0 &&
          index < this.chunkManager.totalChunks
        ) {
          this.chunkManager.uploadedChunks[index] = true;
        }
      });
    } else if (file.completedChunks !== undefined && this.chunkManager) {
      // 如果没有具体的索引数组，但有完成数量，假设前 N 个分片已完成
      for (
        let i = 0;
        i < file.completedChunks && i < this.chunkManager.totalChunks;
        i++
      ) {
        this.chunkManager.uploadedChunks[i] = true;
      }
    }

    // 5. 设置文件哈希和上传ID（用于断点续传）
    if (file.fileHash) {
      this.chunkManager.fileHash = file.fileHash;
    }
    if (file.uploadId) {
      this.chunkManager.uploadId = file.uploadId;
    }

    // 6. 计算并设置进度百分比
    if (this.chunkManager.totalChunks > 0) {
      const percent = Math.round(
        (this.chunkManager.completedChunks / this.chunkManager.totalChunks) *
          100,
      );
      this.percent = percent;
      this.proxy.percent = percent;
    }

    // 7. 如果所有分片都已完成，设置状态为 success
    if (
      this.chunkManager.completedChunks === this.chunkManager.totalChunks &&
      this.chunkManager.totalChunks > 0
    ) {
      this.status = "success";
      this.proxy.status = "success";
      this.percent = 100;
      this.proxy.percent = 100;
    }

    // ✅ 8. 尝试从 IndexedDB 恢复 File 对象（如果启用了文件缓存）
    const up = this.__uploader__;
    if (
      file.fileHash &&
      up.config?.chunkOptions?.enableFileCache &&
      (!this.File || this.File.size === 0)
    ) {
      logger.info("UploadFile", `尝试从缓存恢复文件: ${this.fileName}`, {
        fileHash: file.fileHash,
      });

      try {
        const cachedFile = await import("../utils/fileCache").then((m) =>
          m.restoreFileFromCache(file.fileHash!),
        );

        if (cachedFile) {
          // 验证缓存文件的完整性
          if (
            cachedFile.name === this.fileName &&
            cachedFile.size === this.File.size
          ) {
            this.File = cachedFile;
            logger.info(
              "UploadFile",
              `✅ 成功从缓存恢复文件: ${this.fileName}`,
              { fileSize: cachedFile.size },
            );
          } else {
            logger.warn(
              "UploadFile",
              `⚠️ 缓存文件不匹配: 期望 ${this.fileName} (${this.File.size}), 实际 ${cachedFile.name} (${cachedFile.size})`,
            );
          }
        } else {
          logger.debug(
            "UploadFile",
            `未找到缓存文件，用户需要重新选择: ${this.fileName}`,
          );
        }
      } catch (error) {
        logger.error(
          "UploadFile",
          `从缓存恢复文件失败: ${this.fileName}`,
          error,
        );
      }
    }

    logger.info("UploadFile", `分片上传状态初始化完成: ${this.fileName}`, {
      totalChunks: this.chunkManager.totalChunks,
      completedChunks: this.chunkManager.completedChunks,
      percent: this.percent,
      status: this.status,
    });

    // ✅ 关键修复：更新全局统计信息（总进度、总大小）
    up.updateGlobalStats();
    up.triggerUpdate();
  }

  /**
   * @description: 取消当前的请求
   * @return {*}
   */
  cancel(fn: ((next: () => void) => void) | void) {
    if (this.proxy.status !== "uploading" && this.proxy.status !== "paused") {
      console.warn("没有需要取消的上传", this.fileName);
      return;
    }

    const next = () => {
      // 如果是分片上传，调用 ChunkManager 的 cancelUpload 方法
      if (this.chunkManager) {
        this.chunkManager.cancelUpload();
      } else {
        // 普通上传，直接 abort
        this.abort?.();
      }

      this.__uploader__.totalUploadBytes -= this.File.size;
      this.__uploader__.emit("cancel", this.proxy);
    };

    fn ? fn(next) : next();
  }
  remove() {
    // 取消上传
    if (this.chunkManager) {
      this.chunkManager.cancelUpload();
    } else {
      this.abort?.();
    }

    const up = this.__uploader__;

    // 从文件列表中移除
    up.files = up.files.filter((f) => f.fileId !== this.fileId);

    // ✅ 重新计算全局统计信息（包括总进度、总大小等）
    up.updateGlobalStats();

    up.remObjectUrls(this.url);
    // ✅ 删除重复的手动更新，updateGlobalStats 已经处理了
    up.triggerUpdate();
    up.emit("remove", this.proxy);
  }

  /**
   * 开始上传
   *
   * 统一的上传入口，自动根据配置选择分片上传或普通上传：
   * - **分片上传**: 调用 ChunkManager.startUpload()
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
  async start(): Promise<T> {
    return new Promise(async (resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      try {
        if (this.chunkManager) {
          // 分片上传
          logger.info("UploadFile", `开始分片上传: ${this.fileName}`, {
            fileId: this.fileId,
            fileName: this.fileName,
          });
          await this.chunkManager.startUpload();
        } else {
          // 普通上传
          logger.info("UploadFile", `开始普通上传: ${this.fileName}`, {
            fileId: this.fileId,
            fileName: this.fileName,
          });
          const res = await this.upload();
          resolve(res);
        }
      } catch (error) {
        logger.error("UploadFile", `文件 ${this.fileName} 上传失败`, error);
        this.onError(error);
        this.reject(error);
        throw error;
      }
    });
  }

  /**
   * 重试上传
   *
   * 根据上传类型采用不同的重试策略:
   * - **分片上传**: 调用 ChunkManager.retryFailedChunks(),仅重试失败的分片,已成功分片不重复上传
   * - **普通上传**: 重新调用 upload() 方法,从头开始上传
   *
   * 重试前会重置文件状态为 uploading,进度归零,并标记 retry = true
   *
   * @example
   * ```typescript
   * // 监听错误事件
   * uploader.on('error', (error) => {
   *   console.error('上传失败:', error);
   *
   *   // 用户点击重试按钮
   *   if (confirm('是否重试?')) {
   *     file.rest();
   *   }
   * });
   * ```
   *
   * @remarks
   * - 分片上传的重试次数由 `chunkOptions.retries` 控制(默认 3 次)
   * - 重试是异步操作,建议在 UI 上显示加载状态
   * - 重试失败后会再次触发 error 事件
   */
  async retry() {
    const up = this.__uploader__;
    if (!["cancelled", "fail", "error"].includes(this.proxy.status!)) {
      console.warn("没有需要重试的上传", this.fileName);
      return;
    }
    // 根据当前状态决定重试策略
    const isChunkUpload = up.config?.chunkOptions && this.chunkManager;
    if (isChunkUpload && this.chunkManager) {
      // 分片上传的重试逻辑
      const hasFailedChunks = this.chunkManager.getFailedChunksCount() > 0;
      const allChunksCompleted =
        this.chunkManager.completedChunks === this.chunkManager.totalChunks;

      logger.info("UploadFile", `文件 ${this.fileName} 开始重试`, {
        fileId: this.fileId,
        fileName: this.fileName,
        status: this.proxy.status,
        completedChunks: this.chunkManager.completedChunks,
        totalChunks: this.chunkManager.totalChunks,
        hasFailedChunks,
        allChunksCompleted,
      });

      if (allChunksCompleted && !hasFailedChunks) {
        // 场景1：所有分片都成功了（可能在 merging 阶段失败）
        // 需要重新开始整个上传流程
        logger.info(
          "UploadFile",
          `所有分片已完成，重新开始上传流程（可能是合并阶段失败）`,
        );

        // 重置状态
        this.proxy.isRetry = true;
        this.proxy.status = "uploading";
        // ⚠️ 不要重置 percent，保持当前进度显示

        // 重新初始化并启动上传
        await this.chunkManager.startUpload().catch((err: any) => {
          logger.error("UploadFile", `文件 ${this.fileName} 重试失败`, err);
          this.onError(err);
        });
      } else if (hasFailedChunks) {
        // 场景2：有失败的分片，只重试失败的分片
        logger.info(
          "UploadFile",
          `发现 ${this.chunkManager.getFailedChunksCount()} 个失败分片，仅重试失败分片`,
        );

        // 重置状态
        this.proxy.isRetry = true;
        this.proxy.status = "uploading";

        // 仅重试失败的分片
        await this.chunkManager.retryFailedChunks().catch((err: any) => {
          logger.error("UploadFile", `文件 ${this.fileName} 重试失败`, err);
          this.onError(err);
        });
      } else {
        // 尝试重新开始整个上传流程
        this.proxy.isRetry = true;
        this.proxy.status = "uploading";

        await this.chunkManager.startUpload().catch((err: any) => {
          logger.error("UploadFile", `文件 ${this.fileName} 重试失败`, err);
          this.onError(err);
        });
      }
    } else {
      // 普通上传：重新调用 upload 方法
      logger.info("UploadFile", `文件 ${this.fileName} 开始重试普通上传`);

      // 重置状态
      this.proxy.isRetry = true;
      this.proxy.percent = 0;
      this.proxy.status = "uploading";

      await this.upload().catch((err: any) => {
        logger.error("UploadFile", `文件 ${this.fileName} 重试失败`, err);
        this.onError(err);
      });
    }
    this.proxy.isRetry = false;
    this.__uploader__.emit("retry", this.proxy);
  }

  /**
   * 暂停上传
   *
   * 暂停当前文件的上传过程。
   * - **分片上传**: 暂停新分片的启动,等待当前活跃分片完成后进入暂停状态
   * - **普通上传**: 直接中止 XHR 请求
   *
   * 暂停后会保存当前进度,可以通过 resume() 恢复上传。
   *
   * @example
   * ```typescript
   * // 用户点击暂停按钮
   * pauseButton.addEventListener('click', () => {
   *   file.pause();
   *   console.log(file.status); // "paused"
   * });
   * ```
   *
   * @remarks
   * - 只有处于 "uploading" 状态的文件才能暂停
   * - 暂停后可以随时调用 resume() 恢复
   * - 分片上传的进度会自动保存(如果启用了断点续传)
   */
  pause(): void {
    if (this.proxy.status !== "uploading") {
      console.warn(
        "UploadFile",
        `文件 ${this.fileName} 当前状态为 ${this.proxy.status},无法暂停`,
      );
      return;
    }

    // 委托给 ChunkManager 处理
    if (this.chunkManager) {
      this.chunkManager.pause();
    } else {
      console.warn("该模式不支持暂停", this.fileName);
    }
    this.__uploader__.emit("pause", this.proxy);
  }

  /**
   * 恢复上传
   *
   * 从暂停的位置继续上传。
   * - **分片上传**: 继续上传剩余的分片,已成功分片不会重复上传
   * - **普通上传**: 由于 XHR 无法恢复,会重新开始上传
   *
   * @example
   * ```typescript
   * // 用户点击继续按钮
   * resumeButton.addEventListener('click', () => {
   *   file.resume();
   *   console.log(file.status); // "uploading"
   * });
   * ```
   *
   * @remarks
   * - 只有处于 "paused" 状态的文件才能恢复
   * - 分片上传会从上次中断的位置继续
   * - 普通上传会重新开始(因为 HTTP 请求无法恢复)
   */
  async resume(): Promise<void> {
    if (this.proxy.status !== "paused") {
      console.warn(
        "UploadFile",
        `文件 ${this.fileName} 当前状态为 ${this.proxy.status},无法恢复`,
      );
      return;
    }

    // 委托给 ChunkManager 处理
    if (this.chunkManager) {
      await this.chunkManager.resume();
    } else {
      console.warn("该模式不支持恢复", this.fileName);
    }
    this.__uploader__.emit("resume", this.proxy);
  }

  setFile(file: File | Blob, formData: FormData, index?: number) {
    const up = this.__uploader__;
    if (typeof up.config?.file === "function") {
      up.config?.file({
        data: file,
        formData,
        uploadFile: this,
        chunkIndex: index,
      });
    } else {
      formData.append(up.config?.file!, file);
    }
  }

  /**
   * 上传文件（支持普通上传和分片上传）
   *
   * @param onChunkComplete - 分片上传完成时的回调函数
   * @param signal - AbortSignal，用于取消请求（超时控制）
   * @param chunkFormData - 分片上传的 FormData（可选，优先使用此参数而不是 this.formData）
   * @returns Promise<T>
   */
  async upload(
    onChunkComplete?: (res: T) => void,
    signal?: AbortSignal,
    chunkFormData?: FormData, // 新增参数：接收分片的 FormData
  ): Promise<T> {
    this.proxy.loading = true;
    return new Promise(async (resolve, reject) => {
      const up = this.__uploader__;
      up.loading = true;
      // 重置已上传字节数（避免重新上传时使用旧值）
      this.__uploadedBytes__ = 0;

      if (!up.config?.action) {
        console.warn("请设置上传地址");
        return;
      }

      // 记录上传开始（用于监控模块追踪）
      // 注意：对于分片上传，这个日志会在 ChunkManager.initUpload() 中输出
      // 这里只输出普通上传的开始日志，避免分片上传时每个分片都输出一次
      if (!this.chunkManager) {
        logger.info("UploadFile", `开始上传文件: ${this.fileName}`, {
          fileId: this.fileId,
          fileName: this.fileName,
          fileSize: this.File.size,
          isChunkUpload: false,
        });
      }

      // 记录上传开始时间
      if (!this.chunkManager) {
        computeUploadTime(this.proxy.uploadTime).start();
      }

      // 获取插件上下文
      this.context = (this as any).__pluginContext || {
        uploader: up,
        shared: up["pluginSharedData"],
        config: up.config,
      };
      if (!up.uploadTime.startTime) {
        computeUploadTime(up.uploadTime).start();
      }
      if (!this.chunkManager) {
        this.formData = new FormData();
        this.setFile(this.File, this.formData);
      }

      if (up.beforeUploadCallback) {
        try {
          const result = await up.beforeUploadCallback(this);
          if (!result) {
            return;
          }
        } catch (error) {
          return;
        }
      }

      this.proxy.status !== "cancelled" && (this.proxy.status = "uploading");

      // 只在首次上传时累加 totalBytes，避免重试时重复累加
      // 对于分片上传，应该在 ChunkManager.initUpload() 中初始化 totalBytes
      // 对于普通上传，在这里初始化
      if (!this.chunkManager && up.config?.autoUpload) {
        // 普通上传：只在首次上传时累加
        if (up.totalBytes === 0 || !this.__hasCountedTotalBytes__) {
          up.totalUploadBytes += this.File.size;
          up.totalBytes += this.File.size;
          up.totalFormatSize = formatFileSize(up.totalBytes);
          this.__hasCountedTotalBytes__ = true; // 标记已计数
        }
      }

      let promise: Promise<T>;
      // 优先使用传入的 chunkFormData，避免使用共享的 this.formData
      // 对于分片上传，每个分片都有独立的 FormData，通过参数传递
      // 对于普通上传，使用 this.formData
      const requestData = chunkFormData || this.formData || new FormData();

      if (typeof up.config?.action === "string") {
        // 直接使用用户配置的 action URL
        promise = (up.config.axiosInstance || axios).post<T>(
          up.config.action,
          requestData,
          { signal },
        );
      } else {
        promise = up.config?.action(requestData, this);
      }

      promise
        .then((res) => {
          if (this.chunkManager) {
            // 分片上传：只调用分片完成回调，不调用文件成功回调
            // 文件成功回调会在 ChunkManager.checkStatistics 中所有分片完成后调用
            onChunkComplete?.(res);
          } else {
            // 普通上传：直接设置为成功并调用成功回调
            this.onScuccess(res);
            this.proxy.status = "success";
            this.proxy.percent = 100;
          }
          resolve(res);
        })
        .catch((err) => {
          if (!this.chunkManager) {
            this.isCancel !== true && (this.proxy.status = "error");
          }
          this.onError(err);
          reject(err);
        })
        .finally(() => {
          // 记录上传结束时间和耗时
          if (!this.chunkManager) {
            computeUploadTime(this.proxy.uploadTime).end();
          }

          this.proxy.loading = false;
          up.loading = false;
        });
    });
  }

  public onScuccess(res: T) {
    const up = this.__uploader__;

    up["runHook"]("onSuccess", res, this, this.context);
    up.uploadSuccessCallback?.(res, this.proxy);
    up.uploadFiles.splice(up.uploadFiles.indexOf(this), 1);
    up.remObjectUrls(this.url);

    // 添加 fileId 到日志参数中，供监控模块提取
    logger.info("UploadFile", `文件上传成功: ${this.fileName}`, {
      fileId: this.fileId,
      fileName: this.fileName,
      fileSize: this.File.size,
    });

    // ✅ 关键修复：更新全局统计信息（总进度、总大小）
    up.updateGlobalStats();
    up.triggerUpdate();

    if (!up.uploadFiles.length) {
      up.emit("files-complete", up.files);
      console.log("所有文件上传完成");
      computeUploadTime(up.uploadTime).end();
      up.uploadTime.startTime = 0;
    }
  }

  public onError(err: any) {
    const up = this.__uploader__;
    if (this.isCancel) {
      logger.warn("UploadFile", `文件上传被取消: ${this.fileName}`, {
        fileId: this.fileId,
        fileName: this.fileName,
        fileSize: this.File.size,
      });
      return;
    }
    // 添加 fileId 到错误日志中，供监控模块提取
    logger.error("UploadFile", `文件上传失败: ${this.fileName}`, {
      fileId: this.fileId,
      fileName: this.fileName,
      fileSize: this.File.size,
      error: err.message || err,
    });

    up["runHook"]("onError", err, this, this.context);
    up.emit("error", new FileUDError(ErrorCode.UPLOAD_FAILED, err).toJSON());
  }

  /**
   * 计算全局上传进度（统一处理，避免重复代码）
   */
  private calculateGlobalProgress(event: ProgressEvent): void {
    const up = this.__uploader__;

    // 动态计算当前正在上传的文件总字节数和已上传字节数
    let totalUploadedBytes = 0;
    let currentTotalBytes = 0;
    let totalFilesSize = 0;
    up.files.forEach((file) => {
      // 根据上传类型决定状态过滤条件
      if (file.File?.size > 0) {
        totalFilesSize += file.File.size;
      }
      const isActiveUpload = this.chunkManager
        ? ["uploading", "paused", "fail"].includes(file.status!)
        : file.status === "uploading" || file.status === "paused";

      if (isActiveUpload) {
        currentTotalBytes += file.File.size;

        if (file.chunkManager) {
          // 分片上传：使用 chunkManager 的已上传字节数

          totalUploadedBytes += file.chunkManager.totalUploadedSize;
        } else {
          // 普通上传：使用 __uploadedBytes__
          totalUploadedBytes += file.__uploadedBytes__ || 0;
        }
      }
    });

    // 更新全局已上传字节数和总进度
    up.uploadedBytes = totalUploadedBytes;
    up.totalBytes = totalFilesSize;
    up.totalFormatSize = formatFileSize(totalFilesSize);
    up.totalPercent =
      currentTotalBytes > 0
        ? Math.min(
            100,
            Math.floor((totalUploadedBytes / currentTotalBytes) * 100),
          )
        : this.chunkManager
        ? up.totalPercent
        : 0;
  }

  /**
   * 处理上传进度事件
   *
   * 根据上传类型(分片/普通)采用不同的进度计算策略:
   * - 分片上传: 委托给 ChunkManager.updateProgress() 处理,支持断点续传进度合并
   * - 普通上传: 直接计算百分比 (loaded / total * 100)
   *
   * 同时触发速率计算和进度事件通知
   *
   * @param event - XHR 进度事件对象,包含 loaded 和 total 属性
   *
   *
   *
   * @private
   */
  private handleProgress(event: ProgressEvent): void {
    const up = this.__uploader__;
    if (!this.chunkManager) {
      if (this.File.size > 0) {
        this.proxy.percent = Math.floor((event.loaded * 100) / event.total);

        this.__uploadedBytes__ = Math.floor(
          this.File.size * (this.proxy.percent / 100),
        );
      } else {
        this.__uploadedBytes__ = 0;
      }
    }

    // 更新当前文件已上传的大小（使用 formatFileSize 格式化）
    this.proxy.uploadedFormatSize = formatFileSize(this.__uploadedBytes__);

    // 使用统一方法计算全局进度
    this.calculateGlobalProgress(event);

    // 触发进度事件,通知外部监听器
    // 计算并更新当前文件的上传速率
    // 内部包含防抖逻辑(100ms 最小间隔)
    this.calculateSpeed(this.__uploadedBytes__);
    up.emit("progress", up.totalPercent);
  }

  /**
   * 计算上传速率(带防抖优化)
   *
   * 采用最小时间间隔采样策略,避免高频进度回调导致数值剧烈抖动。
   * 瞬时速度基于最近两个有效采样点计算,平均速度基于总耗时和总字节数计算。
   *
   * @param loadedBytes - 当前已上传的字节数
   *
   *
   * @private
   */
  private calculateSpeed(loadedBytes: number): void {
    const now = Date.now();

    // 初始化上传开始时间(首次调用)
    if (this.uploadStartTime === 0) {
      this.uploadStartTime = now;
      this.lastUpdateTime = now;
      this.lastUploadedBytes = loadedBytes;
      return;
    }

    // 防抖: 最小时间间隔采样(100ms)
    // 避免高频回调导致计算开销过大和数值抖动
    const timeDiff = now - this.lastUpdateTime;
    if (timeDiff < 100) {
      return; // 跳过本次计算,等待下次采样
    }

    // 计算瞬时速度(bytes/s)
    // 公式: (当前字节 - 上次字节) / 时间差(秒)
    const bytesDiff = loadedBytes - this.lastUploadedBytes;
    const currentSpeed = (bytesDiff / timeDiff) * 1000;

    // 计算平均速度(bytes/s)
    // 公式: 总字节 / 总耗时(秒)
    const totalTime = now - this.uploadStartTime;
    const averageSpeed = totalTime > 0 ? (loadedBytes / totalTime) * 1000 : 0;

    // 更新速率信息到 Proxy 对象
    // 通过 Proxy.set 陷阱自动触发 Uploader.triggerUpdate()
    // 进而聚合所有文件的速率到 Uploader.uploadSpeed
    this.proxy.uploadSpeed = {
      currentSpeed,
      averageSpeed,
      currentSpeedFormatted: formatSpeed(currentSpeed),
      averageSpeedFormatted: formatSpeed(averageSpeed),
    };

    // 更新内部状态,为下次计算做准备
    this.lastUpdateTime = now;
    this.lastUploadedBytes = loadedBytes;
  }

  /**
   * 设置当前文件的请求拦截器（全局只安装一次）
   * @param fileInstance 当前文件实例
   */
  public setupInterceptor(fileInstance: UploadFile): void {
    // 保存原始 XHR 引用
    Uploader.originalXHR = window.XMLHttpRequest;

    // 将当前文件添加到全局上传队列
    UploadFile.currentUploadQueue.push(fileInstance);

    // 只在第一次安装全局拦截器
    if (!Uploader.isInterceptorInstalled) {
      const OriginalXHR = window.XMLHttpRequest;

      const XHRProxy = function (this: any) {
        const xhr = new OriginalXHR();
        const upload = xhr.upload;

        let requestHeaders: Record<string, string> = {};
        let currentFileInstance: UploadFile | null = null;

        // 拦截 setRequestHeader
        const originalSetHeader = xhr.setRequestHeader;
        xhr.setRequestHeader = function (name: string, value: string) {
          requestHeaders[name] = value;
          return originalSetHeader.call(this, name, value);
        };

        // 拦截 send - 这是关键！
        const originalSend = xhr.send;
        xhr.send = function (body?: any) {
          // ✅ 在发送请求前检查网络状态
          const networkCheck = checkNetworkStatus();
          if (!networkCheck.online) {
            const error = new FileUDError(
              ErrorCode.NETWORK,
              "网络连接异常，请检查网络设置后重试",
              {
                fileName: currentFileInstance?.fileName,
                fileId: currentFileInstance?.fileId,
                timestamp: networkCheck.timestamp,
              },
              {
                recoverable: true,
                retryable: true,
                suggestion: "请检查网络连接后重试",
                userVisible: true,
              },
            );

            logger.error("UploadFile", `网络检查失败: ${error.message}`, {
              fileId: currentFileInstance?.fileId,
              fileName: currentFileInstance?.fileName,
            });

            // 设置文件状态为 error
            if (currentFileInstance) {
              currentFileInstance.proxy.status = "error";
              currentFileInstance.onError(error);
            }

            // 中止请求
            throw error;
          }

          // 优先从请求体获取 formData
          let formDataToSend = body;

          // 优先从 WeakMap 获取关联的文件实例
          currentFileInstance = UploadFile.xhrToFileMap.get(xhr) || null;

          // 如果 WeakMap 中没有，从队列中按顺序取一个未使用的文件
          if (
            !currentFileInstance &&
            UploadFile.currentUploadQueue.length > 0
          ) {
            // 从队列中找到第一个未被分配的文件
            for (const file of UploadFile.currentUploadQueue) {
              if (!UploadFile.assignedFiles.has(file)) {
                currentFileInstance = file;
                UploadFile.xhrToFileMap.set(xhr, file);
                UploadFile.assignedFiles.add(file);
                break;
              }
            }

            // 如果所有文件都被分配了，使用第一个文件（覆盖）

            if (!currentFileInstance) {
              currentFileInstance = UploadFile.currentUploadQueue[0];
              UploadFile.xhrToFileMap.set(xhr, currentFileInstance);
            }
          }

          // 添加上传器的全局 headers
          if (currentFileInstance?.__uploader__?.config?.headers) {
            Object.entries(
              currentFileInstance.__uploader__.config.headers,
            ).forEach(([key, value]) => {
              const headerExists = Object.keys(requestHeaders).some(
                (existingKey) =>
                  existingKey.toLowerCase() === key.toLowerCase(),
              );
              if (!headerExists) {
                xhr.setRequestHeader(key, value as string);
              }
            });
          }

          // 绑定进度回调到当前文件实例
          upload.onprogress = function (event: ProgressEvent) {
            if (currentFileInstance) {
              currentFileInstance.handleProgress(event);
            }
          };

          // 设置 abort 方法
          if (currentFileInstance) {
            currentFileInstance.abort = () => {
              if (xhr.readyState !== XMLHttpRequest.DONE) {
                xhr.abort();
                if (currentFileInstance) {
                  currentFileInstance.proxy.isCancel = true;
                  currentFileInstance.proxy.status = "cancelled";
                }
              }
            };
          }

          return originalSend.call(this, formDataToSend);
        };

        return xhr;
      } as any;

      // 复制原型方法
      XHRProxy.prototype = OriginalXHR.prototype;

      // 替换全局 XHR
      window.XMLHttpRequest = XHRProxy;
      Uploader.isInterceptorInstalled = true;

      console.log("✅ 全局 XHR 拦截器已安装");
    }

    // 标记当前文件的拦截器已激活
    Uploader.interceptorActive = true;
  }
}
