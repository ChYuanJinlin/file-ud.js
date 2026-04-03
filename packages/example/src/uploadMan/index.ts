import Uploader from "@file-ud.js/core/uploader";
import Ajax from "@/utils/request";
Uploader.baseConfig = {
  file: "file",
  action: "movie/upload/file",
  axiosInstance: Ajax,
};
// new Uploader();
