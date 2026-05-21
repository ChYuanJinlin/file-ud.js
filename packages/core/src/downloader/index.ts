import { EventEmitter } from "../utils/event-emitter";
import type { downloaderConfigs, IFile, UpdateCallBack } from "../types";
import { mergeObjects } from "../utils";
import DownloadFile from "./DownloadFile";
import TransferBase from "../transfer/TransferBase";

export const defaultConfig: downloaderConfigs = {
  action: "",
  method: "GET",
  headers: {},
  timeout: 30000,
};

/**
 * 文件下载器类 (Downloader)
 * 
 * 继承自 TransferBase，专门处理文件下载相关的业务逻辑：
 * - 下载任务管理
 * - 并发控制
 * - 服务端交互 (HTTP 下载)
 */
export default class Downloader<T = any> extends TransferBase<DownloadFile<T>> {
  /** 待下载的文件队列 */
  public downloadFiles: DownloadFile[] = [];

  /** 全局基础配置 */
  public static baseConfig: downloaderConfigs;

  /** 当前实例的配置信息 */
  public config: downloaderConfigs | null = null;

  /** 单例模式下的唯一实例 */
  public static instances: Downloader | null = null;

  /** 当前正在处理的文件实例 */
  public static downloadFile: DownloadFile | null;

  /** 全局 ID 计数器 */
  public static id: number = 0;

  /** 当前实例 ID */
  public id = 0;

  /** XHR 拦截器安装标记 */
  public static isInterceptorInstalled: boolean = false;

  /** 原始 XHR 引用 */
  public static originalXHR: typeof XMLHttpRequest | null = null;

  /** 已注册的插件列表 */
  private plugins: any[] = [];

  /** 插件间共享的数据存储 */
  private pluginSharedData = new Map<string, any>();

  /** 全局错误回调函数 */
  public static onError: any;

  /** 静态默认插件列表 */
  private static defaultPlugins: any[] = [];

  /** 下载成功回调 */
  public downloadSuccessCallback: any = () => null;

  /**
   * 构造函数
   * @param config 配置项
   */
  constructor(config?: downloaderConfigs) {
    super();
    try {
      if (!Downloader.instances) {
        this.config = mergeObjects(Downloader.baseConfig, config);
        Downloader.instances = this.create(this.config);
      }
      return Downloader.instances!;
    } catch (error: any) {
      throw new Error(`Failed to initialize downloader: ${error.message}`);
    }
  }

  /**
   * 创建并配置下载器实例
   * @param config 配置项
   * @returns Downloader 实例
   */
  create(config?: downloaderConfigs): Downloader {
    Downloader.baseConfig = Object.assign(defaultConfig, Downloader.baseConfig);
    this.config = { ...Downloader.baseConfig, ...config };
    return this;
  }

  /**
   * 动态更新配置
   * @param config 部分配置项
   */
  public updateConfig(config: Partial<downloaderConfigs>) {
    this.config = mergeObjects(this.config!, config);
  }

  set onUpdate(callback: UpdateCallBack<DownloadFile>) {
    this.updateCallback = callback as any;
  }

  /**
   * 添加下载任务
   * @param url 下载地址
   * @param fileName 文件名（可选）
   * @returns DownloadFile 实例
   */
  public addFile(url: string, fileName?: string): DownloadFile {
    const downloadFile = new DownloadFile(
      {
        fileId: `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        url,
        fileName: fileName || url.split("/").pop() || "unknown",
        status: "pending",
        percent: 0,
        index: this.files.length,
      },
      this,
    );

    this.files.push(downloadFile);
    this.downloadFiles.push(downloadFile);
    this.triggerUpdate();

    return downloadFile;
  }

  /**
   * 开始所有下载任务
   */
  public async start(): Promise<void> {
    const downloadPromises = this.files.map(async (file) => {
      try {
        if (file.status === "success" || file.status === "downloading") {
          return Promise.resolve();
        }
        return file.start();
      } catch (error) {
        console.error(file.fileName + "文件下载失败:", error);
      }
    });
    await Promise.all(downloadPromises);
  }

  // ==================== 向后兼容的 Getter/Setter ====================

  /** @deprecated 使用 transferredBytes 代替 */
  get downloadedBytes(): number {
    return this.transferredBytes;
  }

  set downloadedBytes(value: number) {
    this.transferredBytes = value;
  }

  /** @deprecated 使用 transferredFormatSize 代替 */
  get downloadedFormatSize(): string {
    return this.transferredFormatSize;
  }

  set downloadedFormatSize(value: string) {
    this.transferredFormatSize = value;
  }

  /** @deprecated 使用 transferTime 代替 */
  get downloadTime(): any {
    return this.transferTime;
  }

  set downloadTime(value: any) {
    this.transferTime = value;
  }

  /** @deprecated 使用 transferSpeed 代替 */
  get downloadSpeed(): any {
    return this.transferSpeed;
  }

  set downloadSpeed(value: any) {
    this.transferSpeed = value;
  }
}
