import { EventEmitter } from "../utils/event-emitter";
import { IFile, TransferSpeedInfo, TransferTimeInfo } from "../types";
import { formatFileSize, formatSpeed, isFileActive, logger, computeUploadTime } from "../utils";
import File from "./File";
import UploadFile from "../uploader/UploadFile";
import DownloadFile from "../downloader/DownloadFile";
import Uploader from "../uploader";
import Downloader from "../downloader";

/**
 * 统一文件管理器 (File Manager)
 * 
 * 同时管理上传和下载任务，提供统一的 API 接口：
 * - 文件列表管理（增删改查）
 * - 全局进度与速率统计
 * - 批量操作控制（暂停、恢复、取消、重试）
 * - 文件回显支持
 * - 事件分发
 * 
 * @template T - 传输成功后的响应数据类型
 */
export default class FileManager<T = any> extends EventEmitter {
  /** 上传文件列表 */
  public uploadFiles: UploadFile<T>[] = [];

  /** 下载文件列表 */
  public downloadFiles: DownloadFile<T>[] = [];

  /** 待传输文件的总字节数 */
  public totalBytes: number = 0;

  /** 已传输的总字节数 */
  public transferredBytes: number = 0;

  /** 全局已传输的总大小（格式化字符串） */
  public transferredFormatSize: string = "0 B";

  /** 全局待传输的总大小（格式化字符串） */
  public totalFormatSize: string = "0 B";

  /** 全局传输速率信息 */
  public transferSpeed: TransferSpeedInfo = {
    currentSpeed: 0,
    averageSpeed: 0,
    currentSpeedFormatted: "0 B/s",
    averageSpeedFormatted: "0 B/s",
  };

  /** 全局传输进度百分比 (0-100) */
  public totalPercent: number = 0;

  /** 是否处于加载/传输状态 */
  public loading: boolean = false;

  /** 传输时间统计信息 */
  public transferTime: TransferTimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 内部定时器 ID，用于防抖更新 */
  protected __updateTimer__: ReturnType<typeof setTimeout> | null = null;

  /** Uploader 实例引用（用于创建上传任务） */
  private uploader: Uploader<T>;

  /** Downloader 实例引用（用于创建下载任务） */
  private downloader: Downloader<T>;

  /**
   * 构造函数
   * @param uploaderConfig - Uploader 配置
   * @param downloaderConfig - Downloader 配置
   */
  constructor(
    uploaderConfig?: any,
    downloaderConfig?: any,
  ) {
    super();

    // 创建 Uploader 和 Downloader 实例
    this.uploader = new Uploader(uploaderConfig);
    this.downloader = new Downloader(downloaderConfig);

    // 监听子管理器的事件并转发
    this.uploader.on("update", () => this.triggerUpdate());
    this.downloader.on("update", () => this.triggerUpdate());
    this.uploader.on("error", (error) => this.emit("error", error));
    this.downloader.on("error", (error) => this.emit("error", error));
  }

  /**
   * 获取所有文件列表（上传 + 下载）
   */
  public get allFiles(): File[] {
    return [...this.uploadFiles, ...this.downloadFiles] as File[];
  }

  /**
   * 添加上传任务
   * @param fileData - 文件数据
   * @returns UploadFile 实例
   */
  public addUploadFile(fileData: Partial<IFile>): UploadFile<T> {
    const uploadFile = this.uploader.addFile(fileData as IFile);
    this.uploadFiles.push(uploadFile);
    this.updateGlobalStats();
    this.triggerUpdate();
    return uploadFile;
  }

  /**
   * 添加下载任务
   * @param url - 下载 URL
   * @param options - 下载选项
   * @returns DownloadFile 实例
   */
  public addDownloadFile(url: string, options?: any): DownloadFile<T> {
    const downloadFile = this.downloader.add(url, options);
    this.downloadFiles.push(downloadFile);
    this.updateGlobalStats();
    this.triggerUpdate();
    return downloadFile;
  }

