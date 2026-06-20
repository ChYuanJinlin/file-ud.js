/**
 * IndexedDB 文件缓存工具
 * 用于持久化存储 File 对象，支持断点续传时的文件恢复
 */

import { formatFileSize } from '.';
import { logger } from './logger';

const DB_NAME = 'file-ud-cache';
const DB_VERSION = 3;
const STORE_NAME = 'files';
const DOWNLOAD_PROGRESS_STORE = 'download-progress';
const FILE_HANDLE_STORE = 'file-handles';

/**
 * 文件缓存记录结构
 */
interface FileCacheRecord {
  fileHash: string;      // 文件哈希（主键）
  fileName: string;      // 文件名
  fileType: string;      // 文件类型
  fileSize: number;      // 文件大小
  data: ArrayBuffer;     // 文件二进制数据
  createdAt: number;     // 创建时间戳
  lastAccessedAt: number; // 最后访问时间戳
}

// ✅ 数据库连接单例
let dbInstance: IDBDatabase | null = null;
let dbOpeningPromise: Promise<IDBDatabase> | null = null;

/**
 * 打开或创建 IndexedDB 数据库（单例模式）
 */
function openDB(): Promise<IDBDatabase> {
  // ✅ 如果已有有效连接，直接返回
  if (dbInstance && dbInstance.version === DB_VERSION) {
    try {
      // 测试连接是否仍然有效
      dbInstance.transaction([STORE_NAME], 'readonly');
      return Promise.resolve(dbInstance);
    } catch (error) {
      // 连接已失效，重置
      logger.warn('FileCache', '数据库连接已失效，重新打开', error);
      dbInstance = null;
      dbOpeningPromise = null;
    }
  }

  // ✅ 如果正在打开中，返回同一个 Promise
  if (dbOpeningPromise) {
    return dbOpeningPromise;
  }

  // ✅ 创建新的打开请求
  dbOpeningPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      logger.error('FileCache', '打开 IndexedDB 失败', request.error);
      dbOpeningPromise = null;
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbOpeningPromise = null;
      
      // ✅ 监听连接关闭事件
      dbInstance.onclose = () => {
        logger.warn('FileCache', '数据库连接已关闭');
        dbInstance = null;
      };
      
      // ✅ 监听连接异常事件
      dbInstance.onerror = (event) => {
        logger.error('FileCache', '数据库连接错误', event);
        dbInstance = null;
      };
      
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 创建文件缓存存储空间
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'fileHash' });

        // 创建索引
        store.createIndex('fileName', 'fileName', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });

        logger.info('FileCache', 'IndexedDB 文件缓存存储初始化成功');
      }

      // 创建下载进度存储空间
      if (!db.objectStoreNames.contains(DOWNLOAD_PROGRESS_STORE)) {
        const progressStore = db.createObjectStore(DOWNLOAD_PROGRESS_STORE, { keyPath: 'fileHash' });
        progressStore.createIndex('updatedAt', 'updatedAt', { unique: false });

        logger.info('FileCache', 'IndexedDB 下载进度存储初始化成功');
      }

      // 🔑 创建文件句柄存储空间（跨会话复用 File Handle）
      if (!db.objectStoreNames.contains(FILE_HANDLE_STORE)) {
        const handleStore = db.createObjectStore(FILE_HANDLE_STORE, { keyPath: 'fileName' });
        handleStore.createIndex('updatedAt', 'updatedAt', { unique: false });

        logger.info('FileCache', 'IndexedDB 文件句柄存储初始化成功');
      }
    };
  });

  return dbOpeningPromise;
}

/**
 * 关闭数据库连接（用于清理资源）
 */
export function closeDB(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
      logger.debug('FileCache', '数据库连接已关闭');
    } catch (error) {
      logger.warn('FileCache', '关闭数据库连接时出错', error);
    } finally {
      dbInstance = null;
      dbOpeningPromise = null;
    }
  }
}

/**
 * 执行 IndexedDB 事务的通用包装器
 * @param operation - 事务操作函数
 * @returns Promise<T>
 */
async function executeTransaction<T>(
  operation: (db: IDBDatabase) => Promise<T>
): Promise<T> {
  try {
    const db = await openDB();
    return await operation(db);
  } catch (error) {
    // ✅ 捕获 InvalidStateError，重置连接并重试一次
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      logger.warn('FileCache', '检测到无效状态错误，重置连接后重试', error);
      closeDB();
      
      // 重试一次
      const db = await openDB();
      return await operation(db);
    }
    throw error;
  }
}

