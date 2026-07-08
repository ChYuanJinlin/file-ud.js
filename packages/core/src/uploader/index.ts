import { Errors } from "..";
import Transfer from "../transfer/Transfer";
import {
  beforeTransferCallBack,
  ErrorCallBack,
  EventName,
  UploaderConfig,
  IFile,
  IUDPlugin,
  onInitChunkCallback,
  OnMergeChunkCallBack,
  OpenFileCallback,
  PluginContext,
  SelectCallBack,
  UpdateCallBack,
  successCallback,
} from "../types";
import {
  checkNetworkStatus,
  formatFileSize,
  generateFileId,
  getFileExtension,
  handleFile,
  logger,
  mergeObjects,
  validator,
} from "../utils";
import FileConcurrencyController from "../concurrency/FileConcurrencyController";

import UploadFile from "./UploadFile";
export const defaultConfig: UploaderConfig = {
  multiple: false,
  accept: [],
  show: false,
  elementId: undefined,
  autoUpload: true,
  action: "",
  file: "file",
};

export default class Uploader<T = any> extends Transfer<UploadFile, T> {
  public inputHTML: HTMLInputElement | null;
  public static objectUrls: any[] = [];
  public static baseConfig: UploaderConfig;
  public config: UploaderConfig | null = null;
  public static instances: Uploader | null = null;
  public static uploadFile: UploadFile | null;

  // 标记是否已安装全局拦截器
  public static isInterceptorInstalled = false;
  public totalPercent: number = 0;

  public static fileIndex = 0;
  // 添加拦截器相关属性
  public static originalXHR?: typeof XMLHttpRequest | null;
  public static interceptorActive = false;

  // 静态默认插件
  private static defaultPlugins: IUDPlugin<UploadFile>[] = [];
  public openCallBack: OpenFileCallback = () => null;

  public selectCallback: SelectCallBack | null | undefined = null;

  /* 
  清空文件
*/
  public clearFiles() {
    this.files.forEach((file) => {
      file.abort?.();
    });
    this.files = [];
    this.activeFiles = [];
    Uploader.fileIndex = 0;
    Uploader.uploadFile = null;
    Uploader.objectUrls = [];
    this.loading = false;
    this.totalPercent = 0;
    this.totalBytes = 0;
    this.transferredBytes = 0;
    this.totalTransferredBytes = 0;
    this.transferredFormatSize = "0 B";
    this.totalFormatSize = "0 B";
    this.triggerUpdate();
  }
  /**
   * 设置全局默认插件（影响之后创建的所有实例）
   */
  static setDefaultPlugins(plugins: IUDPlugin<UploadFile>[]): void {
    Uploader.defaultPlugins = plugins;
  }
  /**
   * 设置文件列表（用于回显已上传的文件）
   * @param files - 要回显的文件列表，可以是 UploadFile 实例或文件信息对象
   * @example
   * ```typescript
   * //从服务端获取文件列表后回显
   * const savedFiles = await fetchSavedFiles();
   * uploader.setFiles(savedFiles.map(fileInfo => ({
   *   fileId: fileInfo.id,
   *   fileName: fileInfo.name,
   *   url: fileInfo.url,
   *   size: fileInfo.size,
   *   percent: 100,
   *   status: 'success',
   *   formatSize: formatFileSize(fileInfo.size)
   * })));
   *
   */
  public setFiles(files: IFile[]) {
    if (!files || !Array.isArray(files)) {
      logger.warn("Uploader", "setFiles: 传入的参数不是数组", files);
      return;
    }

    // 清空现有文件
    this.clearFiles();

    // 遍历并创建 UploadFile 实例
    files.forEach((fileData, index) => {
      // 创建 UploadFile 实例
      const uploadFile = new UploadFile(
        {
          fileId: fileData.fileId,
          url: fileData.url || "",
          fileName: fileData.fileName,
          File: fileData.File,
          percent: fileData.percent ?? 0,
          status: fileData.status || "pending",
          extension: fileData.extension || getFileExtension(fileData.fileName),
          formatSize:
            fileData.formatSize || formatFileSize(fileData.File?.size),
          index: fileData.index ?? Uploader.fileIndex++,
          // 保留其他可能的属性
          ...(fileData as any),
        },
        this as unknown as Transfer,
      );

      // 添加到文件列表
      this.files.push(uploadFile);
      this.activeFiles.push(uploadFile);
    });

    // 更新全局统计信息
    this.updateGlobalStats();

    // 触发更新事件
    this.triggerUpdate();

    logger.info("Uploader", `setFiles: 成功回显 ${this.files.length} 个文件`);
  }

