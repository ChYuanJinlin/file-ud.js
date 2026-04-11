/**
 * 网络状态检查工具
 * 
 * 提供上传前的网络状态检查功能
 */

/**
 * 网络检查结果
 */
export interface NetworkCheckResult {
  /** 是否在线 */
  online: boolean;
  /** 检查时间戳 */
  timestamp: number;
  /** 错误信息（如果离线） */
  error?: string;
}

/**
 * 检查网络连接状态
 * @returns 网络检查结果
 */
export function checkNetworkStatus(): NetworkCheckResult {
  const result: NetworkCheckResult = {
    online: navigator.onLine,
    timestamp: Date.now(),
  };

  if (!result.online) {
    result.error = '网络连接已断开，请检查网络设置后重试';
  }

  return result;
}

/**
 * 异步检查网络连通性（通过实际请求测试）
 * @param testUrl 测试用的 URL（可选，默认为当前域名）
 * @param timeout 超时时间（毫秒），默认 5000ms
 * @returns Promise<NetworkCheckResult>
 */
export async function checkNetworkConnectivity(
  testUrl?: string,
  timeout: number = 5000
): Promise<NetworkCheckResult> {
  // 首先检查基本在线状态
  const basicCheck = checkNetworkStatus();
  if (!basicCheck.online) {
    return basicCheck;
  }

  // 如果没有提供测试 URL，使用当前域名
  const url = testUrl || window.location.origin;

  try {
    // 使用 HEAD 请求进行轻量级测试
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-cache',
    });

    clearTimeout(timeoutId);

    return {
      online: true,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      online: false,
      timestamp: Date.now(),
      error: error instanceof Error ? error.message : '网络连接测试失败',
    };
  }
}

/**
 * 监听网络状态变化
 * @param callback 网络状态变化回调
 * @returns 取消监听的函数
 */
export function watchNetworkStatus(
  callback: (online: boolean) => void
): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // 返回取消监听的函数
  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}
