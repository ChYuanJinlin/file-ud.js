import { Errors } from "..";
import {
  BeforeUploadCallBack,
  ErrorCallBack,
  EventName,
  uploaderConfigs,
  IFile,
  IUploaderPlugin,
  onInitChunkCallback,
  OnMergeChunkCallBack,
  OpenFileCallback,
  PluginContext,
  SelectCallBack,
  UpdateCallBack,
  UploadProgress,
  UploadSpeedInfo,
  UploadSuccessCallBack,
  UploadTimeInfo,
} from "../types";
import {
  checkNetworkStatus,
  computeUploadTime,
  createReactiveUploadFile,
  formatDuration,
  formatFileSize,
  formatSpeed,
  generateFileId,
  getFileExtension,
  handleFile,
  isFileActive,
  logger,
  mergeObjects,
  validator,
} from "../utils";
import { EventEmitter } from "../utils/event-emitter";
import ChunkManager from "./ChunkManager";
import UploadFile from "./UploadFile";
const defaultConfig: uploaderConfigs = {
  multiple: false,
  accept: [],
  show: false,
  elementId: undefined,
  autoUpload: true,
  action: "",
  file: "file",
};

export default class Uploader<T = any> extends EventEmitter {
  public inputHTML: HTMLInputElement | null;
  public files: UploadFile[] = [];
  public uploadFiles: UploadFile[] = [];
  public totalBytes: number = 0;
  public uploadedBytes: number = 0;

  /** 全局已上传的总大小（格式化字符串），如 "125.50 MB" */
  public uploadedFormatSize: string = "0 Bytes";

  /** 全局待上传的总大小（格式化字符串），如 "256.80 MB" */
  public totalFormatSize: string = "0 Bytes";

  public progress: UploadProgress = {
    uploadedBytes: 0,
    totalBytes: 0,
    speed: 0,
    remainingTime: 0,
    startTime: 0,
    elapsedTime: 0,
  };
  // 全局上传速率信息(静态属性)
  public uploadSpeed: UploadSpeedInfo = {
    currentSpeed: 0,
    averageSpeed: 0,
    currentSpeedFormatted: "0 B/s",
    averageSpeedFormatted: "0 B/s",
  };

  public static objectUrls: any[] = [];
  public static baseConfig: uploaderConfigs;
  public config: uploaderConfigs | null = null;
  public static instances: Uploader | null = null;
  public static uploadFile: UploadFile | null;

  // 标记是否已安装全局拦截器
  public static isInterceptorInstalled = false;
  public totalPercent: number = 0;
  public chunkManager: ChunkManager | null = null;
  public totalProgress: number = 0;
  public lastLoadedMap = new Map();

