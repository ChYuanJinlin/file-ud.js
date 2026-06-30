import PQueue from "p-queue";
import { ChunkOptions } from "../types";
import TransferFile from "../transfer/TransferFile";
import {
  formatDuration,
  formatFileSize,
  formatSpeed,
  computeTransferTime,
  logger,
} from "../utils";

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
  /** 最大速率限制（bytes/秒），0 = 不限制。下载场景由 maxDownloadSpeed 设置 */
  maxSpeed: number = 0;
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

  /** 每次 start() 递增的代数计数器，防止旧 run 的异步回调污染新 run 的状态 */
  private _startGeneration = 0;

  // ==================== 速率限制 ====================
  /** 速率限制：累计已传输字节数（用于限速计算） */
  private _throttleBytes: number = 0;
  /** 速率限制：起始时间戳 */
  private _throttleStartTime: number = 0;

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
  protected async doAfterStartReset(): Promise<void> {}

  /** 分片传输成功后保存结果数据（上传存 response，下载存 blob 到 Map / 流式写入磁盘） */
  protected async doSaveChunkResult(
    _chunkIndex: number,
    _data: any,
  ): Promise<void> {}

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
    if (
      !initResult.chunks ||
      !Array.isArray(initResult.chunks) ||
      initResult.chunks.length === 0
    ) {
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

    // 🔑 清空 PQueue 中所有排队任务，避免旧任务干扰新 run
    if (this.queue) {
      this.queue.clear();
      this.queue = null;
    }

    // 中止所有活跃的 HTTP 请求

    this.abortControllers.forEach((controller) => {
      try {
        controller.abort();
      } catch (_error) {
        console.log("🚀 ~ ChunkManager ~ cancel ~ _error:", _error);
      }
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

    const file = this.getTransferFile();
    const fileSize = file.getFileSize();
    const bytesDiff = currentTransferredBytes - this.lastChunkBytes;

    // 瞬时速度（bytes/s）
    const currentSpeed = (bytesDiff / timeDiff);
    // 平均速度（bytes/s）：基于 chunkStartTime 计算总耗时
    const totalElapsed = (now - this.chunkStartTime) / 1000;
    const averageSpeed = totalElapsed > 0
      ? currentTransferredBytes / totalElapsed
      : 0;

    // 预计剩余时间
    const remainingBytes = Math.max(0, fileSize - currentTransferredBytes);
    let estimatedTimeRemaining = -1;
    let estimatedTimeFormatted = "计算中...";

    if (averageSpeed > 0 && remainingBytes > 0) {
      estimatedTimeRemaining = Math.ceil(remainingBytes / averageSpeed);
      estimatedTimeFormatted = formatDuration(estimatedTimeRemaining * 1000);
    } else if (remainingBytes <= 0) {
      estimatedTimeRemaining = 0;
      estimatedTimeFormatted = "即将完成";
    }

    // 🔑 更新单文件的 speed 信息（分片传输期间原来不更新，导致列表行一直显示"计算中..."）
    file.proxy.speed = {
      currentSpeed,
      averageSpeed,
      currentSpeedFormatted: formatSpeed(currentSpeed),
      averageSpeedFormatted: formatSpeed(averageSpeed),
      estimatedTimeRemaining,
      estimatedTimeFormatted,
    };

    file.transfer.triggerUpdate();

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

    // 🔑 清除旧 PQueue 中的排队任务，避免干扰新 run
    if (this.queue) {
      this.queue.clear();
    }

    // 🔑 递增代数，使上一轮 cancel 残留的异步回调解散
    //    避免旧的 handleChunkSuccess/handleChunkError 在 reset 后仍修改状态
    const currentGen = ++this._startGeneration;

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
    // 重置限流状态
    this._throttleBytes = 0;
    this._throttleStartTime = 0;
    // 🔑 重置秒下/秒传标志，避免上一次 run 的 markInstantDownload() 残留影响
    //    新的 doInit() 会重新判断是否需要走秒下流程
    this.isInstantTransfer = false;
    // 🔑 清除取消后残留的失败分片记录（这些分片在 cancel 的异步清理中被标记为失败，
    //    但并未经过真正的错误重试），避免 checkStatistics() 误判。
    this.failedChunks = [];
    this.retryCountMap.clear();
    await this.doAfterStartReset();

    // 🔑 等待上次的 writable 完全关闭（下载场景），避免 createWritable 文件锁冲突
    //    若因锁冲突失败，错误会在 start() 的 catch 中被静默吞掉，导致重试无反应
    if (typeof (this as any).ensureWritableClosed === "function") {
      await (this as any).ensureWritableClosed();
    }

    // 🔑 doAfterStartReset 清空了 chunkBlobs 等数据，需同步重置分片完成状态
    //    后续 doInit() 会从服务端 / IndexedDB 恢复真实的已完成分片
    this.completedChunks = 0;
    this.chunks = new Array(this.totalChunks).fill(false);

    // 重新创建 PQueue
    // 🔑 必须标记 __v_skip=true，防止 Vue reactive() 包装 PQueue
    //    否则 PQueue v9 的 ES2022 私有字段（#queue, #idAssigner）无法通过 Vue Proxy 访问
    //    → TypeError: Cannot read private member from an object whose class did not declare it
    const queue = new PQueue({ concurrency: this.maxConcurrent });
    (queue as any).__v_skip = true;
    this.queue = queue;

    // 初始化全局字节统计
    if (!(file as any).__hasCountedTotalBytes__) {
      const tr = file.transfer;
      tr.totalTransferredBytes += file.getFileSize();
      tr.totalBytes += file.getFileSize();
      tr.totalFormatSize = formatFileSize(tr.totalBytes);
      (file as any).__hasCountedTotalBytes__ = true;
    }

    // 🔑 根据分片大小动态计算超时下限（假设最低网速 50 KB/s）
    //    20MB 分片 → 约 409 秒，1MB 分片 → 约 20 秒
    //    timeout 为 0 时跳过，永不超时
    if (this.timeout > 0) {
      const minTimeoutBySize = Math.ceil((this.chunkSize / 51200) * 1000);
      this.timeout = Math.max(this.timeout, 60000, minTimeoutBySize);
    }

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

      await this.transferWithConcurrency(currentGen);

      await this.checkStatistics();
    } catch (error) {
      await this.checkStatistics();
      this.chunkEndTime = performance.now();
      this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;
      // 🔑 无论是否有 failedChunks，始终向上抛出错误
      //    若没有 failedChunks（如 doInit 中 createWritable 失败），
      //    之前的实现会静默吞掉错误 → retry() 的 .catch() 永不触发 → 用户看不出任何反应
      throw error;
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
    // 🔑 递增代数，防止并发 start() 调用污染当前重试的状态变更
    const retryGen = ++this._startGeneration;
    this.isCancelled = false;
    this.isPaused = false;

    const failedChunksCopy = [...this.failedChunks];
    this.failedChunks = [];

    for (const chunkIndex of failedChunksCopy) {
      // 🔑 代数检查：如果 start() 在此期间被重新调用，立即停止重试
      if (this._startGeneration !== retryGen) break;

      this.retryCountMap.set(chunkIndex, 0);
      try {
        await this.chunkWithRetry(chunkIndex);
      } catch (_error) {
        if (this._startGeneration !== retryGen) break;
        this.failedChunks.push(chunkIndex);
      }
    }

    // 🔑 仅当代数仍然匹配时才触发统计检查（避免污染新 run）
    if (this._startGeneration === retryGen) {
      await this.checkStatistics();
    }
  }

  /**
   * 带超时 & 重试机制的单个分片传输
   */
  protected async chunkWithRetry(chunkIndex: number): Promise<void> {
    const maxRetries = this.retries;
    let retryCount = this.retryCountMap.get(chunkIndex) || 0;

    const executeOnce = async (): Promise<void> => {
      // 🔑 速率限流：传输前检查是否需要延迟
      await this.throttleBeforeChunk(this.chunkSize);

      const abortController = new AbortController();
      this.abortControllers.push(abortController);

      const timeoutId = this.timeout > 0
        ? setTimeout(() => {
            abortController.abort();
          }, this.timeout)
        : (null as any);

      try {
        const result = await this.doChunkTransfer(
          chunkIndex,
          abortController.signal,
        );
        if (timeoutId !== null) clearTimeout(timeoutId);
        this.removeAbortController(abortController);

        // 处理分片成功
        await this.handleChunkSuccess(chunkIndex, result);
      } catch (error) {
        if (timeoutId !== null) clearTimeout(timeoutId);
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
      // 🔑 每次重试前检查取消状态，避免取消后继续重试成功
      if (this.isCancelled) {
        logger.info(
          this.getTag(),
          `分片 ${chunkIndex + 1}/${this.totalChunks} 取消重试（传输已取消）`,
        );
        throw new Error("Transfer cancelled");
      }

      try {
        if (retryCount > 0) {
          logger.warn(
            this.getTag(),
            `分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 第 ${retryCount} 次重试`,
          );
        }

        await executeOnce();
        this.retryCountMap.set(chunkIndex, 0);

        if (retryCount > 0) {
          logger.info(
            this.getTag(),
            `分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 重试成功（共 ${retryCount} 次）`,
          );
        }
        return;
      } catch (_error: any) {
        retryCount++;
        this.retryCountMap.set(chunkIndex, retryCount);

        if (retryCount > maxRetries) {
          this.failedChunks.push(chunkIndex);
          this.setFileStatusToFail();
          logger.error(
            this.getTag(),
            `分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 最终失败（已重试 ${maxRetries} 次）`,
          );
          return;
        }

        // 指数退避（基数使用用户配置的 retryDelay，默认 1000ms）
        const baseDelay = this.retryDelay || 1000;
        const delay = Math.min(baseDelay * Math.pow(2, retryCount - 1), 10000);
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
    throw new Error(error);
  }

  /**
   * 并发传输所有分片
   *
   * @param startGen - 当前 start() 调用的代数，用于过滤上一轮残留的异步回调
   */
  protected async transferWithConcurrency(startGen?: number): Promise<void> {
    const transferPromises: Promise<void>[] = [];
    const chunkStartTimes: number[] = [];
    const chunkDurations: number[] = [];
    let queuedCount = 0;

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
      queuedCount++;

      const capturedChunkIndex = chunkIndex;
      transferPromises.push(
        this.queue.add(async () => {
          // 🔑 代数检查：如果 start() 被重新调用，跳过旧 run 的残留回调
          if (startGen !== undefined && this._startGeneration !== startGen) {
            return;
          }

          await this.waitForResume();

          chunkStartTimes[capturedChunkIndex] = performance.now();

          try {
            await this.chunkWithRetry(capturedChunkIndex);
            chunkDurations[capturedChunkIndex] =
              performance.now() - chunkStartTimes[capturedChunkIndex];
          } catch (_error) {
            if (chunkStartTimes[capturedChunkIndex]) {
              chunkDurations[capturedChunkIndex] =
                performance.now() - chunkStartTimes[capturedChunkIndex];
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

    // 更新文件速率（使用 checkStatistics 已算好的 totalChunkTime，避免 chunkStartTime 被重置导致失真）
    const totalTime = this.totalChunkTime / 1000;
    const averageSpeed = totalTime > 0 ? fileSize / totalTime : 0;
    file.proxy.speed = {
      currentSpeed: 0,
      averageSpeed,
      currentSpeedFormatted: "0 B/s",
      averageSpeedFormatted: formatSpeed(averageSpeed),
      estimatedTimeRemaining: 0,
      estimatedTimeFormatted: "已完成",
    };

    try {
      // 🔑 分片全部传输完成，进入合并阶段
      file.proxy.status = "merging";
      file.transfer.emit("merging", {
        file: file.proxy as any,
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

  // ==================== 速率限制 ====================

  /**
   * 下载速率限流：在传输每个分片前检查是否需要延迟
   *
   * 采用平均速率算法：累计已传输字节数 / 已用时间 必须 ≤ maxSpeed。
   * 如果当前速率超过限制，sleep 差值后继续。
   *
   * @param chunkSize - 待传输分片的预计大小（字节）
   */
  protected async throttleBeforeChunk(chunkSize: number): Promise<void> {
    if (this.maxSpeed <= 0) return;

    const now = performance.now();

    if (this._throttleStartTime === 0) {
      this._throttleStartTime = now;
      this._throttleBytes = 0;
    }

    // 预累加本分片大小
    this._throttleBytes += chunkSize;

    // 理想耗时（ms）= 累计字节数 / 目标速率 * 1000
    const idealElapsed = (this._throttleBytes / this.maxSpeed) * 1000;
    const actualElapsed = now - this._throttleStartTime;

    if (actualElapsed < idealElapsed) {
      const delay = idealElapsed - actualElapsed;
      await new Promise((resolve) => setTimeout(resolve, delay));
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
      file: file.proxy as any,
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
    });

    try {
      const mergeResult = await this.doMergeChunks();
      this.chunkEndTime = performance.now();
      this.totalChunkTime = this.chunkEndTime - this.chunkStartTime;
      this.calculateStats();

      // 🔑 同步更新 proxy.speed（与 handleAllChunksSuccess 一致），修复秒下路径中
      //    markInstantDownload() 将 speed 置零后 completeMerge() 只算 chunkStatsInfos
      //    却不更新 proxy.speed → UI 显示陈旧/错误的速率
      const fileSize = file.getFileSize();
      const totalTime = this.totalChunkTime / 1000;
      const averageSpeed = totalTime > 0 ? fileSize / totalTime : 0;
      file.proxy.speed = {
        currentSpeed: 0,
        averageSpeed,
        currentSpeedFormatted: "0 B/s",
        averageSpeedFormatted: formatSpeed(averageSpeed),
        estimatedTimeRemaining: 0,
        estimatedTimeFormatted: "已完成",
      };

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
