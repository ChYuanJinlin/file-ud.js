import type { IFile, TransferSpeedInfo, TransferTimeInfo, TransferStatus } from "../types";
import { TransferStatusConst } from "../types";
import { formatFileSize, formatSpeed, computeUploadTime, logger, checkNetworkStatus, createReactiveTransferFile } from "../utils";
import { ErrorCode, FileUDError } from "./errors";

/**
 * FileUD 核心文件基类
 * 
 * 封装所有文件传输（上传/下载）共有的核心逻辑：
 * - 文件状态管理（fileId, fileName, url, status, percent...）
 * - 进度跟踪与速率计算
 * - 时间统计
 * - 生命周期控制（暂停/恢复/取消）
 * - Proxy 响应式更新
 * - 统一 XHR 拦截器
 * 
 * @template T - 传输成功后的响应数据类型
 */
export default abstract class File<T = any> implements IFile {
  /** 文件唯一标识符 */
  public fileId: string;

  /** 文件访问URL */
  public url: string;

  /** 文件名称 */
  public fileName: string;

  /** 文件对象 */
  public File!: globalThis.File;

  /** 传输进度百分比 (0-100) */
  public percent: number = 0;

  /** 文件扩展名 */
  public extension?: string;

  /** loading 状态 */
  public loading: boolean = false;

  /** hash 校验 loading */
  public hashLoading?: boolean = false;

  /** hash 进度 */
  public hashPercent?: number = 0;

  /** 是否取消传输 */
  public isCancel: boolean = false;

  /** 文件大小（格式化字符串） */
  public formatSize?: string;

  /** 取消请求方法 */
  public abort?: () => void;

  /** 是否在重试中 */
  public isRetry: boolean = false;

  /** 文件在队列中的索引 */
  public index?: number;

  /** 父级管理器引用（Uploader 或 Downloader） */
  protected __parent__: any;

  /** 文件传输的状态 */
  public status: TransferStatus = TransferStatusConst.PENDING;

  /** 传输速率统计信息 */
  public transferSpeed: TransferSpeedInfo = {
    currentSpeed: 0,
    averageSpeed: 0,
    currentSpeedFormatted: "0 B/s",
    averageSpeedFormatted: "0 B/s",
  };

  /** 传输时间统计信息 */
  public transferTime: TransferTimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 已传输的字节数（内部使用） */
  protected __transferredBytes__: number = 0;

  /** 总字节数 */
  protected __totalBytes__: number = 0;

  /** 上次加载的字节数（用于计算瞬时速度） */
  protected __lastLoadedBytes__: number = 0;

  /** 上次计算速度的时间戳 */
  protected __lastSpeedCalcTime__: number = 0;

  /** 代理对象（用于响应式更新） */
  public proxy!: File;

  /**
   * 构造函数
   * @param fileData 文件初始数据
   * @param parent 父级管理器实例（Uploader 或 Downloader）
   */
  constructor(fileData: Partial<IFile>, parent: any) {
    this.fileId = fileData.fileId || "";
    this.url = fileData.url || "";
    this.fileName = fileData.fileName || "";
    this.File = fileData.File as globalThis.File;
    this.percent = fileData.percent || 0;
    this.extension = fileData.extension;
    this.loading = fileData.loading || false;
    this.isCancel = fileData.isCancel || false;
    this.formatSize = fileData.formatSize;
    this.index = fileData.index;
    this.status = (fileData.status as TransferStatus) || TransferStatusConst.PENDING;
    this.__parent__ = parent;

    // 创建响应式代理对象
    this.proxy = createReactiveTransferFile(this, parent);

    // 设置拦截器（只安装一次）
    this.setupInterceptor();
  }

  /**
   * 设置统一的 XHR 拦截器
   * 
   * 功能：
   * 1. 网络状态检查（发送请求前验证网络连接）
   * 2. 全局 Headers 注入（从父级配置中获取）
   * 3. XHR Proxy 基础框架（为子类扩展提供基础）
   * 
   * @protected
   */
  protected setupInterceptor(): void {
    const parent = this.__parent__;
    
    // 检查是否已经安装过拦截器
    if ((parent.constructor as any).isInterceptorInstalled) {
      return;
    }

    // 保存原始 XHR 引用
    (parent.constructor as any).originalXHR = window.XMLHttpRequest;

    const OriginalXHR = window.XMLHttpRequest;

    const XHRProxy = function (this: any) {
      const xhr = new OriginalXHR();

      let requestHeaders: Record<string, string> = {};

      // 拦截 setRequestHeader
      const originalSetHeader = xhr.setRequestHeader;
      xhr.setRequestHeader = function (name: string, value: string) {
        requestHeaders[name] = value;
        return originalSetHeader.call(this, name, value);
      };

      // 拦截 send
      const originalSend = xhr.send;
      xhr.send = function (body?: any) {
        // ✅ 在发送请求前检查网络状态
        const networkCheck = checkNetworkStatus();
        if (!networkCheck.online) {
          const error = new FileUDError(
            ErrorCode.NETWORK,
            "网络连接异常，请检查网络设置后重试",
            {
              timestamp: networkCheck.timestamp,
            },
            {
              recoverable: true,
              retryable: true,
              suggestion: "请检查网络连接后重试",
              userVisible: true,
            },
          );

          logger.error("File", `网络检查失败: ${error.message}`);

          // 中止请求
          throw error;
        }

        // 添加全局 headers
        if (parent.config?.headers) {
          Object.entries(parent.config.headers).forEach(([key, value]) => {
            const headerExists = Object.keys(requestHeaders).some(
              (existingKey) => existingKey.toLowerCase() === key.toLowerCase(),
            );
            if (!headerExists) {
              xhr.setRequestHeader(key, value as string);
            }
          });
        }

        return originalSend.call(this, body);
      };

      return xhr;
    } as any;

    // 复制原型方法
    XHRProxy.prototype = OriginalXHR.prototype;

    // 替换全局 XHR
    window.XMLHttpRequest = XHRProxy;
    (parent.constructor as any).isInterceptorInstalled = true;

    logger.info("File", "✅ 全局 XHR 拦截器已安装");
  }

