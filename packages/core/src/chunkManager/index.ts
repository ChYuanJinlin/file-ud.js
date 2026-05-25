import PQueue from "p-queue";
import { ChunkOptions } from "../types";
import TransferFile from "../transfer/TransferFile";

export default class ChunkManager {
  chunkSize: number = 0;
  maxConcurrent: number = 5;
  public chunkIndex: number = 0;
  retries: number | null = 0;
  retryDelay: number = 1000; // 重试延迟，默认1秒
  timeout: number = 30000; // 超时时间，默认30秒
  chunk: Blob | null = null; // 当前分片数据

  public totalChunks: number = 0;
  public chunks: boolean[] = [];
  public chunkEndTime = 0;
  public completedChunks = 0;
  public totalChunkTime = 0;
  public response: any = null;
  public queue: PQueue | null = null; // 改为可选，在 startUpload 中初始化
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
  config: ChunkOptions; // 保存配置

  // 新增：用于标记已经累加过 completedChunks 的分片（防重复累加）
  public countedChunks: Set<number> = new Set();

  // 新增属性
  public fileHash: string = ""; // 文件MD5哈希
  public failedChunks: number[] = []; // 失败的分片索引
  public retryCountMap: Map<number, number> = new Map(); // 每个分片的重试次数
  // 暂停/恢复控制
  public isPaused: boolean = false; // 是否处于暂停状态
  public isCancelled: boolean = false; // ✅ 是否已取消（用于阻止新分片启动）
  public pauseResolves: Array<() => void> = []; // 改为数组，存储所有等待的 resolve
  public activeUploads: Set<Promise<void>> = new Set(); // 当前活跃的上传任务
  public abortControllers: AbortController[] = []; // 保存所有活跃分片的 AbortController

  // 网速计算所需的内部状态
  public lastUpdateTime: number = 0;
  public lastChunkBytes: number = 0;
  public transferFile: TransferFile | null = null; // 当前上传的文件对象
  // 分片上传耗时统计
  public chunkStats: {
    averageTime: number;
    maxTime: number;
    minTime: number;
  } | null = null;

  /**
   * 是否真正秒传（文件已存在，无需合并）
   */
  public isInstantUpload = false;

  constructor(ChunkOptions: ChunkOptions, file: TransferFile) {
    this.config = ChunkOptions; // 保存配置
    this.chunkSize = ChunkOptions.chunkSize ?? 1024 * 1024 * 5; // 默认5MB
    this.maxConcurrent = ChunkOptions.maxConcurrent ?? 5; // 默认同时上传5个分片
    this.retries =
      ChunkOptions.retries !== undefined ? ChunkOptions.retries : 5; // 默认重试5次，允许设置为 null 禁用自动重试
    this.retryDelay = ChunkOptions.retryDelay ?? 1000; // 默认重试延迟1秒
    this.timeout = ChunkOptions.timeout ?? 30000; // 默认超时30秒
    this.transferFile = file;
    this.totalChunks = Math.ceil(file.File.size / this.chunkSize);
    this.chunks = [];
    this.completedChunks = 0; // 显式初始化 completedChunks
  }
}