  constructor(config?: UploaderConfig) {
    super();
    this.inputHTML = null;
    try {
      if (!Uploader.instances) {
        this.config = mergeObjects(Uploader.baseConfig, config);

        Uploader.instances = this.create(this.config);
      }
      return Uploader.instances!;
    } catch (error: any) {
      throw new Error(`Failed to initialize uploader: ${error.message}`);
    }
  }
  /**
   * @description: 打开文件
   * @param {OpenFileCallback} fn
   * @return {*}
   */
  public open(fn?: OpenFileCallback): any {
    if (this.inputHTML) {
      this.inputHTML.click();
    } else {
      logger.warn("Uploader", "The uploader does not exist. Please create one");
    }
    if (fn) {
      this.openCallBack = fn;
    }
  }

  private init() {
    // 使用统一的重置方法
    this.resetState();

    // 继承默认插件
    this.plugins = [...Uploader.defaultPlugins];
  }
  private createInput() {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("hidden", Boolean(this.config?.show).toString());
    input.accept = this.config?.accept?.toString() || "*";
    this.plugins = [];
    console.info("创建文件输入框");

    input.multiple = this.config?.multiple || false;
    this.inputHTML = input;
    if (!this.config?.elementId) {
      document.body.appendChild(input);
    } else {
      const target = document.getElementById(this.config.elementId);
      if (target) {
        target.appendChild(input);
      }
    }
    return input;
  }
  create(config?: UploaderConfig) {
    Uploader.baseConfig = Object.assign(defaultConfig, Uploader.baseConfig);
    this.config = { ...Uploader.baseConfig, ...config };
    this.init();

    // 🔑 配置文件级并发
    if (this.config.maxFileConcurrent !== undefined) {
      FileConcurrencyController.getInstance().maxUploadConcurrent =
        this.config.maxFileConcurrent;
    }

    this.createInput().onchange = async (e) => {
      const FileList = (e.target as HTMLInputElement)?.files;
      const filesList = Array.from(FileList!);

      await this.processSelectedFiles(filesList);

      this.inputHTML!.value = "";
    };

    return this;
  }
  public updateConfig(config: Partial<UploaderConfig>) {
    this.config = mergeObjects(this.config!, config);
  }
  set onbeforeTransfer(callback: beforeTransferCallBack<UploadFile>) {
    this.beforeTransferCallback = callback;
  }

  set onSelect(callback: SelectCallBack) {
    this.selectCallback = callback;
  }

  public remObjectUrls(url: string) {
    Uploader.objectUrls.splice(
      Uploader.objectUrls.findIndex((item) => item === url),
      1,
    );
  }

  // 全部取消上传
  public cancelAll() {
    this.files.forEach((file) => {
      file.cancel();
    });
  }

  // 全部暂停
  public pauseAll() {
    this.files.forEach((file) => {
      file.pause();
    });
  }
  // 全部继续
  public resumeAll() {
    this.files.forEach((file) => {
      file.resume();
    });
  }

  // 全部重试
  public retryAll() {
    this.files.forEach((file) => {
      file.retry();
    });
  }

  /**
   * @description: 手动提交上传所有文件（当 autoUpload 为 false 时）
   * @return {Promise<void>}
   */
  public async submit(): Promise<void> {
    // 上传前检查网络状态
    try {
      const networkCheck = checkNetworkStatus();
      if (!networkCheck.online) {
        const error = new Error(networkCheck.error || "网络连接异常");
        logger.error("uploadChunkManager", `网络检查失败: ${error.message}`);
        this.cancelAll();
        throw error;
      }
    } catch (error) {
      this.cancelAll();
      logger.error("uploadChunkManager", "网络检查异常", error);
    }
    // 检查是否有待上传的文件
    if (this.files.length === 0) {
      console.warn("没有待上传的文件");
      return Promise.reject();
    }

    // 如果是第一次调用 submit，触发批量开始事件并记录开始时间
    const isFirstBatch =
      this.activeFiles.filter((f) => f.status === "UDLoading").length === 0;
    if (isFirstBatch) {
      this.emit("files-start", this.files);

      // 并行上传所有文件
      const uploadPromises = this.files.map(async (file) => {
        try {
          // 如果文件已经是成功或上传中状态，跳过
          if (file.status === "success" || file.status === "UDLoading") {
            return Promise.resolve();
          }

          // ✅ 使用统一的 start() 方法

          return file.start(file.uploadChunkManager);
        } catch (error) {
          console.error(file.fileName + "文件传输失败:", error);
        }
      });
      await Promise.all(uploadPromises);
    }
  }

