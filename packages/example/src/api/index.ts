import Ajax from "@/utils/request";

export const uploadFile = () => {
  return Ajax.post("/upload-chunk");
};

export const upload = () => {
  return Ajax.post("/upload");
};

export const checkFile = (data) => {
  return Ajax.post("/check-file",data);
};

export const createUploadTask = (data) => {
  return Ajax.post("/create-upload-task", data);
};

export const mergeChunks = (data) => {
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
