import { EventName, uploaderConfigs, LogConfig } from "../types";
import Uploader, { defaultConfig } from "../uploader/index";
import { initLogger, LogLevel, mergeObjects } from "../utils";
export default class FileUD {
  private static uploaders: Map<string, Uploader> = new Map();
  public static uploader: Uploader | null = Uploader.instances;

  public static startUploadLogger(logConfig?: LogConfig) {
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
    config?: uploaderConfigs,
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
    newUploader.config = mergeObjects(defaultConfig, config || {});
    newUploader.create(newUploader.config);
    newUploader.inputHTML?.setAttribute("data-uploader-name", name);
    FileUD.uploaders.set(name, newUploader);

    return newUploader;
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
}
