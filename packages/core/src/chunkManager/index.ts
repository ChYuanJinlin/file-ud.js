import PQueue from "p-queue";
import { ChunkOptions } from "../types";
import TransferFile from "../transfer/TransferFile";
import { formatFileSize, formatSpeed, computeTransferTime, logger } from "../utils";

/**
 * 分片管理器基类
 *
 * 提取上传/下载分片管理器的所有公共逻辑：
 * - 并发分片传输调度
 * - 暂停/恢复/取消
 * - 重试机制（含 AbortController + 超时）
 * - 进度计算 & 速率统计
 * - 分片完成/失败后的事件触发与状态聚合
 *
 * 子类只需实现以下抽象方法：
 * - {@link getTag}      日志标签
 * - {@link getTransferFile}  关联的传输文件实例
 * - {@link doInit}      初始化传输（获取已传分片列表等）
 * - {@link doChunkTransfer}  执行单个分片的实际传输
 * - {@link doMergeChunks}    合并所有分片
 */
export default abstract class ChunkManager<
  T extends TransferFile<T> = TransferFile<any, any>,
> {
  chunkSize: number = 0;
  maxConcurrent: number = 5;
  public chunkIndex: number = 0;
  retries: number | null = 0;
  retryDelay: number = 1000;
  timeout: number = 30000;
  chunk: Blob | null = null;

  public totalChunks: number = 0;
  public chunks: boolean[] = [];
  public chunkEndTime = 0;
  public completedChunks = 0;
  public totalChunkTime = 0;
  public response: any = null;
  public queue: PQueue | null = null;
  public chunkStartTime = performance.now();

  public chunkStatsInfos: {
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

  totalChunkSize: number = 0;
  config: ChunkOptions;

  public countedChunks: Set<number> = new Set();

  public fileHash: string = "";
  public failedChunks: number[] = [];
  public retryCountMap: Map<number, number> = new Map();
  public isPaused: boolean = false;
  public isCancelled: boolean = false;
  public pauseResolves: Array<() => void> = [];
  public activeUploads: Set<Promise<void>> = new Set();
  public abortControllers: AbortController[] = [];
  public lastUpdateTime: number = 0;
  public lastChunkBytes: number = 0;

  public chunkStats: {
    averageTime: number;
    maxTime: number;
    minTime: number;
  } | null = null;

  /** 是否秒传/秒下（无需实际传输，文件已在目标端） */
  public isInstantTransfer = false;

  /** 关联的传输文件（UploadFile / DownloadFile） */
  protected transferFile: T;

  // ==================== 抽象方法（子类必须实现） ====================

  /** 日志标签，如 "uploadChunkManager" / "DownloadChunkManager" */
  protected abstract getTag(): string;

  /** 计算文件唯一标识：上传=本地MD5，下载=服务端Hash / 指纹 */
  protected abstract computeFileIdentifier(): Promise<string>;

  /** 返回关联的传输文件实例 */
  protected getTransferFile(): T {
    return this.transferFile;
  }

  /** 初始化传输：检查已上传/已下载分片（断点续传） */
  protected abstract doInit(): Promise<any>;

  /** 执行单个分片的实际传输（上传/下载） */
  protected abstract doChunkTransfer(
    chunkIndex: number,
    signal?: AbortSignal,
  ): Promise<{ data: any; chunkSize: number }>;

  /** 合并所有分片 */
  protected abstract doMergeChunks(): Promise<any>;

  // ==================== 可选钩子（子类覆写） ====================

  /** start() 重置后的额外清理，如下载场景清空 downloadedChunks */
  protected doAfterStartReset(): void {}

  /** 分片传输成功后保存结果数据（上传存 response，下载存 blob 到 Map / 流式写入磁盘） */
  protected async doSaveChunkResult(_chunkIndex: number, _data: any): Promise<void> {}

  /** onSuccess 之前的额外操作，如下载场景调用 saveBlob */
  protected async doBeforeOnSuccess(_mergeResult: any): Promise<void> {}

  /** start() 发现所有分片已完成时的处理（上传需区分秒传/断点续传） */
  protected async doOnAllChunksAlreadyDone(_initResult: any): Promise<void> {
    await this.completeMerge();
  }

  // ==================== 通用 Helper（子类在 doInit 中复用） ====================

  /**
   * 标记所有分片为已完成（秒传/秒下、服务端已存在全部分片）
   */
  protected applyAllChunksComplete(fileSize: number): void {
    this.completedChunks = this.totalChunks;
    this.totalChunkSize = fileSize;
    this.chunks = new Array(this.totalChunks).fill(true);
    this.countedChunks = new Set(
      Array.from({ length: this.totalChunks }, (_, i) => i),
    );
    this.getTransferFile().proxy.percent = 100;
  }

  /**
   * 断点续传恢复：从 initResult.chunks 标记已完成的分片
   * @param initResult - 服务端返回的初始化结果，包含 chunks 数组
   */
  protected applyBreakpointResume(initResult: {
    chunks?: number[] | null;
  }): void {
    if (!initResult.chunks || !Array.isArray(initResult.chunks) || initResult.chunks.length === 0) {
      return;
    }

    this.completedChunks = 0;
    initResult.chunks.forEach((index: number) => {
      if (index >= 0 && index < this.totalChunks && !this.chunks[index]) {
        this.chunks[index] = true;
        this.completedChunks++;
        this.countedChunks.add(index);
        this.totalChunkSize += this.chunkSize;
      }
    });
    this.updateProgress();

    const tr = this.getTransferFile().transfer;
    tr.updateGlobalStats();
    tr.triggerUpdate();
  }

  // ==================== 构造函数 ====================

  constructor(ChunkOptions: ChunkOptions, file: T) {
    this.config = ChunkOptions;
    this.transferFile = file;
    this.chunkSize = ChunkOptions.chunkSize ?? 1024 * 1024 * 5;
    this.maxConcurrent = ChunkOptions.maxConcurrent ?? 5;
    this.retries =
      ChunkOptions.retries !== undefined ? ChunkOptions.retries : 5;
    this.retryDelay = ChunkOptions.retryDelay ?? 1000;
    this.timeout = ChunkOptions.timeout ?? 30000;
    this.totalChunks = Math.ceil(file.getFileSize() / this.chunkSize);
    this.chunks = [];
    this.completedChunks = 0;
  }

  // ==================== 生命周期控制 ====================

  /**
   * 暂停传输（上传/下载统一实现）
   */
  public pause(): void {
    if (this.isPaused) return;

    this.isPaused = true;
    const file = this.getTransferFile();
    file.proxy.status = "paused";
    logger.info(this.getTag(), `文件 ${file.fileName} 已暂停`, {
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
    });
  }

  /**
   * 恢复传输（上传/下载统一实现）
   */
  public async resume(): Promise<void> {
    if (!this.isPaused) return;

    this.isPaused = false;
    const file = this.getTransferFile();
    file.proxy.status = "UDLoading";

    file.transfer.emit("resume", file.proxy as any);

    logger.info(this.getTag(), `文件 ${file.fileName} 已恢复`, {
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
    });

    // 唤醒等待中的分片传输任务
    if (this.pauseResolves.length > 0) {
      this.pauseResolves.forEach((resolve) => resolve());
      this.pauseResolves = [];
    }
  }

  /**
   * 取消传输（上传/下载统一实现）
   */
  public cancel(): void {
    const file = this.getTransferFile();
    logger.info(this.getTag(), `取消文件 ${file.fileName} 的传输`, {
      activeControllers: this.abortControllers.length,
    });

    this.isCancelled = true;

    // 中止所有活跃的 HTTP 请求
    this.abortControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch (_error) {}
    });
    this.abortControllers = [];

    // 阻止新分片启动
    this.isPaused = true;

    // 唤醒等待中的分片
    if (this.pauseResolves.length > 0) {
      this.pauseResolves.forEach((resolve) => resolve());
      this.pauseResolves = [];
    }

    this.activeUploads.clear();

    file.proxy.status = "cancelled";
    file.transfer.emit("cancel", file.proxy as any);
  }

  /**
   * 是否处于暂停状态
   */
  public getPaused(): boolean {
    return this.isPaused;
  }

  /**
   * 获取失败分片的数量
   */
  public getFailedChunksCount(): number {
    return this.failedChunks.length;
  }

  // ==================== 进度 & 速率 ====================

  /**
   * 更新传输进度百分比
   */
  public updateProgress(): void {
    if (this.totalChunks === 0) {
      this.getTransferFile().proxy.percent = 100;
      return;
    }

    let percent = Math.floor((this.completedChunks / this.totalChunks) * 100);
    percent = Math.min(100, Math.max(0, percent));

    // 🔑 分片传输阶段进度最高 99%，100% 留给合并完成后
    if (this.completedChunks >= this.totalChunks) {
      percent = 99;
    }

    this.getTransferFile().proxy.percent = percent;
    this.calculateAndUpdateSpeed(this.totalChunkSize);
  }

  /**
   * 计算并触发全局速率更新
   */
  protected calculateAndUpdateSpeed(currentTransferredBytes: number): void {
    const now = performance.now();

    if (this.lastUpdateTime === 0 || this.lastUpdateTime > now) {
      this.lastUpdateTime = now;
      this.lastChunkBytes = currentTransferredBytes;
      return;
    }

    const timeDiff = (now - this.lastUpdateTime) / 1000;
    if (timeDiff < 0.1) return;

    this.getTransferFile().transfer.triggerUpdate();

    this.lastUpdateTime = now;
    this.lastChunkBytes = currentTransferredBytes;
  }

  /**
   * 计算传输统计信息
   */
  protected calculateStats(): void {
    const fileSize = this.getTransferFile().getFileSize();
    this.chunkStatsInfos = {
      totalTime: this.totalChunkTime,
      fileSize,
      completedChunks: this.completedChunks,
      averageSpeed: fileSize / (this.totalChunkTime / 1000) / 1024,
    };
  }

  // ==================== 核心传输流程 ====================

  /**
   * 统一的 entry：启动分片传输
   */
  public async start(): Promise<void> {
    const file = this.getTransferFile();

    // 触发开始事件（由子类覆写 getStartEventName 指定事件名）
    (file.transfer as any).emit(this.getStartEventName(), {
      file: file.proxy,
      totalChunks: this.totalChunks,
      chunkSize: this.chunkSize,
    });

    // 重置所有状态
    this.totalChunkSize = 0;
    (file as any).__transferBytes__ = 0;
    this.chunkStartTime = performance.now();
    this.countedChunks.clear();
    this.lastUpdateTime = 0;
    this.lastChunkBytes = 0;
    this.isCancelled = false;
    this.isPaused = false;
    this.doAfterStartReset();

    // 重新创建 PQueue
    this.queue = new PQueue({ concurrency: this.maxConcurrent });

    // 初始化全局字节统计
    if (!(file as any).__hasCountedTotalBytes__) {
      const tr = file.transfer;
      tr.totalTransferredBytes += file.getFileSize();
      tr.totalBytes += file.getFileSize();
      tr.totalFormatSize = formatFileSize(tr.totalBytes);
      (file as any).__hasCountedTotalBytes__ = true;
    }

    this.timeout = Math.max(this.timeout, 60000);

    // 🔑 在 doInit() 之前就设置 startTime，确保所有路径（普通 / 已全完成 / 异常）都有合法起始时间
    computeTransferTime(file.proxy.transferTime).start();

    try {
      const res = await this.doInit();

      if (this.completedChunks === this.totalChunks) {
        await this.doOnAllChunksAlreadyDone(res);
        return;
      }

      // 标记文件状态为传输中（分片传输路径统一入口，普通传输由子类在 download/upload 方法中设置）
      file.proxy.status = "UDLoading";

      await this.transferWithConcurrency();

      await this.checkStatistics();
    } catch (error) {
      await this.checkStatistics();
      this.chunkEndTime = performance.now();
      this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;
      if (this.failedChunks.length > 0) throw error;
    } finally {
      // 🔑 finally 确保所有出口（正常返回 / 早期 return / 异常）都会记录结束时间
      computeTransferTime(file.proxy.transferTime).end();
    }
  }

  /** 子类覆写以返回不同的开始事件名 */
  protected getStartEventName(): string {
    return "chunk-transfer-start";
  }

  /**
   * 重试失败的分片
   */
  public async retryFailedChunks(): Promise<void> {
    this.isCancelled = false;
    this.isPaused = false;

    const failedChunksCopy = [...this.failedChunks];
    this.failedChunks = [];

    for (const chunkIndex of failedChunksCopy) {
      this.retryCountMap.set(chunkIndex, 0);
      try {
        await this.chunkWithRetry(chunkIndex);
      } catch (_error) {
        this.failedChunks.push(chunkIndex);
      }
    }

    await this.checkStatistics();
  }

  /**
   * 带超时 & 重试机制的单个分片传输
   */
  protected async chunkWithRetry(chunkIndex: number): Promise<void> {
    const maxRetries = this.retries;
    let retryCount = this.retryCountMap.get(chunkIndex) || 0;

    const executeOnce = async (): Promise<void> => {
      const abortController = new AbortController();
      this.abortControllers.push(abortController);

      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, this.timeout);

      try {
        const result = await this.doChunkTransfer(chunkIndex, abortController.signal);
        clearTimeout(timeoutId);
        this.removeAbortController(abortController);

        // 处理分片成功
        await this.handleChunkSuccess(chunkIndex, result);
      } catch (error) {
        clearTimeout(timeoutId);
        this.removeAbortController(abortController);

        // 处理分片失败
        this.handleChunkError(chunkIndex, error);
        throw error;
      }
    };

    // 禁用自动重试
    if (maxRetries === null) {
      try {
        await executeOnce();
        this.retryCountMap.set(chunkIndex, 0);
        return;
      } catch (error) {
        this.failedChunks.push(chunkIndex);
        this.setFileStatusToFail();
        throw error;
      }
    }

    // 正常重试循环
    while (retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          logger.warn(
            this.getTag(),
            `分片 ${chunkIndex + 1}/${this.totalChunks} 第 ${retryCount} 次重试`,
          );
        }

        await executeOnce();
        this.retryCountMap.set(chunkIndex, 0);

        if (retryCount > 0) {
          logger.info(
            this.getTag(),
            `分片 ${chunkIndex + 1}/${this.totalChunks} 重试成功（共 ${retryCount} 次）`,
          );
        }
        return;
      } catch (_error: any) {
        retryCount++;
        this.retryCountMap.set(chunkIndex, retryCount);

        if (retryCount > maxRetries) {
          this.failedChunks.push(chunkIndex);
          logger.error(
            this.getTag(),
            `分片 ${chunkIndex + 1}/${this.totalChunks} 最终失败（已重试 ${maxRetries} 次）`,
          );
          return;
        }

        // 指数退避
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 分片传输成功后的统一处理
   */
  protected async handleChunkSuccess(
    chunkIndex: number,
    result: { data: any; chunkSize: number },
  ): Promise<void> {
    const file = this.getTransferFile();

    if (!this.chunks[chunkIndex]) {
      // 保存分片结果（子类钩子）
      await this.doSaveChunkResult(chunkIndex, result.data);
      this.response = result.data;

      this.chunks[chunkIndex] = true;
      this.totalChunkSize += result.chunkSize;
      this.completedChunks++;
      this.countedChunks.add(chunkIndex);

      this.updateProgress();

      file.transfer.emit("chunk-success", {
        chunkIndex,
        totalChunks: this.totalChunks,
        completedChunks: this.completedChunks,
        percent: file.proxy.percent || 0,
        file: file.proxy as any,
      });

      logger.info(
        this.getTag(),
        `分片 ${chunkIndex + 1}/${this.totalChunks} 传输成功`,
        {
          chunkIndex,
          completedChunks: this.completedChunks,
          totalChunks: this.totalChunks,
          percent: file.proxy.percent,
          size: result.chunkSize,
        },
      );
    }

    // 从失败列表移除
    const failIdx = this.failedChunks.indexOf(chunkIndex);
    if (failIdx > -1) {
      this.failedChunks.splice(failIdx, 1);
    }
  }

  /**
   * 分片传输失败后的统一处理
   */
  protected handleChunkError(chunkIndex: number, error: any): void {
    const file = this.getTransferFile();
    this.chunks[chunkIndex] = false;

    logger.error(
      this.getTag(),
      `分片 ${chunkIndex + 1}/${this.totalChunks} 传输失败`,
      {
        chunkIndex,
        error: error instanceof Error ? error.message : String(error),
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      },
    );

    file.transfer.emit("chunk-error", {
      chunkIndex,
      totalChunks: this.totalChunks,
      error: error instanceof Error ? error.message : String(error),
      file: file.proxy as any,
    });
  }

  /**
   * 并发传输所有分片
   */
  protected async transferWithConcurrency(): Promise<void> {
    const transferPromises: Promise<void>[] = [];
    const chunkStartTimes: number[] = [];
    const chunkDurations: number[] = [];

    if (!this.queue) {
      throw new Error("PQueue not initialized. Call start() first.");
    }

    for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
      if (this.isCancelled) {
        logger.info(this.getTag(), "检测到取消标志，停止入队新分片", {
          currentChunk: chunkIndex,
          totalChunks: this.totalChunks,
        });
        break;
      }

      // 跳过已传输的分片
      if (this.chunks[chunkIndex]) {
        continue;
      }

      this.chunkIndex = chunkIndex + 1;

      transferPromises.push(
        this.queue.add(async () => {
          await this.waitForResume();

          chunkStartTimes[chunkIndex] = performance.now();

          try {
            await this.chunkWithRetry(chunkIndex);
            chunkDurations[chunkIndex] =
              performance.now() - chunkStartTimes[chunkIndex];
          } catch (_error) {
            if (chunkStartTimes[chunkIndex]) {
              chunkDurations[chunkIndex] =
                performance.now() - chunkStartTimes[chunkIndex];
            }
            throw _error;
          }
        }),
      );
    }

    await Promise.allSettled(transferPromises);

    // 计算分片耗时统计
    const validDurations = chunkDurations.filter((d) => d > 0);
    this.chunkStats = {
      averageTime:
        validDurations.reduce((a, b) => a + b, 0) / validDurations.length || 0,
      maxTime: Math.max(...validDurations, 0),
      minTime: Math.min(...validDurations, Infinity),
    };
  }

  // ==================== 统计检查 & 合并 ====================

  /**
   * 检查统计信息并触发合并或失败处理
   */
  protected async checkStatistics(): Promise<void> {
    this.chunkEndTime = performance.now();
    this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;

    const allSuccess = this.completedChunks === this.totalChunks;

    logger.debug(this.getTag(), "检查统计信息", {
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
      allSuccess,
      failedChunks: this.failedChunks.length,
    });

    if (allSuccess) {
      await this.handleAllChunksSuccess();
    } else if (this.failedChunks.length > 0) {
      await this.handleFailedChunks();
    } else {
      logger.warn(this.getTag(), "传输未完成", {
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      });
    }
  }

  /**
   * 处理所有分片成功
   */
  protected async handleAllChunksSuccess(): Promise<void> {
    const file = this.getTransferFile();
    const fileSize = file.getFileSize();

    this.calculateAndUpdateSpeed(fileSize);

    // 更新文件速率
    const totalTime = (performance.now() - this.chunkStartTime) / 1000;
    const averageSpeed = totalTime > 0 ? fileSize / totalTime : 0;
    file.proxy.speed = {
      currentSpeed: 0,
      averageSpeed,
      currentSpeedFormatted: "0 B/s",
      averageSpeedFormatted: formatSpeed(averageSpeed),
    };

    try {
      // 🔑 分片全部传输完成，进入合并阶段
      file.proxy.status = "merging";
      file.transfer.emit("merging", {
        file: file.proxy,
        completedChunks: this.completedChunks,
        totalChunks: this.totalChunks,
      });

      const mergeResult = await this.doMergeChunks();

      await this.doBeforeOnSuccess(mergeResult);

      // 🔑 合并 + 保存全部完成后才推到 100%
      file.proxy.percent = 100;

      file.onSuccess(mergeResult);
    } catch (error) {
      file.onError(error);
    }

    this.calculateStats();
  }

  /**
   * 处理失败分片
   */
  protected async handleFailedChunks(): Promise<void> {
    const file = this.getTransferFile();

    if (this.retries === null) {
      logger.warn(
        this.getTag(),
        `发现 ${this.failedChunks.length} 个失败分片，自动重试已禁用`,
      );
      file.onError(new Error("部分分片传输失败"));
      return;
    }

    logger.warn(
      this.getTag(),
      `发现 ${this.failedChunks.length} 个失败分片，开始自动重试`,
    );
    await this.retryFailedChunks();

    if (this.failedChunks.length > 0) {
      file.onError(new Error("部分分片传输失败，重试后仍未成功"));
    } else {
      await this.checkStatistics();
    }
  }

  // ==================== 辅助方法 ====================

  /**
   * 设置文件状态为失败
   */
  protected setFileStatusToFail(): void {
    if (this.retries === null) {
      setTimeout(() => {
        this.getTransferFile().proxy.status = "fail";
      }, 0);
    }
  }

  /**
   * 等待恢复（暂停/恢复机制）
   */
  protected async waitForResume(): Promise<void> {
    if (!this.isPaused) return;

    await new Promise<void>((resolve) => {
      this.pauseResolves.push(() => resolve());
    });

    if (this.isCancelled) {
      logger.info(this.getTag(), "分片传输被取消，停止执行");
      throw new Error("Transfer cancelled");
    }
  }

  /**
   * 从活跃控制器列表中移除指定的 AbortController
   */
  protected removeAbortController(controller: AbortController): void {
    const idx = this.abortControllers.indexOf(controller);
    if (idx > -1) this.abortControllers.splice(idx, 1);
  }

  /**
   * 合并完成后的收尾（可分片数量完整时直接走合并流程）
   */
  protected async completeMerge(): Promise<void> {
    const file = this.getTransferFile();

    // 🔑 进入合并阶段
    file.proxy.status = "merging";
    file.transfer.emit("merging", {
      file: file.proxy,
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
    });

    try {
      const mergeResult = await this.doMergeChunks();
      this.chunkEndTime = performance.now();
      this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;
      this.calculateStats();
      await this.doBeforeOnSuccess(mergeResult);

      // 🔑 合并 + 保存全部完成后才推到 100%
      file.proxy.percent = 100;

      file.onSuccess(mergeResult);
    } catch (error) {
      this.chunkEndTime = performance.now();
      this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;
      file.onError(error);
    }
  }
}
