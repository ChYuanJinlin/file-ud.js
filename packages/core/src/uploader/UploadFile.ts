import axios from "axios";
import { IFile } from "../types";
import Uploader from ".";
import ChunkManager from "../chunkManager";
import UploadChunkManager from "./UploadChunkManager";
import {
  createReactiveUploadFile,
  formatFileSize,
  logger,
  computeTransferTime,
} from "../utils";
import TransferFile from "../transfer/TransferFile";
import Transfer from "../transfer/Transfer";
import { XHRInterceptor } from "../xhr-intercepto";

/**
 * 文件传输实例类
 * 负责单个文件的上传逻辑、状态管理、速率计算和生命周期控制
 *
 * @template T - 上传成功后的响应数据类型
 */
export default class UploadFile<T = any> extends TransferFile<UploadFile, T> {
  public up: Uploader<T>;
  /**
   * 分片管理器实例
   * 每个文件拥有独立的 uploadChunkManager,实现并发控制、断点续传和失败隔离
   */
  public uploadChunkManager: UploadChunkManager | null = null;
  public static interceptor: XHRInterceptor<UploadFile>;

  /**
   * 全局共享的 WeakMap
   * 用于存储 XHR 实例与文件上下文的映射关系,支持拦截器透明注入
   */
  private static xhrToFileMap = new WeakMap<XMLHttpRequest, UploadFile>();

  /**
   * 全局共享的当前上传文件队列
   * 用于在拦截器中查找匹配的 FormData
   */
  private static currentQueue: UploadFile[] = [];

  /**
   * 跟踪已分配到 XHR 的文件集合
   * 用于按顺序分配 XHR 实例,避免冲突
   */
  private static assignedFiles = new Set<UploadFile>();

  constructor(file: IFile, transfer: Transfer) {
    super(file, transfer);
    this.up = transfer as unknown as Uploader<T>;
    this.proxy = createReactiveUploadFile(this, transfer);
    // 如果是分片上传（检查 chunkOptions 配置）,在构造时就创建 uploadChunkManager
    if (this.up.config?.chunkOptions) {
      this.uploadChunkManager = new UploadChunkManager(
        this.up.config.chunkOptions,
        this,
      );
      this.chunkManager = this.uploadChunkManager;
      // ✅ 如果回显数据中包含分片信息，初始化 uploadChunkManager 状态
      if (file.totalChunks !== undefined) {
        this.initChunkManagerFromRestore(file);
      }
    }

    // 关键：在发起请求前设置拦截器，建立当前文件与 XHR 的映射
    this.initInterceptor();

    // 添加到队列
    UploadFile.currentQueue.push(this);
    
    UploadFile.interceptor.install();
    return this.proxy;
  }

  /**
   * 从回显数据初始化 uploadChunkManager 状态
   * 用于后端接口返回的文件列表回显场景
   *
   * @param file - 包含分片上传信息的文件对象
   */
  private async initChunkManagerFromRestore(file: IFile): Promise<void> {
    if (!this.uploadChunkManager) {
      logger.warn(
        "UploadFile",
        "initChunkManagerFromRestore: uploadChunkManager 不存在",
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
        chunkIndexes: file.chunkIndexes?.length || 0,
        fileHash: file.fileHash,
        uploadId: file.uploadId,
      },
    );

    // 1. 设置总分片数
    if (file.totalChunks !== undefined) {
      this.uploadChunkManager.totalChunks = file.totalChunks;
    }

    // 2. 设置已完成分片数
    if (file.completedChunks !== undefined) {
      this.uploadChunkManager.completedChunks = file.completedChunks;
    }

    // 3. 初始化已上传分片数组
    if (file.totalChunks !== undefined) {
      this.uploadChunkManager.chunks = new Array(file.totalChunks).fill(false);
    }

    // 4. 标记已上传的分片
    if (file.chunkIndexes && file.chunkIndexes.length > 0) {
      file.chunkIndexes.forEach((index) => {
        if (
          this.uploadChunkManager &&
          index >= 0 &&
          index < this.uploadChunkManager.totalChunks
        ) {
          this.uploadChunkManager.chunks[index] = true;
        }
      });
    } else if (file.completedChunks !== undefined && this.uploadChunkManager) {
      // 如果没有具体的索引数组，但有完成数量，假设前 N 个分片已完成
      for (
        let i = 0;
        i < file.completedChunks && i < this.uploadChunkManager.totalChunks;
        i++
      ) {
        this.uploadChunkManager.chunks[i] = true;
      }
    }

    // 5. 设置文件哈希和上传ID（用于断点续传）
    if (file.fileHash) {
      this.uploadChunkManager.fileHash = file.fileHash;
    }

    // 6. 计算并设置进度百分比
    if (this.uploadChunkManager.totalChunks > 0) {
      const percent = Math.round(
        (this.uploadChunkManager.completedChunks /
          this.uploadChunkManager.totalChunks) *
          100,
      );
      this.percent = percent;
      this.proxy.percent = percent;
    }

    // 7. 如果所有分片都已完成，设置状态为 success
    if (
      this.uploadChunkManager.completedChunks ===
        this.uploadChunkManager.totalChunks &&
      this.uploadChunkManager.totalChunks > 0
    ) {
      this.status = "success";
      this.proxy.status = "success";
      this.percent = 100;
      this.proxy.percent = 100;
    }

    // ✅ 8. 尝试从 IndexedDB 恢复 File 对象（如果启用了文件缓存）
    const up = this.transfer;
    if (
      file.fileHash &&
      this.up.config?.chunkOptions?.enableFileCache &&
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
      totalChunks: this.uploadChunkManager.totalChunks,
      completedChunks: this.uploadChunkManager.completedChunks,
      percent: this.percent,
      status: this.status,
    });

