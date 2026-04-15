/**
 * 统一日志工具模块
 * 
 * 提供环境感知的日志输出，支持级别控制和格式化
 * 
 * @example
 * ```typescript
 * import { logger } from './utils/logger';
 * 
 * logger.info('ChunkManager', '开始上传分片');
 * logger.debug('ChunkManager', '分片详情', { index: 0, size: 1024 });
 * logger.warn('ChunkManager', '更新状态失败:', error);
 * logger.error('ChunkManager', '上传失败', error);
 * ```
 */

// Node.js process 类型声明（兼容浏览器环境）
declare const process: {
  env?: {
    NODE_ENV?: string;
    VITE_LOG_LEVEL?: string;
    LOG_LEVEL?: string;
  };
};

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,  // 调试信息（仅开发环境）
  INFO = 1,   // 一般信息
  WARN = 2,   // 警告信息
  ERROR = 3,  // 错误信息
}

/**
 * 日志配置选项
 */
export interface LoggerOptions {
  /** 是否启用日志输出（默认 true） */
  enabled?: boolean;
  /** 最低日志级别 */
  level?: LogLevel;
  /** 是否显示时间戳 */
  showTimestamp?: boolean;
  /** 是否启用颜色输出 */
  enableColors?: boolean;
}

/**
 * 日志条目接口
 */
export interface LogEntry {
  /** 时间戳 */
  timestamp: number;
  /** 日志级别 */
  level: LogLevel;
  /** 模块名称 */
  module: string;
  /** 消息内容 */
  message: string;
  /** 额外参数 */
  args?: any[];
  /** 错误堆栈（如果是 Error 对象） */
  stack?: string;
}

/**
 * 日志收集器回调函数类型
 */
export type LogCollectorCallback = (entry: LogEntry) => void | Promise<void>;

/**
 * 日志级别标签映射
 */
const LEVEL_LABELS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

/**
 * 日志级别颜色映射（ANSI 颜色代码）
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[36m',  // 青色
  [LogLevel.INFO]: '\x1b[32m',   // 绿色
  [LogLevel.WARN]: '\x1b[33m',   // 黄色
  [LogLevel.ERROR]: '\x1b[31m',  // 红色
};

const RESET_COLOR = '\x1b[0m';

/**
 * 默认配置
 */
const DEFAULT_OPTIONS: LoggerOptions = {
  enabled: true,
  level: typeof process !== 'undefined' && process.env?.NODE_ENV === 'production' 
    ? LogLevel.WARN 
    : LogLevel.DEBUG,
  showTimestamp: true,
  enableColors: typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production',
};

/**
 * 当前日志配置
 */
let currentOptions: LoggerOptions = { ...DEFAULT_OPTIONS };

/**
 * 日志收集器回调列表
 */
const logCollectors: LogCollectorCallback[] = [];

/**
 * 从环境变量读取日志级别
 */
function getLogLevelFromEnv(): LogLevel | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined;
  
  const envLevel = process.env.VITE_LOG_LEVEL || process.env.LOG_LEVEL;
  if (!envLevel) return undefined;

  const levelMap: Record<string, LogLevel> = {
    debug: LogLevel.DEBUG,
    info: LogLevel.INFO,
    warn: LogLevel.WARN,
    error: LogLevel.ERROR,
  };

  return levelMap[envLevel.toLowerCase()];
}

/**
 * 初始化日志配置
 * @param options 日志配置选项
 */
export function initLogger(options?: LoggerOptions): void {
  const envLevel = getLogLevelFromEnv();
  
  currentOptions = {
    ...DEFAULT_OPTIONS,
    ...(options || {}),
    // 环境变量优先级最高
    ...(envLevel !== undefined ? { level: envLevel } : {}),
  };

  console.log(`[Logger] Initialized with level: ${LEVEL_LABELS[currentOptions.level!]}`);
}

/**
 * 动态设置日志级别
 * @param level 日志级别
 */
export function setLogLevel(level: LogLevel): void {
  currentOptions.level = level;
}

/**
 * 注册日志收集器
 * @param callback 收集器回调函数
 * @returns 取消注册的函数
 * 
 * @example
 * ```typescript
 * // 注册收集器
 * const unsubscribe = addLogCollector((entry) => {
 *   if (entry.level === LogLevel.ERROR) {
 *     // 上报到监控平台
 *     reportToSentry(entry);
 *   }
 * });
 * 
 * // 取消注册
 * unsubscribe();
 * ```
 */
export function addLogCollector(callback: LogCollectorCallback): () => void {
  logCollectors.push(callback);
  
  // 返回取消注册的函数
  return () => {
    const index = logCollectors.indexOf(callback);
    if (index > -1) {
      logCollectors.splice(index, 1);
    }
  };
}

/**
 * 清除所有日志收集器
 */
export function clearLogCollectors(): void {
  logCollectors.length = 0;
}

