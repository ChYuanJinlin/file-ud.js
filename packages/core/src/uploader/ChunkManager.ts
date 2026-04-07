import { AxiosProgressEvent } from "axios";
import { ChunkOptions } from "../types";
import UploadFile from "./UploadFile";
import { calculateFileMD5, formatSpeed, sleep } from "../utils";

export default class ChunkManager {
  chunkSize: number = 0;
  maxConcurrent: number = 5;
  public uploadedChunkIndex: number = 0;
  retries: number = 0;
  retryDelay: number = 1000; // 重试延迟，默认1秒
  timeout: number = 30000; // 超时时间，默认30秒
  enableResume: boolean = false; // 是否启用断点续传
  public totalChunks: number = 0;
  public uploadedChunks: boolean[] = [];
  public uploadEndTime = 0;
  public completedChunks = 0;
  public totalUploadTime = 0;
  public uploadStartTime = performance.now();
  uploadErrorFileCallBack: (() => void)[] = [];
  public uploadStatsInfos: {
    totalTime: number;
    fileSize: number;
    completedChunks: number | undefined;
    averageSpeed: number;
  } = {
    totalTime: 0,
    fileSize: 0,
    completedChunks: undefined,
    averageSpeed: 0,
  };
  uploadFile: UploadFile;
  totalUploadedSize: number = 0;
  config: ChunkOptions; // 保存配置

  // 新增属性
  private fileHash: string = ""; // 文件MD5哈希
  private uploadId: string = ""; // 服务端返回的上传ID
  private failedChunks: number[] = []; // 失败的分片索引
  private retryCountMap: Map<number, number> = new Map(); // 每个分片的重试次数
  private progressSaveTimer: ReturnType<typeof setInterval> | null = null; // 进度保存定时器

  // 暂停/恢复控制
  private isPaused: boolean = false; // 是否处于暂停状态
  private pauseResolve?: () => void; // 暂停时的 Promise resolve
  private activeUploads: Set<Promise<void>> = new Set(); // 当前活跃的上传任务

  // 网速计算所需的内部状态
  private lastUpdateTime: number = 0;
  private lastUploadedBytes: number = 0;

  constructor(ChunkOptions: ChunkOptions, file: UploadFile) {
    this.config = ChunkOptions; // 保存配置
    this.chunkSize = ChunkOptions.chunkSize || 1024 * 1024 * 5; // 默认5MB
    this.maxConcurrent = ChunkOptions.maxConcurrent || 5; // 默认同时上传5个分片
    this.retries = ChunkOptions.retries || 3; // 默认重试3次
    this.retryDelay = ChunkOptions.retryDelay || 1000; // 默认重试延迟1秒
    this.timeout = ChunkOptions.timeout || 30000; // 默认超时30秒
    this.enableResume = ChunkOptions.enableResume || false; // 默认不启用断点续传
    this.totalChunks = Math.ceil(file.File.size / this.chunkSize);
    this.uploadFile = file;
    this.uploadedChunks = Array(this.totalChunks).fill(false);

    // 如果提供了自定义uploadId，使用它
    if (ChunkOptions.uploadId) {
      this.uploadId = ChunkOptions.uploadId;
    }
  }

