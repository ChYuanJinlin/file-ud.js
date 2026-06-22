import type {
  DownloaderConfig,
  IUDPlugin,
  UDFile,
  beforeTransferCallBack,
} from "../types/index";
import Transfer from "../transfer/Transfer";
import {
  mergeObjects,
  formatFileSize,
  logger,
  getFileExtension,
  saveFileHandle,
  loadFileHandle,
} from "../utils";

import DownloadFile from "./DownloadFile";

export const defaultConfig: DownloaderConfig = {
  action: "",
  headers: {},
  timeout: 30000,
  axiosOptions: {
    method: "get",
    responseType: "blob",
  },
};

/**
 * 文件下载器类 (Downloader)
 *
 * 继承自 Transfer，专门处理文件下载相关的业务逻辑。
 * 回调属性（successCallback / updateCallback / onInitChunkCallback / OnMergeChunkCallBack /
 * beforeTransferCallback）及其 setter 全部由 Transfer 基类提供，此处不再重复声明。
 */
export default class Downloader<T = any> extends Transfer<DownloadFile, T> {
  /** 全局基础配置 */
  public static baseConfig: DownloaderConfig;

  /** 当前实例的配置信息 */
  public config: DownloaderConfig | null = null;
  public static instances: Downloader | null = null;
  public static fileIndex: number = 0;

  /** 静态默认插件（影响之后创建的所有实例） */
  private static defaultPlugins: IUDPlugin<DownloadFile>[] = [];

  // ==================== 回调设置器（仅基类未提供的） ====================

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

    // 加载默认插件
    this.init();

