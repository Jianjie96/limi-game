// ============================================================================
// src/ui/profile.ts — 个人资料与偏好设置（个人中心页的数据层）
// ----------------------------------------------------------------------------
// 统一持久化到本地存储：昵称、头像（微信相册图片 / 元素色兜底）、
// 震动反馈、屏幕方向偏好。
// 音频两个开关（音乐/音效）由 audio.ts 自行持久化，此处不重复。
// ============================================================================

import { AVATAR_COLORS, FONT_FAMILY } from './constants';

const NICK_KEY = 'lami_nickname';
const AVATAR_KEY = 'lami_avatar_index';
/** 自定义头像的永久化本地路径（saveFile 产物）；为空时用元素色兜底。 */
const AVATAR_PATH_KEY = 'lami_avatar_path';
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
// 自定义头像（微信相册/拍照选择，支持随时重选或恢复默认）
// ----------------------------------------------------------------------------

/** 读取自定义头像的永久化本地路径；文件丢失时自动清理并返回 null。 */
export function getAvatarPath(): string | null {
  let path = '';
  try {
    const v = wx.getStorageSync(AVATAR_PATH_KEY);
    if (typeof v === 'string' && v) path = v;
  } catch (e) {
    return null;
  }
  if (!path) return null;
  try {
    wx.getFileSystemManager().accessSync(path);
    return path;
  } catch (e) {
    // 文件已失效（清缓存等）：清掉记录，回到色片兜底
    try {
      wx.removeStorageSync(AVATAR_PATH_KEY);
    } catch (e2) {
      // 静默
    }
    return null;
  }
}

function setAvatarPath(path: string | null): void {
  try {
    if (path) wx.setStorageSync(AVATAR_PATH_KEY, path);
    else wx.removeStorageSync(AVATAR_PATH_KEY);
  } catch (e) {
    // 静默
  }
}

/**
 * 拉起微信原生媒体选择器选头像（相册/拍照），选中后 saveFile 永久化。
 * 返回永久化路径；用户取消或失败返回 null。
 */
export function chooseAvatarFromWeChat(): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof wx.chooseMedia !== 'function') {
      resolve(null);
      return;
    }
    try {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: (res) => {
          const temp = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
          if (!temp) {
            resolve(null);
            return;
          }
          try {
            wx.getFileSystemManager().saveFile({
              tempFilePath: temp,
              success: (r) => {
                setAvatarPath(r.savedFilePath);
                resolve(r.savedFilePath);
              },
              fail: () => resolve(null),
            });
          } catch (e) {
            resolve(null);
          }
        },
        fail: () => resolve(null), // 用户取消也走 fail
      });
    } catch (e) {
      resolve(null);
    }
  });
}

/** 恢复默认头像（清除自定义图片，回到元素色圆片）。 */
export function resetAvatar(): void {
  const path = getAvatarPath();
  setAvatarPath(null);
  if (path) {
    try {
      (wx.getFileSystemManager() as any).unlink?.({ filePath: path, fail: () => undefined });
    } catch (e) {
      // 静默
    }
  }
}

// ----------------------------------------------------------------------------
// 头像 Image 加载缓存（Canvas 绘制用）
// ----------------------------------------------------------------------------

let avatarImgCache: { path: string; img: any; ready: boolean } | null = null;
const avatarImgListeners = new Set<() => void>();

/**
 * 获取自定义头像的 Image 对象；未设置/未加载完返回 null。
 * 加载完成时回调所有等待方（用于触发重绘）。
 */
export function getAvatarImage(onReady?: () => void): any | null {
  const path = getAvatarPath();
  if (!path) return null;
  if (!avatarImgCache || avatarImgCache.path !== path) {
    const img = wx.createImage();
    const entry = { path, img, ready: false };
    avatarImgCache = entry;
    img.onload = () => {
      entry.ready = true;
      for (const cb of [...avatarImgListeners]) cb();
      avatarImgListeners.clear();
    };
    img.onerror = () => {
      if (avatarImgCache === entry) avatarImgCache = null;
    };
    img.src = path;
  }
  if (avatarImgCache.ready) return avatarImgCache.img;
  if (onReady) avatarImgListeners.add(onReady);
  return null;
}

/**
 * 绘制圆形头像：优先微信自定义图片（cover 裁切），
 * 未设置/未加载完时用元素色圆片 + 昵称末字兜底。
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  onImageReady?: () => void,
): void {
  const ringW = r >= 24 ? 2 : 1.5;
  const img = getAvatarImage(onImageReady);
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const iw = img.width || 1;
    const ih = img.height || 1;
    const s = Math.max((r * 2) / iw, (r * 2) / ih);
    ctx.drawImage(img, cx - (iw * s) / 2, cy - (ih * s) / 2, iw * s, ih * s);
    ctx.restore();
  } else {
    const name = getNickname();
    ctx.fillStyle = getAvatarColor();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.font = `bold ${Math.round(r * 0.8)}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(name.charAt(name.length - 1), cx, cy + 1);
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = ringW;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
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
