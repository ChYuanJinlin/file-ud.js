import axios, { AxiosProgressEvent, Canceler } from "axios";
import { IFile } from "../types";
import Uploader from ".";
import {
  createReactiveUploadFile,
  extractPathFromFunction,
  formatFileSize,
  validator,
} from "../utils";
import { ErrorCode, Errors, FileUDError } from "../fileUD/errors";

export default class UploadFile<T = any> {
  fileId: string;
  url: string;
  fileName: string;
  File: File;
  percent: number | undefined;
  status: IFile["status"];
  extension: string | undefined;
  formatSize: string | undefined;
  formData: FormData | null = null;
  retry?: boolean;
  index: number;
  loading: boolean;
  abort: IFile["abort"];
  proxy: UploadFile;
  public __uploader__: Uploader;
  metadata: any;
  // 全局共享的 WeakMap，用于存储 XHR 实例与文件上下文的映射
  private static xhrToFileMap = new WeakMap<XMLHttpRequest, UploadFile>();

  // 全局共享的当前上传文件队列（用于在拦截器中查找匹配的 formData）
  private static currentUploadQueue: UploadFile[] = [];
  // 跟踪已分配到 XHR 的文件（用于按顺序分配）
  private static assignedFiles = new Set<UploadFile>();

  constructor(file: IFile, up: Uploader<T>) {
    this.fileId = file.fileId;
    this.url = file.url;
    this.fileName = file.fileName;
    this.File = file.File;
    this.percent = file.percent;
    this.status = file.status;
    this.File = file.File;
    this.loading = false;
    this.extension = file.extension;
    this.formatSize = file.formatSize;
    this.abort = file.abort;
    this.index = file.index;
    this.retry = file.retry || false;
    this.__uploader__ = file.__uploader__!;
    this.proxy = createReactiveUploadFile(this, up);
    // 关键：在发起请求前设置拦截器，建立当前文件与 XHR 的映射
    this.setupInterceptor(this);
    return this.proxy;
  }
  /**
   * @description: 取消当前的请求
   * @return {*}
   */
  cancel() {
    this.abort?.();
    this.proxy.status = "cancelled";
  }
  remove() {
    this.cancel();
    const up = this.__uploader__;
    up.files = up.files.filter((f) => f.fileId !== this.fileId);
    up.remObjectUrls(this.url);
    up.emit("remove", this.proxy);
  }
  /**
   * @description: 重试
   * @return {*}
   */
  rest() {
    this.proxy.retry = true;
    // this.upload();
  }

  async upload() {
    this.proxy.loading = true;

    return new Promise(async (resolve, reject) => {
      const up = this.__uploader__;
      if (!up.config?.action) {
        console.warn("请设置上传地址");
        return;
      }

      // 获取插件上下文
      const context = (this as any).__pluginContext || {
        uploader: up,
        shared: up["pluginSharedData"],
        config: up.config,
      };
      this.formData = new FormData();
      if (typeof up.config?.file === "function") {
        up.config?.file.call(this, this.formData);
      } else {
        this.formData.append(up.config?.file!, this.proxy.File!);
      }
      if (up.beforeUploadCallback) {
        try {
          const result = await up.beforeUploadCallback?.call(up, this);
          if (!result) {
            return;
          }
        } catch (error) {
          return;
        }
      }

      this.proxy.status = "uploading";

      if (up.config?.autoUpload) {
        up.totalSize += formatFileSize(this.File.size);
      } else {
        up.totalSize = formatFileSize(
          Array.from(up.files).reduce((acc, file) => acc + this.File.size, 0),
        );
      }

      let promise: Promise<T>;
      // 使用外部函数 - 设置拦截器后发起请求

      if (typeof up.config?.action === "string") {
        promise = (up.config.axiosInstance || axios).post<T>(
          up.config.action,
          this.formData,
        );
      } else {
        promise = up.config?.action.call(up) as Promise<any>;
      }

      promise
        .then((res) => {
          up["runHook"]("onSuccess", res, this, context);
          up.uploadSuccessCallback?.(res, this.proxy);
          this.proxy.status = "success";
          up.remObjectUrls(this.url);
          resolve(res);
          console.info("文件上传成功", res);
        })
        .catch((err) => {
          up["runHook"]("onError", err, this, context);
          this.proxy.status = "error";
          this.proxy.percent = 0; // 上传失败时重置进度为 0%
          this.__uploader__.emit(
            "error",
            new FileUDError(ErrorCode.UPLOAD_FAILED, err).toJSON(),
          );

          reject(err);
        })
        .finally(() => {
          this.proxy.loading = false;
          // 从全局上传队列中移除当前文件
          const index = UploadFile.currentUploadQueue.indexOf(this);
          if (index > -1) {
            UploadFile.currentUploadQueue.splice(index, 1);
          }
        });
    });
  }