    return this;
  }

  /**
   * 设置全局默认插件（影响之后创建的所有实例）
   */
  static setDefaultPlugins(plugins: IUDPlugin<DownloadFile>[]): void {
    Downloader.defaultPlugins = plugins;
  }

  /**
   * 初始化实例插件列表（继承全局默认插件）
   */
  private init() {
    this.plugins = [...Downloader.defaultPlugins];
  }

  // ==================== 流式保存（File System Access API） ====================

  /**
   * 🔑 文件名 → FileSystemFileHandle 缓存
   *
   * 用途：避免重复调用 showSaveFilePicker() 截断已存在的文件。
   * Chrome 的 showSaveFilePicker() 在用户选择覆盖同名文件时会直接截断文件为 0 字节，
   * 导致"秒下"检测失败。缓存句柄后，二次下载同一文件直接复用句柄。
   *
   * ⚠️ 挂载在 window 上而非 static Map：Vite HMR 会重置模块级静态变量，
   *    但 window 上的属性不受影响，保证开发模式下缓存不丢失。
   *    页面全量刷新后缓存自然清空，功能不受影响（回退到正常下载）。
   */
  private static get fileHandleCache(): Map<string, FileSystemFileHandle> {
    const key = "__UD_FILE_HANDLE_CACHE__";
    if (!(window as any)[key]) {
      (window as any)[key] = new Map<string, FileSystemFileHandle>();
    }
    return (window as any)[key];
  }

  /**
   * 静态方法：打开系统"另存为"对话框，获取流式写入 FileHandle
   *
   * 使用 File System Access API（Chrome 86+, Edge 86+）。
   * 如果 API 不可用，返回 undefined（调用方应回退到 Blob 下载模式）。
   *
   * 🔑 如果当前会话中已下载过同名文件，直接复用缓存的 handle，
   *    避免 showSaveFilePicker() 截断已有文件。
   *
   * @param suggestedName 建议的文件名
   * @returns FileHandle（用户选择后），null（用户取消），undefined（API 不可用）
   */
  public static async pickSaveFile(
    suggestedName?: string,
  ): Promise<FileSystemFileHandle | null | undefined> {
    try {
      if (typeof window === "undefined" || !window.showSaveFilePicker) {
        return undefined;
      }

      // 🔑 多层缓存策略（按优先级）：
      //    L1: 内存 Map（window 挂载，同会话最快）
      //    L2: IndexedDB（跨页面刷新，持久化 FileSystemFileHandle）

      // ---- L1: 内存缓存 ----
      if (suggestedName && Downloader.fileHandleCache.has(suggestedName)) {
        const cachedHandle = Downloader.fileHandleCache.get(suggestedName)!;
        try {
          const diskFile = await cachedHandle.getFile();
          if (diskFile.size > 0) {
            return cachedHandle;
          }
          Downloader.fileHandleCache.delete(suggestedName);
        } catch (e) {
          Downloader.fileHandleCache.delete(suggestedName);
        }
      }

      // ---- L2: IndexedDB 持久化句柄（跨页面刷新） ----
      if (suggestedName) {
        try {
          const indexedHandle = await loadFileHandle(suggestedName);
          if (indexedHandle) {
            // 验证句柄仍有效（文件未被手动删除）
            try {
              const diskFile = await indexedHandle.getFile();
              if (diskFile.size > 0) {
                // 🔄 回填到 L1 内存缓存，下次更快
                Downloader.fileHandleCache.set(suggestedName, indexedHandle);
                return indexedHandle;
              }
            } catch (verifyErr) {
              // 句柄验证失败，跳过
            }
          }
        } catch (loadErr) {
          // IndexedDB 查询失败，跳过 L2 缓存
        }
      }

      // ---- L3: 无缓存 → 弹出系统"另存为"对话框 ----
      const handle = await window.showSaveFilePicker({
        suggestedName,
      });

      // 🔑 新选择的句柄 → 回填到 L1（拿到句柄就缓存，不等下载完成）
      //    ⚠️ 不在此处写 L2 IndexedDB：此时 showSaveFilePicker 刚截断文件为 0 字节，
      //      写 L2 会导致下次刷新后 loadFileHandle 拿到"空文件句柄"。
      //      L2 持久化放在 downloadFile.then() 中（下载完成后）。
      if (suggestedName && handle) {
        Downloader.fileHandleCache.set(suggestedName, handle);
      }

      return handle;
    } catch (err: any) {
      // 用户取消保存对话框 → DOMException: The user aborted a request
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.name === "UnknownError")
      ) {
        return null;
      }
      logger.warn("Downloader", "pickSaveFile 异常", err);
      return undefined;
    }
  }

  /**
   * 添加下载任务并立即开始下载
   * @param file 下载文件配置
   * @param fileHandle 可选，File System Access API 的 FileHandle（流式保存用）
   * @returns DownloadFile 实例
   */
  public downloadFile(
    file: UDFile,
    fileHandle?: FileSystemFileHandle,
  ): DownloadFile<T> {
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
        fileHandle: fileHandle || file.fileHandle,
      },
      this as unknown as Transfer,
    );

    // 先添加到文件列表，让 UI 立即可见
    this.files.push(downloadFile);
    this.activeFiles.push(downloadFile);
    this.updateGlobalStats();
    this.triggerUpdate();

    // 再开始下载，进度会通过 TransferFile 的监听实时更新
    downloadFile.start(downloadFile.downloadChunkManager).then(() => {
      // 🔑 下载成功后缓存文件句柄（L1 内存 + L2 IndexedDB）
      const fh = downloadFile.fileHandle;
      if (fh) {
        const name = file.fileName || file.url;
        // L1: 内存缓存（最快，但页面刷新后丢失）
        Downloader.fileHandleCache.set(name, fh);
        // L2: IndexedDB 持久化（跨页面刷新）
        saveFileHandle(name, fh).catch(() => {});
      }

      // 下载完成后触发一次最终更新
      this.updateGlobalStats();
      this.triggerUpdate();
    });

    return downloadFile;
  }

  // ==================== 全局批量控制 ====================

  /**
   * 提交所有待下载文件（自动调用所有文件 start 方法）
   */
  public submit(): void {
    this.files.forEach((file) => {
      if (file.status === "pending" || file.status === "fail") {
        file.start(file.downloadChunkManager);
      }
    });
  }

  /**
   * 取消所有下载任务
   */
  public cancelAll(): void {
    this.files.forEach((file) => {
      file.cancel();
    });
  }

  /**
   * 暂停所有下载任务
   */
  public pauseAll(): void {
    this.files.forEach((file) => {
      const proxyFile = file.proxy || file;
      if (proxyFile.status === "UDLoading") {
        file.pause();
      }
    });
  }

  /**
   * 恢复所有下载任务
   */
  public async resumeAll(): Promise<void> {
    const resumes: Promise<void>[] = [];
    this.files.forEach((file) => {
      const proxyFile = file.proxy || file;
      if (proxyFile.status === "paused") {
        resumes.push(file.resume());
      }
    });
    await Promise.allSettled(resumes);
  }

  /**
   * 重试所有失败/取消的下载任务
   */
  public async retryAll(): Promise<void> {
    const retries: Promise<void>[] = [];
    this.files.forEach((file) => {
      const proxyFile = file.proxy || file;
      if (["cancelled", "fail", "error"].includes(proxyFile.status!)) {
        retries.push(file.retry());
      }
    });
    await Promise.allSettled(retries);
  }

  /**
   * 保存 Blob 到本地（触发浏览器下载对话框）
   * @param fileName 文件名
   * @param data Blob 数据或可转为 Blob 的数据
   */
  public static saveBlob(fileName: string, data: any): void {
    // 确保 data 是有效的 Blob 对象
    let blob: Blob;
    if (data instanceof Blob) {
      blob = data;
    } else {
      blob = new Blob([data]);
    }

    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    // ✅ 部分浏览器在异步回调中 a.click() 不会触发下载弹窗，
    // 延迟移除元素并清理 URL，给浏览器足够时间处理
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 100);
  }

  /**
   * 通过 URL 下载并保存文件到本地（触发浏览器下载对话框）
   * @param fileName 文件名
   * @param url 下载链接
   */
  public static async saveFile(fileName: string, url: string): Promise<void> {
    // 去除 query string 和 hash，避免 getFileExtension 提取出带参数的扩展名
    const cleanUrl = url.split("?")[0].split("#")[0];
    const extension = getFileExtension(cleanUrl);
    fileName = extension ? `${fileName}.${extension}` : fileName;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      Downloader.saveBlob(fileName, blob);
    } catch (error) {
      logger.error("Downloader", `文件保存失败: ${fileName}`, error);
      throw error;
    }
  }
}
