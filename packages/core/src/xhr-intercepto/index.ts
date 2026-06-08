// core/xhr-interceptor.ts
import { checkNetworkStatus, logger } from "../utils";
import { FileUDError, ErrorCode } from "../fileUD/errors";
import TransferFile from "../transfer/TransferFile";

/**
 * XHR 拦截器配置
 */
export interface XHRInterceptorConfig<T> {
  /** 拦截器名称（用于日志） */
  name: string;
  /** 获取文件队列的方法 */
  getFileQueue: () => T[];
  /** 获取全局 headers 的方法 */
  getGlobalHeaders: (file: T) => Record<string, string> | undefined;
  /** 处理进度事件的方法 */
  onProgress: (file: T, event: ProgressEvent) => void;
  /** 设置 abort 方法（可选） */
  setupAbort?: (file: T, xhr: XMLHttpRequest) => void;
  /** 标记文件已分配（可选） */
  markFileAsAssigned?: (file: T) => void;
  /** 从 XHR 获取文件实例的方法 */
  getFileFromXHR?: (xhr: XMLHttpRequest) => T | null;
  /** 设置 XHR 与文件的映射 */

  setFileToXHR?: (xhr: XMLHttpRequest, file: T) => void;
  /** 设置 abort 方法 */
  onAbort?: (file: T, xhr: XMLHttpRequest) => void;

  /** 取消标记文件 */
  unmarkFileAsAssigned: (file: T) => void;
}

/**
 * 全局 XHR 拦截器管理器
 */
export class XHRInterceptor<T extends TransferFile<T>> {
  private static instances = new Map<string, XHRInterceptor<any>>();

  private isInstalled: boolean = false;
  private originalXHR: typeof XMLHttpRequest | null = null;
  private xhrToFileMap = new WeakMap<XMLHttpRequest, T>();
  private assignedFiles = new Set<T>();

  constructor(private config: XHRInterceptorConfig<T>) {
    console.log(`[XHRInterceptor] 创建拦截器: ${config.name}`);
    this.config = config;
  }

  /**
   * 获取或创建拦截器实例（单例模式）
   */
  static getInstance<T extends TransferFile<T>>(
    name: string,
    config: XHRInterceptorConfig<T>,
  ): XHRInterceptor<T> {
    if (!this.instances.has(name)) {
      this.instances.set(name, new XHRInterceptor(config));
    }
    return this.instances.get(name) as XHRInterceptor<T>;
  }

  /**
   * 添加文件到已分配集合
   */
  private markAsAssigned(file: T): void {
    this.assignedFiles.add(file);
    if (this.config.markFileAsAssigned) {
      this.config.markFileAsAssigned(file);
    }
  }

  /**
   * 从 XHR 获取关联的文件
   */
  private getFileFromXHR(xhr: XMLHttpRequest): T | null {
    if (this.config.getFileFromXHR) {
      return this.config.getFileFromXHR(xhr);
    }
    return this.xhrToFileMap.get(xhr) || null;
  }

  /**
   * 设置 XHR 与文件的映射
   */
  private setFileToXHR(xhr: XMLHttpRequest, file: T): void {
    if (this.config.setFileToXHR) {
      this.config.setFileToXHR(xhr, file);
    } else {
      this.xhrToFileMap.set(xhr, file);
    }
  }

