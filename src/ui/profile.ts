// ============================================================================
// src/ui/profile.ts — 个人资料与偏好设置（个人中心页的数据层）
// ----------------------------------------------------------------------------
// 统一持久化到本地存储：昵称、头像色、震动反馈、屏幕方向偏好。
// 音频两个开关（音乐/音效）由 audio.ts 自行持久化，此处不重复。
// ============================================================================

import { AVATAR_COLORS } from './constants';

const NICK_KEY = 'lami_nickname';
const AVATAR_KEY = 'lami_avatar_index';
const VIBRATE_KEY = 'lami_vibrate_on';
const ORIENTATION_KEY = 'lami_orientation';

export type OrientationPref = 'portrait' | 'landscape';

// ----------------------------------------------------------------------------
// 昵称
// ----------------------------------------------------------------------------

/** 读取昵称；首次使用时生成随机代号并持久化。 */
export function getNickname(): string {
  try {
    const v = wx.getStorageSync(NICK_KEY);
    if (typeof v === 'string' && v.trim()) return v;
  } catch (e) {
    // 落到默认值
  }
  const name = `旅行者${Math.floor(Math.random() * 900) + 100}`;
  setNickname(name);
  return name;
}

/** 保存昵称（去空白、限 12 字）；空昵称返回 false。 */
export function setNickname(name: string): boolean {
  const v = name.trim().slice(0, 12);
  if (!v) return false;
  try {
    wx.setStorageSync(NICK_KEY, v);
  } catch (e) {
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// 头像（元素色圆片 + 昵称末字，与房间页头像同一视觉语言）
// ----------------------------------------------------------------------------

/** 头像色在 AVATAR_COLORS 中的下标。 */
export function getAvatarIndex(): number {
  try {
    const v = wx.getStorageSync(AVATAR_KEY);
    if (typeof v === 'number' && v >= 0 && v < AVATAR_COLORS.length) return v;
  } catch (e) {
    // 落到默认值
  }
  return getNickname().charCodeAt(0) % AVATAR_COLORS.length;
}

export function setAvatarIndex(index: number): void {
  if (index < 0 || index >= AVATAR_COLORS.length) return;
  try {
    wx.setStorageSync(AVATAR_KEY, index);
  } catch (e) {
    // 静默
  }
}

export function getAvatarColor(): string {
  return AVATAR_COLORS[getAvatarIndex() % AVATAR_COLORS.length];
}

// ----------------------------------------------------------------------------
// 震动反馈
// ----------------------------------------------------------------------------

export function isVibrateEnabled(): boolean {
  try {
    return wx.getStorageSync(VIBRATE_KEY) !== false; // 默认开
  } catch (e) {
    return true;
  }
}

export function setVibrateEnabled(on: boolean): void {
  try {
    wx.setStorageSync(VIBRATE_KEY, on);
  } catch (e) {
    // 静默
  }
}

/** 按设置触发短震动；关闭或 API 不可用时静默忽略。 */
export function vibrateIfEnabled(): void {
  if (!isVibrateEnabled()) return;
  try {
    wx.vibrateShort({});
  } catch (e) {
    // 不支持则忽略
  }
}

// ----------------------------------------------------------------------------
// 屏幕方向偏好
// ----------------------------------------------------------------------------

export function getPreferredOrientation(): OrientationPref {
  try {
    return wx.getStorageSync(ORIENTATION_KEY) === 'landscape' ? 'landscape' : 'portrait';
  } catch (e) {
    return 'portrait';
  }
}

export function setPreferredOrientation(pref: OrientationPref): void {
  try {
    wx.setStorageSync(ORIENTATION_KEY, pref);
  } catch (e) {
    // 静默
  }
}

/**
 * 把设备方向切到偏好值（启动 / 回首页时调用）。
 * 不支持转屏的环境静默跳过；成功回调可选（用于延迟刷新布局）。
 */
export function applyPreferredOrientation(onApplied?: () => void): void {
  if (typeof wx.setDeviceOrientation !== 'function') return;
  try {
    wx.setDeviceOrientation({
      value: getPreferredOrientation(),
      success: () => onApplied?.(),
      fail: () => {
        // 静默：保持当前方向
      },
    });
  } catch (e) {
    // 静默
  }
}