  /**
   * 验证文件是否符合上传条件（统一验证逻辑）
   * @param file 原始文件对象
   * @param uploadFileInstance 上传文件实例
   * @returns 验证结果 { valid: boolean, error?: any }
   * @private
   */
  private validateFile(
    file: File,
    uploadFileInstance: UploadFile,
  ): { valid: boolean; error?: any } {
    // 大小限制检查
    if (
      this.config?.maxSize &&
      !validator.size(file.size, this.config.maxSize)
    ) {
      return {
        valid: false,
        error: Errors.fileTooLarge.call(this, this.config?.maxSize),
      };
    }

    // 类型限制检查
    if (
      this.config?.accept?.toString() &&
      !validator.type(this.config?.accept, uploadFileInstance)
    ) {
      return {
        valid: false,
        error: Errors.fileTooType.call(this, {
          accept: this.config?.accept,
          fileName: file.name,
        }),
      };
    }

    // 数量限制只对多文件追加模式生效；单文件模式由 multiple=false 控制覆盖行为
    if (
      this.config?.multiple === true &&
      this.config?.limit &&
      !validator.limit(this.config?.limit, this.files.length)
    ) {
      return {
        valid: false,
        error: Errors.fileTooLimit.call(this, this.config?.limit),
      };
    }

    return { valid: true };
  }

  /**
   * 处理文件选择（内部方法）
   */
  private async processSelectedFiles(files: File[]) {
    const replacesCurrent = this.config?.multiple !== true;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // 创建插件上下文
      const pluginContext: PluginContext<UploadFile> = {
        transfer: this as unknown as Transfer<UploadFile>,
        shared: new Map(),
        config: this.config,
      };

      const uploadFileInstance = new UploadFile<T>(
        {
          fileId: generateFileId(),
          url: "",
          fileName: file.name,
          File: file,
          percent: 0,
          status: "pending",
          extension: getFileExtension(file.name),
          formatSize: formatFileSize(file.size),
          size: file.size,
          index: Uploader.fileIndex++,
        },
        this as unknown as Transfer,
      );
      let processedFile: UploadFile | null = null;

      try {
        // 执行插件钩子
        const selectResults = await this.runHook(
          "onFileSelect",
          uploadFileInstance,
          pluginContext,
        );
        processedFile =
          selectResults.filter((r) => r instanceof UploadFile).pop() || null;
        if (processedFile instanceof UploadFile) {
          // 更新实例的引用
          Object.assign(uploadFileInstance, processedFile);
        }
      } catch (error) {
        console.error("处理选中文件时发生错误:", error);
        continue;
      }
      // 调用选择回调
      if (this.selectCallback) {
        try {
          const result = await this.selectCallback.call(this, file);
          if (!result) {
            continue;
          }
        } catch (error) {
          continue;
        }
      }

      // 使用统一的验证方法
      const validation = this.validateFile(file, uploadFileInstance);
      if (!validation.valid) {
        this.emit("error", validation.error);
        // 如果是数量限制，跳出循环
        if (validation.error?.code === "FILE_TOO_LIMIT") {
          break;
        }
        continue;
      }

      // 保存插件上下文
      (uploadFileInstance as any).__pluginContext = pluginContext;

      // 生成预览 URL
      handleFile(uploadFileInstance.File).then((url) => {
        uploadFileInstance.url = url;
        Uploader.objectUrls.push(url);
        if (this.inputHTML) {
          this.inputHTML.value = "";
        }
        this.emit("change", uploadFileInstance);
        this.openCallBack?.(uploadFileInstance);
      });

      const beforeResults = await this.runHook(
        "beforeTransfer",
        uploadFileInstance,
        pluginContext,
      );
      const shouldContinue = beforeResults.every((r) => r !== false);
      if (!shouldContinue) continue;

      if (replacesCurrent) {
        this.clearFiles();
        uploadFileInstance.index = Uploader.fileIndex++;
      }
      Uploader.uploadFile = uploadFileInstance;

      // 添加到文件列表
      this.files.push(uploadFileInstance);
      this.activeFiles.push(uploadFileInstance);
      if (this.config?.autoUpload) {
        uploadFileInstance.start(uploadFileInstance.uploadChunkManager);
      }
    }
  }
}
