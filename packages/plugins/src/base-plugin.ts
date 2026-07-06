import {
  UploadFile,
  FileUDError,
  ErrorCode,
  type IUDPlugin,
  type PluginContext,
} from "@file-ud.js/core";
/**
 * 插件基类
 * 提供通用的错误处理和日志功能
 */
export abstract class BasePlugin implements IUDPlugin<UploadFile> {
  /** 插件名称 */
  abstract name: string;
  
  /** 插件版本 */
  version = "1.0.0";
  
  /** 插件优先级 */
  priority = 0;
  
  /** 是否关键插件 */
  critical = false;
  
  /** 插件描述 */
  desc = "";

  /**
   * 安装插件 - 统一日志输出
   */
  install(transfer: any): void {
    console.log(`${this.name} ✅ 插件已安装`);
  }

  /**
   * 创建基础错误对象
   * @param file - 当前文件
   * @param uploader - 上传器实例
   * @returns 基础错误对象
   */
  protected createBaseError(file: UploadFile, uploader: any): FileUDError {
    return new FileUDError(
      ErrorCode.UNKNOWN,
      "",
      {
        uploader,
        plugin: this.name,
        fileName: file.fileName,
        fileSize: file.File.size,
        fileType: file.File.type,
      },
    );
  }

  /**
   * 抛出验证错误
   * @param error - 错误对象
   * @returns Promise.reject
   */
  protected throwError(error: FileUDError): Promise<never> {
    return Promise.reject(error);
  }

  /**
   * 文件选择时的验证逻辑（由子类实现）
   */
  abstract onFileSelect(
    file: UploadFile,
    context: PluginContext<UploadFile>,
  ): Promise<UploadFile | void>;

  /**
   * 销毁插件
   */
  destroy?(): void {
    console.log(`${this.name} 🔒 插件已销毁`);
  }
}
