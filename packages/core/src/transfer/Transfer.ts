import {
  IFile,
  onInitChunkCallback,
  OnMergeChunkCallBack,
  speedInfo,
  TimeInfo,
  UpdateCallBack,
} from "../types";
import { formatFileSize, formatSpeed, isFileActive } from "../utils";
import { EventEmitter } from "../utils/event-emitter";
import TransferFile from "./TransferFile";

export default class Transfer<
  T extends TransferFile = TransferFile,
> extends EventEmitter {
  /** 当前传输任务的文件列表 */
  public files: T[] = [];
  /** 当前正在上传或下载任务的文件列表 用来判断当前文件是否全部上传完成 */
  public activeFiles: T[] = [];

  /** 总字节数 */
  public totalBytes: number = 0;

  /** 已传输的总字节数 */
  public transferredBytes: number = 0;
  /** 总的已传输的总字节数 */
  public totalTransferredBytes: number = 0;
  /** 全局已传输的总大小（格式化字符串），如 "125.50 MB" */
  public transferredFormatSize: string = "0 B";

  /** 全局待传输的总大小（格式化字符串），如 "256.80 MB" */
  public totalFormatSize: string = "0 B";

  /** 全局传输速率信息 (瞬时速度、平均速度等) */
  public speed: speedInfo = {
    currentSpeed: 0,
    averageSpeed: 0,
    currentSpeedFormatted: "0 B/s",
    averageSpeedFormatted: "0 B/s",
  };

  /** 全局传输进度百分比 (0-100) */
  public totalPercent: number = 0;

  /** 是否处于加载/传输状态 */
  public loading: boolean = false;

  /** 传输时间统计信息 (开始时间、结束时间、耗时) */
  public transferTime: TimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 内部定时器 ID，用于防抖更新 */
  public __updateTimer__: ReturnType<typeof setTimeout> | null = null;
  public updateCallback: UpdateCallBack | null | undefined = null;
  public onInitChunkCallback: onInitChunkCallback | null = null;
  public OnMergeChunkCallBack: OnMergeChunkCallBack | null = null;

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
      this.speed = this.calculateGlobalUploadSpeed();

      this.updateCallback?.([...this.files]);
    }, 100); // 100ms 防抖延迟
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
        if (file.speed) {
          totalCurrentSpeed += file.speed.currentSpeed;
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
        if (isFileActive(file) && file.transferTime.startTime > 0) {
          earliestStartTime = Math.min(
            earliestStartTime,
            file.transferTime.startTime,
          );
        }
      });

      const totalTime = (Date.now() - earliestStartTime) / 1000;
      if (totalTime > 0) {
        globalAverageSpeed = totalUploadedBytes / totalTime;
      }
    }

    // 更新全局已上传大小（使用 formatFileSize 格式化）
    this.transferredFormatSize = formatFileSize(totalUploadedBytes);

    return {
      currentSpeed: totalCurrentSpeed,
      averageSpeed: globalAverageSpeed,
      currentSpeedFormatted: formatSpeed(totalCurrentSpeed),
      averageSpeedFormatted: formatSpeed(globalAverageSpeed),
    };
  }

  /**
   * 获取文件的已上传字节数（统一获取逻辑）
   * @param file 文件实例
   * @returns 已上传字节数
   * @private
   */
  private getFileUploadedBytes(file: T): number {
    return file.chunkManager
      ? file.chunkManager.totalChunkSize
      : file.__transferBytes__ || 0;
  }
}
