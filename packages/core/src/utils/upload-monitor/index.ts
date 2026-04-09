/**
 * 上传性能监控模块
 * 
 * 提供上传成功率、耗时统计、错误分析等监控功能
 * 
 * @example
 * ```typescript
 * import { uploadMonitor } from '@core/utils';
 * 
 * // 获取实时统计数据
 * console.log(uploadMonitor.getStats());
 * 
 * // 重置统计数据
 * uploadMonitor.reset();
 * ```
 */

import { addLogCollector, LogLevel, LogEntry } from '../logger';

/**
 * 单个文件的上传记录
 */
export interface UploadRecord {
  /** 文件唯一标识 */
  fileId: string;
  /** 文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 开始时间戳 */
  startTime: number;
  /** 结束时间戳 */
  endTime?: number;
  /** 是否成功 */
  success: boolean;
  /** 失败原因（如果失败） */
  error?: string;
  /** 重试次数 */
  retryCount: number;
  /** 分片总数（如果是分片上传） */
  totalChunks?: number;
  /** 成功分片数 */
  uploadedChunks?: number;
  /** 失败分片数 */
  failedChunks?: number;
  /** ✅ 各模块的错误次数统计 */
  errorModules?: Map<string, number>;
}

/**
 * 上传统计数据
 */
export interface UploadStats {
  /** 总上传数 */
  totalUploads: number;
  /** 成功上传数 */
  successfulUploads: number;
  /** 失败上传数 */
  failedUploads: number;
  /** 成功率（0-100） */
  successRate: number;
  /** 平均耗时（毫秒） */
  averageDuration: number;
  /** 最短耗时（毫秒） */
  minDuration: number;
  /** 最长耗时（毫秒） */
  maxDuration: number;
  /** 中位数耗时（毫秒） */
  medianDuration: number;
  /** 平均文件大小（字节） */
  averageFileSize: number;
  /** 总上传数据量（字节） */
  totalBytesUploaded: number;
  /** 平均上传速度（字节/秒） */
  averageSpeed: number;
  /** 按错误类型统计 */
  errorsByType: Map<string, number>;
  /** 按模块统计错误 */
  errorsByModule: Map<string, number>;
  /** 平均重试次数 */
  averageRetries: number;
  /** 分片上传统计 */
  chunkUploadStats?: {
    /** 总分片数 */
    totalChunks: number;
    /** 成功分片数 */
    successfulChunks: number;
    /** 失败分片数 */
    failedChunks: number;
    /** 分片成功率 */
    chunkSuccessRate: number;
  };
}

/**
 * 上传性能监控类
 */
class UploadMonitor {
  /** 上传记录列表 */
  private records: UploadRecord[] = [];
  
  /** 当前活跃的上传任务 */
  private activeUploads = new Map<string, UploadRecord>();
  
  /** 最大保留记录数 */
  private readonly MAX_RECORDS = 1000;
  
  constructor() {
    this.init();
  }
  
  /**
   * 初始化日志收集器
   */
  private init() {
    addLogCollector((entry) => {
      this.processLog(entry);
    });
  }
  
