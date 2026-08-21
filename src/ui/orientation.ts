// ============================================================================
// orientation.ts — 横竖屏切换统一网关（验证 + 回滚）
// ----------------------------------------------------------------------------
// 微信小游戏运行时转屏（wx.setDeviceOrientation）在真机上异步且部分机型不可靠：
// success 回调只代表「请求已受理」，窗口可能迟迟不转、甚至根本不转。
// 若切完不做验证就持久化偏好，一旦布局错乱且无法点击，坏偏好会让下次启动
// 重复同样问题（只能删除小程序清缓存自救）。
// 因此所有转屏统一走 requestOrientation：切完以窗口 API 连续采样验证方向
// 真正稳定，失败则自动回滚原方向，调用方据返回值决定是否持久化偏好。
// ============================================================================

import { OrientationPref } from './profile';

/** 当前环境是否支持运行时转屏。 */
export function orientationSupported(): boolean {
  return typeof wx.setDeviceOrientation === 'function';
}

/** 读取窗口当前真实方向（jsbridge 异常时按竖屏处理）。 */
export function currentWindowOrientation(): OrientationPref {
  try {
    const info: any = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    return info.windowWidth > info.windowHeight ? 'landscape' : 'portrait';
  } catch (e) {
    return 'portrait';
  }
}

/**
 * 轮询验证窗口方向已切到 target 并稳定（连续 2 次采样一致才算数，
 * 防真机转屏中间态假阳性）。超时返回 false，由调用方决定回滚。
 */
function waitOrientationStable(target: OrientationPref, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (currentWindowOrientation() === target) {
      resolve(true);
      return;
    }
    const start = Date.now();
    let consecutive = 0;
    const timer = setInterval(() => {
      if (currentWindowOrientation() === target) {
        consecutive++;
        if (consecutive >= 2) {
          clearInterval(timer);
          resolve(true);
          return;
        }
      } else {
        consecutive = 0;
      }
      if (Date.now() - start >= timeout) {
        clearInterval(timer);
        resolve(false);
      }
    }, 80);
  });
}

/**
 * 切换设备方向并验证结果（全站唯一转屏入口）。
 * 返回最终真实方向：等于 target 即成功；否则已自动回滚，调用方必须丢弃
 * 对 target 的持久化（防「切屏失败 + 偏好落盘」造成启动死循环）。
 */
export function requestOrientation(target: OrientationPref): Promise<OrientationPref> {
  if (!orientationSupported()) return Promise.resolve(currentWindowOrientation());
  const from = currentWindowOrientation();
  if (from === target) return Promise.resolve(target);

  return new Promise<OrientationPref>((resolve) => {
    const rollback = () => {
      try {
        wx.setDeviceOrientation({ value: from });
      } catch (e) {
        // 回滚失败也不再重试，按原方向收尾
      }
      resolve(from);
    };
    try {
      wx.setDeviceOrientation({
        value: target,
        success: () => {
          waitOrientationStable(target, 2000).then((ok) => {
            if (ok) resolve(target);
            else rollback();
          });
        },
        fail: () => rollback(),
      });
    } catch (e) {
      rollback();
    }
  });
}