  public uploadTime: UploadTimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };
  public static fileIndex = 0;
  // 添加拦截器相关属性
  public static originalXHR?: typeof XMLHttpRequest | null;
  public static interceptorActive = false;
  public static id: number = 0;
  public id = 0;
  private plugins: IUploaderPlugin[] = [];
  private pluginSharedData = new Map<string, any>();
  public static onError: ErrorCallBack;
  // 静态默认插件
  private static defaultPlugins: IUploaderPlugin[] = [];
  public openCallBack: OpenFileCallback = () => null;
  public beforeUploadCallback: BeforeUploadCallBack | null | undefined = null;
  public updateCallback: UpdateCallBack | null | undefined = null;
  public uploadSuccessCallback: UploadSuccessCallBack<T> = () => null;
  public selectCallback: SelectCallBack | null | undefined = null;
  public onInitChunkCallback: onInitChunkCallback | null = null;
  public OnMergeChunkCallBack: OnMergeChunkCallBack | null = null;
  // 用于防抖的定时器
  private __updateTimer__: ReturnType<typeof setTimeout> | null = null;
  public totalUploadBytes: number = 0;

  /**
   * 触发更新回调（带防抖）
   * @private
   */
  public triggerUpdate(): void {
    // 清除之前的定时器
    if (this.__updateTimer__) {
      clearTimeout(this.__updateTimer__);
    }

    // 设置新的定时器，延迟执行更新回调
    this.__updateTimer__ = setTimeout(() => {
      // 计算并更新全局上传速率
      this.uploadSpeed = this.calculateGlobalUploadSpeed();

      this.updateCallback?.([...this.files]);
    }, 100); // 100ms 防抖延迟
  }

  /**
   * 获取文件的已上传字节数（统一获取逻辑）
   * @param file 文件实例
   * @returns 已上传字节数
   * @private
   */
  private getFileUploadedBytes(file: UploadFile): number {
    return file.chunkManager
      ? file.chunkManager.totalUploadedSize
      : file.__uploadedBytes__ || 0;
  }

  /**
   * 计算全局上传速率(所有文件的聚合)
   * @returns 全局速率对象
   * @private
   */
  private calculateGlobalUploadSpeed(): {
    currentSpeed: number;
    averageSpeed: number;
    currentSpeedFormatted: string;
    averageSpeedFormatted: string;
  } {
    let totalCurrentSpeed = 0;
    let totalUploadedBytes = 0;
    let totalFileSize = 0;
    let uploadingFileCount = 0;

    // 遍历所有正在上传的文件，累加速率和字节数
    this.files.forEach((file) => {
      if (isFileActive(file)) {
        uploadingFileCount++;

        // 累加文件大小（用于计算平均速度）
        totalFileSize += file.File.size;

        // 使用统一方法获取已上传字节数
        totalUploadedBytes += this.getFileUploadedBytes(file);

        // 如果文件有速度信息，累加瞬时速度
        if (file.uploadSpeed) {
          totalCurrentSpeed += file.uploadSpeed.currentSpeed;
        }
      } else if (file.status === "success") {
        // 已完成文件也计入总大小（用于计算整体平均速度）
        totalFileSize += file.File.size;
        totalUploadedBytes += file.File.size;
      }
    });

    // 计算全局平均速度：总已上传字节 / 总耗时
    let globalAverageSpeed = 0;
    if (totalUploadedBytes > 0 && uploadingFileCount > 0) {
      // 找到最早开始上传的文件的时间
      let earliestStartTime = Date.now();
      this.files.forEach((file) => {
        if (isFileActive(file) && file.uploadTime.startTime > 0) {
          earliestStartTime = Math.min(
            earliestStartTime,
            file.uploadTime.startTime,
          );
        }
      });

      const totalTime = (Date.now() - earliestStartTime) / 1000;
      if (totalTime > 0) {
        globalAverageSpeed = totalUploadedBytes / totalTime;
      }
    }

    // 更新全局已上传大小（使用 formatFileSize 格式化）
    this.uploadedFormatSize = formatFileSize(totalUploadedBytes);

    return {
      currentSpeed: totalCurrentSpeed,
      averageSpeed: globalAverageSpeed,
      currentSpeedFormatted: formatSpeed(totalCurrentSpeed),
      averageSpeedFormatted: formatSpeed(globalAverageSpeed),
    };
  }
  /* 
  清空文件
*/
  public clearFiles() {
    this.files.forEach((file) => {
      file.abort?.();
    });
    this.files = [];
    Uploader.fileIndex = 0;
    Uploader.uploadFile = null;
    Uploader.objectUrls = [];
    this.totalPercent = 0;
    this.totalBytes = 0;
    this.totalFormatSize = "0 Bytes";
    this.triggerUpdate();
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
   *   percent: 100,
   *   status: 'success',
   *   formatSize: fileInfo.size
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
        this,
      );

      // 添加到文件列表
      this.files.push(uploadFile);
      this.uploadFiles.push(uploadFile);
    });

    // 更新全局统计信息
    this.updateGlobalStats();

    // 触发更新事件
    this.triggerUpdate();

    logger.info("Uploader", `setFiles: 成功回显 ${this.files.length} 个文件`);
  }

  /**
   * 更新全局统计信息（内部方法）
   * @private
   */
  public updateGlobalStats() {
    // 重新计算总字节数
    this.totalBytes = this.files.reduce((sum, file) => {
      return sum + (file.File?.size || 0);
    }, 0);

    // 更新格式化后的总大小
    this.totalFormatSize = formatFileSize(this.totalBytes);

    // 计算总进度
    if (this.files.length > 0) {
      const totalPercent = this.files.reduce((sum, file) => {
        return sum + (file.percent || 0);
      }, 0);
      this.totalPercent = Math.round(totalPercent / this.files.length);
    } else {
      this.totalPercent = 0;
    }
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

  constructor(config?: uploaderConfigs) {
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
  /**
   * 注册插件
   * @param plugin 插件实例
   * @param options 插件配置
   */
  use(plugin: IUploaderPlugin | IUploaderPlugin[], options?: any): this {
    const plugins = Array.isArray(plugin) ? plugin : [plugin];

    for (const p of plugins) {
      // 检查是否已注册
      if (this.plugins.some((existing) => existing.name === p.name)) {
        console.warn(`插件 ${p.name} 已存在，跳过注册`);
        continue;
      }

      // 调用插件的 install 方法
      if (p.install) {
        p.install(this, options);
      }
      p.created?.(this);
      this.plugins.push(p);
      console.log(`✅ 插件已注册: ${p.name} v${p.version || "1.0.0"}`);
    }

    // 按优先级排序
    this.plugins.sort((a, b) => (a.priority || 50) - (b.priority || 50));

    return this;
  }
  /**
   * 设置全局默认插件（影响之后创建的所有实例）
   */
  static setDefaultPlugins(plugins: IUploaderPlugin[]): void {
    Uploader.defaultPlugins = plugins;
  }
  /**
   * 移除插件
   * @param name 插件名称
   */
  unuse(name: string): this {
    const index = this.plugins.findIndex((p) => p.name === name);
    if (index !== -1) {
      const plugin = this.plugins[index];
      plugin.destroy?.();
      this.plugins.splice(index, 1);
      console.log(`🗑️ 插件已移除: ${name}`);
    }
    return this;
  }

  /**
   * 获取插件
   * @param name 插件名称
   */
  getPlugin(name?: string): IUploaderPlugin | IUploaderPlugin[] | undefined {
    if (name) {
      return this.plugins.find((p) => p.name === name);
    }
    return [...this.plugins];
  }

  /**
   * 执行插件钩子
   * @param hook 钩子名称
   * @param args 参数
   */
  private async runHook<K extends keyof IUploaderPlugin>(
    hook: K,
    ...args: any[]
  ): Promise<any[]> {
    const results: any[] = [];

    for (const plugin of this.plugins) {
      const handler = plugin[hook];
      if (handler && typeof handler === "function") {
        const result = await (handler as any).apply(plugin, args);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * 重置上传器状态为初始值（统一重置逻辑）
   * @private
   */
  private resetUploaderState(): void {
    this.lastLoadedMap = new Map();
    this.id = Uploader.id++;
    this.uploadedBytes = 0;
    this.totalBytes = 0;
    this.totalFormatSize = "0 Bytes";
    this.uploadedFormatSize = "0 Bytes";
    this.totalUploadBytes = 0;
    this.uploadSpeed = {
      currentSpeedFormatted: "",
      averageSpeedFormatted: "",
      currentSpeed: 0,
      averageSpeed: 0,
    };
    this.uploadTime = {
      startTime: 0,
      endTime: 0,
      duration: 0,
      durationFormatted: "0s",
    };
    this.progress = {
      uploadedBytes: 0,
      totalBytes: 0,
      speed: 0,
      remainingTime: 0,
      startTime: 0,
      elapsedTime: 0,
    };
    this.totalPercent = 0;
    this.totalProgress = 0;
    this.uploadFiles = [];
    this.events = new Map<EventName, Set<Function>>();
    this.files = [];
  }

  private init() {
    // 使用统一的重置方法
    this.resetUploaderState();

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
  create(config?: uploaderConfigs) {
    Uploader.baseConfig = Object.assign(defaultConfig, Uploader.baseConfig);
    this.config = { ...Uploader.baseConfig, ...config };
    this.init();

    this.createInput().onchange = async (e) => {
      const FileList = (e.target as HTMLInputElement)?.files;
      const filesList = Array.from(FileList!);

      await this.processSelectedFiles(filesList);

      this.inputHTML!.value = "";
    };

    return this;
  }
  public updateConfig(config: Partial<uploaderConfigs>) {
    this.config = mergeObjects(this.config!, config);
  }
  set onBeforeUpload(callback: BeforeUploadCallBack) {
    this.beforeUploadCallback = callback;
  }

  set onSuccess(callback: UploadSuccessCallBack<T>) {
    this.uploadSuccessCallback = callback;
  }

  set onSelect(callback: SelectCallBack) {
    this.selectCallback = callback;
  }

  set onUpdate(callback: UpdateCallBack) {
    this.updateCallback = callback;
  }

  set onInitChunk(callback: onInitChunkCallback) {
    this.onInitChunkCallback = callback;
  }

  set onMergeChunk(callback: OnMergeChunkCallBack) {
    this.OnMergeChunkCallBack = callback;
  }

  public remObjectUrls(url: string) {
    Uploader.objectUrls.splice(
      Uploader.objectUrls.findIndex((item) => item === url),
      1,
    );
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
        logger.error("ChunkManager", `网络检查失败: ${error.message}`);
        this.cancelAll();
        throw error;
      }
    } catch (error) {
      this.cancelAll();
      logger.error("ChunkManager", "网络检查异常", error);
    }
    // 检查是否有待上传的文件
    if (this.files.length === 0) {
      console.warn("没有待上传的文件");
      return Promise.reject();
    }

    // 如果是第一次调用 submit，触发批量开始事件并记录开始时间
    const isFirstBatch =
      this.uploadFiles.filter((f) => f.status === "uploading").length === 0;
    if (isFirstBatch) {
      this.emit("files-start", this.files);

      // 并行上传所有文件
      const uploadPromises = this.files.map(async (file) => {
        try {
          // 如果文件已经是成功或上传中状态，跳过
          if (file.status === "success" || file.status === "uploading") {
            return Promise.resolve();
          }

          // ✅ 使用统一的 start() 方法
          return file.start();
        } catch (error) {
          console.error(file.fileName + "文件上传失败:", error);
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

    // 数量限制检查
    if (
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
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // 创建插件上下文
      const pluginContext = {
        uploader: this,
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
          index: Uploader.fileIndex++,
        },
        this,
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
      Uploader.uploadFile = uploadFileInstance;

      // 调用选择回调
      if (this.selectCallback) {
        try {
          const result = await this.selectCallback.call(this, file);
          if (!result) {
            return [];
          }
        } catch (error) {
          return [];
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
        "beforeUpload",
        uploadFileInstance,
        pluginContext,
      );
      const shouldContinue = beforeResults.every((r) => r !== false);
      if (!shouldContinue) continue;

      // 添加到文件列表
      this.files.push(uploadFileInstance);
      this.uploadFiles.push(uploadFileInstance);
      if (this.config?.autoUpload) {
        uploadFileInstance.start();
      }
    }
  }
}