  /**
   * 处理日志条目
   */
  private processLog(entry: LogEntry) {
    // 追踪上传开始
    if (entry.module === 'UploadFile' && entry.message.includes('开始上传')) {
      const fileId = this.extractFileId(entry);
      if (fileId && !this.activeUploads.has(fileId)) {
        const record: UploadRecord = {
          fileId,
          fileName: this.extractFileName(entry) || 'unknown',
          fileSize: this.extractFileSize(entry) || 0,
          startTime: entry.timestamp,
          success: false,
          retryCount: 0,
        };
        
        this.activeUploads.set(fileId, record);
      }
    }
    
    // 追踪上传成功
    if (entry.module === 'UploadFile' && entry.message.includes('上传成功')) {
      const fileId = this.extractFileId(entry);
      if (fileId && this.activeUploads.has(fileId)) {
        const record = this.activeUploads.get(fileId)!;
        record.endTime = entry.timestamp;
        record.success = true;
        
        this.finalizeRecord(record);
        this.activeUploads.delete(fileId);
      }
    }
    
    // 追踪上传失败
    if (entry.level === LogLevel.ERROR) {
      const fileId = this.extractFileId(entry);
      
      // ChunkManager 级别的错误
      if (entry.module === 'ChunkManager') {
        if (fileId && this.activeUploads.has(fileId)) {
          const record = this.activeUploads.get(fileId)!;
          
          // ✅ 记录 ChunkManager 模块的错误
          if (!record.errorModules) {
            record.errorModules = new Map<string, number>();
          }
          record.errorModules.set('ChunkManager', (record.errorModules.get('ChunkManager') || 0) + 1);
          
          // 统计分片失败
          if (entry.message.includes('分片') && entry.message.includes('失败')) {
            record.failedChunks = (record.failedChunks || 0) + 1;
          }
          
          // 如果是最终失败（非重试）
          if (entry.message.includes('最终失败')) {
            record.endTime = entry.timestamp;
            record.success = false;
            record.error = entry.message;
            
            this.finalizeRecord(record);
            this.activeUploads.delete(fileId);
          }
        }
      }
      
      // UploadFile 级别的错误
      if (entry.module === 'UploadFile') {
        if (fileId && this.activeUploads.has(fileId)) {
          const record = this.activeUploads.get(fileId)!;
          
          // ✅ 记录 UploadFile 模块的错误
          if (!record.errorModules) {
            record.errorModules = new Map<string, number>();
          }
          record.errorModules.set('UploadFile', (record.errorModules.get('UploadFile') || 0) + 1);
          
          record.endTime = entry.timestamp;
          record.success = false;
          record.error = entry.message;
          
          this.finalizeRecord(record);
          this.activeUploads.delete(fileId);
        }
      }
    }
    
    // 追踪重试
    if (entry.module === 'UploadFile' && entry.message.includes('重试')) {
      const fileId = this.extractFileId(entry);
      if (fileId && this.activeUploads.has(fileId)) {
        const record = this.activeUploads.get(fileId)!;
        record.retryCount++;
      }
    }
    
    // 追踪分片信息
    if (entry.module === 'ChunkManager' && entry.message.includes('分片切割完成')) {
      const fileId = this.extractFileId(entry);
      if (fileId && this.activeUploads.has(fileId)) {
        const record = this.activeUploads.get(fileId)!;
        const totalChunks = this.extractTotalChunks(entry);
        if (totalChunks) {
          record.totalChunks = totalChunks;
          record.uploadedChunks = 0;
          record.failedChunks = 0;
        }
      }
    }
  }
  
  /**
   * 完成记录并添加到历史
   */
  private finalizeRecord(record: UploadRecord) {
    // 计算分片统计
    if (record.totalChunks) {
      record.uploadedChunks = record.totalChunks - (record.failedChunks || 0);
    }
    
    this.records.push(record);
    
    // 限制记录数量
    if (this.records.length > this.MAX_RECORDS) {
      this.records.shift();
    }
  }
  
  /**
   * 从日志条目中提取 fileId
   */
  private extractFileId(entry: LogEntry): string | null {
    // 尝试从 args 中提取
    if (entry.args?.length) {
      for (const arg of entry.args) {
        if (arg && typeof arg === 'object' && 'fileId' in arg) {
          return String(arg.fileId);
        }
      }
    }
    
    // 尝试从消息中提取（如果有）
    const match = entry.message.match(/fileId[=:]\s*(\w+)/);
    if (match) {
      return match[1];
    }
    
    return null;
  }
  
  /**
   * 从日志条目中提取文件名
   */
  private extractFileName(entry: LogEntry): string | null {
    if (entry.args?.length) {
      for (const arg of entry.args) {
        if (typeof arg === 'string' && (arg.endsWith('.pdf') || arg.endsWith('.jpg') || arg.endsWith('.png'))) {
          return arg;
        }
      }
    }
    return null;
  }
  
  /**
   * 从日志条目中提取文件大小
   */
  private extractFileSize(entry: LogEntry): number | null {
    if (entry.args?.length) {
      for (const arg of entry.args) {
        if (arg && typeof arg === 'object' && 'size' in arg && typeof arg.size === 'number') {
          return arg.size;
        }
      }
    }
    return null;
  }
  
