import axios, { AxiosProgressEvent, Canceler } from "axios";
import {
  IFile,
  UploadProgress,
  UploadSpeedInfo,
  UploadTimeInfo,
} from "../types";
import Uploader from ".";
import ChunkManager from "./ChunkManager";
import {
  createReactiveUploadFile,
  formatSpeed,
  formatDuration,
  logger,
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

  /** 文件扩展名 */
  extension: string | undefined;
  public hashPercent = 0;
  public hashLoading = false;
  /** 格式化后的文件大小,如 "5.23 MB" */
  formatSize: string | undefined;

  /** 表单数据对象,用于携带上传参数 */
  formData: FormData | null = null;

  /** 是否处于重试状态 */
  retry?: boolean;

  /** Promise resolve 回调引用 */
  resolve: ((value: any) => void | undefined) | undefined;

  /** Promise reject 回调引用 */
  reject: ((reason?: any) => void | undefined) | undefined;

  /** 文件在队列中的索引 */
  index: number;

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
    this.index = file.index;
    this.retry = file.retry || false;
    this.__uploader__ = file.__uploader__!;

    // 如果是分片上传,在构造时就创建 ChunkManager
    if (up.config?.chunkOptions) {
      this.chunkManager = new ChunkManager(up.config.chunkOptions, this);
    }

    this.proxy = createReactiveUploadFile(this, up);
    // 关键：在发起请求前设置拦截器，建立当前文件与 XHR 的映射
    this.setupInterceptor(this);
    return this.proxy;
  }
  /**
   * @description: 取消当前的请求
   * @return {*}
   */
  cancel() {
    this.abort?.();
    this.proxy.status = "cancelled";
  }
  remove() {
    this.cancel();
    const up = this.__uploader__;
    up.files = up.files.filter((f) => f.fileId !== this.fileId);

    up.remObjectUrls(this.url);
    up.emit("remove", this.proxy);
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
  rest() {
    const up = this.__uploader__;

    // 重置状态
    this.proxy.retry = true;
    this.proxy.percent = 0;

    // 分片上传: 使用当前文件的 ChunkManager 重试失败分片
    if (up.config?.chunkOptions && this.chunkManager) {
      logger.info("UploadFile", `文件 ${this.fileName} 开始重试分片上传`);
      this.chunkManager.retryFailedChunks().catch((err: any) => {
        logger.error("UploadFile", `文件 ${this.fileName} 重试失败`, err);
        this.onError(err);
      });
    } else {
      // 普通上传: 重新调用 upload 方法
      logger.info("UploadFile", `文件 ${this.fileName} 开始重试普通上传`);
      this.upload().catch((err: any) => {
        logger.error("UploadFile", `文件 ${this.fileName} 重试失败`, err);
        this.onError(err);
      });
    }
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
      logger.warn(
        "UploadFile",
        `文件 ${this.fileName} 当前状态为 ${this.proxy.status},无法暂停`,
      );
      return;
    }

    // 委托给 ChunkManager 处理
    if (this.chunkManager) {
      this.chunkManager.pause();
    } else {
      // 普通上传直接 abort
      this.proxy.status = "paused";
      if (this.abort) {
        this.abort();
        logger.info("UploadFile", `普通上传已暂停: ${this.fileName}`);
      }
    }
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
      logger.warn(
        "UploadFile",
        `文件 ${this.fileName} 当前状态为 ${this.proxy.status},无法恢复`,
      );
      return;
    }

    // 委托给 ChunkManager 处理
    if (this.chunkManager) {
      await this.chunkManager.resume();
    } else {
      // 普通上传需要重新开始
      logger.info("UploadFile", `普通上传将重新开始: ${this.fileName}`);
      await this.upload();
    }
  }

  setFile(file: File | Blob, formData: FormData) {
    const up = this.__uploader__;
    if (typeof up.config?.file === "function") {
      up.config?.file(this, formData);
    } else {
      formData.append(up.config?.file!, file);
    }
  }

  async upload(onChunkComplete?: (res: T) => void, signal?: AbortSignal) {
    this.proxy.loading = true;

    return new Promise(async (resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      const up = this.__uploader__;
      if (!up.config?.action) {
        console.warn("请设置上传地址");
        return;
      }

      // ✅ 记录上传开始（用于监控模块追踪）
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
      const now = Date.now();
      this.proxy.uploadTime = {
        startTime: now,
        endTime: 0,
        duration: 0,
        durationFormatted: "0s",
      };
      // 获取插件上下文
      this.context = (this as any).__pluginContext || {
        uploader: up,
        shared: up["pluginSharedData"],
        config: up.config,
      };

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

      this.proxy.status = "uploading";

      if (up.config?.autoUpload) {
        up.totalBytes += this.File.size;
      } else {
        up.totalBytes = Array.from(up.files).reduce(
          (acc, file) => acc + this.File.size,
          0,
        );
      }

      let promise: Promise<T>;
      // 使用外部函数 - 设置拦截器后发起请求
      const requestData = this.formData || new FormData();
      if (typeof up.config?.action === "string") {
        // 直接使用用户配置的 action URL
        // 如果是分片上传，用户可以通过 onInit/onMerge 回调自定义逻辑
        // 这里的 action 就是最终的分片上传地址
        // ✅ 传递 signal 实现真正的超时控制
        promise = (up.config.axiosInstance || axios).post<T>(
          up.config.action,
          requestData,
          { signal }
        );
      } else {
        promise = up.config?.action(requestData, this);
      }

      promise
        .then((res) => {
          if (this.chunkManager) {
            // ✅ 分片上传：只调用分片完成回调，不调用文件成功回调
            // 文件成功回调会在 ChunkManager.checkStatistics 中所有分片完成后调用
            onChunkComplete?.(res);
          } else {
            // ✅ 普通上传：直接设置为成功并调用成功回调
            this.proxy.status = "success";
            this.onScuccess(res);
          }
          resolve(res);
        })
        .catch((err) => {
          if (!this.chunkManager) {
            this.proxy.status = "error";
            this.proxy.percent = 0; // 上传失败时重置进度为 0%
            up.totalPercent = 0;
          }
          this.onError(err);
          reject(err);
        })
        .finally(() => {
          // 记录上传结束时间和耗时
          const now = Date.now();
          const duration = now - this.uploadTime.startTime;
          this.proxy.uploadTime = {
            startTime: this.uploadTime.startTime,
            endTime: now,
            duration,
            durationFormatted: formatDuration(duration),
          };

          this.proxy.loading = false;
        });
    });
  }

  public onScuccess(res: T) {
    const up = this.__uploader__;

    up["runHook"]("onSuccess", res, this, this.context);
    up.uploadSuccessCallback?.(res, this.proxy);
    up.uploadFiles.splice(up.uploadFiles.indexOf(this), 1);
    up.remObjectUrls(this.url);
    
    // ✅ 修复：添加 fileId 到日志参数中，供监控模块提取
    logger.info("UploadFile", `文件上传成功: ${this.fileName}`, {
      fileId: this.fileId,
      fileName: this.fileName,
      fileSize: this.File.size,
    });
  }
  
  public onError(err: any) {
    const up = this.__uploader__;
    
    // ✅ 修复：添加 fileId 到错误日志中，供监控模块提取
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
   * @example
   * ```typescript
   * // Axios 配置中绑定
   * axios.post(url, formData, {
   *   onUploadProgress: this.handleProgress.bind(this)
   * });
   * ```
   *
   * @private
   */
  private handleProgress(event: ProgressEvent): void {
    const up = this.__uploader__;
    // 统一处理不同类型的事件对象
    const loaded = (event as any).loaded || event.loaded;
    let percent = 0;
    // 普通上传: 直接计算百分比

    if (!this.chunkManager) {
      if (event.total) {
        this.proxy.percent = Math.floor((event.loaded * 100) / event.total);
      }

      // 计算总进度：使用 lastLoadedMap 避免重复累加
      const lastLoaded = up.lastLoadedMap.get(this.fileId) || 0;
      const deltaLoaded = loaded - lastLoaded;
      // 只累加增量部分
      if (deltaLoaded > 0) {
        up.totalProgress += deltaLoaded;
        up.lastLoadedMap.set(this.fileId, loaded);
      }

      // 计算总进度百分比
      up.totalPercent =
        up.totalBytes > 0
          ? Math.round((up.totalProgress / up.totalBytes) * 100)
          : percent;
    }

    // 触发进度事件,通知外部监听器
    // 计算并更新当前文件的上传速率
    // 内部包含防抖逻辑(100ms 最小间隔)
    this.calculateSpeed(event.loaded);
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
          // ✅ 修复：优先使用 body 中的 formData（axios 传递的，不会被并发覆盖）
          let formDataToSend = body;

          // 优先从 WeakMap 获取关联的文件实例
          currentFileInstance = UploadFile.xhrToFileMap.get(xhr) || null;

          // 如果 WeakMap 中没有，从队列中按顺序取一个未使用的文件
          if (
            !currentFileInstance &&
            UploadFile.currentUploadQueue.length > 0
          ) {
            for (const file of UploadFile.currentUploadQueue) {
              currentFileInstance = file;
              UploadFile.xhrToFileMap.set(xhr, file);
              break;
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

          // ✅ 修复：只有当 body 中没有 formData 时，才从实例获取（兜底逻辑）
          if (!formDataToSend && currentFileInstance?.formData) {
            formDataToSend = currentFileInstance.formData;

            logger.debug("UploadFile", "拦截器从实例获取 formData（兜底）", {
              hasFormData: true,
              chunkIndex: currentFileInstance.formData.get("chunkIndex"),
              fileName: currentFileInstance.formData.get("fileName"),
            });
          } else if (formDataToSend instanceof FormData) {
            // body 中有 formData，记录日志
            logger.debug("UploadFile", "拦截器使用 body 中的 formData", {
              hasFormData: true,
              chunkIndex: formDataToSend.get("chunkIndex"),
              fileName: formDataToSend.get("fileName"),
            });
          } else {
            logger.warn("UploadFile", "拦截器未找到 formData", {
              hasBody: !!body,
              isBodyFormData: body instanceof FormData,
              hasCurrentFile: !!currentFileInstance,
              hasInstanceFormData: !!currentFileInstance?.formData,
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
              }
            };
          }
          try {
            return originalSend.call(this, formDataToSend);
          } catch (error) {
            logger.error("UploadFile", "XHR 发送失败", error);
          }
        };

        return xhr;
      } as any;

      // 复制原型方法
      XHRProxy.prototype = OriginalXHR.prototype;

      // 替换全局 XHR
      window.XMLHttpRequest = XHRProxy;
      Uploader.isInterceptorInstalled = true;

      logger.debug("UploadFile", "全局 XHR 拦截器已安装");
    }

    // 标记当前文件的拦截器已激活
    Uploader.interceptorActive = true;
  }
}