  /**
   * 处理传输进度事件
   * 
   * 功能：
   * 1. 计算并更新进度百分比
   * 2. 更新已传输字节数
   * 3. 触发速率计算
   * 4. 通知父级管理器更新
   * 
   * @param event - XHR 进度事件对象
   * @protected
   */
  protected handleProgress(event: ProgressEvent): void {
    if (event.lengthComputable) {
      const percent = Math.round((event.loaded / event.total) * 100);
      this.percent = percent;
      this.__transferredBytes__ = event.loaded;
      this.__totalBytes__ = event.total;

      // 计算速率
      this.calculateSpeed(event.loaded);

      // 触发父级管理器更新
      this.__parent__?.triggerUpdate();
    }
  }

  /**
   * 计算传输速率（带防抖优化）
   * 
   * 采用最小时间间隔采样策略，避免高频进度回调导致数值剧烈抖动。
   * 瞬时速度基于最近两个有效采样点计算，平均速度基于总耗时和总字节数计算。
   * 
   * @param loadedBytes - 当前已传输的字节数
   * @protected
   */
  protected calculateSpeed(loadedBytes: number): void {
    const now = Date.now();

    // 初始化传输开始时间（首次调用）
    if (this.__lastSpeedCalcTime__ === 0) {
      this.__lastSpeedCalcTime__ = now;
      this.__lastLoadedBytes__ = loadedBytes;
      return;
    }

    // 防抖：最小时间间隔采样（100ms）
    const timeDiff = now - this.__lastSpeedCalcTime__;
    if (timeDiff < 100) {
      return;
    }

    // 计算瞬时速度（bytes/s）
    const bytesDiff = loadedBytes - this.__lastLoadedBytes__;
    const currentSpeed = (bytesDiff / timeDiff) * 1000;

    // 计算平均速度（bytes/s）
    const totalTime = now - (this.transferTime.startTime || now);
    const averageSpeed = totalTime > 0 ? (loadedBytes / totalTime) * 1000 : 0;

    // 更新速率信息到 Proxy 对象
    this.proxy.transferSpeed = {
      currentSpeed,
      averageSpeed,
      currentSpeedFormatted: formatSpeed(currentSpeed),
      averageSpeedFormatted: formatSpeed(averageSpeed),
    };

    // 更新内部状态，为下次计算做准备
    this.__lastSpeedCalcTime__ = now;
    this.__lastLoadedBytes__ = loadedBytes;
  }

  /**
   * 暂停传输
   * 
   * 子类需要实现具体的暂停逻辑：
   * - UploadFile: 暂停分片上传
   * - DownloadFile: 中止下载请求
   * 
   * @public
   */
  public pause(): void {
    logger.warn("File", `pause() 方法需要在子类中实现`, {
      fileId: this.fileId,
      fileName: this.fileName,
    });
  }

  /**
   * 恢复传输
   * 
   * 子类需要实现具体的恢复逻辑：
   * - UploadFile: 继续上传剩余分片
   * - DownloadFile: 重新开始下载（HTTP 无法恢复）
   * 
   * @public
   */
  public resume(): void {
    logger.warn("File", `resume() 方法需要在子类中实现`, {
      fileId: this.fileId,
      fileName: this.fileName,
    });
  }

  /**
   * 取消传输
   * 
   * 子类需要实现具体的取消逻辑：
   * - UploadFile: 调用 abort() 或 ChunkManager.cancelUpload()
   * - DownloadFile: 调用 abort()
   * 
   * @public
   */
  public cancel(): void {
    logger.warn("File", `cancel() 方法需要在子类中实现`, {
      fileId: this.fileId,
      fileName: this.fileName,
    });
  }

  /**
   * 创建并配置 XHR 请求（供子类调用）
   * 
   * @param method HTTP 方法
   * @param url 请求 URL
   * @param responseType 响应类型
   * @returns 配置好的 XMLHttpRequest 实例
   * @protected
   */
  protected createXHR(
    method: string,
    url: string,
    responseType: XMLHttpRequestResponseType = "blob",
  ): XMLHttpRequest {
    const xhr = new XMLHttpRequest();
    
    // 将当前实例与 XHR 关联（用于拦截器中获取上下文）
    (xhr as any).__transferFile__ = this;

    xhr.open(method, url);
    xhr.responseType = responseType;

    return xhr;
  }

}
