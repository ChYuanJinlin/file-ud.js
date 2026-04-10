import { AxiosProgressEvent } from "axios";
import { ChunkOptions } from "../types";
import UploadFile from "./UploadFile";
import { calculateFileMD5, formatSpeed, sleep, logger } from "../utils";
import {
  saveUploadTask,
  updateChunkStatus,
  getUploadTask,
  deleteUploadTask,
  getCachedHash,
  saveFileHash,
} from "../utils/uploadDB";

export default class ChunkManager {
  chunkSize: number = 0;
  maxConcurrent: number = 5;
  public uploadedChunkIndex: number = 0;
  retries: number = 0;
  retryDelay: number = 1000; // 重试延迟，默认1秒
  timeout: number = 30000; // 超时时间，默认30秒
  enableResume: boolean = false; // 是否启用断点续传
  chunk: Blob | null = null; // 当前分片数据
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
  public fileHash: string = ""; // 文件MD5哈希
  public uploadId: string = ""; // 服务端返回的上传ID
  private failedChunks: number[] = []; // 失败的分片索引
  private retryCountMap: Map<number, number> = new Map(); // 每个分片的重试次数
  // 暂停/恢复控制
  private isPaused: boolean = false; // 是否处于暂停状态
  private pauseResolve?: () => void; // 暂停时的 Promise resolve
  private activeUploads: Set<Promise<void>> = new Set(); // 当前活跃的上传任务

  // 网速计算所需的内部状态
  private lastUpdateTime: number = 0;
  private lastUploadedBytes: number = 0;

  // 分片上传耗时统计
  public chunkUploadStats: {
    averageTime: number;
    maxTime: number;
    minTime: number;
  } | null = null;

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
   * 优化: 使用与分片上传相同的 chunkSize,减少重复I/O
   */
  private async computeFileHash(): Promise<string> {
    if (!this.fileHash) {
      try {
        const up = this.uploadFile.__uploader__;

        // 获取插件上下文
        const context = (this.uploadFile as any).__pluginContext || {
          uploader: up,
          file: this.uploadFile,
          shared: up["pluginSharedData"],
          config: up.config,
        };
        this.uploadFile.proxy.hashLoading = true;
        // 调用工具函数计算 MD5，并传入进度回调
        this.fileHash = await calculateFileMD5(
          this.uploadFile.File,
          async (percent: number) => {
            // 更新 context 状态为 hashing
            context.status = "hashing";
            this.uploadFile.proxy.status = "hashing";
            context.message = `正在计算文件指纹: ${percent}%`;

            // 通过 runHook 调用插件的 onProgress 钩子
            await up["runHook"](
              "onProgress",
              percent,
              this.uploadFile,
              context,
            );

            this.uploadFile.proxy.hashPercent = percent;
          },
        );
      } catch (error) {
        // 如果计算失败，使用时间戳作为备用标识
        this.fileHash = `fallback_${Date.now()}_${Math.random().toString(36).substring(2)}`;
      } finally {
        this.uploadFile.proxy.hashLoading = false;
      }
    }
    return this.fileHash;
  }

