import {
  UploaderConfig,
  DownloaderConfig,
  LogConfig,
} from "../types";
import Uploader from "../uploader/index";
import Downloader from "../downloader/index";
import { initLogger, LogLevel } from "../utils";

export default class FileUD {
  private static uploaders: Map<string, Uploader> = new Map();
  private static downloaders: Map<string, Downloader> = new Map();
  public static startUDLogger(logConfig?: LogConfig) {
    // 初始化日志配置

    initLogger({
      enabled: logConfig?.enabled ?? true,
      level: logConfig?.level ?? LogLevel.DEBUG,
      showTimestamp: logConfig?.showTimestamp,
      enableColors: logConfig?.enableColors,
    });
  }

  public static createUploader<T = any>(
    name: string,
    config?: Partial<UploaderConfig>,
  ): Uploader<T> {
    if (!name) {
      throw new Error("Uploader name is required");
    }

    // ✅ 如果已经存在同名的 uploader，先销毁旧实例（清理 input 元素）
    if (FileUD.uploaders.has(name)) {
      const oldUploader = FileUD.uploaders.get(name);
      if (oldUploader) {
        // 清空文件列表并重置索引
        oldUploader.clearFiles();
        // 移除旧的 input 元素
        oldUploader.inputHTML?.remove();
        // 从 Map 中删除
        FileUD.uploaders.delete(name);
      }
    }

    // 创建新的 uploader 实例
    const newUploader: Uploader<T> = Object.create(Uploader.prototype);
    newUploader.create(config);
    newUploader.inputHTML?.setAttribute("data-uploader-name", name);
    FileUD.uploaders.set(name, newUploader);

    return newUploader;
  }

  /**
   * 创建下载器实例（多例模式）
   * @param name 下载器名称（唯一标识）
   * @param config 下载器配置
   * @returns Downloader 实例
   */
  public static createDownloader<T = any>(
    name: string,
    config?: Partial<DownloaderConfig>,
  ): Downloader<T> {
    if (!name) {
      throw new Error("Downloader name is required");
    }

    // ✅ 如果已经存在同名的 downloader，先销毁旧实例
    if (FileUD.downloaders.has(name)) {
      const oldDownloader = FileUD.downloaders.get(name);
      if (oldDownloader) {
        // 清空文件列表
        oldDownloader.files = [];
        oldDownloader.activeFiles = [];
        // 从 Map 中删除
        FileUD.downloaders.delete(name);
      }
    }

    // 使用 Object.create 创建新的 downloader 实例（与 createUploader 保持一致）
    const newDownloader: Downloader<T> = Object.create(Downloader.prototype);
    // 调用 create 方法初始化
    newDownloader.create(config);
    FileUD.downloaders.set(name, newDownloader as unknown as Downloader);

    return newDownloader;
  }
  // 销毁所有创建的上传器
  public static destroyUploaders(name?: string) {
    if (name && FileUD.uploaders.has(name)) {
      const uploader = FileUD.uploaders.get(name);
      uploader?.inputHTML?.remove();
      FileUD.uploaders.delete(name);
    } else {
      for (const [key, uploader] of FileUD.uploaders.entries()) {
        uploader.inputHTML?.remove();
      }
      FileUD.uploaders.clear();
    }
  }
  //   获取上传器
  public static getUploaders(name?: string) {
    if (name && FileUD.uploaders.has(name)) {
      return FileUD.uploaders.get(name);
    }
    return FileUD.uploaders;
  }

  /**
   * 销毁所有创建的下载器
   * @param name 可选，指定销毁的下载器名称
   */
  public static destroyDownloaders(name?: string) {
    if (name && FileUD.downloaders.has(name)) {
      const downloader = FileUD.downloaders.get(name);
      if (downloader) {
        // 清空文件列表
        downloader.files = [];
        downloader.activeFiles = [];
      }
      FileUD.downloaders.delete(name);
    } else {
      for (const [, downloader] of FileUD.downloaders.entries()) {
        downloader.files = [];
        downloader.activeFiles = [];
      }
      FileUD.downloaders.clear();
    }
  }

  /**
   * 获取下载器
   * @param name 可选，指定获取的下载器名称
   * @returns 单个下载器或所有下载器的 Map
   */
  public static getDownloaders(name?: string) {
    if (name && FileUD.downloaders.has(name)) {
      return FileUD.downloaders.get(name);
    }
    return FileUD.downloaders;
  }
}
