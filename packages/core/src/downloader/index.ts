import type { DownloaderConfig, DownloadOptions, IFile } from "../types";
import {
  mergeObjects,
  formatFileSize,
  isFileActive,
  formatSpeed,
  logger,
  getFileExtension,
  generateFileId,
} from "../utils";
import Transfer from "../transfer/Transfer";
import DownloadFile from "./DownloadFile";

export const defaultConfig: DownloaderConfig = {
  action: "",
  headers: {},
  timeout: 30000,
  axiosOptions: {
    method: "get",
  },
};

/**
 * 文件下载器类 (Downloader)
 *
 * 继承自 Transfer，专门处理文件下载相关的业务逻辑：
 * - 下载任务管理
 * - 并发控制
 * - 服务端交互 (HTTP 下载)
 */
export default class Downloader<T = any> extends Transfer<DownloadFile<T>> {
  /** 全局基础配置 */
  public static baseConfig: DownloaderConfig;

  /** 当前实例的配置信息 */
  public config: DownloaderConfig | null = null;
  public static instances: Downloader | null = null;
  public static fileIndex: number = 0;
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

    return this;
  }

  /**
   * 添加下载任务并立即开始下载
   * @param url 下载链接
   * @param fileName 文件名（可选，可从 URL 提取）
   * @param options 下载选项（可选）
   * @returns DownloadFile 实例
   */
  public downloadFile(file: IFile): DownloadFile<T> {
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
      },
      this,
    );

    // 添加到文件列表
    this.files.push(downloadFile);
    this.activeFiles.push(downloadFile);

    // 更新全局统计
    this.updateGlobalStats();
    this.triggerUpdate();

    // // 立即开始下载
    // downloadFile.start();

    return downloadFile;
  }

  /**
   * 静态方法：直接保存文件到本地（触发浏览器下载对话框）
   * @param fileName 文件名
   * @param url 下载链接
   */
  public static async saveFile(fileName: string, url: string): Promise<void> {
    const extension = getFileExtension(url);
    fileName = extension ? `${fileName}.${extension}` : fileName;
    try {
      const response = await fetch(url);
      const blob = await response.blob();

      // 创建临时 URL
      const blobUrl = URL.createObjectURL(blob);

      // 创建下载链接
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // 释放 URL
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      logger.error("Downloader", `文件保存失败: ${fileName}`, error);
      throw error;
    }
  }
}