  private async getFileHash(file: File): Promise<string> {
    // 1. 生成快速指纹
    const quickFingerprint = `${file.name}_${file.lastModified}_${file.size}`;

    // 2. 从 IndexedDB 中查找缓存
    const cached = await getCachedHash(quickFingerprint);
    if (cached) {
      this.uploadFile.hashPercent = 100;
      return cached;
    }

    // 3. 未命中，实际计算 Hash
    const hash = await this.computeFileHash(); // 计算文件哈希

    // 4. 存入缓存
    await saveFileHash(file, hash);
    return hash;
  }
  /**
   * 初始化上传（获取uploadId或检查已上传分片）
   */
  private async initUpload(): Promise<void> {
    const up = this.uploadFile.__uploader__;

    this.fileHash = await this.getFileHash(this.uploadFile.File);

    // ✅ 添加文件级别的开始上传日志（用于监控模块）
    logger.info("ChunkManager", `开始上传文件: ${this.uploadFile.fileName}`, {
      fileId: this.uploadFile.fileId,
      fileName: this.uploadFile.fileName,
      fileSize: this.uploadFile.File.size,
      totalChunks: this.totalChunks,
      chunkSize: this.chunkSize,
    });

    // 如果启用了断点续传，尝试从 IndexedDB 恢复进度
    if (this.enableResume) {
      const savedProgress = await this.loadProgress();
      if (savedProgress && savedProgress.uploadedChunks) {
        // 从保存的进度中恢复
        this.uploadId = this.fileHash; // 使用 fileHash 作为任务ID
        // 恢复 uploadedChunks 状态
        savedProgress.uploadedChunks.forEach((index: number) => {
          if (index >= 0 && index < this.totalChunks) {
            this.uploadedChunks[index] = true;
            this.completedChunks++;
          }
        });

        logger.info("ChunkManager", "从 IndexedDB 恢复上传进度", {
          fileHash: this.fileHash,
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          completedChunks: this.completedChunks,
          totalChunks: this.totalChunks,
        });

        return;
      }

      // 如果没有保存的进度，创建新任务
      try {
        await saveUploadTask({
          id: this.fileHash,
          filename: this.uploadFile.File.name,
          size: this.uploadFile.File.size,
          chunkSize: this.chunkSize,
          totalChunks: this.totalChunks,
          chunks: Array.from({ length: this.totalChunks }, (_, i) => ({
            index: i,
            uploaded: false,
          })),
          createdAt: Date.now(),
        });

        logger.debug("ChunkManager", "创建新的上传任务记录", {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
        });
      } catch (error) {
        logger.warn("ChunkManager", "创建上传任务失败:", error);
      }
    }

    // 调用用户提供的初始化回调
    const onInit = up.onInitCallback;
    if (onInit) {
      try {
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
        }
      } catch (error) {
        throw new Error(
          `分片上传初始化失败: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      // 如果没有提供onInit回调，生成本地uploadId
      this.uploadId = this.fileHash;
    }
  }

  /**
   * 生成唯一的uploadId
   */
  private generateUploadId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  }

  /**
   * 带重试机制的分片上传
   */
  private async uploadChunkWithRetry(chunkIndex: number): Promise<void> {
    const maxRetries = this.retries;
    let retryCount = this.retryCountMap.get(chunkIndex) || 0;

    while (retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          logger.warn(
            "ChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${this.totalChunks} 第 ${retryCount} 次重试`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              retryCount,
            },
          );
        }