  /**
   * 从日志条目中提取分片总数
   */
  private extractTotalChunks(entry: LogEntry): number | null {
    if (entry.args?.length) {
      for (const arg of entry.args) {
        if (arg && typeof arg === 'object' && 'totalChunks' in arg && typeof arg.totalChunks === 'number') {
          return arg.totalChunks;
        }
      }
    }
    
    // 尝试从消息中提取
    const match = entry.message.match(/(\d+)\s*\/\s*\d+/);
    if (match) {
      return parseInt(match[1], 10);
    }
    
    return null;
  }
  
  /**
   * 获取上传统计数据
   */
  public getStats(): UploadStats {
    const completedRecords = this.records.filter(r => r.endTime);
    
    if (completedRecords.length === 0) {
      return {
        totalUploads: 0,
        successfulUploads: 0,
        failedUploads: 0,
        successRate: 0,
        averageDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        medianDuration: 0,
        averageFileSize: 0,
        totalBytesUploaded: 0,
        averageSpeed: 0,
        errorsByType: new Map(),
        errorsByModule: new Map(),
        averageRetries: 0,
      };
    }
    
    const successful = completedRecords.filter(r => r.success);
    const failed = completedRecords.filter(r => !r.success);
    
    // 计算耗时统计
    const durations = completedRecords
      .map(r => r.endTime! - r.startTime)
      .filter(d => d > 0);
    
    const averageDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
    
    // 计算中位数
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const medianDuration = sortedDurations.length > 0
      ? sortedDurations[Math.floor(sortedDurations.length / 2)]
      : 0;
    
    // 计算文件大小统计
    const fileSizes = completedRecords.map(r => r.fileSize).filter(s => s > 0);
    const averageFileSize = fileSizes.length > 0
      ? Math.round(fileSizes.reduce((a, b) => a + b, 0) / fileSizes.length)
      : 0;
    
    const totalBytesUploaded = successful.reduce((sum, r) => sum + r.fileSize, 0);
    
    // 计算平均上传速度
    const totalDuration = durations.reduce((a, b) => a + b, 0);
    const averageSpeed = totalDuration > 0
      ? Math.round((totalBytesUploaded / (totalDuration / 1000)))
      : 0;
    
    // 统计错误类型
    const errorsByType = new Map<string, number>();
    const errorsByModule = new Map<string, number>();
    
    failed.forEach(record => {
      if (record.error) {
        // 按错误类型统计
        const errorType = this.classifyError(record.error);
        errorsByType.set(errorType, (errorsByType.get(errorType) || 0) + 1);
      }
      
      // ✅ 按模块统计错误数
      if (record.errorModules) {
        record.errorModules.forEach((count, module) => {
          errorsByModule.set(module, (errorsByModule.get(module) || 0) + count);
        });
      }
    });
    
    // 计算平均重试次数
    const totalRetries = completedRecords.reduce((sum, r) => sum + r.retryCount, 0);
    const averageRetries = completedRecords.length > 0
      ? Math.round((totalRetries / completedRecords.length) * 100) / 100
      : 0;
    
    // 分片上传统计
    const chunkRecords = completedRecords.filter(r => r.totalChunks);
    let chunkUploadStats: UploadStats['chunkUploadStats'] | undefined;
    
    if (chunkRecords.length > 0) {
      const totalChunks = chunkRecords.reduce((sum, r) => sum + (r.totalChunks || 0), 0);
      const successfulChunks = chunkRecords.reduce((sum, r) => sum + (r.uploadedChunks || 0), 0);
      const failedChunks = chunkRecords.reduce((sum, r) => sum + (r.failedChunks || 0), 0);
      
      chunkUploadStats = {
        totalChunks,
        successfulChunks,
        failedChunks,
        chunkSuccessRate: totalChunks > 0
          ? Math.round((successfulChunks / totalChunks) * 10000) / 100
          : 0,
      };
    }
    
    return {
      totalUploads: completedRecords.length,
      successfulUploads: successful.length,
      failedUploads: failed.length,
      successRate: Math.round((successful.length / completedRecords.length) * 10000) / 100,
      averageDuration,
      minDuration,
      maxDuration,
      medianDuration,
      averageFileSize,
      totalBytesUploaded,
      averageSpeed,
      errorsByType,
      errorsByModule,
      averageRetries,
      chunkUploadStats,
    };
  }
  
