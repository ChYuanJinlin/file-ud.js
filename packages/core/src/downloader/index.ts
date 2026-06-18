import type {
  DownloaderConfig,
  IUDPlugin,
  UDFile,
  beforeTransferCallBack,
} from "../types/index";
import Transfer from "../transfer/Transfer";
import {
  mergeObjects,
  formatFileSize,
  logger,
  getFileExtension,
} from "../utils";

import DownloadFile from "./DownloadFile";

export const defaultConfig: DownloaderConfig = {
  action: "",
  headers: {},
  timeout: 30000,
  axiosOptions: {
    method: "get",
    responseType: "blob",
  },
};

/**
 * 文件下载器类 (Downloader)
 *
 * 继承自 Transfer，专门处理文件下载相关的业务逻辑。
 * 回调属性（successCallback / updateCallback / onInitChunkCallback / OnMergeChunkCallBack /
 * beforeTransferCallback）及其 setter 全部由 Transfer 基类提供，此处不再重复声明。
 */
export default class Downloader<T = any> extends Transfer<DownloadFile, T> {
  /** 全局基础配置 */
  public static baseConfig: DownloaderConfig;

  /** 当前实例的配置信息 */
  public config: DownloaderConfig | null = null;
  public static instances: Downloader | null = null;
  public static fileIndex: number = 0;

  /** 静态默认插件（影响之后创建的所有实例） */
  private static defaultPlugins: IUDPlugin<DownloadFile>[] = [];

  // ==================== 回调设置器（仅基类未提供的） ====================

