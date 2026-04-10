import { Errors } from "..";
import {
  BeforeUploadCallBack,
  ErrorCallBack,
  EventName,
  FileUDConfigs,
  IFile,
  IUploaderPlugin,
  OnInitCallBack,
  OnMergeCallBack,
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
  formatDuration,
  formatFileSize,
  formatSpeed,
  generateFileId,
  getFileExtension,
  handleFile,
  initLogger,
  logger,
  mergeObjects,
  validator,
} from "../utils";
import { EventEmitter } from "../utils/event-emitter";
import ChunkManager from "./ChunkManager";
import UploadFile from "./UploadFile";
const defaultConfig: FileUDConfigs = {
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
  public static baseConfig: FileUDConfigs;
  public config: FileUDConfigs | null = null;
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
  public onInitCallback: OnInitCallBack | null = null;
  public onMergeCallback: OnMergeCallBack | null = null;
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

      // 检查是否所有文件都已上传完成
      this.checkAndUpdateTotalUploadTime();

      this.updateCallback?.([...this.files]);
    }, 100); // 100ms 防抖延迟
  }

  /**
   * 检查并更新全局上传总耗时
   * 当所有文件都完成(成功或失败)时,记录总耗时
   * @private
   */
  private checkAndUpdateTotalUploadTime(): void {
    // 如果没有文件,不处理
    if (this.files.length === 0) {
      return;
    }

    // 检查是否所有文件都已完成(success 或 error 状态)
    const allCompleted = this.files.every(
      (file) => file.status === "success" || file.status === "error",
    );

    // 如果所有文件都完成且尚未记录结束时间
    if (
      allCompleted &&
      this.uploadTime.startTime > 0 &&
      this.uploadTime.endTime === 0
    ) {
      const endTime = Date.now();
      const duration = endTime - this.uploadTime.startTime;
      this.uploadTime = {
        startTime: this.uploadTime.startTime,
        endTime,
        duration,
        durationFormatted: formatDuration(duration),
      };
    }
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
    let totalAverageSpeed = 0;
    let uploadingFileCount = 0;

    // 遍历所有正在上传的文件,累加速率
    this.files.forEach((file) => {
      if (file.status === "uploading" && file.uploadSpeed) {
        totalCurrentSpeed += file.uploadSpeed.currentSpeed;
        totalAverageSpeed += file.uploadSpeed.averageSpeed;
        uploadingFileCount++;
      }
    });

    const avgSpeed =
      uploadingFileCount > 0 ? totalAverageSpeed / uploadingFileCount : 0;

    return {
      currentSpeed: totalCurrentSpeed,
      averageSpeed: avgSpeed,
      currentSpeedFormatted: formatSpeed(totalCurrentSpeed),
      averageSpeedFormatted: formatSpeed(avgSpeed),
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
    this.totalBytes = 0;
    this.triggerUpdate();
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

  constructor(config?: FileUDConfigs) {
    super();
    this.inputHTML = null;
    try {
      if (!Uploader.instances) {
        this.config = mergeObjects(Uploader.baseConfig, config);

        // 初始化日志配置
        if (this.config.logConfig) {
          initLogger({
            enabled: this.config.logConfig.enabled ?? true,
            level: this.config.logConfig.level,
            showTimestamp: this.config.logConfig.showTimestamp,
            enableColors: this.config.logConfig.enableColors,
          });
        }

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
  public open(fn: OpenFileCallback): any {
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

  private init() {
    this.lastLoadedMap = new Map();
    this.id = Uploader.id++;
    // 继承默认插件
    this.plugins = [...Uploader.defaultPlugins];
    this.uploadedBytes = 0;
    this.totalBytes = 0;
    this.totalUploadBytes = 0;
    this.uploadSpeed = {
      currentSpeedFormatted: "",
      averageSpeedFormatted: "",
      currentSpeed: 0,
      averageSpeed: 0,
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
  create(config?: FileUDConfigs) {
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
  public updateConfig(config: Partial<FileUDConfigs>) {
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

  set onInit(callback: OnInitCallBack) {
    this.onInitCallback = callback;
  }

  set onMerge(callback: OnMergeCallBack) {
    this.onMergeCallback = callback;
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
    // 检查是否有待上传的文件
    if (this.files.length === 0) {
      console.warn("没有待上传的文件");
      return Promise.resolve();
    }

    // 如果是第一次调用 submit，触发批量开始事件并记录开始时间
    const isFirstBatch =
      this.uploadFiles.filter((f) => f.status === "uploading").length === 0;
    if (isFirstBatch) {
      this.emit("files-start", this.files);

      // 记录全局上传开始时间
      const now = Date.now();
      this.uploadTime = {
        startTime: now,
        endTime: 0,
        duration: 0,
        durationFormatted: "0s",
      };
    }

    // 并行上传所有文件
    const uploadPromises = this.files.map(async (file) => {
      try {
        // 如果文件已经是成功或上传中状态，跳过
        if (file.status === "success" || file.status === "uploading") {
          return Promise.resolve();
        }

        // 直接开始上传，由 UploadFile 内部管理 ChunkManager
        return file.chunkManager
          ? file.chunkManager.startUpload()
          : file.upload();
      } catch (error) {
        console.error(file.fileName + "文件上传失败:", error);
      }
    });

    await Promise.all(uploadPromises);
    if (!this.uploadFiles.length) {
      this.emit("files-complete", this.files);
      console.log("所有文件上传完成");
      this.totalProgress = 0;
      this.totalUploadBytes = 0;
    }
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

      // 大小限制检查
      if (
        this.config?.maxSize &&
        !validator.size(file.size, this.config.maxSize)
      ) {
        this.emit(
          "error",
          Errors.fileTooLarge.call(this, this.config?.maxSize),
        );
        continue;
      }
      // 类型限制检查
      if (
        this.config?.accept?.toString() &&
        !validator.type(this.config?.accept, uploadFileInstance)
      ) {
        this.emit(
          "error",
          Errors.fileTooType.call(this, {
            accept: this.config?.accept,
            fileName: file.name,
          }),
        );
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

      if (
        this.config?.limit &&
        !validator.limit(this.config?.limit, this.files.length)
      ) {
        this.emit("error", Errors.fileTooLimit.call(this, this.config?.limit));
        break;
      }
      const beforeResults = await this.runHook(
        "beforeUpload",
        uploadFileInstance,
        pluginContext,
      );
      const shouldContinue = beforeResults.every((r) => r !== false);
      if (!shouldContinue) continue;

      // 添加到文件列表
      this.files.unshift(uploadFileInstance);
      this.uploadFiles.unshift(uploadFileInstance);

      // 自动上传：调用 submit 方法
      if (this.config?.autoUpload) {
        this.submit();
      }
    }
  }
}
