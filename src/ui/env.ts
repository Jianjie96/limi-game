/** 运行环境判断（入口与各场景共用）。 */

/** 是否开发版（envVersion === 'develop'），体验版/正式版均视为线上。 */
export function isDevEnvironment(): boolean {
  try {
    return (
      typeof wx.getAccountInfoSync === 'function' &&
      wx.getAccountInfoSync().miniProgram.envVersion === 'develop'
    );
  } catch (e) {
    // API 不可用时按线上处理：隐藏调试入口与辅助提示。
    return false;
  }
}
