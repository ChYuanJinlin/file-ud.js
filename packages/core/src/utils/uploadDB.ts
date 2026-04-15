import { openDB, IDBPDatabase } from "idb";

// 文件分块信息，索引和是否已上传的状态
export interface ChunkRecord {
  index: number;
  uploaded: boolean;
}

// 整个上传任务的记录，包含文件名，大小，分块大小，总分块数等信息，以及所有分块上传的装填
export interface UploadTaskRecord {
  id: string; // file md5
  filename: string; // 文件名
  size: number; // 文件大小
  chunkSize: number; // 分块大小
  totalChunks: number; // 总分块数
  chunks: ChunkRecord[]; // 所有分块上传的装填
  createdAt: number; // 创建时间
  updatedAt: number; // 更新时间
}
// 文件 Hash 缓存记录
export interface FileHashRecord {
  id: string; // 快速指纹: filename_lastModified_size
  hash: string; // 文件 MD5
  filename: string;
  size: number;
  lastModified: number;
  createdAt: number;
  updatedAt: number;
}
const DB_NAME = "FileUploadDB"; // 数据库名
const STORE_NAME = "uploadTasks"; // 存储对象名
const VERSION = 1; // 数据库版本
let dbInstance: IDBPDatabase<UploadTaskRecord> | null = null;
const HASH_STORE_NAME = "fileHashes"; // Hash 缓存存储对象名
// 初始化数据库（单例模式，避免重复打开）
export const initDB = async (): Promise<IDBPDatabase<UploadTaskRecord>> => {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    dbInstance = await openDB<UploadTaskRecord>(DB_NAME, VERSION, {
      upgrade(db) {
        // 创建存储对象
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          // 创建索引以便按更新时间查询
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        // 创建 Hash 缓存存储对象（新增）
        if (!db.objectStoreNames.contains(HASH_STORE_NAME)) {
          const hashStore = db.createObjectStore(HASH_STORE_NAME, {
            keyPath: "id",
          });
          hashStore.createIndex("hash", "hash", { unique: false });
          hashStore.createIndex("updatedAt", "updatedAt", { unique: false });
          hashStore.createIndex("size", "size", { unique: false });
        }
      },
    });
    return dbInstance;
  } catch (error) {
    console.error("IndexedDB 初始化失败:", error);
    throw new Error("IndexedDB 初始化失败");
  }
};

// 保存上传任务（新增或更新）
export const saveUploadTask = async (
  task: Omit<UploadTaskRecord, "updatedAt"> & Partial<UploadTaskRecord>,
): Promise<void> => {
  try {
    const db = await initDB();
    const now = Date.now();
    await db.put(STORE_NAME, {
      ...task,
      updatedAt: now,
      createdAt: task.createdAt || now,
    });
  } catch (error) {
    console.error("保存上传任务失败:", error);
    throw error;
  }
};

// 获取上传任务
export const getUploadTask = async (
  id: string,
): Promise<UploadTaskRecord | null> => {
  try {
    const db = await initDB();
    return await db.get(STORE_NAME, id);
  } catch (error) {
    console.error("获取上传任务失败:", error);
    return null;
  }
};
/**
 * 生成文件的快速指纹（使用文件属性）
 * @param filename 文件名
 * @param lastModified 最后修改时间
 * @param size 文件大小
 * @returns 快速指纹字符串
 */
export const generateQuickFingerprintFromProps = (
  filename: string,
  lastModified: number,
  size: number,
): string => {
  return `${filename}_${lastModified}_${size}`;
};
/**
 * 生成文件的快速指纹（用于缓存查找）
 * @param file 文件对象
 * @returns 快速指纹字符串
 */
export const generateQuickFingerprint = (file: File): string => {
  return `${file.name}_${file.lastModified}_${file.size}`;
};

/**
 * 获取文件 Hash（从缓存中）
 * @param file 文件对象或快速指纹
 * @returns Hash 值，不存在则返回 null
 */
