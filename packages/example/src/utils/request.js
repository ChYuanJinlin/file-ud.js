// http.ts
import axios from "axios";
// 🔑 支持环境变量配置后端地址
// - 本地开发：Vite proxy /api → localhost:3000，baseURL = "/api"
// - 生产部署：设置 VITE_API_BASE_URL 指向实际后端，如 "https://your-server.com"
//   后端不需要 /api 前缀时填完整地址，如 "https://your-server.com"
//   后端需要 /api 前缀时填 "https://your-server.com/api"
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
// 设置请求超时和请求头
const instance = axios.create({
    baseURL: apiBaseUrl,
    timeout: 1000 * 60 * 60 * 60,
});
instance.interceptors.request.use((config) => {
    // ✅ 合并 headers 而不是替换，保留 axios 自动设置的 Content-Type
    config.headers.Authorization = `Bearer xxxxx`;
    config.headers["Accept-Language"] = "111";
    return config;
}, (error) => {
    return Promise.reject(error);
});
// 响应拦截器
instance.interceptors.response.use((response) => {
    return response; // 直接返回响应数据
}, (error) => {
    let { message, response } = error;
    console.log("🚀 ~ message:", message);
    // switch (error.response.status) {
    //   case 401:
    //     ElMessage({
    //       message: error.response.data.msg,
    //       type: "warning",
    //     });
    //     router.replace({
    //       path: "/login",
    //       query: {
    //         redirect: router.currentRoute.value.fullPath,
    //       },
    //     });
    //     break;
    //   case 403:
    //     ElMessage({
    //       message: error.response.data.msg,
    //       type: "warning",
    //     });
    //     localStorage.removeItem("token");
    //     localStorage.removeItem("isLogin");
    //     router.replace({
    //       path: "/login",
    //       query: {
    //         redirect: vue.$route.fullPath,
    //       },
    //     });
    //     break;
    //   case 404:
    //     ElMessage({
    //       message: "404地址不存在",
    //       type: "error",
    //     });
    //     break;
    //   default:
    //     ElMessage({
    //       message: "系统异常，请稍后再试",
    //       type: "error",
    //     });
    // }
    return Promise.reject(error);
});
// 创建 Ajax 类
class Ajax {
}
Ajax.instance = instance;
// 定义 ajax 方法
Ajax.ajax = (url, data, options, method = "get") => {
    return new Promise((resolve, reject) => {
        const promise = method === "get"
            ? Ajax.instance.get(url, { params: data, ...options })
            : Ajax.instance.request({ method, url, data, ...options });
        promise
            .then((res) => resolve(res.data))
            .catch((error) => {
            console.error("Request failed:", error);
            reject(error);
        });
    });
};
// 挂载静态方法
Ajax.options = (url, data, options) => Ajax.ajax(url, data, options, "options");
Ajax.get = (url, data, options) => Ajax.ajax(url, data, options, "get");
Ajax.post = (url, data, options) => Ajax.ajax(url, data, options, "post");
Ajax.put = (url, data, options) => Ajax.ajax(url, data, options, "put");
Ajax.head = (url, data, options) => Ajax.ajax(url, data, options, "head");
Ajax.delete = (url, data, options) => Ajax.ajax(url, data, options, "delete");
Ajax.trace = (url, data, options) => Ajax.ajax(url, data, options, "trace");
Ajax.connect = (url, data, options) => Ajax.ajax(url, data, options, "connect");
// 3. 最后再声明类型（或导出时断言）
export default Ajax;
