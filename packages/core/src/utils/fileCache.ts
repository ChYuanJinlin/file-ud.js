/**
 * IndexedDB 文件缓存工具
 * 用于持久化存储 File 对象，支持断点续传时的文件恢复
 */

import { logger } from './logger';

const DB_NAME = 'file-ud-cache';
const DB_VERSION = 1;
const STORE_NAME = 'files';

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

/**
 * 打开或创建 IndexedDB 数据库
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      logger.error('FileCache', '打开 IndexedDB 失败', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // 创建对象存储空间
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'fileHash' });
        
        // 创建索引
        store.createIndex('fileName', 'fileName', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
        
        logger.info('FileCache', 'IndexedDB 数据库初始化成功');
      }
    };
  });
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
    const db = await openDB();
    
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

    return new Promise((resolve, reject) => {
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
    const db = await openDB();

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
    const db = await openDB();

    return new Promise((resolve, reject) => {
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
    const db = await openDB();

    return new Promise((resolve, reject) => {
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
    const db = await openDB();

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
    const db = await openDB();
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;

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
    const db = await openDB();

    return new Promise((resolve, reject) => {
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
    });
  } catch (error) {
    logger.warn('FileCache', '更新访问时间异常', error);
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