  /**
   * 安装拦截器（全局只安装一次）
   */
  install(): void {
    if (this.isInstalled) {
      console.log(`[XHRInterceptor] ${this.config.name} 拦截器已安装，跳过`);
      return;
    }

    this.originalXHR = window.XMLHttpRequest;
    const interceptor = this;
    const OriginalXHR = window.XMLHttpRequest;

    const XHRProxy = function (this: any) {
      const xhr = new OriginalXHR();
      const headersMap = new Map<string, string>();
      let currentFileInstance: T | null = null;

      // 拦截 setRequestHeader
      const originalSetHeader = xhr.setRequestHeader;
      xhr.setRequestHeader = function (name: string, value: string) {
        headersMap.set(name.toLowerCase(), value);
      };

      // 拦截 send - 核心逻辑
      const originalSend = xhr.send;
      xhr.send = function (body?: any) {
        // ✅ 1. 先尝试从映射中获取文件实例
        currentFileInstance = interceptor.getFileFromXHR(xhr);

        // ✅ 2. 如果还没有，从队列中分配一个未使用的文件
        if (!currentFileInstance) {
          const fileQueue = interceptor.config.getFileQueue();
          for (const file of fileQueue) {
            if (!interceptor.assignedFiles.has(file)) {
              currentFileInstance = file;
              interceptor.setFileToXHR(xhr, currentFileInstance);
              interceptor.markAsAssigned(currentFileInstance);
              break;
            }
          }

          // ✅ 分片上传兼容：大文件分片上传时，同一文件会产生多个并发 XHR
          // assignedFiles 会导致已分配的文件被跳过（设计用于多文件防重复匹配）
          // 因此需要回退机制：当队列中所有文件都已分配（典型分片场景），
          // 允许重新匹配队列中的文件，确保每个分片的 XHR 都能关联到文件实例
          if (!currentFileInstance && fileQueue.length > 0) {
            currentFileInstance = fileQueue[0];
            interceptor.setFileToXHR(xhr, currentFileInstance);
          }
        }

        // 网络检查
        const networkCheck = checkNetworkStatus();
        if (!networkCheck.online) {
          const error = new FileUDError(
            ErrorCode.NETWORK,
            "网络连接异常，请检查网络设置后重试",
            { timestamp: networkCheck.timestamp },
            {
              recoverable: true,
              retryable: true,
              suggestion: "请检查网络连接后重试",
              userVisible: true,
            },
          );

          logger.error(
            interceptor.config.name,
            `网络检查失败: ${error.message}`,
          );

          if (currentFileInstance) {
            interceptor.config.onProgress(currentFileInstance, {
              loaded: 0,
              total: 0,
              lengthComputable: false,
            } as ProgressEvent);
          }
          throw error;
        }

        // 添加全局 headers
        if (currentFileInstance) {
          const globalHeaders =
            interceptor.config.getGlobalHeaders(currentFileInstance) || {};
          Object.entries(globalHeaders).forEach(([key, value]) => {
            headersMap.set(key.toLowerCase(), value as string); // 直接覆盖
          });
        }
        headersMap.forEach((value, key) => {
          originalSetHeader.call(xhr, key, value);
        });
        // ✅ 3. 绑定进度回调
        if (currentFileInstance) {
          // 对于上传，监听 upload.onprogress
          if (xhr.upload) {
            xhr.upload.onprogress = function (event: ProgressEvent) {
              interceptor.config.onProgress(currentFileInstance!, event);
            };
          }
          if (currentFileInstance.isDownloader()) {
            // 对于下载，监听 xhr.onprogress
            xhr.onprogress = function (event: ProgressEvent) {
              interceptor.config.onProgress(currentFileInstance!, event);
            };
          }
        } else {
          console.warn(
            `[${interceptor.config.name}] 没有找到关联的文件实例，进度回调可能无法触发`,
          );
        }

        // 设置 abort 方法
        if (currentFileInstance && interceptor.config.onAbort) {
          interceptor.config.onAbort(currentFileInstance, xhr);
        }

        return originalSend.call(this, body);
      };

      return xhr;
    } as any;

    XHRProxy.prototype = OriginalXHR.prototype;
    window.XMLHttpRequest = XHRProxy;
    this.isInstalled = true;

    console.log(`✅ 全局 XHR 拦截器已安装: ${this.config.name}`);
  }

  /**
   * 恢复原始 XHR
   */
  restore(): void {
    if (this.originalXHR) {
      window.XMLHttpRequest = this.originalXHR;
      this.isInstalled = false;
      this.originalXHR = null;
    }
  }

  /**
   * 清理文件（文件完成时调用）
   */
  cleanupFile(file: T): void {
    this.assignedFiles.delete(file);
  }
}
