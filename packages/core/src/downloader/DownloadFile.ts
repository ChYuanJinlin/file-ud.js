import axios from "axios";
import { IDownloadFile } from "../types";
import TransferFile from "../transfer/TransferFile";

import { computeTransferTime, createReactiveDownloadFile } from "../utils";
import DownloadChunkManager from "./DownloadChunkManager";
import Downloader from ".";
import Transfer from "../transfer/Transfer";

/**
 * 文件下载实例类
 * 负责单个文件的下载逻辑、状态管理、速率计算和生命周期控制
 *
 * @template T - 下载成功后的响应数据类型
 */
export default class DownloadFile<T = any> extends TransferFile<
  DownloadFile,
  T
> {
  /**
   * 分片管理器实例
   * 每个文件拥有独立的 uploadChunkManager,实现并发控制、断点续传和失败隔离
   */
  public downloadChunkManager: DownloadChunkManager | null = null;
  public dl: Downloader<T>;
  /** 下载控制器 */
  private controller: AbortController | null = null;

  /** 已下载字节数 */
  protected __downloadedBytes__: number = 0;

  /** 总字节数 */
  protected __totalBytes__: number = 0;

  /** Blob 对象（useBlob 模式下） */
  private blob: Blob | null = null;

  // ==================== 速率计算内部状态 ====================

  /** 上次计算速率的时间戳 (毫秒) */
  public lastUpdateTime: number = 0;

  /** 上次已下载的字节数 */
  public lastDownloadedBytes: number = 0;

  /** 下载开始的时间戳 (毫秒) */
  public downloadStartTime: number = 0;

  constructor(file: IDownloadFile, transfer: Transfer) {
    super(file, transfer);
    this.dl = transfer as unknown as Downloader<T>;
    this.proxy = createReactiveDownloadFile(this, transfer);
  }

  /**
   * 执行下载
   */
  private async download(): Promise<T> {
    this.proxy.loading = true;
    return new Promise(async (resolve, reject) => {
      this.transfer.loading = true;

      if (!this.dl.config?.action) {
        console.warn("请设置下载地址");
        return;
      }

      // 记录下载开始时间
      if (!this.downloadChunkManager) {
        computeTransferTime(this.proxy.transferTime).start();
      }
       if (! this.transfer.transferTime.startTime) {
        computeTransferTime( this.transfer.transferTime).start();
      }
    });
  }

  // /**
  //  * 处理下载进度
  //  */
  // private handleProgress(event: ProgressEvent): void {
  //   const loaded = event.loaded;
  //   const total = event.total || 0;

  //   this.__downloadedBytes__ = loaded;
  //   this.__totalBytes__ = total;

  //   if (total > 0) {
  //     this.proxy.percent = Math.floor((loaded / total) * 100);
  //   }

  //   // 更新当前文件已下载的大小
  //   this.proxy.transferFormatSize = formatFileSize(loaded);

  //   // 计算下载速度
  //   this.calculateSpeed(loaded);

  //   // 更新全局统计
  //   this.__downloader__.updateGlobalStats();
  //   this.__downloader__.triggerUpdate();

  //   // 触发进度事件
  //   this.__downloader__.emit("progress", this.proxy.percent);
  // }

  // /**
  //  * 计算下载速度
  //  */
  // private calculateSpeed(loadedBytes: number): void {
  //   const now = Date.now();

  //   // 初始化下载开始时间(首次调用)
  //   if (this.downloadStartTime === 0) {
  //     this.downloadStartTime = now;
  //     this.lastUpdateTime = now;
  //     this.lastDownloadedBytes = loadedBytes;
  //     return;
  //   }

  //   // 防抖: 最小时间间隔采样(100ms)
  //   const timeDiff = now - this.lastUpdateTime;
  //   if (timeDiff < 100) {
  //     return;
  //   }

  //   // 计算瞬时速度(bytes/s)
  //   const bytesDiff = loadedBytes - this.lastDownloadedBytes;
  //   const currentSpeed = (bytesDiff / timeDiff) * 1000;

  //   // 计算平均速度(bytes/s)
  //   const totalTime = now - this.downloadStartTime;
  //   const averageSpeed = totalTime > 0 ? (loadedBytes / totalTime) * 1000 : 0;

  //   // 更新速率信息到 Proxy 对象
  //   this.proxy.speed = {
  //     currentSpeed,
  //     averageSpeed,
  //     currentSpeedFormatted: formatSpeed(currentSpeed),
  //     averageSpeedFormatted: formatSpeed(averageSpeed),
  //   };

  //   // 更新内部状态
  //   this.lastUpdateTime = now;
  //   this.lastDownloadedBytes = loadedBytes;
  // }
}