  /**
   * 设置文件列表（清空后替换，用于回显）
   * @param files - 文件数据数组
   */
  public setFiles(files: Partial<IFile>[]): void {
    // 清空现有列表
    this.uploadFiles = [];
    this.downloadFiles = [];

    // 根据文件类型添加到对应列表
    files.forEach((fileData) => {
      if (fileData.type === "download") {
        const downloadFile = this.downloader.add(fileData.url || "", fileData);
        this.downloadFiles.push(downloadFile);
      } else {
        const uploadFile = this.uploader.addFile(fileData as IFile);
        this.uploadFiles.push(uploadFile);
      }
    });

    this.updateGlobalStats();
    this.triggerUpdate();
  }

  /**
   * 追加文件到列表
   * @param files - 文件数据数组
   */
  public appendFiles(files: Partial<IFile>[]): void {
    files.forEach((fileData) => {
      if (fileData.type === "download") {
        const downloadFile = this.downloader.add(fileData.url || "", fileData);
        this.downloadFiles.push(downloadFile);
      } else {
        const uploadFile = this.uploader.addFile(fileData as IFile);
        this.uploadFiles.push(uploadFile);
      }
    });

    this.updateGlobalStats();
    this.triggerUpdate();
  }

  /**
   * 开始指定文件的传输（自动识别上传/下载）
   * @param fileId - 文件 ID
   */
  public async start(fileId: string): Promise<void> {
    const uploadFile = this.uploadFiles.find((f) => f.fileId === fileId);
    const downloadFile = this.downloadFiles.find((f) => f.fileId === fileId);

    if (uploadFile) {
      await uploadFile.start();
    } else if (downloadFile) {
      await downloadFile.start();
    } else {
      logger.warn("FileManager", `未找到文件: ${fileId}`);
    }
  }

  /**
   * 暂停指定文件
   * @param fileId - 文件 ID
   */
  public pause(fileId: string): void {
    const uploadFile = this.uploadFiles.find((f) => f.fileId === fileId);
    const downloadFile = this.downloadFiles.find((f) => f.fileId === fileId);

    if (uploadFile) {
      uploadFile.pause();
    } else if (downloadFile) {
      downloadFile.pause();
    }
  }

  /**
   * 恢复指定文件
   * @param fileId - 文件 ID
   */
  public resume(fileId: string): void {
    const uploadFile = this.uploadFiles.find((f) => f.fileId === fileId);
    const downloadFile = this.downloadFiles.find((f) => f.fileId === fileId);

    if (uploadFile) {
      uploadFile.resume();
    } else if (downloadFile) {
      downloadFile.resume();
    }
  }

  /**
   * 取消指定文件
   * @param fileId - 文件 ID
   */
  public cancel(fileId: string): void {
    const uploadFile = this.uploadFiles.find((f) => f.fileId === fileId);
    const downloadFile = this.downloadFiles.find((f) => f.fileId === fileId);

    if (uploadFile) {
      uploadFile.cancel();
    } else if (downloadFile) {
      downloadFile.cancel();
    }
  }

  /**
   * 重试指定文件
   * @param fileId - 文件 ID
   */
  public retry(fileId: string): void {
    const uploadFile = this.uploadFiles.find((f) => f.fileId === fileId);
    const downloadFile = this.downloadFiles.find((f) => f.fileId === fileId);

    if (uploadFile) {
      uploadFile.retry();
    } else if (downloadFile) {
      downloadFile.retry();
    }
  }

  /**
   * 移除指定文件
   * @param fileId - 文件 ID
   */
  public remove(fileId: string): void {
    const uploadIndex = this.uploadFiles.findIndex((f) => f.fileId === fileId);
    if (uploadIndex > -1) {
      const uploadFile = this.uploadFiles[uploadIndex];
      uploadFile.cancel();
      this.uploadFiles.splice(uploadIndex, 1);
    }

    const downloadIndex = this.downloadFiles.findIndex((f) => f.fileId === fileId);
    if (downloadIndex > -1) {
      const downloadFile = this.downloadFiles[downloadIndex];
      downloadFile.cancel();
      this.downloadFiles.splice(downloadIndex, 1);
    }

    this.updateGlobalStats();
    this.triggerUpdate();
  }

