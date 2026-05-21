import { EventEmitter } from "../utils/event-emitter";
import type {
  IFile,
  TransferSpeedInfo,
  TransferTimeInfo,
  UpdateCallBack,
} from "../types";
import { formatFileSize, isFileActive, formatSpeed } from "../utils";

/**
 * 文件传输基类 (Transfer Base)
 *
 * 封装了文件上传和下载共有的核心逻辑：
 * - 文件列表管理 (增删改查)
 * - 全局进度与速率统计
 * - 批量操作控制 (暂停、恢复、取消、重试)
 * - 事件分发与防抖更新
 *
 * @note 当前版本中 Uploader 和 Downloader 尚未继承此类，保留供未来重构使用
 */
export default abstract class TransferBase<
  T extends IFile = IFile,
> extends EventEmitter {
  /** 当前传输任务的文件列表 */
  public files: T[] = [];
  /** 当前正在上传或下载任务的文件列表 用来判断当前文件是否全部上传完成 */
  public activeFiles: T[] = [];
  /** 待传输文件的总字节数 */
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

  /** 传输时间统计信息 (开始时间、结束时间、耗时) */
  public transferTime: TransferTimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 状态更新回调 (防抖) */
  public updateCallback: UpdateCallBack<T> | null | undefined = null;

  /** 内部定时器 ID，用于防抖更新 */
  protected __updateTimer__: ReturnType<typeof setTimeout> | null = null;

  /**
   * 触发更新回调（带防抖处理）
   *
   * 当文件状态发生变化时调用，通过延迟执行避免高频触发导致的性能损耗。
   * @public
   */
  public triggerUpdate(): void {
    if (this.__updateTimer__) {
      clearTimeout(this.__updateTimer__);
    }

    this.__updateTimer__ = setTimeout(() => {
      // 调用子类可能重写的速率计算方法
      this.transferSpeed = this.calculateGlobalSpeed();
      // 调用 updateCallback
      this.updateCallback?.([...this.files]);
    }, 100); // 100ms 防抖延迟
  }

  /**
   * 计算全局传输速率
   *
   * 聚合所有活跃文件的瞬时速度，并根据总耗时计算平均速度。
   * @returns 全局速率对象
   * @protected
   */
  protected calculateGlobalSpeed(): TransferSpeedInfo {
    debugger
    let totalCurrentSpeed = 0;
    let totalTransferredBytes = 0;
    let activeFileCount = 0;

    this.files.forEach((file: T) => {
      if (isFileActive(file as any)) {
        activeFileCount++;
        totalTransferredBytes += (file as any).__transferredBytes__ || 0;
        if ((file as any).transferSpeed) {
          totalCurrentSpeed += (file as any).transferSpeed.currentSpeed;
        }
      } else if (file.status === "success") {
        // 已完成文件计入总量以计算整体平均值
        totalTransferredBytes += file.File?.size || 0;
      }
    });

    let globalAverageSpeed = 0;
    if (totalTransferredBytes > 0 && activeFileCount > 0) {
      let earliestStartTime = Date.now();
      this.files.forEach((file: T) => {
        if (
          isFileActive(file as any) &&
          (file as any).transferTime?.startTime > 0
        ) {
          earliestStartTime = Math.min(
            earliestStartTime,
            (file as any).transferTime.startTime,
          );
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
   *
   * 重新计算总字节数、总进度百分比及格式化显示文本。
   * @public
   */
  public updateGlobalStats() {
    this.totalBytes = this.files.reduce((sum, file) => {
      return sum + (file.File?.size || 0);
    }, 0);

    this.totalFormatSize = formatFileSize(this.totalBytes);

    if (this.files.length > 0) {
      const totalPercent = this.files.reduce((sum, file) => {
        return sum + (file.percent || 0);
      }, 0);
      this.totalPercent = Math.round(totalPercent / this.files.length);
    } else {
      this.totalPercent = 0;
    }
  }

  /**
   * 清空所有文件任务
   *
   * 会中止所有正在进行的传输任务并重置统计数据。
   */
  public clearFiles() {
    this.files.forEach((file: T) => {
      (file as any).abort?.();
    });
    this.files = [];
    this.totalPercent = 0;
    this.totalBytes = 0;
    this.transferredFormatSize = "0 B";
    this.triggerUpdate();
  }

  /**
   * 取消所有正在进行的传输任务
   */
  public cancelAll() {
    this.files.forEach((file: T) => {
      (file as any).cancel?.();
    });
  }

  /**
   * 暂停所有正在进行的传输任务
   */
  public pauseAll() {
    this.files.forEach((file: T) => {
      (file as any).pause?.();
    });
  }

  /**
   * 恢复所有已暂停的传输任务
   */
  public resumeAll() {
    this.files.forEach((file: T) => {
      (file as any).resume?.();
    });
  }

  /**
   * 重试所有失败或已取消的传输任务
   */
  public retryAll() {
    this.files.forEach((file: T) => {
      (file as any).retry?.();
    });
  }
}