        // ✅ 使用 AbortController 实现真正的超时控制
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => {
          abortController.abort();
        }, this.timeout);

        try {
          // 传递 signal 给 UploadFile.upload，实现真正的超时取消
          await this.uploadChunk(chunkIndex, abortController.signal);

          // 上传成功，清除超时定时器
          clearTimeout(timeoutId);
        } catch (error) {
          // 确保清除定时器
          clearTimeout(timeoutId);
          throw error;
        }

        // 上传成功，重置重试计数
        this.retryCountMap.set(chunkIndex, 0);

        if (retryCount > 0) {
          logger.info(
            "ChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${this.totalChunks} 重试成功（共重试 ${retryCount} 次）`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              retryCount,
            },
          );
        }

        return;
      } catch (error: any) {
        retryCount++;
        this.retryCountMap.set(chunkIndex, retryCount);

        if (retryCount > maxRetries) {
          this.failedChunks.push(chunkIndex);

          logger.error(
            "ChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${this.totalChunks} 最终失败（已重试 ${maxRetries} 次）`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              retryCount: maxRetries,
              error: error instanceof Error ? error.message : String(error),
            },
          );

          throw error;
        }

        // 指数退避重试延迟
        const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 10000);
        logger.debug(
          "ChunkManager",
          `分片 ${chunkIndex} 将在 ${delay}ms 后重试`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 上传单个分片
   */
  private async uploadChunk(chunkIndex: number, signal?: AbortSignal): Promise<void> {
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.uploadFile.File.size);
    const chunk = this.uploadFile.File.slice(start, end);
    this.chunk = chunk; // 暂存当前分片，供外部访问
    const chunkSizeValue = chunk.size;

    logger.debug(
      "ChunkManager",
      `开始上传分片 ${chunkIndex + 1}/${this.totalChunks}`,
      {
        fileId: this.uploadFile.fileId,
        fileName: this.uploadFile.fileName,
        chunkIndex,
        size: chunkSizeValue,
        start,
        end,
      },
    );

    const chunkFormData = new FormData();
    chunkFormData.append("chunkIndex", chunkIndex.toString());
    chunkFormData.append("totalChunks", this.totalChunks.toString());
    chunkFormData.append("fileName", this.uploadFile.fileName);
    this.uploadFile.setFile(chunk, chunkFormData);

    // 临时保存到 uploadFile，供拦截器使用
    this.uploadFile.formData = chunkFormData;

    try {
      // ✅ 传递 signal 实现真正的超时控制
      await this.uploadFile.upload((res) => {
        if (!this.uploadedChunks[chunkIndex]) {
          // 完成的分片
          this.completedChunks++;
          this.totalUploadedSize += chunkSizeValue;
          this.uploadedChunks[chunkIndex] = true;

          logger.info(
            "ChunkManager",
            `分片 ${chunkIndex + 1}/${this.totalChunks} 上传成功`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              completedChunks: this.completedChunks,
              totalChunks: this.totalChunks,
              progress: `${Math.round((this.completedChunks / this.totalChunks) * 100)}%`,
            },
          );
        } else {
          logger.debug(
            "ChunkManager",
            `分片 ${chunkIndex + 1}/${this.totalChunks} 已上传，跳过累加`,
          );
        }

        // 更新进度
        this.updateProgress();

        // 从失败列表中移除
        const failIndex = this.failedChunks.indexOf(chunkIndex);
        if (failIndex > -1) {
          this.failedChunks.splice(failIndex, 1);
        }

        // 如果启用了断点续传，更新单个分片状态（更高效）
        if (this.enableResume) {
          updateChunkStatus(this.fileHash, chunkIndex, true).catch((error) => {
            logger.warn("ChunkManager", "更新分片状态失败:", error);
          });
        }
      }, signal);

      return Promise.resolve();
    } catch (error) {
      this.uploadedChunks[chunkIndex] = false;

      logger.error(
        "ChunkManager",
        `分片 ${chunkIndex + 1}/${this.totalChunks} 上传失败`,
        {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          chunkIndex,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      throw error;
    }
  }

  /**
   * 合并所有分片
   */
  private async mergeChunks(): Promise<any> {
    const up = this.uploadFile.__uploader__;
    this.uploadFile.proxy.status = "merging";
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

        // 清除保存的进度
        if (this.enableResume) {
          await this.clearProgress();
        }
        this.uploadFile.proxy.status = "success";
        return response;
      } else {
        // 如果没有提供onMerge回调，直接认为成功
        // 清除保存的进度
        if (this.enableResume) {
          await this.clearProgress();
        }

        return undefined;
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 检查统计信息并触发合并
   */
  private async checkStatistics() {
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
    } else {
      // 有分片失败，尝试重试
      if (this.failedChunks.length > 0) {
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
        this.failedChunks.push(chunkIndex);
      }
    }

    // 如果还有失败的，触发错误回调
    if (this.failedChunks.length > 0) {
      this.uploadFile.onError(
        new Error(`${this.failedChunks.length} 个分片上传失败`),
      );
    }
  }

  /**
   * 从 IndexedDB 加载上传进度
   */
  private async loadProgress(): Promise<any> {
    if (!this.enableResume) return null;

    try {
      const task = await getUploadTask(this.fileHash);

      if (task) {
        // 检查是否是同一个文件（通过哈希和大小）
        if (
          task.id === this.fileHash &&
          task.size === this.uploadFile.File.size
        ) {
          // 转换数据格式以兼容原有逻辑
          return {
            uploadId: task.id,
            uploadedChunks: task.chunks
              .filter(
                (chunk: { index: number; uploaded: boolean }) => chunk.uploaded,
              )
              .map(
                (chunk: { index: number; uploaded: boolean }) => chunk.index,
              ),
            completedChunks: task.chunks.filter(
              (chunk: { index: number; uploaded: boolean }) => chunk.uploaded,
            ).length,
          };
        }
      }
    } catch (error) {
      logger.warn("ChunkManager", "加载上传进度失败:", error);
    }
    return null;
  }

  /**
   * 清除保存的上传进度
   */
  private async clearProgress(): Promise<void> {
    if (!this.enableResume) return;

    try {
      await deleteUploadTask(this.fileHash);
      logger.debug("ChunkManager", "已清除上传进度缓存");
    } catch (error) {
      logger.warn("ChunkManager", "清除上传进度失败:", error);
    }
  }

  /**
   * 取消上传
   */
  public cancelUpload(): void {
    // 取消上传逻辑
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
      return;
    }

    this.isPaused = true;
    this.uploadFile.proxy.status = "paused";

    // 如果是普通上传(没有 ChunkManager),直接 abort
    if (
      !this.uploadFile.chunkManager ||
      this.uploadFile.chunkManager === this
    ) {
      // 检查是否是普通上传(通过检查是否有 chunkIndex 参数)
      const isChunkedUpload = this.uploadId !== "";

      if (!isChunkedUpload && this.uploadFile.abort) {
        this.uploadFile.abort();
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
      return;
    }

    this.isPaused = false;
    this.uploadFile.proxy.status = "uploading";

    // 如果是分片上传,继续上传剩余分片
    if (this.uploadId) {
      // 检查是否还有未完成的分片
      const hasUnfinishedChunks = this.uploadedChunks.some(
        (uploaded) => !uploaded,
      );

      if (hasUnfinishedChunks) {
        await this.startUpload();
      } else {
        await this.mergeChunks();
      }
    } else {
      // 普通上传无法恢复,需要重新开始
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

  public updateProgress() {
    this.uploadFile.proxy.percent = Math.floor(
      (this.completedChunks / this.totalChunks) * 100,
    ); // 已完成分片的总大小

    // 计算并更新上传速度
    this.calculateAndUpdateSpeed(this.totalUploadedSize);
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
    // 第一步：初始化上传（获取uploadId、检查已上传分片）
    await this.initUpload();

    // 如果所有分片都已上传，直接合并
    if (this.completedChunks === this.totalChunks) {
      logger.info("ChunkManager", "所有分片已上传，直接执行合并");

      // 记录开始时间（如果是断点续传，需要重新计算）
      if (!this.uploadStartTime) {
        this.uploadStartTime = performance.now();
      }

      try {
        const mergeResult = await this.mergeChunks();

        // 记录总耗时
        this.uploadEndTime = performance.now();
        this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;

        // 添加上传统计信息
        this.uploadStatsInfos = {
          totalTime: this.totalUploadTime,
          fileSize: this.uploadFile.File.size,
          completedChunks: this.completedChunks,
          averageSpeed:
            this.uploadFile.File.size / (this.totalUploadTime / 1000) / 1024, // KB/s
        };

        // 触发成功回调
        this.uploadFile.onScuccess(mergeResult);

        logger.info("ChunkManager", "文件上传完成（断点续传）", {
          totalTime: this.totalUploadTime,
          completedChunks: this.completedChunks,
          totalChunks: this.totalChunks,
        });
      } catch (error) {
        // 合并失败，触发错误回调
        this.uploadEndTime = performance.now();
        this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;
        this.uploadFile.onError(error);
      }

      return;
    }

    try {
      // 使用信号量控制并发
      await this.uploadWithConcurrency();

      // 检查统计信息并触发合并或错误处理
      this.checkStatistics();
    } catch (error) {
      // 错误时也记录耗时
      this.uploadEndTime = performance.now();
      this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;
      throw error;
    }
  }

  /**
   * 使用信号量控制并发上传
   */
  private async uploadWithConcurrency(): Promise<void> {
    const uploadPromises: Promise<void>[] = [];
    const chunkStartTimes: number[] = [];
    const chunkDurations: number[] = [];

    for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
      // ✅ 检查暂停状态，如果暂停则等待恢复
      await this.waitForResume();

      // 跳过已上传的分片（断点续传场景）
      if (this.uploadedChunks[chunkIndex]) {
        continue;
      }

      this.uploadedChunkIndex = chunkIndex + 1;

      // 记录分片开始时间
      chunkStartTimes[chunkIndex] = performance.now();

      const promise = this.uploadChunkWithRetry(chunkIndex)
        .then(() => {
          // 记录分片耗时
          chunkDurations[chunkIndex] =
            performance.now() - chunkStartTimes[chunkIndex];
        })
        .catch((error) => {
          // 记录失败分片的耗时（如果有）
          if (chunkStartTimes[chunkIndex]) {
            chunkDurations[chunkIndex] =
              performance.now() - chunkStartTimes[chunkIndex];
          }
          // 重新抛出错误，让 Promise.allSettled 能够捕获
          throw error;
        });

      uploadPromises.push(promise);

      // 并发控制：当达到最大并发数时，等待其中一个完成
      if (uploadPromises.length >= this.maxConcurrent) {
        await Promise.race(uploadPromises);
      }
    }

    await Promise.allSettled(uploadPromises);

    // 统计信息
    const completedDurations = chunkDurations.filter(
      (duration) => duration > 0,
    );
    if (completedDurations.length > 0) {
      const avgChunkTime =
        completedDurations.reduce((a, b) => a + b, 0) /
        completedDurations.length;

      // 更新实例上的统计信息
      this.chunkUploadStats = {
        averageTime: avgChunkTime,
        maxTime: Math.max(...completedDurations),
        minTime: Math.min(...completedDurations),
      };
    }
  }
}
