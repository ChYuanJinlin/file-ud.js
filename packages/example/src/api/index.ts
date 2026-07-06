import Ajax from "@/utils/request";

export const uploadFile = (data: any) => {
  return Ajax.post("/upload-chunk",data);
};

export const upload = (data: any) => {
  return Ajax.post("/upload",data);
};

export const checkFile = (data: any) => {
  return Ajax.post("/check-file",data);
};

export const createUploadTask = (data: any) => {
  return Ajax.post("/create-upload-task", data);
};

export const mergeChunks = (data: any) => {
  return Ajax.post("/merge-chunks", data);
};






/**
 * 获取文件列表
 * @param params 查询参数
 * @param params.page 页码（默认 1）
 * @param params.pageSize 每页数量（默认 10）
 * @param params.fileType 文件类型过滤（image/video/audio/document/other）
 * @param params.search 搜索文件名关键词
 * @param params.sortBy 排序字段（name/size/date）
 * @param params.sortOrder 排序方式（asc/desc）
 * @returns Promise<{ 
 *   success: boolean, 
 *   data: Array<{ 
 *     name: string, 
 *     url: string, 
 *     size: number,
 *     type: string,
 *     extension: string,
 *     createdAt: string,
 *     updatedAt: string 
 *   }>,
 *   total: number,
 *   page: number,
 *   pageSize: number,
 *   totalPages: number 
 * }>
 */
/**
 * 下载文件（GET 方式，支持分片下载）
 * @param fileName 文件名
 * @returns Promise<AxiosResponse>
 */
export const downloadFileApi = (fileName: string) => {
  return Ajax.get(`/download/${encodeURIComponent(fileName)}`, undefined, {
    responseType: "blob",
  });
};

/**
 * 下载 Excel（POST 方式，不分片示例）
 * @param params 下载参数
 * @returns Promise<AxiosResponse>
 */
export const downloadExcelApi = (params: {
  columns: number;
  rows: number;
  fileName: string;
}) => {
  return Ajax.post("/download-excel", params, {
    responseType: "blob",
  });
};

export const getFileList = (data?: {
  page?: number;
  pageSize?: number;
  fileType?: 'image' | 'video' | 'audio' | 'document' | 'other';
  search?: string;
  sortBy?: 'name' | 'size' | 'date';
  sortOrder?: 'asc' | 'desc';
}) => {
  return Ajax.get("/files", data);
};

/**
 * 删除服务端文件（同时清理去重记录、任务记录、残留分片）
 * @param fileName 文件名
 * @returns Promise<{ success: boolean, message: string, data: { deletedItems: string[], fileName: string } }>
 */
export const deleteServerFile = (fileName: string) => {
  return Ajax.delete(`/files/${encodeURIComponent(fileName)}`);
};
