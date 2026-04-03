import { EventName, FileUDConfigs } from "../types";
import Uploader from "../uploader/index";
import { mergeObjects } from "../utils";

export default class FileUD {
  private static uploaders: Map<string, Uploader> = new Map();
  public static uploader: Uploader | null = Uploader.instances;
  public static createUploader<T = any>(
    name: string,
    config?: FileUDConfigs,
  ): Uploader {
    if (!name) {
      throw new Error("Uploader name is required");
    }
    const newUploader: Uploader<T> = Object.create(Uploader.prototype);
    newUploader.config = mergeObjects(Uploader.baseConfig, config);
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