/**
 * 保存 File 对象到 IndexedDB
 * 
 * @param fileHash - 文件哈希值（作为主键）
 * @param file - File 对象
 * @returns Promise<void>
 */
export async function saveFileToCache(fileHash: string, file: File): Promise<void> {
  try {
    // 将 File 转换为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    const record: FileCacheRecord = {
      fileHash,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      data: arrayBuffer,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };

    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(record);

        request.onsuccess = () => {
          logger.debug('FileCache', `文件已缓存: ${file.name} (${formatFileSize(file.size)})`, {
            fileHash,
            fileSize: file.size,
          });
          resolve();
        };

        request.onerror = () => {
          logger.error('FileCache', '保存文件缓存失败', request.error);
          reject(request.error);
        };
        
        transaction.onerror = () => {
          logger.error('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.error('FileCache', '保存文件缓存异常', error);
    throw error;
  }
}

/**
 * 从 IndexedDB 恢复 File 对象
 * 
 * @param fileHash - 文件哈希值
 * @returns Promise<File | null> - 如果找到则返回 File 对象，否则返回 null
 */
export async function restoreFileFromCache(fileHash: string): Promise<File | null> {
  try {
    return await executeTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(fileHash);

        request.onsuccess = () => {
          const record: FileCacheRecord | undefined = request.result;
          
          if (!record) {
            logger.debug('FileCache', `未找到缓存文件: ${fileHash}`);
            resolve(null);
            return;
          }

          // 更新最后访问时间
          updateLastAccessedTime(fileHash);

          // 将 ArrayBuffer 转换回 File
          const blob = new Blob([record.data], { type: record.fileType });
          const file = new File([blob], record.fileName, { type: record.fileType });

          logger.debug('FileCache', `成功恢复缓存文件: ${record.fileName}`, {
            fileHash,
            fileSize: record.fileSize,
          });

          resolve(file);
        };

        request.onerror = () => {
          logger.error('FileCache', '恢复文件缓存失败', request.error);
          reject(request.error);
        };
        
        transaction.onerror = () => {
          logger.error('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.error('FileCache', '恢复文件缓存异常', error);
    throw error;
  }
}

/**
 * 删除指定文件的缓存
 * 
 * @param fileHash - 文件哈希值
 * @returns Promise<void>
 */
export async function removeFileFromCache(fileHash: string): Promise<void> {
  try {
    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(fileHash);

        request.onsuccess = () => {
          logger.debug('FileCache', `已删除文件缓存: ${fileHash}`);
          resolve();
        };

        request.onerror = () => {
          logger.error('FileCache', '删除文件缓存失败', request.error);
          reject(request.error);
        };
        
        transaction.onerror = () => {
          logger.error('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.error('FileCache', '删除文件缓存异常', error);
    throw error;
  }
}

/**
 * 清空所有文件缓存
 * 
 * @returns Promise<void>
 */
export async function clearAllFileCache(): Promise<void> {
  try {
    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          logger.info('FileCache', '已清空所有文件缓存');
          resolve();
        };

        request.onerror = () => {
          logger.error('FileCache', '清空文件缓存失败', request.error);
          reject(request.error);
        };
        
        transaction.onerror = () => {
          logger.error('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.error('FileCache', '清空文件缓存异常', error);
    throw error;
  }
}

/**
 * 获取缓存统计信息
 * 
 * @returns Promise<{ count: number; totalSize: number }>
 */
export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
  try {
    return await executeTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const records: FileCacheRecord[] = request.result || [];
          const totalSize = records.reduce((sum, record) => sum + record.fileSize, 0);
          
          resolve({
            count: records.length,
            totalSize,
          });
        };

        request.onerror = () => {
          logger.error('FileCache', '获取缓存统计失败', request.error);
          reject(request.error);
        };
        
        transaction.onerror = () => {
          logger.error('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.error('FileCache', '获取缓存统计异常', error);
    throw error;
  }
}

/**
 * 清理过期缓存（超过指定天数的缓存）
 * 
 * @param days - 保留天数，默认 7 天
 * @returns Promise<number> - 删除的记录数
 */
export async function cleanExpiredCache(days: number = 7): Promise<number> {
  try {
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

    return await executeTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('lastAccessedAt');
        const request = index.getAll();

        request.onsuccess = () => {
          const records: FileCacheRecord[] = request.result || [];
          const expiredRecords = records.filter(
            (record) => record.lastAccessedAt < cutoffTime
          );

          let deletedCount = 0;

          // 删除过期记录
          const deletePromises = expiredRecords.map((record) => {
            return new Promise<void>((resolveDelete, rejectDelete) => {
              const deleteRequest = store.delete(record.fileHash);
              deleteRequest.onsuccess = () => {
                deletedCount++;
                resolveDelete();
              };
              deleteRequest.onerror = () => {
                logger.error('FileCache', `删除过期缓存失败: ${record.fileHash}`, deleteRequest.error);
                resolveDelete(); // 继续处理其他记录
              };
            });
          });

          Promise.all(deletePromises).then(() => {
            if (deletedCount > 0) {
              logger.info('FileCache', `已清理 ${deletedCount} 个过期缓存`);
            }
            resolve(deletedCount);
          });
        };

        request.onerror = () => {
          logger.error('FileCache', '查询过期缓存失败', request.error);
          reject(request.error);
        };
        
        transaction.onerror = () => {
          logger.error('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.error('FileCache', '清理过期缓存异常', error);
    throw error;
  }
}

/**
 * 更新文件的最后访问时间
 * 
 * @param fileHash - 文件哈希值
 */
async function updateLastAccessedTime(fileHash: string): Promise<void> {
  try {
    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(fileHash);

        request.onsuccess = () => {
          const record: FileCacheRecord | undefined = request.result;
          
          if (record) {
            record.lastAccessedAt = Date.now();
            const updateRequest = store.put(record);
            
            updateRequest.onsuccess = () => resolve();
            updateRequest.onerror = () => {
              logger.warn('FileCache', '更新访问时间失败', updateRequest.error);
              resolve(); // 不阻塞主流程
            };
          } else {
            resolve();
          }
        };

        request.onerror = () => {
          logger.warn('FileCache', '查询记录失败', request.error);
          resolve(); // 不阻塞主流程
        };
        
        transaction.onerror = () => {
          logger.warn('FileCache', '事务执行失败', transaction.error);
          resolve(); // 不阻塞主流程
        };
      });
    });
  } catch (error) {
    logger.warn('FileCache', '更新访问时间异常', error);
    // 不抛出错误，避免影响主流程
  }
}

// ==================== 下载进度缓存 ====================

/**
 * 下载进度缓存记录结构
 */
interface DownloadProgressRecord {
  fileHash: string;          // 文件唯一标识
  fileName: string;
  fileSize: number;
  totalChunks: number;
  completedChunks: number;
  chunkIndexes: number[];   // 已下载的分片索引
  updatedAt: number;
}

/**
 * 保存下载进度到 IndexedDB
 */
export async function saveDownloadProgress(
  fileHash: string,
  fileName: string,
  fileSize: number,
  totalChunks: number,
  chunkIndexes: number[],
): Promise<void> {
  try {
    const record: DownloadProgressRecord = {
      fileHash,
      fileName,
      fileSize,
      totalChunks,
      completedChunks: chunkIndexes.length,
      chunkIndexes,
      updatedAt: Date.now(),
    };

    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([DOWNLOAD_PROGRESS_STORE], 'readwrite');
        const store = transaction.objectStore(DOWNLOAD_PROGRESS_STORE);
        const request = store.put(record);

        request.onsuccess = () => {
          logger.debug('FileCache', `下载进度已保存: ${fileName} (${chunkIndexes.length}/${totalChunks})`);
          resolve();
        };

        request.onerror = () => {
          logger.warn('FileCache', '保存下载进度失败', request.error);
          reject(request.error);
        };

        transaction.onerror = () => {
          logger.warn('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.warn('FileCache', '保存下载进度异常', error);
  }
}

/**
 * 从 IndexedDB 加载下载进度
 * @returns 已完成分片索引数组，未找到则返回 null
 */
export async function loadDownloadProgress(
  fileHash: string,
): Promise<{
  fileName: string;
  fileSize: number;
  totalChunks: number;
  chunkIndexes: number[];
} | null> {
  try {
    return await executeTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([DOWNLOAD_PROGRESS_STORE], 'readonly');
        const store = transaction.objectStore(DOWNLOAD_PROGRESS_STORE);
        const request = store.get(fileHash);

        request.onsuccess = () => {
          const record: DownloadProgressRecord | undefined = request.result;

          if (!record) {
            logger.debug('FileCache', `未找到下载进度: ${fileHash}`);
            resolve(null);
            return;
          }

          logger.info('FileCache', `加载下载进度: ${record.fileName} (${record.completedChunks}/${record.totalChunks})`);

          resolve({
            fileName: record.fileName,
            fileSize: record.fileSize,
            totalChunks: record.totalChunks,
            chunkIndexes: record.chunkIndexes,
          });
        };

        request.onerror = () => {
          logger.warn('FileCache', '加载下载进度失败', request.error);
          reject(request.error);
        };

        transaction.onerror = () => {
          logger.warn('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.warn('FileCache', '加载下载进度异常', error);
    return null;
  }
}

/**
 * 删除指定文件的下载进度记录
 */
export async function removeDownloadProgress(fileHash: string): Promise<void> {
  try {
    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([DOWNLOAD_PROGRESS_STORE], 'readwrite');
        const store = transaction.objectStore(DOWNLOAD_PROGRESS_STORE);
        const request = store.delete(fileHash);

        request.onsuccess = () => {
          logger.debug('FileCache', `已删除下载进度: ${fileHash}`);
          resolve();
        };

        request.onerror = () => {
          logger.warn('FileCache', '删除下载进度失败', request.error);
          reject(request.error);
        };

        transaction.onerror = () => {
          logger.warn('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.warn('FileCache', '删除下载进度异常', error);
  }
}

// ==================== 文件句柄持久化（跨会话复用 File System Access Handle） ====================

/**
 * 文件句柄缓存记录结构
 */
interface FileHandleRecord {
  fileName: string;           // 文件名（主键）
  fileHandle: FileSystemFileHandle;  // 文件系统句柄（IndexedDB 可序列化）
  updatedAt: number;
}

/**
 * 将 FileSystemFileHandle 持久化到 IndexedDB（跨页面刷新复用）
 *
 * 关键是避免重复调用 showSaveFilePicker() 导致 Chrome 截断已有文件为 0 字节。
 */
export async function saveFileHandle(
  fileName: string,
  fileHandle: FileSystemFileHandle,
): Promise<void> {
  try {
    const record: FileHandleRecord = {
      fileName,
      fileHandle,
      updatedAt: Date.now(),
    };

    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([FILE_HANDLE_STORE], 'readwrite');
        const store = transaction.objectStore(FILE_HANDLE_STORE);
        const request = store.put(record);

        request.onsuccess = () => {
          logger.debug('FileCache', `文件句柄已持久化: ${fileName}`);
          resolve();
        };

        request.onerror = () => {
          logger.warn('FileCache', '保存文件句柄失败', request.error);
          reject(request.error);
        };

        transaction.onerror = () => {
          logger.warn('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.warn('FileCache', '保存文件句柄异常', error);
  }
}

/**
 * 从 IndexedDB 加载持久化的 FileSystemFileHandle
 * @returns FileSystemFileHandle（未找到或已失效则返回 null）
 */
export async function loadFileHandle(
  fileName: string,
): Promise<FileSystemFileHandle | null> {
  try {
    return await executeTransaction(async (db) => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([FILE_HANDLE_STORE], 'readonly');
        const store = transaction.objectStore(FILE_HANDLE_STORE);
        const request = store.get(fileName);

        request.onsuccess = () => {
          const record: FileHandleRecord | undefined = request.result;

          if (!record) {
            logger.debug('FileCache', `未找到持久化文件句柄: ${fileName}`);
            resolve(null);
            return;
          }

          // 🔑 验证句柄仍有效
          try {
            // 简单的权限检查：尝试获取文件信息
            record.fileHandle.getFile().then(
              () => {
                logger.debug('FileCache', `文件句柄有效: ${fileName}`);
                resolve(record.fileHandle);
              },
              () => {
                logger.warn('FileCache', `文件句柄已失效（权限撤销）: ${fileName}`);
                // 异步清理失效句柄
                removeFileHandle(fileName);
                resolve(null);
              },
            );
          } catch {
            // 同步方式失败
            removeFileHandle(fileName);
            resolve(null);
          }
        };

        request.onerror = () => {
          logger.warn('FileCache', '加载文件句柄失败', request.error);
          reject(request.error);
        };

        transaction.onerror = () => {
          logger.warn('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.warn('FileCache', '加载文件句柄异常', error);
    return null;
  }
}

/**
 * 删除指定文件的句柄记录
 */
export async function removeFileHandle(fileName: string): Promise<void> {
  try {
    await executeTransaction(async (db) => {
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction([FILE_HANDLE_STORE], 'readwrite');
        const store = transaction.objectStore(FILE_HANDLE_STORE);
        const request = store.delete(fileName);

        request.onsuccess = () => {
          logger.debug('FileCache', `已删除文件句柄: ${fileName}`);
          resolve();
        };

        request.onerror = () => {
          logger.warn('FileCache', '删除文件句柄失败', request.error);
          reject(request.error);
        };

        transaction.onerror = () => {
          logger.warn('FileCache', '事务执行失败', transaction.error);
          reject(transaction.error);
        };
      });
    });
  } catch (error) {
    logger.warn('FileCache', '删除文件句柄异常', error);
  }
}