  /**
   * 触发更新回调（带防抖处理）
   */
  public triggerUpdate(): void {
    if (this.__updateTimer__) {
      clearTimeout(this.__updateTimer__);
    }

    this.__updateTimer__ = setTimeout(() => {
      this.transferSpeed = this.calculateGlobalSpeed();
      this.emit("update", this.allFiles);
    }, 100);
  }

  /**
   * 计算全局传输速率
   */
  protected calculateGlobalSpeed(): TransferSpeedInfo {
    let totalCurrentSpeed = 0;
    let totalTransferredBytes = 0;
    let activeFileCount = 0;

    // 统计上传文件
    this.uploadFiles.forEach((file) => {
      if (isFileActive(file)) {
        activeFileCount++;
        totalTransferredBytes += file.__transferredBytes__ || 0;
        if (file.transferSpeed) {
          totalCurrentSpeed += file.transferSpeed.currentSpeed;
        }
      } else if (file.status === "success") {
        totalTransferredBytes += file.File?.size || 0;
      }
    });

    // 统计下载文件
    this.downloadFiles.forEach((file) => {
      if (isFileActive(file)) {
        activeFileCount++;
        totalTransferredBytes += file.__transferredBytes__ || 0;
        if (file.transferSpeed) {
          totalCurrentSpeed += file.transferSpeed.currentSpeed;
        }
      } else if (file.status === "success") {
        totalTransferredBytes += file.File?.size || 0;
      }
    });

    let globalAverageSpeed = 0;
    if (totalTransferredBytes > 0 && activeFileCount > 0) {
      let earliestStartTime = Date.now();
      [...this.uploadFiles, ...this.downloadFiles].forEach((file: any) => {
        if (isFileActive(file) && file.transferTime?.startTime > 0) {
          earliestStartTime = Math.min(earliestStartTime, file.transferTime.startTime);
        }
      });

      const totalTime = (Date.now() - earliestStartTime) / 1000;
      if (totalTime > 0) {
        globalAverageSpeed = totalTransferredBytes / totalTime;
      }
    }

    this.transferredFormatSize = formatFileSize(totalTransferredBytes);

    return {
      currentSpeed: totalCurrentSpeed,
      averageSpeed: globalAverageSpeed,
      currentSpeedFormatted: formatSpeed(totalCurrentSpeed),
      averageSpeedFormatted: formatSpeed(globalAverageSpeed),
    };
  }

  /**
   * 更新全局统计信息
   */
  public updateGlobalStats(): void {
    // 计算总字节数
    this.totalBytes = [...this.uploadFiles, ...this.downloadFiles].reduce((sum, file) => {
      return sum + (file.File?.size || 0);
    }, 0);

    this.totalFormatSize = formatFileSize(this.totalBytes);

    // 计算总进度
    const allFiles = [...this.uploadFiles, ...this.downloadFiles];
    if (allFiles.length > 0) {
      const totalPercent = allFiles.reduce((sum, file) => {
        return sum + (file.percent || 0);
      }, 0);
      this.totalPercent = Math.round(totalPercent / allFiles.length);
    } else {
      this.totalPercent = 0;
    }
  }

  /**
   * 清空所有文件任务
   */
  public clearFiles(): void {
    this.uploader.clearFiles();
    this.downloader.clearFiles();
    this.uploadFiles = [];
    this.downloadFiles = [];
    this.totalPercent = 0;
    this.totalBytes = 0;
    this.transferredFormatSize = "0 B";
    this.triggerUpdate();
  }

  /**
   * 取消所有正在进行的传输任务
   */
  public cancelAll(): void {
    this.uploader.cancelAll();
    this.downloader.cancelAll();
  }

  /**
   * 暂停所有正在进行的传输任务
   */
  public pauseAll(): void {
    this.uploader.pauseAll();
    this.downloader.pauseAll();
  }

  /**
   * 恢复所有已暂停的传输任务
   */
  public resumeAll(): void {
    this.uploader.resumeAll();
    this.downloader.resumeAll();
  }

  /**
   * 重试所有失败或已取消的传输任务
   */
  public retryAll(): void {
    this.uploader.retryAll();
    this.downloader.retryAll();
  }
}
