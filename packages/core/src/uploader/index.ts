import { Errors } from "..";
import {
  BeforeUploadCallBack,
  ErrorCallBack,
  EventName,
  FileUDConfigs,
  IUploaderPlugin,
  OpenFileCallback,
  PluginContext,
  SelectCallBack,
  UpdateCallBack,
  UploadSuccessCallBack,
} from "../types";
import {
  formatFileSize,
  generateFileId,
  getFileExtension,
  handleFile,
  mergeObjects,
  validator,
} from "../utils";
import { EventEmitter } from "../utils/event-emitter";
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
let id = 0;
export default class Uploader<T = any> extends EventEmitter {
  public inputHTML: HTMLInputElement | null;
  public files: UploadFile[] = [];
  public static objectUrls: any[] = [];
  public static baseConfig: FileUDConfigs;
  public config: FileUDConfigs | null = null;
  public static instances: Uploader | null = null;
  // 标记是否已安装全局拦截器
  public static isInterceptorInstalled = false;
  public totalSize: string = "0";
  public uploadedBytes: number = 0;
  public static totalProgress: number = 0;
  public lastLoadedMap = new Map();
  public static fileIndex = 0;
  // 添加拦截器相关属性
  public static originalXHR?: typeof XMLHttpRequest | null;
  public static interceptorActive = false;
  private id: number = 0;
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
  // 用于防抖的定时器
  private __updateTimer__: ReturnType<typeof setTimeout> | null = null;

  /**
   * @description: 触发更新回调（带防抖）
   * @private
   */
  public triggerUpdate(): void {
    // 清除之前的定时器
    if (this.__updateTimer__) {
      clearTimeout(this.__updateTimer__);
    }

    // 设置新的定时器，延迟执行更新回调
    this.__updateTimer__ = setTimeout(() => {
      this.updateCallback?.([...this.files]);
    }, 100); // 100ms 防抖延迟
  }

  constructor(config?: FileUDConfigs) {
    super();
    this.inputHTML = null;
    try {
      if (!Uploader.instances) {
        this.config = mergeObjects(Uploader.baseConfig, config);
        Uploader.instances = this.create(this.config);
      }
      return Uploader.instances;
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
      console.warn("The uploader does not exist. Please create one");
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
    this.id = id++;
    // 继承默认插件
    this.plugins = [...Uploader.defaultPlugins];
    this.uploadedBytes = 0;
    this.totalSize = "0";
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
    // 触发批量开始事件
    this.emit("batch-start", this.files);

    try {
      // 并行上传所有文件，每个文件状态独立
      const uploadPromises = this.files.map((file) => {
        // 如果文件已经是成功或上传中状态，跳过
        if (file.status === "success" || file.status === "uploading") {
          return Promise.resolve();
        }
        // 直接开始上传，不执行插件钩子
        return file.upload();
      });

      // 等待所有文件上传完成
      await Promise.all(uploadPromises);

      // 触发批量完成事件
      this.emit("batch-complete", this.files);
      console.info("所有文件上传完成");
    } catch (error) {
      console.error("批量上传过程中发生错误:", error);
      throw error;
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
        return [];
      }

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
        return [];
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
        return [];
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
      this.files.push(uploadFileInstance);

      // 自动上传
      if (this.config?.autoUpload) {
        this.submit();
      }
    }
  }
}