  /**
   * 计算文件MD5哈希值
   */
  private async computeFileHash(): Promise<string> {
    if (!this.fileHash) {
      try {
        console.log("开始计算文件MD5...");
        this.fileHash = await calculateFileMD5(this.uploadFile.File);
        console.log(`文件MD5: ${this.fileHash}`);
      } catch (error) {
        console.error("计算文件MD5失败:", error);
        // 如果计算失败，使用时间戳作为备用标识
        this.fileHash = `fallback_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      }
    }
    return this.fileHash;
  }

  /**
   * 初始化上传（获取uploadId或检查已上传分片）
   */
  private async initUpload(): Promise<void> {
    const up = this.uploadFile.__uploader__;

    // 计算文件哈希
    await this.computeFileHash();

    // 如果启用了断点续传，尝试从本地存储恢复进度
    if (this.enableResume) {
      const savedProgress = this.loadProgress();
      if (savedProgress && savedProgress.uploadId) {
        this.uploadId = savedProgress.uploadId;
        this.uploadedChunks = savedProgress.uploadedChunks;
        this.completedChunks = this.uploadedChunks.filter(Boolean).length;
        console.log(
          `恢复上传进度: 已完成 ${this.completedChunks}/${this.totalChunks} 个分片`,
        );
        return;
      }
    }

    // 调用用户提供的初始化回调
    const onInit = up.onInitCallback;
    if (onInit) {
      try {
        console.log("调用用户自定义的初始化回调...");
        const result = await onInit(
          this.uploadFile,
          this.totalChunks,
          this.fileHash,
        );

        this.uploadId = result.uploadId;

        // 如果返回了已上传的分片列表，更新状态
        if (result.uploadedChunks && Array.isArray(result.uploadedChunks)) {
          result.uploadedChunks.forEach((index: number) => {
            if (index >= 0 && index < this.totalChunks) {
              this.uploadedChunks[index] = true;
              this.completedChunks++;
            }
          });
          console.log(`服务器已有 ${this.completedChunks} 个分片`);
        }

        console.log(`上传初始化成功, uploadId: ${this.uploadId}`);
      } catch (error) {
        console.error("初始化回调执行失败:", error);
        throw new Error(
          `分片上传初始化失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      // 如果没有提供onInit回调，生成本地uploadId
      console.warn("未提供 onInit 回调，使用本地生成的 uploadId");
      this.uploadId = this.generateUploadId();
    }
  }

  /**
   * 生成唯一的uploadId
   */
  private generateUploadId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * 上传单个分片（带超时和重试）
   */
  private async uploadChunkWithRetry(chunkIndex: number): Promise<void> {
    const maxRetries = this.retries;
    let retryCount = this.retryCountMap.get(chunkIndex) || 0;

    while (retryCount <= maxRetries) {
      try {
        // 注意：真正的超时控制需要在 UploadFile.upload 中支持 signal 参数
        // 当前实现通过 Promise.race 模拟超时
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(`分片 ${chunkIndex} 上传超时 (${this.timeout}ms)`),
            );
          }, this.timeout);
        });

        // 使用 Promise.race 实现超时控制
        await Promise.race([this.uploadChunk(chunkIndex), timeoutPromise]);

        // 上传成功，重置重试计数
        this.retryCountMap.set(chunkIndex, 0);
        return;
      } catch (error: any) {
        retryCount++;
        this.retryCountMap.set(chunkIndex, retryCount);

        if (retryCount > maxRetries) {
          console.error(
            `分片 ${chunkIndex} 上传失败，已达到最大重试次数 (${maxRetries})`,
          );
          this.failedChunks.push(chunkIndex);
          throw error;
        }

        // 指数退避策略：delay = baseDelay * 2^(retryCount-1)
        const delay = this.retryDelay * Math.pow(2, retryCount - 1);
        console.log(
          `分片 ${chunkIndex} 上传失败，${delay}ms 后第 ${retryCount}/${maxRetries} 次重试...`,
        );
        await sleep(delay);
      }
    }
  }

  /**
   * 上传单个分片
   */
  private async uploadChunk(chunkIndex: number): Promise<void> {
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.uploadFile.File.size);
    const chunk = this.uploadFile.File.slice(start, end);
    const chunkSizeValue = chunk.size;

    console.log(`开始上传分片 ${chunkIndex + 1}/${this.totalChunks}`, {
      chunkIndex,
      chunkSize: chunk.size,
      start,
      end,
      uploadId: this.uploadId,
    });

    try {
      await this.uploadFile.upload(
        (res) => {
          // 完成的分片
          this.completedChunks++;
          this.totalUploadedSize += chunkSizeValue;
          this.uploadedChunks[chunkIndex] = true;

          // 从失败列表中移除
          const failIndex = this.failedChunks.indexOf(chunkIndex);
          if (failIndex > -1) {
            this.failedChunks.splice(failIndex, 1);
          }

          // 如果启用了断点续传，定期保存进度
          if (this.enableResume) {
            this.saveProgress();
          }

          if (this.completedChunks === this.totalChunks) {
            this.checkStatistics(res);
          }
        },
        chunkIndex,
        this.uploadId,
      );
    } catch (error) {
      console.error(
        `分片文件${this.uploadFile.File.name}上传失败,当前分片下标${chunkIndex}`,
      );
      this.uploadedChunks[chunkIndex] = false;
      throw error;
    }
  }

  /**
   * 合并所有分片
   */
  private async mergeChunks(): Promise<any> {
    const up = this.uploadFile.__uploader__;

    console.log(`开始合并分片, uploadId: ${this.uploadId}`);

    try {
      // 调用用户提供的合并回调
      const onMerge = up.onMergeCallback;
      if (onMerge) {
        const response = await onMerge(
          this.uploadFile,
          this.uploadId,
          this.fileHash,
          this.totalChunks,
        );

        console.log("分片合并成功", response);

        // 清除保存的进度
        if (this.enableResume) {
          this.clearProgress();
        }

        return response;
      } else {
        // 如果没有提供onMerge回调，直接认为成功
        console.warn("未提供 onMerge 回调，跳过合并步骤");

        // 清除保存的进度
        if (this.enableResume) {
          this.clearProgress();
        }

        return undefined;
      }
    } catch (error) {
      console.error("分片合并失败:", error);
      throw error;
    }
  }

  /**
   * 检查统计信息并触发合并
   */
  private async checkStatistics(res: any) {
    // 计算总耗时
    this.uploadEndTime = performance.now();
    this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;

    // 检查结果
    const allSuccess = this.uploadedChunks.every((uploaded) => uploaded);

    if (allSuccess) {
      // 所有分片上传成功，调用合并接口
      try {
        const mergeResult = await this.mergeChunks();
        this.uploadFile.onScuccess(mergeResult);
      } catch (error) {
        this.uploadFile.onError(error);
        return;
      }

      // 添加上传统计信息
      this.uploadStatsInfos = {
        totalTime: this.totalUploadTime,
        fileSize: this.uploadFile.File.size,
        completedChunks: this.completedChunks,
        averageSpeed:
          this.uploadFile.File.size / (this.totalUploadTime / 1000) / 1024, // KB/s
      };

      const timeText = `总耗时: ${(this.totalUploadTime / 1000).toFixed(
        2,
      )}秒, 平均速度: ${this.uploadStatsInfos.averageSpeed.toFixed(2)} KB/s`;

      console.log(`🎉 上传完成! ${timeText}`);
      console.log("上传统计:", this.uploadStatsInfos);

      console.log(`上传文件 ${this.uploadFile.File.name} 完成 ${timeText}`);
    } else {
      // 有分片失败，尝试重试
      if (this.failedChunks.length > 0) {
        console.log(`发现 ${this.failedChunks.length} 个失败分片，尝试重试...`);
        await this.retryFailedChunks();
      } else {
        this.uploadFile.onError(new Error("部分分片上传失败"));
      }
    }
  }

  /**
   * 重试失败的分片
   */
  public async retryFailedChunks(): Promise<void> {
    const failedChunksCopy = [...this.failedChunks];
    this.failedChunks = [];

    for (const chunkIndex of failedChunksCopy) {
      try {
        await this.uploadChunkWithRetry(chunkIndex);
      } catch (error) {
        console.error(`重试分片 ${chunkIndex} 仍然失败`);
        this.failedChunks.push(chunkIndex);
      }
    }

    // 如果还有失败的，再次检查
    if (this.failedChunks.length > 0) {
      console.error(`仍有 ${this.failedChunks.length} 个分片上传失败`);
      this.uploadFile.onError(
        new Error(`${this.failedChunks.length} 个分片上传失败`),
      );
    }
  }

  /**
   * 保存上传进度到本地存储
   */
  private saveProgress(): void {
    if (!this.enableResume) return;

    const progressData = {
      uploadId: this.uploadId,
      fileHash: this.fileHash,
      fileName: this.uploadFile.fileName,
      fileSize: this.uploadFile.File.size,
      uploadedChunks: this.uploadedChunks,
      completedChunks: this.completedChunks,
      timestamp: Date.now(),
    };

    try {
      localStorage.setItem(
        `upload_progress_${this.fileHash}`,
        JSON.stringify(progressData),
      );
    } catch (error) {
      console.warn("保存上传进度失败:", error);
    }
  }

  /**
   * 从本地存储加载上传进度
   */
  private loadProgress(): any {
    if (!this.enableResume) return null;

    try {
      const data = localStorage.getItem(`upload_progress_${this.fileHash}`);
      if (data) {
        const progress = JSON.parse(data);
        // 检查是否是同一个文件（通过哈希和大小）
        if (
          progress.fileHash === this.fileHash &&
          progress.fileSize === this.uploadFile.File.size
        ) {
          return progress;
        }
      }
    } catch (error) {
      console.warn("加载上传进度失败:", error);
    }
    return null;
  }

  /**
   * 清除保存的上传进度
   */
  private clearProgress(): void {
    if (!this.enableResume) return;

    try {
      localStorage.removeItem(`upload_progress_${this.fileHash}`);
      console.log("已清除上传进度缓存");
    } catch (error) {
      console.warn("清除上传进度失败:", error);
    }
  }

  /**
   * 取消上传
   */
  public cancelUpload(): void {
    // 清除进度保存定时器
    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
    }

    console.log("上传已取消");
  }

  /**
   * 暂停上传
   * 
   * 暂停所有正在进行的分片上传,但保持当前进度。
   * 对于普通上传,会中止 XHR 请求。
   * 对于分片上传,会等待当前活跃的分片完成后暂停新分片的启动。
   * 
   * @example
   * ```typescript
   * file.pause();
   * console.log(file.status); // "paused"
   * ```
   */
  public pause(): void {
    if (this.isPaused) {
      console.warn("上传已处于暂停状态");
      return;
    }

    this.isPaused = true;
    this.uploadFile.proxy.status = "paused";
    
    console.log(`⏸️ 上传已暂停 (${this.uploadFile.fileName})`);

    // 如果是普通上传(没有 ChunkManager),直接 abort
    if (!this.uploadFile.chunkManager || this.uploadFile.chunkManager === this) {
      // 检查是否是普通上传(通过检查是否有 chunkIndex 参数)
      const isChunkedUpload = this.uploadId !== "";
      
      if (!isChunkedUpload && this.uploadFile.abort) {
        this.uploadFile.abort();
        console.log("普通上传已中止");
      }
    }
  }

  /**
   * 恢复上传
   * 
   * 从暂停的位置继续上传。
   * 对于分片上传,会继续上传未完成的分片。
   * 对于普通上传,需要重新开始(因为 XHR 无法恢复)。
   * 
   * @example
   * ```typescript
   * file.resume();
   * console.log(file.status); // "uploading"
   * ```
   */
  public async resume(): Promise<void> {
    if (!this.isPaused) {
      console.warn("上传未处于暂停状态");
      return;
    }

    this.isPaused = false;
    this.uploadFile.proxy.status = "uploading";
    
    console.log(`▶️ 上传已恢复 (${this.uploadFile.fileName})`);

    // 如果是分片上传,继续上传剩余分片
    if (this.uploadId) {
      // 检查是否还有未完成的分片
      const hasUnfinishedChunks = this.uploadedChunks.some(uploaded => !uploaded);
      
      if (hasUnfinishedChunks) {
        console.log("继续上传剩余分片...");
        await this.startUpload();
      } else {
        console.log("所有分片已完成,执行合并...");
        await this.mergeChunks();
      }
    } else {
      // 普通上传无法恢复,需要重新开始
      console.warn("普通上传无法恢复,将重新开始上传");
      this.uploadFile.rest();
    }
  }

  /**
   * 检查是否处于暂停状态
   * @returns 是否暂停
   */
  public getPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 等待直到不再暂停(用于异步流程中的暂停检查)
   * @returns Promise,当恢复时 resolve
   */
  private async waitForResume(): Promise<void> {
    if (!this.isPaused) {
      return;
    }

    return new Promise((resolve) => {
      this.pauseResolve = resolve;
    });
  }

  public updateProgress(
    progressEvent: ProgressEvent | AxiosProgressEvent,
  ): number {
    const completedSize = this.completedChunks * this.chunkSize; // 已完成分片的总大小
    const currentChunkProgress = progressEvent.loaded; // 当前分片已上传大小
    const totalUploaded = completedSize + currentChunkProgress;

    // 计算并更新全局上传速率
    this.calculateAndUpdateSpeed(totalUploaded);

    return Math.round((totalUploaded * 100) / this.uploadFile.File.size);
  }

  /**
   * 计算并更新全局上传速率
   * @param currentUploadedBytes 当前已上传字节数
   */
  private calculateAndUpdateSpeed(currentUploadedBytes: number): void {
    const now = performance.now();

    // 首次调用，初始化基准值
    if (this.lastUpdateTime === 0) {
      this.lastUpdateTime = now;
      this.lastUploadedBytes = currentUploadedBytes;
      return;
    }

    // 计算时间差（秒）
    const timeDiff = (now - this.lastUpdateTime) / 1000;

    // 避免除以零或时间间隔过短(防抖)
    if (timeDiff < 0.1) {
      return;
    }

    // 计算字节差
    const bytesDiff = currentUploadedBytes - this.lastUploadedBytes;

    // 计算瞬时速度 (bytes/s)
    const currentSpeed = timeDiff > 0 ? bytesDiff / timeDiff : 0;

    // 计算平均速度：总上传字节数 / 总耗时
    const totalTime = (now - this.uploadStartTime) / 1000;
    const averageSpeed = totalTime > 0 ? currentUploadedBytes / totalTime : 0;

    // 更新全局静态属性
    this.uploadFile.__uploader__.uploadSpeed = {
      currentSpeed,
      averageSpeed,
      currentSpeedFormatted: formatSpeed(currentSpeed),
      averageSpeedFormatted: formatSpeed(averageSpeed),
    };

    // 更新基准值
    this.lastUpdateTime = now;
    this.lastUploadedBytes = currentUploadedBytes;
  }

  public async startUpload() {
    console.log(`开始上传，最大并发数: ${this.maxConcurrent}`);

    // 第一步：初始化上传（获取uploadId、检查已上传分片）
    await this.initUpload();

    // 如果所有分片都已上传，直接合并
    if (this.completedChunks === this.totalChunks) {
      console.log("所有分片已上传，直接合并");
      await this.mergeChunks();
      return;
    }

    const chunkStartTimes: number[] = []; // 记录每个分片开始时间
    const chunkDurations: number[] = []; // 记录每个分片耗时

    // 启动进度自动保存（如果启用断点续传）
    if (this.enableResume) {
      this.progressSaveTimer = setInterval(() => {
        this.saveProgress();
      }, 5000); // 每5秒保存一次
    }

    try {
      // 使用信号量控制并发
      await this.uploadWithConcurrency(chunkStartTimes, chunkDurations);

      // 清除进度保存定时器
      if (this.progressSaveTimer) {
        clearInterval(this.progressSaveTimer);
      }

      // 检查是否有失败的分片
      if (this.failedChunks.length > 0) {
        console.log(`发现 ${this.failedChunks.length} 个失败分片，尝试重试...`);
        await this.retryFailedChunks();
      }
    } catch (error) {
      // 错误时也记录耗时
      this.uploadEndTime = performance.now();
      this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;
      console.error(
        `上传过程发生错误，总耗时: ${(this.totalUploadTime / 1000).toFixed(
          2,
        )}秒`,
        error,
      );
      this.uploadFile.onError(error);
      return;
    }

    // 统计信息
    const completedDurations = chunkDurations.filter(
      (duration) => duration > 0,
    );
    if (completedDurations.length > 0) {
      const avgChunkTime =
        completedDurations.reduce((a, b) => a + b, 0) /
        completedDurations.length;
      const maxChunkTime = Math.max(...completedDurations);
      const minChunkTime = Math.min(...completedDurations);
      console.log(
        `平均分片耗时 ${avgChunkTime.toFixed(
          2,
        )}ms, 最慢分片 ${maxChunkTime.toFixed(
          2,
        )}ms, 最快分片 ${minChunkTime.toFixed(2)}ms`,
      );
    }
  }

  /**
   * 使用信号量控制并发上传
   */
  private async uploadWithConcurrency(
    chunkStartTimes: number[],
    chunkDurations: number[],
  ): Promise<void> {
    const pendingChunks: number[] = [];

    // 收集未上传的分片
    for (let i = 0; i < this.totalChunks; i++) {
      if (!this.uploadedChunks[i]) {
        pendingChunks.push(i);
      }
    }

    console.log(`待上传分片数: ${pendingChunks.length}`);

    // 使用队列控制并发
    const queue: Promise<void>[] = [];

    for (const chunkIndex of pendingChunks) {
      // 检查是否暂停,如果暂停则等待恢复
      await this.waitForResume();

      // 再次检查,防止在等待期间被取消
      if (this.uploadFile.proxy.status === "cancelled" || 
          this.uploadFile.proxy.status === "error") {
        console.log("上传已取消或出错,停止后续分片上传");
        return;
      }

      this.uploadedChunkIndex = chunkIndex + 1;

      // 记录分片开始时间
      chunkStartTimes[chunkIndex] = performance.now();

      const promise = this.uploadChunkWithRetry(chunkIndex)
        .then(() => {
          // 记录分片耗时
          chunkDurations[chunkIndex] =
            performance.now() - chunkStartTimes[chunkIndex];
          console.log(
            `分片 ${chunkIndex} 耗时: ${chunkDurations[chunkIndex].toFixed(2)}ms`,
          );
        })
        .catch((error) => {
          console.error(`分片 ${chunkIndex} 最终上传失败:`, error);
          throw error;
        });

      queue.push(promise);

      // 当达到最大并发数时，等待最早的任务完成
      if (queue.length >= this.maxConcurrent) {
        console.log(`达到并发限制 ${this.maxConcurrent}，等待任务完成...`);
        // 等待任意一个任务完成
        await Promise.race(queue);
        // 检查批次内所有任务状态并清空队列
        await Promise.allSettled(queue);
        queue.length = 0;
      }
    }

    // 等待所有剩余任务完成
    if (queue.length > 0) {
      console.log("等待剩余分片上传完成...");
      await Promise.allSettled(queue);
    }

    console.log("所有分片上传完成");
  }
}