    // ✅ 关键修复：更新全局统计信息（总进度、总大小）
    up.updateGlobalStats();
    up.triggerUpdate();
  }

  /**
   * 执行普通上传的重试（模板方法覆写）
   */
  protected async doRetryTransfer(): Promise<T> {
    return this.upload();
  }

  remove() {
    // 取消上传
    if (this.uploadChunkManager) {
      this.uploadChunkManager.cancelUpload();
    } else {
      this.abort?.();
    }

    const up = this.transfer;

    // 从文件列表中移除
    up.files = up.files.filter((f) => f.fileId !== this.fileId);

    // ✅ 重新计算全局统计信息（包括总进度、总大小等）
    up.updateGlobalStats();

    this.up.remObjectUrls(this.url);
    // ✅ 删除重复的手动更新，updateGlobalStats 已经处理了
    up.triggerUpdate();
    up.emit("remove", this.proxy);
  }

  setFile(file: File | Blob, formData: FormData, index?: number) {
    if (typeof this.up.config?.file === "function") {
      this.up.config?.file({
        data: file,
        formData,
        uploadFile: this,
        chunkIndex: index,
      });
    } else {
      formData.append(this.up.config?.file!, file);
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
      const up = this.transfer;
      up.loading = true;
      // 重置已上传字节数（避免重新上传时使用旧值）
      this.__transferBytes__ = 0;

      if (!this.up.config?.action) {
        console.warn("请设置上传地址");
        return;
      }

      // 记录上传开始（用于监控模块追踪）
      // 注意：对于分片上传，这个日志会在 uploadChunkManager.initUpload() 中输出
      // 这里只输出普通上传的开始日志，避免分片上传时每个分片都输出一次
      if (!this.uploadChunkManager) {
        logger.info("UploadFile", `开始上传文件: ${this.fileName}`, {
          fileId: this.fileId,
          fileName: this.fileName,
          fileSize: this.File.size,
          isChunkUpload: false,
        });
      }

      // 记录上传开始时间
      if (!this.uploadChunkManager) {
        computeTransferTime(this.proxy.transferTime).start();
      }

      // 获取插件上下文
      this.context = (this as any).__pluginContext || {
        transfer: up,
        shared: this.up["pluginSharedData"],
        config: this.up.config,
      };
      if (!up.transferTime.startTime) {
        computeTransferTime(up.transferTime).start();
      }
      if (!this.uploadChunkManager) {
        this.formData = new FormData();
        this.setFile(this.File, this.formData);
      }

      if (this.up.beforeTransferCallback) {
        try {
          const result = await this.up.beforeTransferCallback(this);
          if (!result) {
            return;
          }
        } catch (error) {
          return;
        }
      }

      this.proxy.status !== "cancelled" && (this.proxy.status = "UDLoading");

      // 只在首次上传时累加 totalBytes，避免重试时重复累加
      // 对于分片上传，应该在 uploadChunkManager.initUpload() 中初始化 totalBytes
      // 对于普通上传，在这里初始化
      if (!this.uploadChunkManager && this.up.config?.autoUpload) {
        // 普通上传：只在首次上传时累加
        if (up.totalBytes === 0 || !this.__hasCountedTotalBytes__) {
          up.totalTransferredBytes += this.File.size;
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

      if (typeof this.up.config?.action === "string") {
        // 直接使用用户配置的 action URL
        const axiosPromise = (this.up.config.axiosInstance || axios).post<T>(
          this.up.config.action,
          requestData,
          { signal },
        );
        promise = axiosPromise.then((response) => response.data);
      } else {
        // 🔑 函数 action：通过 XHR 拦截器机制处理取消，不暴露 signal 给用户
        if (signal) {
          signal.addEventListener(
            "abort",
            () => this.abort?.(),
            { once: true },
          );
        }
        promise = this.up.config?.action(requestData, this);
      }

      promise
        .then((res) => {
          if (this.uploadChunkManager) {
            // 分片上传：只调用分片完成回调，不调用文件成功回调
            // 文件成功回调会在 uploadChunkManager.checkStatistics 中所有分片完成后调用
            onChunkComplete?.(res);
          } else {
            // 普通上传：直接设置为成功并调用成功回调
            this.onSuccess(res);
            this.proxy.status = "success";
            this.proxy.percent = 100;
          }
          resolve(res);
        })
        .catch((err) => {
          if (!this.uploadChunkManager) {
            this.isCancel !== true && (this.proxy.status = "error");
          }
          this.onError(err);
          reject(err);
        })
        .finally(() => {
          // 记录上传结束时间和耗时
          if (!this.uploadChunkManager) {
            computeTransferTime(this.proxy.transferTime).end();
          }

          this.proxy.loading = false;
          up.loading = false;
        });
    });
  }

  /**
   * 返回上传的分片管理器
   */
  protected getChunkManager(): ChunkManager | null {
    return this.uploadChunkManager;
  }

  /**
   * 获取文件大小（上传场景：直接用 File.size）
   */
  public getFileSize(): number {
    return this.File?.size || 0;
  }

  /**
   * 更新当前文件的上传进度和已传输字节数（模板方法）
   *
   * 根据上传类型采用不同的进度计算策略：
   * - 普通上传：从 event.loaded/event.total 直接计算百分比和字节数
   * - 分片上传：由 uploadChunkManager 独立维护进度，此处无需额外操作
   */
  protected updateLocalProgress(event: ProgressEvent): void {
    if (!this.uploadChunkManager) {
      if (this.File.size > 0) {
        this.proxy.percent = Math.floor((event.loaded * 100) / event.total);

        this.__transferBytes__ = Math.floor(
          this.File.size * (this.proxy.percent / 100),
        );
      } else {
        this.__transferBytes__ = 0;
      }
    }
  }


}
