import { AxiosProgressEvent } from "axios";
import { ChunkOptions } from "../types";
import UploadFile from "./UploadFile";
import PQueue from "p-queue";
import {
  calculateFileMD5,
  formatSpeed,
  formatDuration,
  sleep,
  logger,
  checkNetworkStatus,
  computeUploadTime,
} from "../utils";
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
  retries: number | null = 0;
  retryDelay: number = 1000; // 重试延迟，默认1秒
  timeout: number = 30000; // 超时时间，默认30秒
  enableResume: boolean = false; // 是否启用断点续传
  chunk: Blob | null = null; // 当前分片数据
  public totalChunks: number = 0;
  public uploadedChunks: boolean[] = [];
  public uploadEndTime = 0;
  public completedChunks = 0;
  public totalUploadTime = 0;
  public response: any = null;
  public queue: PQueue | null = null; // ✅ 改为可选，在 startUpload 中初始化
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

  // ✅ 新增：用于标记已经累加过 completedChunks 的分片（防重复累加）
  private countedChunks: Set<number> = new Set();

  // 新增属性
  public fileHash: string = ""; // 文件MD5哈希
  public uploadId: string = ""; // 服务端返回的上传ID
  private failedChunks: number[] = []; // 失败的分片索引
  private retryCountMap: Map<number, number> = new Map(); // 每个分片的重试次数
  // 暂停/恢复控制
  private isPaused: boolean = false; // 是否处于暂停状态
  private pauseResolves: Array<() => void> = []; // ✅ 改为数组，存储所有等待的 resolve
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
    this.chunkSize = ChunkOptions.chunkSize ?? 1024 * 1024 * 5; // 默认5MB
    this.maxConcurrent = ChunkOptions.maxConcurrent ?? 5; // 默认同时上传5个分片
    this.retries =
      ChunkOptions.retries !== undefined ? ChunkOptions.retries : 5; // 默认重试5次，允许设置为 null 禁用自动重试
    this.retryDelay = ChunkOptions.retryDelay ?? 1000; // 默认重试延迟1秒
    this.timeout = ChunkOptions.timeout ?? 30000; // 默认超时30秒
    this.enableResume = ChunkOptions.enableResume ?? false; // 默认不启用断点续传
    this.totalChunks = Math.ceil(file.File.size / this.chunkSize);
    this.uploadFile = file;
    this.uploadedChunks = [];
    this.completedChunks = 0; // ✅ 显式初始化 completedChunks

    logger.debug("ChunkManager", "创建新的 ChunkManager 实例", {
      fileId: file.fileId,
      fileName: file.fileName,
      totalChunks: this.totalChunks,
      completedChunks: this.completedChunks,
    });
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
            logger.debug(
              "ChunkManager",
              `computeFileHash 被调用: ${context.message}`,
            );
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
        logger.error("ChunkManager", "计算文件哈希失败，使用备用标识", error);
        // 如果计算失败，使用时间戳作为备用标识
        this.fileHash = `fallback_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2)}`;
      } finally {
        this.uploadFile.proxy.hashLoading = false;
      }
    }
    return this.fileHash;
  }

  private async getFileHash(file: File): Promise<string> {
    // 1. 生成快速指纹
    const quickFingerprint = `${file.name}_${file.lastModified}_${file.size}`;

    // ✅ 添加调试日志：记录每次调用 getFileHash 的文件名
    logger.debug("ChunkManager", `getFileHash 被调用: ${file.name}`, {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      fingerprint: quickFingerprint,
      fileId: this.uploadFile.fileId,
    });

    // 2. 从 IndexedDB 中查找缓存
    const cached = await getCachedHash(quickFingerprint);
    if (cached) {
      logger.info("ChunkManager", `Hash 缓存命中:: ${file.name}`, {
        fileName: file.name,
        fileId: this.uploadFile.fileId,
      });
      this.uploadFile.hashPercent = 100;
      return cached;
    }

    // 3. 未命中，实际计算 Hash
    logger.info("ChunkManager", `Hash 缓存未命中，开始计算: ${file.name}`);
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

    // ✅ 秒传检查：如果配置了 onInitChunkCallback，优先调用服务端接口检查文件是否存在
    if (up.onInitChunkCallback) {
      try {
        logger.debug("ChunkManager", "调用 onInitChunk 回调检查秒传/断点续传", {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          fileHash: this.fileHash,
        });

        const initResult = await up.onInitChunkCallback(
          this.uploadFile,
          this.totalChunks,
          this.fileHash,
        );

        // 保存服务端返回的 uploadId
        if (initResult?.fileHash) {
          logger.info("ChunkManager", "初始化成功", {
            fileHash: this.fileHash,
            fileId: this.uploadFile.fileId,
          });

          // ✅ 秒传判断：如果服务端返回的已上传分片数量等于总分片数，说明文件已存在
          if (
            initResult.uploadedChunks &&
            Array.isArray(initResult.uploadedChunks) &&
            initResult.uploadedChunks.length === this.totalChunks
          ) {
            logger.info("ChunkManager", "✅ 秒传成功！文件已存在于服务端", {
              fileHash: this.fileHash,
              fileName: this.uploadFile.fileName,
              uploadedChunksCount: initResult.uploadedChunks.length,
              totalChunks: this.totalChunks,
            });

            this.completedChunks = this.totalChunks;
            this.totalUploadedSize = this.uploadFile.File.size;
            this.countedChunks = new Set(
              Array.from({ length: this.totalChunks }, (_, i) => i),
            ); // 标记所有分片为已累加
            this.uploadedChunks = new Array(this.totalChunks).fill(true);

            // ✅ 设置文件状态为 success
            this.uploadFile.proxy.status = "success";
            this.uploadFile.proxy.percent = 100;

            // ✅ 更新全局进度和速度（不依赖 lastUpdateTime）
            const up = this.uploadFile.__uploader__;
            up.triggerUpdate();

            return;
          }

          // ✅ 断点续传：如果服务端返回部分已上传分片
          if (
            initResult.uploadedChunks &&
            Array.isArray(initResult.uploadedChunks) &&
            initResult.uploadedChunks.length > 0
          ) {
            logger.info("ChunkManager", "恢复已上传分片（断点续传）", {
              uploadedChunksCount: initResult.uploadedChunks.length,
              totalChunks: this.totalChunks,
              percent: Math.round(
                (initResult.uploadedChunks.length / this.totalChunks) * 100,
              ),
            });

            initResult.uploadedChunks.forEach((index: number) => {
              if (index >= 0 && index < this.totalChunks) {
                this.uploadedChunks[index] = true;
                this.completedChunks++;
                this.countedChunks.add(index);
                this.totalUploadedSize += this.chunkSize;
              }
            });

            // ✅ 更新文件进度
            this.updateProgress();
            return; // 已恢复进度，直接返回
          }
        }
      } catch (error) {
        logger.warn("ChunkManager", "初始化失败", error);
        this.uploadFile.proxy.status = "error";
        // 降级到本地 IndexedDB 存储
        return Promise.reject(error);
      }
    }

    // 如果启用了断点续传，尝试从 IndexedDB 恢复进度
    if (this.enableResume) {
      const savedProgress = await this.loadProgress();
      if (savedProgress && savedProgress.uploadedChunks) {
        logger.debug("ChunkManager", "开始恢复断点续传进度", {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          completedChunksBefore: this.completedChunks,
          uploadedChunksCount: savedProgress.uploadedChunks.length,
        });

        // ✅ 恢复 uploadedChunks 状态、completedChunks 计数和 countedChunks 集合
        savedProgress.uploadedChunks.forEach((index: number) => {
          if (index >= 0 && index < this.totalChunks) {
            this.uploadedChunks[index] = true;
            this.completedChunks++; // 累加计数器
            this.countedChunks.add(index); // ✅ 标记为已累加，防止重试时重复累加
            this.totalUploadedSize += this.chunkSize;
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

  /**
   * 带重试机制的分片上传
   */
  private async uploadChunkWithRetry(chunkIndex: number): Promise<void> {
    const maxRetries = this.retries;
    let retryCount = this.retryCountMap.get(chunkIndex) || 0;

    // ✅ 如果 retries 为 null，禁用自动重试，只尝试一次
    if (maxRetries === null) {
      try {
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

          // ✅ 添加详细的错误日志
          if (error instanceof Error && error.name === "AbortError") {
            logger.error(
              "ChunkManager",
              `分片 ${chunkIndex + 1} 被取消（可能是超时或手动取消）`,
              {
                fileId: this.uploadFile.fileId,
                fileName: this.uploadFile.fileName,
                chunkIndex,
                timeout: this.timeout,
                error: error.message,
              },
            );
          }

          throw error;
        }

        // 上传成功，重置重试计数
        this.retryCountMap.set(chunkIndex, 0);
        return;
      } catch (error: any) {
        // ✅ 自动重试被禁用，直接标记为失败
        this.failedChunks.push(chunkIndex);

        logger.error(
          "ChunkManager",
          `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
            this.totalChunks
          } 上传失败（自动重试已禁用，请手动重试）`,
          {
            fileId: this.uploadFile.fileId,
            fileName: this.uploadFile.fileName,
            chunkIndex,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        setTimeout(() => {
          this.uploadFile.proxy.status = "fail";
        }, 0);
        throw error;
      }
    }

    // ✅ 正常重试逻辑
    while (retryCount <= maxRetries) {
      try {
        if (retryCount > 0) {
          logger.warn(
            "ChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 第 ${retryCount} 次重试`,
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

          // ✅ 添加详细的错误日志
          if (error instanceof Error && error.name === "AbortError") {
            logger.error(
              "ChunkManager",
              `分片 ${chunkIndex + 1} 被取消（可能是超时或手动取消）`,
              {
                fileId: this.uploadFile.fileId,
                fileName: this.uploadFile.fileName,
                chunkIndex,
                timeout: this.timeout,
                error: error.message,
              },
            );
          }

          throw error;
        }

        // 上传成功，重置重试计数
        this.retryCountMap.set(chunkIndex, 0);

        if (retryCount > 0) {
          logger.info(
            "ChunkManager",
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 重试成功（共重试 ${retryCount} 次）`,
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
            `文件 ${this.uploadFile.fileName} 的分片 ${chunkIndex + 1}/${
              this.totalChunks
            } 最终失败（已重试 ${maxRetries} 次）`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              chunkIndex,
              retryCount: maxRetries,
              error: error instanceof Error ? error.message : String(error),
            },
          );

          return;
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
  private async uploadChunk(
    chunkIndex: number,
    signal?: AbortSignal,
  ): Promise<void> {
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

    // ✅ 修复：创建独立的 FormData，作为参数传递给 upload 方法
    // 不要保存到实例级别，避免多文件并发时被覆盖
    const chunkFormData = new FormData();
    this.uploadFile.setFile(chunk, chunkFormData, chunkIndex);

    try {
      // ✅ 传递 signal 实现真正的超时控制
      // ✅ 传递 chunkFormData 作为请求参数，避免使用共享的 this.uploadFile.formData
      await this.uploadFile.upload(
        (res) => {
          // ✅ 使用 countedChunks 来防止重复累加
          this.response = res; // 暂存最新的响应数据，供外部访问

          // ✅ 关键修复：只有当该分片未被标记为已上传时，才进行累加
          if (!this.uploadedChunks[chunkIndex]) {
            this.uploadedChunks[chunkIndex] = true;

            // ✅ 先累加字节数
            this.totalUploadedSize += chunkSizeValue;

            // ✅ 再累加完成分片计数
            this.completedChunks++;

            // ✅ 标记为已计数，防止重试时重复累加
            this.countedChunks.add(chunkIndex);

            // 更新进度
            this.updateProgress();

            logger.info(
              "ChunkManager",
              `分片 ${chunkIndex + 1}/${this.totalChunks} 上传成功`,
              {
                fileId: this.uploadFile.fileId,
                fileName: this.uploadFile.fileName,
                chunkIndex,
                completedChunks: this.completedChunks,
                totalChunks: this.totalChunks,
                percent: this.uploadFile.proxy.percent,
              },
            );
          } else {
            logger.debug(
              "ChunkManager",
              `分片 ${chunkIndex + 1}/${this.totalChunks} 已上传，跳过累加`,
              {
                completedChunks: this.completedChunks,
                totalChunks: this.totalChunks,
              },
            );
          }

          // 从失败列表中移除
          const failIndex = this.failedChunks.indexOf(chunkIndex);
          if (failIndex > -1) {
            this.failedChunks.splice(failIndex, 1);
          }

          // 如果启用了断点续传，更新单个分片状态（更高效）
          if (this.enableResume) {
            updateChunkStatus(this.fileHash, chunkIndex, true).catch(
              (error) => {
                logger.warn("ChunkManager", "更新分片状态失败:", error);
              },
            );
          }
        },
        signal,
        chunkFormData,
      ); // ✅ 传递 chunkFormData 作为参数

      return Promise.resolve();
    } catch (error) {
      // ✅ 分片失败时，不要回退 completedChunks！
      // 只标记 uploadedChunks 为 false，等待重试成功后再累加
      // 这样进度只会增加不会减少，避免进度回退导致用户体验差
      this.uploadedChunks[chunkIndex] = false;

      logger.error(
        "ChunkManager",
        `分片 ${chunkIndex + 1}/${this.totalChunks} 上传失败`,
        {
          fileId: this.uploadFile.fileId,
          fileName: this.uploadFile.fileName,
          chunkIndex,
          error: error instanceof Error ? error.message : String(error),
          completedChunks: this.completedChunks,
          totalChunks: this.totalChunks,
          progress: this.uploadFile.proxy.progress,
        },
      );
      setTimeout(() => {
        this.uploadFile.proxy.status = "fail";
      }, 0);
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
      const onMerge = up.OnMergeChunkCallBack;
      if (onMerge) {
        const response = await onMerge(this);

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
      this.uploadFile.proxy.status = "fail";
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

    // ✅ 修复：基于 completedChunks 判断是否所有分片都完成了
    // uploadedChunks 可能会因为重试、断点续传等场景导致状态不一致
    // completedChunks 是可靠的计数器，只要累加了就说明分片确实上传成功了
    const allSuccess = this.completedChunks === this.totalChunks;

    logger.debug("ChunkManager", `检查统计信息`, {
      fileId: this.uploadFile.fileId,
      fileName: this.uploadFile.fileName,
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
      allSuccess,
      uploadedChunksTrue: this.uploadedChunks.filter((u) => u).length,
      failedChunks: this.failedChunks.length,
    });

    if (allSuccess) {
      // ✅ 所有分片上传成功，强制设置进度为 100%
      const up = this.uploadFile.__uploader__;

      // ✅ 计算并更新全局上传速度
      this.calculateAndUpdateSpeed(this.uploadFile.File.size);

      // ✅ 更新单个文件的 uploadSpeed（分片上传完成时）
      const totalTime = (performance.now() - this.uploadStartTime) / 1000;
      const averageSpeed =
        totalTime > 0 ? this.uploadFile.File.size / totalTime : 0;
      this.uploadFile.proxy.uploadSpeed = {
        currentSpeed: 0, // 上传已完成，瞬时速度为 0
        averageSpeed,
        currentSpeedFormatted: "0 B/s",
        averageSpeedFormatted: formatSpeed(averageSpeed),
      };

      // 调用合并接口
      try {
        const mergeResult = await this.mergeChunks();
        this.uploadFile.proxy.percent = 100; // 确保合并完成后进度为 100%
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
      // ✅ 有分片失败的处理逻辑
      if (this.failedChunks.length > 0) {
        // ✅ 如果 retries 为 null，禁用自动重试，直接报错
        if (this.retries === null) {
          logger.warn(
            "ChunkManager",
            `发现 ${this.failedChunks.length} 个失败分片，自动重试已禁用，请手动重试`,
            {
              fileId: this.uploadFile.fileId,
              fileName: this.uploadFile.fileName,
              failedChunks: this.failedChunks,
            },
          );

          // ✅ 设置文件状态为 fail
          setTimeout(() => {
            this.uploadFile.proxy.status = "fail";
          }, 0);

          this.uploadFile.onError(new Error("部分分片上传失败"));
          return;
        }

        // ✅ 正常重试逻辑（retries >= 0）
        logger.warn(
          "ChunkManager",
          `发现 ${this.failedChunks.length} 个失败分片，开始自动重试`,
          {
            fileId: this.uploadFile.fileId,
            fileName: this.uploadFile.fileName,
            failedChunks: this.failedChunks,
          },
        );

        await this.retryFailedChunks();

        // ✅ 重试完成后，再次检查统计信息
        // 如果重试成功，会触发合并和状态转换
        // 如果重试仍然失败，会触发错误处理
        await this.checkStatistics();
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
      // ✅ 重置该分片的重试计数，允许手动重试时重新尝试
      this.retryCountMap.set(chunkIndex, 0);

      try {
        await this.uploadChunkWithRetry(chunkIndex);
      } catch (error) {
        this.failedChunks.push(chunkIndex);
      }
    }

    // ✅ 重试完成后，检查统计信息并触发合并或错误处理
    await this.checkStatistics();
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
   * 会等待当前活跃的分片完成后暂停新分片的启动。
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

    logger.info("ChunkManager", `文件 ${this.uploadFile.fileName} 已暂停`, {
      fileId: this.uploadFile.fileId,
      fileName: this.uploadFile.fileName,
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
    });
  }

  /**
   * 恢复上传
   *
   * 从暂停的位置继续上传分片。
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

    logger.info("ChunkManager", `文件 ${this.uploadFile.fileName} 已恢复`, {
      fileId: this.uploadFile.fileId,
      fileName: this.uploadFile.fileName,
      completedChunks: this.completedChunks,
      totalChunks: this.totalChunks,
    });

    // ✅ 唤醒所有等待中的分片上传任务
    if (this.pauseResolves.length > 0) {
      this.pauseResolves.forEach((resolve) => resolve());
      this.pauseResolves = [];
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
   * 获取失败分片的数量
   * @returns 失败分片数量
   */
  public getFailedChunksCount(): number {
    return this.failedChunks.length;
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
      this.pauseResolves.push(resolve);
    });
  }

  /**
   * 更新上传进度
   *
   * ✅ 简单直接的进度计算：completedChunks / totalChunks * 100%
   * completedChunks 只在分片真正上传成功时才累加
   */
  public updateProgress() {
    // ✅ 修复：不再在此处自增 completedChunks，而是由调用方（uploadChunk 成功回调）确保状态一致
    // 此处仅负责根据当前的 completedChunks 计算百分比

    // 防止除以0
    if (this.totalChunks === 0) {
      this.uploadFile.proxy.percent = 100;
      return;
    }

    // ✅ 简单直接的进度计算
    let percent = Math.round((this.completedChunks / this.totalChunks) * 100);

    // ✅ 边界保护：确保不超过 100%
    percent = Math.min(100, Math.max(0, percent));

    // ✅ 如果所有分片都完成，强制设置为 100%
    if (this.completedChunks >= this.totalChunks) {
      percent = 100;
    }

    this.uploadFile.proxy.percent = percent;

    // ✅ 计算并更新全局上传速度
    this.calculateAndUpdateSpeed(this.totalUploadedSize);

    // ✅ 触发全局更新，确保总进度条实时响应
    this.uploadFile.__uploader__.triggerUpdate();
  }

  /**
   * 计算并更新全局上传速率
   * @param currentUploadedBytes 当前已上传字节数
   */
  private calculateAndUpdateSpeed(currentUploadedBytes: number): void {
    const now = performance.now();

    // ✅ 首次调用或重新上传时，初始化基准值
    if (this.lastUpdateTime === 0 || this.lastUpdateTime > now) {
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

    // ✅ 不再直接更新全局 uploadSpeed，而是触发 Uploader 的更新
    // 由 Uploader.calculateGlobalUploadSpeed() 统一聚合所有文件的速度
    this.uploadFile.__uploader__.triggerUpdate();

    // 更新基准值
    this.lastUpdateTime = now;
    this.lastUploadedBytes = currentUploadedBytes;
  }

  public async startUpload() {
    const up = this.uploadFile.__uploader__;

    // ✅ 重置所有状态（避免重新上传时使用旧值）
    this.totalUploadedSize = 0;
    this.uploadFile.__uploadedBytes__ = 0;
    this.uploadStartTime = performance.now(); // ✅ 重置开始时间
    this.countedChunks.clear(); // ✅ 重置已计数分片集合

    // ✅ 重置速度计算状态（避免第二次上传时速度计算错误）
    this.lastUpdateTime = 0;
    this.lastUploadedBytes = 0;

    // ✅ 重新创建 PQueue，确保使用正确的并发配置
    this.queue = new PQueue({ concurrency: this.maxConcurrent });

    // ❌ 不要在这里重置 completedChunks！
    // completedChunks 会在 initUpload() 中根据断点续传情况设置
    // 如果没有断点续传，completedChunks 保持为 0（构造函数中初始化）

    // ✅ 初始化总字节数（只在首次上传时）
    if (!this.uploadFile.__hasCountedTotalBytes__) {
      up.totalUploadBytes += this.uploadFile.File.size;
      up.totalBytes += this.uploadFile.File.size;
      this.uploadFile.__hasCountedTotalBytes__ = true;
    }

    // ✅ 增加超时时间到 60 秒（避免大文件分片上传被误取消）
    this.timeout = Math.max(this.timeout, 60000);

    try {
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
      computeUploadTime(this.uploadFile.proxy.uploadTime).start();
      // 使用信号量控制并发
      await this.uploadWithConcurrency();

      // 检查统计信息并触发合并或错误处理
      await this.checkStatistics();

      computeUploadTime(this.uploadFile.proxy.uploadTime).end();
    } catch (error) {
      // ✅ 错误时也要检查统计信息，确保正确更新状态和进度
      await this.checkStatistics();

      // 记录耗时
      this.uploadEndTime = performance.now();
      this.totalUploadTime = this.uploadEndTime - this.uploadStartTime;

      // 如果 checkStatistics 没有处理错误（比如还有失败分片），则抛出错误
      if (this.failedChunks.length > 0) {
        throw error;
      }
    }
  }

  /**
   * 使用信号量控制并发上传
   */
  private async uploadWithConcurrency(): Promise<void> {
    const uploadPromises: Promise<void>[] = [];
    const chunkStartTimes: number[] = [];
    const chunkDurations: number[] = [];

    // ✅ 确保队列已初始化
    if (!this.queue) {
      throw new Error("PQueue not initialized. Call startUpload() first.");
    }

    for (let chunkIndex = 0; chunkIndex < this.totalChunks; chunkIndex++) {
      // 跳过已上传的分片（断点续传场景）
      if (this.uploadedChunks[chunkIndex]) {
        continue;
      }

      this.uploadedChunkIndex = chunkIndex + 1;

      // ✅ 在每个分片上传前检查暂停状态
      uploadPromises.push(
        this.queue.add(async () => {
          // ✅ 在真正开始上传前检查是否暂停
          await this.waitForResume();

          // 记录分片开始时间
          chunkStartTimes[chunkIndex] = performance.now();

          try {
            await this.uploadChunkWithRetry(chunkIndex);
            // 记录分片耗时
            chunkDurations[chunkIndex] =
              performance.now() - chunkStartTimes[chunkIndex];
          } catch (error) {
            // 记录失败分片的耗时（如果有）
            if (chunkStartTimes[chunkIndex]) {
              chunkDurations[chunkIndex] =
                performance.now() - chunkStartTimes[chunkIndex];
            }
            throw error;
          }
        }),
      );
    }
    await Promise.all(uploadPromises);

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