export const getCachedHash = async (
  file: File | string,
): Promise<string | null> => {
  try {
    const db = await initDB();
    const fingerprint =
      typeof file === "string" ? file : generateQuickFingerprint(file);
    const record = await db.get(HASH_STORE_NAME, fingerprint);

    if (record) {
      return record.hash;
    }

    return null;
  } catch (error) {
    console.error("获取缓存 Hash 失败:", error);
    return null;
  }
};
// 删除上传任务
export const deleteUploadTask = async (id: string): Promise<void> => {
  try {
    const db = await initDB();
    await db.delete(STORE_NAME, id);
  } catch (error) {
    console.error("删除上传任务失败:", error);
    throw error;
  }
};
/**
 * 保存文件 Hash 到缓存
 * @param file 文件对象
 * @param hash 文件 MD5 Hash
 */
export const saveFileHash = async (file: File, hash: string): Promise<void> => {
  try {
    const db = await initDB();
    const fingerprint = generateQuickFingerprint(file);
    const now = Date.now();

    const record: FileHashRecord = {
      id: fingerprint,
      hash: hash,
      filename: file.name,
      size: file.size,
      lastModified: file.lastModified,
      createdAt: now,
      updatedAt: now,
    };

    await db.put(HASH_STORE_NAME, record);
    console.log(`💾 Hash 已缓存: ${fingerprint} -> ${hash}`);
  } catch (error) {
    console.error("保存 Hash 缓存失败:", error);
    throw error;
  }
};
/**
 * 更新单个分片的上传状态
 * @param taskId 任务ID（文件MD5）
 * @param chunkIndex 分片索引
 * @param uploaded 是否已上传
 */
export const updateChunkStatus = async (
  taskId: string,
  chunkIndex: number,
  uploaded: boolean,
): Promise<void> => {
  try {
    const db = await initDB();
    const task = await db.get(STORE_NAME, taskId);

    if (!task) {
      console.warn(`任务 ${taskId} 不存在`);
      return;
    }

    // 更新对应分片的状态
    const chunk = task.chunks.find((c: ChunkRecord) => c.index === chunkIndex);
    if (chunk) {
      chunk.uploaded = uploaded;
    } else {
      task.chunks.push({ index: chunkIndex, uploaded });
    }

    // 保存更新后的任务
    await db.put(STORE_NAME, {
      ...task,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error("更新分片状态失败:", error);
    throw error;
  }
};

/**
 * 获取所有未完成的上传任务
 * @param maxAge 最大年龄（毫秒），超过此时间的任务视为过期，默认为 7 天
 */
export const getIncompleteTasks = async (
  maxAge?: number,
): Promise<UploadTaskRecord[]> => {
  try {
    const db = await initDB();
    const allTasks = await db.getAll(STORE_NAME);

    // 过滤出未完成的任务
    const incompleteTasks = allTasks.filter((task: UploadTaskRecord) => {
      const isCompleted = task.chunks.every(
        (chunk: ChunkRecord) => chunk.uploaded,
      );
      return !isCompleted;
    });

    // 如果指定了最大年龄，过滤过期任务
    if (maxAge !== undefined) {
      const now = Date.now();
      return incompleteTasks.filter((task) => now - task.updatedAt < maxAge);
    }

    return incompleteTasks;
  } catch (error) {
    console.error("获取未完成任务失败:", error);
    return [];
  }
};

/**
 * 清理过期的上传任务
 * @param maxAge 最大年龄（毫秒），默认为 7 天
 */
export const cleanupExpiredTasks = async (
  maxAge: number = 7 * 24 * 60 * 60 * 1000,
): Promise<number> => {
  try {
    const db = await initDB();
    const allTasks = await db.getAll(STORE_NAME);
    const now = Date.now();
    let deletedCount = 0;

    for (const task of allTasks) {
      // 删除已完成或过期的任务
      const isCompleted = task.chunks.every(
        (chunk: ChunkRecord) => chunk.uploaded,
      );
      const isExpired = now - task.updatedAt > maxAge;

      if (isCompleted || isExpired) {
        await db.delete(STORE_NAME, task.id);
        deletedCount++;
      }
    }

    console.log(`清理了 ${deletedCount} 个过期/已完成的任务`);
    return deletedCount;
  } catch (error) {
    console.error("清理过期任务失败:", error);
    return 0;
  }
};

/**
 * 关闭数据库连接（通常在应用卸载时调用）
 */
export const closeDB = (): void => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
};