  constructor(config?: DownloaderConfig) {
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
   * 动态更新配置
   * @param config 部分配置项
   */
  public updateConfig(config: Partial<DownloaderConfig>) {
    this.config = mergeObjects(this.config!, config);
  }

  /**
   * 创建下载器实例（多例模式支持）
   * @param config 下载器配置
   * @returns Downloader 实例
   */
  public create(config?: DownloaderConfig) {
    // 合并配置
    Downloader.baseConfig = Object.assign(defaultConfig, Downloader.baseConfig);
    this.config = { ...Downloader.baseConfig, ...config };

    // 初始化状态
    this.resetState();

    // 加载默认插件
    this.init();

    return this;
  }

  /**
   * 设置全局默认插件（影响之后创建的所有实例）
   */
  static setDefaultPlugins(plugins: IUDPlugin<DownloadFile>[]): void {
    Downloader.defaultPlugins = plugins;
  }

  /**
   * 初始化实例插件列表（继承全局默认插件）
   */
  private init() {
    this.plugins = [...Downloader.defaultPlugins];
  }

  // ==================== 流式保存（File System Access API） ====================

  /**
   * 静态方法：打开系统"另存为"对话框，获取流式写入 FileHandle
   *
   * 使用 File System Access API（Chrome 86+, Edge 86+）。
   * 如果 API 不可用，返回 undefined（调用方应回退到 Blob 下载模式）。
   *
   * @param suggestedName 建议的文件名
   * @returns FileHandle（用户选择后），null（用户取消），undefined（API 不可用）
   */
  public static async pickSaveFile(
    suggestedName?: string,
  ): Promise<FileSystemFileHandle | null | undefined> {
    try {
      if (typeof window === "undefined" || !window.showSaveFilePicker) {
        logger.warn("Downloader", "File System Access API 不可用，回退到 Blob 模式");
        return undefined;
      }
      const handle = await window.showSaveFilePicker({
        suggestedName,
      });
      return handle;
    } catch (err: any) {
      // 用户取消保存对话框 → DOMException: The user aborted a request
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.name === "UnknownError")
      ) {
        return null;
      }
      logger.warn("Downloader", "pickSaveFile 异常", err);
      return undefined;
    }
  }

  /**
   * 添加下载任务并立即开始下载
   * @param file 下载文件配置
   * @param fileHandle 可选，File System Access API 的 FileHandle（流式保存用）
   * @returns DownloadFile 实例
   */
  public downloadFile(
    file: UDFile,
    fileHandle?: FileSystemFileHandle,
  ): DownloadFile<T> {
    // 创建下载文件实例
    const downloadFile = new DownloadFile(
      {
        fileName: file.fileName || file.url,
        status: "pending",
        percent: 0,
        url: file.url,
        index: Downloader.fileIndex++,
        extension: getFileExtension(file.fileName),
        formatSize: formatFileSize(file.size),
        size: file.size,
        fileHandle: fileHandle || file.fileHandle,
      },
      this as unknown as Transfer,
    );

    // 先添加到文件列表，让 UI 立即可见
    this.files.push(downloadFile);
    this.activeFiles.push(downloadFile);
    this.updateGlobalStats();
    this.triggerUpdate();

    // 再开始下载，进度会通过 TransferFile 的监听实时更新
    downloadFile.start(downloadFile.downloadChunkManager).then(() => {
      // 下载完成后触发一次最终更新
      this.updateGlobalStats();
      this.triggerUpdate();
    });

    return downloadFile;
  }

  // ==================== 全局批量控制 ====================

  /**
   * 提交所有待下载文件（自动调用所有文件 start 方法）
   */
  public submit(): void {
    this.files.forEach((file) => {
      if (file.status === "pending" || file.status === "fail") {
        file.start(file.downloadChunkManager);
      }
    });
  }

  /**
   * 取消所有下载任务
   */
  public cancelAll(): void {
    this.files.forEach((file) => {
      file.cancel();
    });
  }

  /**
   * 暂停所有下载任务
   */
  public pauseAll(): void {
    this.files.forEach((file) => {
      const proxyFile = file.proxy || file;
      if (proxyFile.status === "UDLoading") {
        file.pause();
      }
    });
  }

  /**
   * 恢复所有下载任务
   */
  public async resumeAll(): Promise<void> {
    const resumes: Promise<void>[] = [];
    this.files.forEach((file) => {
      const proxyFile = file.proxy || file;
      if (proxyFile.status === "paused") {
        resumes.push(file.resume());
      }
    });
    await Promise.allSettled(resumes);
  }

  /**
   * 重试所有失败/取消的下载任务
   */
  public async retryAll(): Promise<void> {
    const retries: Promise<void>[] = [];
    this.files.forEach((file) => {
      const proxyFile = file.proxy || file;
      if (["cancelled", "fail", "error"].includes(proxyFile.status!)) {
        retries.push(file.retry());
      }
    });
    await Promise.allSettled(retries);
  }

  /**
   * 保存 Blob 到本地（触发浏览器下载对话框）
   * @param fileName 文件名
   * @param data Blob 数据或可转为 Blob 的数据
   */
  public static saveBlob(fileName: string, data: any): void {
    // 确保 data 是有效的 Blob 对象
    let blob: Blob;
    if (data instanceof Blob) {
      blob = data;
    } else {
      blob = new Blob([data]);
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    // ✅ 部分浏览器在异步回调中 a.click() 不会触发下载弹窗，
    // 延迟移除元素并清理 URL，给浏览器足够时间处理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 100);
  }

  /**
   * 通过 URL 下载并保存文件到本地（触发浏览器下载对话框）
   * @param fileName 文件名
   * @param url 下载链接
   */
  public static async saveFile(fileName: string, url: string): Promise<void> {
    // 去除 query string 和 hash，避免 getFileExtension 提取出带参数的扩展名
    const cleanUrl = url.split("?")[0].split("#")[0];
    const extension = getFileExtension(cleanUrl);
    fileName = extension ? `${fileName}.${extension}` : fileName;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      Downloader.saveBlob(fileName, blob);
    } catch (error) {
      logger.error("Downloader", `文件保存失败: ${fileName}`, error);
      throw error;
    }
  }
}
