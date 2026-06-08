/**
 * File System Access API 类型声明
 *
 * 浏览器支持：Chrome 86+, Edge 86+, Opera 72+
 * 参考：https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API
 */

interface FileSystemWritableFileStream extends WritableStream {
  write(data: FileSystemWriteChunkType): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

type FileSystemWriteChunkType =
  | BufferSource
  | Blob
  | string
  | {
      type: "write";
      position: number;
      data: BufferSource | Blob | string;
    }
  | {
      type: "seek";
      position: number;
    }
  | {
      type: "truncate";
      size: number;
    };

interface FileSystemCreateWritableOptions {
  keepExistingData?: boolean;
}

interface FileSystemFileHandle {
  kind: "file";
  name: string;
  createWritable(
    options?: FileSystemCreateWritableOptions,
  ): Promise<FileSystemWritableFileStream>;
  createSyncAccessHandle?(): Promise<FileSystemSyncAccessHandle>;
  getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle {
  kind: "directory";
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
  values(): AsyncIterableIterator<FileSystemHandle>;
  keys(): AsyncIterableIterator<string>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemHandle]>;
}

type FileSystemHandle = FileSystemFileHandle | FileSystemDirectoryHandle;

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  startIn?:
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: FilePickerAcceptType[];
  excludeAcceptAllOption?: boolean;
  startIn?:
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
}

interface DirectoryPickerOptions {
  startIn?:
    | "desktop"
    | "documents"
    | "downloads"
    | "music"
    | "pictures"
    | "videos";
}

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

// 兜底：如果 window 上还没有 showSaveFilePicker，声明它
interface Window {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (
    options?: OpenFilePickerOptions,
  ) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (
    options?: DirectoryPickerOptions,
  ) => Promise<FileSystemDirectoryHandle>;
}