/**
 * 格式化日志消息
 * @param level 日志级别
 * @param module 模块名称
 * @param message 消息内容
 * @param args 额外参数
 */
function formatMessage(
  level: LogLevel,
  module: string,
  message: string,
  args: any[]
): string {
  const parts: string[] = [];

  // 时间戳
  if (currentOptions.showTimestamp) {
    const now = new Date();
    // ✅ 使用本地时间格式化，而不是 toISOString()（UTC 时间）
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    const timeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
    parts.push(`[${timeStr}]`);
  }

  // 级别标签
  const label = LEVEL_LABELS[level];
  if (currentOptions.enableColors) {
    parts.push(`${LEVEL_COLORS[level]}[${label}]${RESET_COLOR}`);
  } else {
    parts.push(`[${label}]`);
  }

  // 模块名称
  parts.push(`[${module}]`);

  // 消息内容
  parts.push(message);

  return parts.join(' ');
}

/**
 * 提取错误堆栈
 * @param arg 参数
 * @returns 堆栈字符串或 null
 */
function extractStack(arg: any): string | null {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  return null;
}

/**
 * 输出日志并触发收集器
 * @param level 日志级别
 * @param module 模块名称
 * @param message 消息内容
 * @param args 额外参数
 */
function log(level: LogLevel, module: string, message: string, ...args: any[]): void {
  // 检查是否启用日志
  if (!currentOptions.enabled) {
    return;
  }

  // 检查日志级别
  if (level < (currentOptions.level ?? LogLevel.DEBUG)) {
    return;
  }

  const formattedMessage = formatMessage(level, module, message, args);

  // ✅ 关键修复：使用 Error().stack 获取真实的调用位置
  // 这样浏览器控制台的代码跳转会指向调用日志的位置，而不是 logger 文件
  let stackInfo: string | undefined;
  try {
    const error = new Error();
    const stackLines = error.stack?.split('\n') || [];
    // stack 格式: 
    // Error
    //     at log (logger/index.ts:xxx:yy)        ← 当前函数
    //     at Object.info (logger/index.ts:xxx:yy) ← logger 对象方法
    //     at actualCaller (caller.ts:xxx:yy)     ← 真实调用者（我们要这个！）
    // 跳过前两行，取第三行作为调用位置
    if (stackLines.length >= 3) {
      stackInfo = stackLines[3].trim();
    }
  } catch (e) {
    // 忽略错误
  }

  // ✅ 将调用位置信息添加到参数中
  // 浏览器控制台会自动解析这个位置并支持点击跳转
  const outputArgs = stackInfo ? [...args, `\n    ${stackInfo}`] : args;

  // 根据级别选择输出方法
  switch (level) {
    case LogLevel.DEBUG:
      console.debug(formattedMessage, ...outputArgs);
      break;
    case LogLevel.INFO:
      console.info(formattedMessage, ...outputArgs);
      break;
    case LogLevel.WARN:
      console.warn(formattedMessage, ...outputArgs);
      break;
    case LogLevel.ERROR:
      console.error(formattedMessage, ...outputArgs);
      break;
  }

  // 触发日志收集器
  if (logCollectors.length > 0) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      module,
      message,
      args,
    };

    // 提取错误堆栈
    const stack = args.find(extractStack);
    if (stack) {
      entry.stack = extractStack(stack) || undefined;
    }

    // 异步调用所有收集器
    logCollectors.forEach((collector) => {
      try {
        const result = collector(entry);
        // 如果返回 Promise，捕获可能的错误
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error('[Logger] Collector error:', error);
          });
        }
      } catch (error) {
        console.error('[Logger] Collector error:', error);
      }
    });
  }
}

/**
 * 日志工具对象
 */
export const logger = {
  /**
   * 调试日志（仅开发环境）
   * @param module 模块名称
   * @param message 消息内容
   * @param args 额外参数
   */
  debug: (module: string, message: string, ...args: any[]) => {
    message = `🔍 ${message}`;
    log(LogLevel.DEBUG, module, message, ...args);
  },

  /**
   * 信息日志
   * @param module 模块名称
   * @param message 消息内容
   * @param args 额外参数
   */
  info: (module: string, message: string, ...args: any[]) => {
    message = `✅ ${message}`;
    log(LogLevel.INFO, module, message, ...args);
  },

  /**
   * 警告日志
   * @param module 模块名称
   * @param message 消息内容
   * @param args 额外参数
   */
  warn: (module: string, message: string, ...args: any[]) => {
    message = `⚠️ ${message}`;
    log(LogLevel.WARN, module, message, ...args);
  },

  /**
   * 错误日志
   * @param module 模块名称
   * @param message 消息内容
   * @param args 额外参数
   */
  error: (module: string, message: string, ...args: any[]) => {
    message = `❌ ${message}`;
    log(LogLevel.ERROR, module, message, ...args);
  },
};