  /**
   * 分类错误类型
   */
  private classifyError(errorMessage: string): string {
    if (errorMessage.includes('网络') || errorMessage.includes('timeout')) {
      return 'NETWORK_ERROR';
    }
    if (errorMessage.includes('服务器') || errorMessage.includes('500')) {
      return 'SERVER_ERROR';
    }
    if (errorMessage.includes('未授权') || errorMessage.includes('401')) {
      return 'AUTH_ERROR';
    }
    if (errorMessage.includes('分片')) {
      return 'CHUNK_ERROR';
    }
    if (errorMessage.includes('合并')) {
      return 'MERGE_ERROR';
    }
    return 'UNKNOWN_ERROR';
  }
  
  /**
   * 获取最近 N 条上传记录
   */
  public getRecentRecords(count: number = 10): UploadRecord[] {
    return this.records.slice(-count).reverse();
  }
  
  /**
   * 获取活跃上传任务
   */
  public getActiveUploads(): Map<string, UploadRecord> {
    return new Map(this.activeUploads);
  }
  
  /**
   * 重置所有统计数据
   */
  public reset(): void {
    this.records = [];
    this.activeUploads.clear();
  }
  
  /**
   * 导出统计数据为 JSON
   */
  public exportToJSON(): string {
    const stats = this.getStats();
    
    // 转换 Map 为普通对象
    const serializableStats = {
      ...stats,
      errorsByType: Object.fromEntries(stats.errorsByType),
      errorsByModule: Object.fromEntries(stats.errorsByModule),
      exportedAt: new Date().toISOString(),
    };
    
    return JSON.stringify(serializableStats, null, 2);
  }
  
  /**
   * 打印统计报告到控制台
   */
  public printReport(): void {
    const stats = this.getStats();
    
    console.group('📊 上传性能监控报告');
    console.log('总上传数:', stats.totalUploads);
    console.log('成功上传:', stats.successfulUploads);
    console.log('失败上传:', stats.failedUploads);
    console.log('成功率:', `${stats.successRate}%`);
    console.log('平均耗时:', `${stats.averageDuration}ms`);
    console.log('最短耗时:', `${stats.minDuration}ms`);
    console.log('最长耗时:', `${stats.maxDuration}ms`);
    console.log('中位数耗时:', `${stats.medianDuration}ms`);
    console.log('平均文件大小:', `${stats.averageFileSize} bytes`);
    console.log('总上传数据量:', `${stats.totalBytesUploaded} bytes`);
    console.log('平均上传速度:', `${stats.averageSpeed} bytes/s`);
    console.log('平均重试次数:', stats.averageRetries);
    
    if (stats.chunkUploadStats) {
      console.group('分片上传统计');
      console.log('总分片数:', stats.chunkUploadStats.totalChunks);
      console.log('成功分片:', stats.chunkUploadStats.successfulChunks);
      console.log('失败分片:', stats.chunkUploadStats.failedChunks);
      console.log('分片成功率:', `${stats.chunkUploadStats.chunkSuccessRate}%`);
      console.groupEnd();
    }
    
    if (stats.errorsByType.size > 0) {
      console.group('错误类型分布');
      stats.errorsByType.forEach((count, type) => {
        console.log(`${type}:`, count);
      });
      console.groupEnd();
    }
    
    // ✅ 添加错误模块分布的打印
    if (stats.errorsByModule.size > 0) {
      console.group('错误模块分布');
      stats.errorsByModule.forEach((count, module) => {
        console.log(`${module}:`, count);
      });
      console.groupEnd();
    }
    
    console.groupEnd();
  }
}

// 单例实例
export const uploadMonitor = new UploadMonitor();
