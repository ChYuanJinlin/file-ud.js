import ChunkManager from "../chunkManager";
import { IFile, speedInfo, TimeInfo } from "../types";

export default class TransferFile<T = any> {
  /**
   * 上传速率统计信息
   * 包含瞬时速度、平均速度及其格式化字符串
   * 通过 Proxy 自动触发全局速率聚合
   */
  public speed: speedInfo = {
    currentSpeed: 0,
    averageSpeed: 0,
    currentSpeedFormatted: "0 B/s",
    averageSpeedFormatted: "0 B/s",
  };

  /**
   * 上传时间统计信息
   * 记录文件从开始到结束的完整耗时
   * 通过 Proxy 自动触发 UI 更新
   */
  public transferTime: TimeInfo = {
    startTime: 0,
    endTime: 0,
    duration: 0,
    durationFormatted: "0s",
  };

  /** 文件唯一标识符 */
  fileId: string;
  /** Proxy 代理对象,用于实现响应式更新 */
  proxy: T;

  /** 文件预览 URL (Object URL) */
  url: string;

  /** 文件名称 */
  fileName: string;

  /** 原始 File 对象 */
  File: File;

  /** 上传进度百分比 (0-100) */
  percent: number | undefined;

  /** 是否正在上传 */
  loading: boolean;

  /** 文件上传状态 */
  status: IFile["status"];
  isCancel: boolean = false;
  /** 文件扩展名 */
  extension: string | undefined;

  public hashPercent = 0;
  public hashLoading = false;
  /** 格式化后的文件大小,如 "5.23 MB" */
  formatSize: string | undefined;

  /** 当前文件已上传的大小（格式化字符串），如 "45.23 MB" */
  transferFormatSize: string = "0 B";

  /** 表单数据对象,用于携带上传参数 */
  formData: FormData | null = null;
  chunkManager: ChunkManager | null = null;
  /** 是否处于重试状态 */
  isRetry?: boolean;

  /** Promise resolve 回调引用 */
  resolve: ((value: any) => void | undefined) | undefined;

  /** Promise reject 回调引用 */
  reject: ((reason?: any) => void | undefined) | undefined;

  /** 文件在队列中的索引 */
  index?: number;

  /** 取消上传的函数 */
  abort: IFile["abort"];
  /** 标记是否已计入总字节数（避免重试时重复累加） */
  public __hasCountedTotalBytes__: boolean = false;
  /** 当前文件已上传的字节数（用于普通上传计算总进度） */
  public __transferBytes__: number = 0;

  constructor(file: IFile) {
    this.fileId = file.fileId;
    this.url = file.url;
    this.fileName = file.fileName;
    this.File = file.File;
    this.percent = file.percent;
    this.status = file.status;
    this.loading = false;
    this.extension = file.extension;
    this.formatSize = file.formatSize;
    this.proxy = null as any; // 代理对象将在外部创建后赋值
    this.abort = file.abort;
    this.index = file.index!;
    this.isRetry = file.isRetry || false;
  }
}