  private handleProgress(progressEvent: ProgressEvent | AxiosProgressEvent) {
    // 统一处理不同类型的事件对象
    const loaded = (progressEvent as any).loaded || progressEvent.loaded;
    const total = (progressEvent as any).total || 0;

    // 如果 total 为 0，尝试使用文件本身的大小
    const validTotal = total > 0 ? total : this.proxy.File.size;
    if (validTotal <= 0) {
      // 如果连文件大小都不知道，设置为 0% 或保持原状
      console.warn("无法获取文件大小信息");
      return;
    }

    // 防止进度超过 100%
    const percent = Math.min(100, Math.round((loaded / validTotal) * 100));

    // 原有的进度处理逻辑
    if (this.__uploader__?.config?.chunkOptions) {
      // 分片进度处理
    } else {
      this.proxy.percent = percent;
    }
  }

  /**
   * 设置当前文件的请求拦截器（全局只安装一次）
   * @param fileInstance 当前文件实例
   */
  public setupInterceptor(fileInstance: UploadFile): void {
    // 保存原始 XHR 引用
    Uploader.originalXHR = window.XMLHttpRequest;

    // 将当前文件添加到全局上传队列
    UploadFile.currentUploadQueue.push(fileInstance);

    // 只在第一次安装全局拦截器
    if (!Uploader.isInterceptorInstalled) {
      const OriginalXHR = window.XMLHttpRequest;

      const XHRProxy = function (this: any) {
        const xhr = new OriginalXHR();
        const upload = xhr.upload;

        let requestHeaders: Record<string, string> = {};
        let currentFileInstance: UploadFile | null = null;

        // 拦截 setRequestHeader
        const originalSetHeader = xhr.setRequestHeader;
        xhr.setRequestHeader = function (name: string, value: string) {
          requestHeaders[name] = value;
          return originalSetHeader.call(this, name, value);
        };

        // 拦截 send - 这是关键！
        const originalSend = xhr.send;
        xhr.send = function (body?: any) {
          // 优先从请求体获取 formData
          let formDataToSend = body;

          // 优先从 WeakMap 获取关联的文件实例
          currentFileInstance = UploadFile.xhrToFileMap.get(xhr) || null;

          // 如果 WeakMap 中没有，从队列中按顺序取一个未使用的文件
          if (
            !currentFileInstance &&
            UploadFile.currentUploadQueue.length > 0
          ) {
            // 从队列中找到第一个未被分配的文件
            for (const file of UploadFile.currentUploadQueue) {
              if (!UploadFile.assignedFiles.has(file)) {
                currentFileInstance = file;
                UploadFile.xhrToFileMap.set(xhr, file);
                UploadFile.assignedFiles.add(file);
                break;
              }
            }

            // 如果所有文件都被分配了，使用第一个文件（覆盖）
            if (!currentFileInstance) {
              currentFileInstance = UploadFile.currentUploadQueue[0];
              UploadFile.xhrToFileMap.set(xhr, currentFileInstance);
              console.warn(
                "⚠️ 所有文件都已分配，覆盖第一个文件:",
                currentFileInstance.fileName,
              );
            }
          }

          // 添加上传器的全局 headers
          if (currentFileInstance?.__uploader__?.config?.headers) {
            Object.entries(
              currentFileInstance.__uploader__.config.headers,
            ).forEach(([key, value]) => {
              const headerExists = Object.keys(requestHeaders).some(
                (existingKey) =>
                  existingKey.toLowerCase() === key.toLowerCase(),
              );
              if (!headerExists) {
                xhr.setRequestHeader(key, value as string);
              }
            });
          }

          // 使用当前文件的 formData（如果存在）
          if (currentFileInstance?.formData) {
            formDataToSend = currentFileInstance.formData;
          }

          // 绑定进度回调到当前文件实例
          upload.onprogress = function (event: ProgressEvent) {
            if (currentFileInstance) {
              currentFileInstance.handleProgress(event);
            }
          };

          // 设置 abort 方法
          if (currentFileInstance) {
            currentFileInstance.abort = () => {
              if (xhr.readyState !== XMLHttpRequest.DONE) {
                xhr.abort();
              }
            };
          }

          return originalSend.call(this, formDataToSend);
        };

        return xhr;
      } as any;

      // 复制原型方法
      XHRProxy.prototype = OriginalXHR.prototype;

      // 替换全局 XHR
      window.XMLHttpRequest = XHRProxy;
      Uploader.isInterceptorInstalled = true;

      console.log("✅ 全局 XHR 拦截器已安装");
    }

    // 标记当前文件的拦截器已激活
    Uploader.interceptorActive = true;
  }
}
