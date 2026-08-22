// ============================================================================
// src/ui/profile.ts — 个人资料与偏好设置（个人中心页的数据层）
// ----------------------------------------------------------------------------
// 昵称、头像（微信相册图片 / 元素色兜底）本地持久化 + 云端落库
// （lami_profiles 集合，见 src/cloud/profile.ts），跨设备同步；
// 震动反馈、屏幕方向偏好仅本地。音频开关由 audio.ts 自行持久化。
// 历史战绩已落库云端（lami_history），见 src/cloud/game.ts fetchMatchHistory。
// ============================================================================

import { AVATAR_COLORS, FONT_FAMILY } from './constants';
import {
  fetchCloudProfile,
  saveCloudProfile,
  uploadAvatarFile,
  type CloudProfileResult,
} from '../cloud/profile';

const NICK_KEY = 'lami_nickname';
const AVATAR_KEY = 'lami_avatar_index';
/** 自定义头像的永久化本地路径（saveFile 产物）；为空时用元素色兜底。 */
const AVATAR_PATH_KEY = 'lami_avatar_path';
/** 本地头像图片对应的云存储 fileID（与云端档案对比，避免重复下载）。 */
const AVATAR_FILEID_KEY = 'lami_avatar_fileid';
/** 首次启动的资料设置引导弹框只弹一次。 */
const PROFILE_PROMPT_KEY = 'lami_profile_prompted';
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

/** 选头像结果：path 为选中后永久化路径；errorMsg 仅非用户取消的失败才有值。 */
export interface ChooseAvatarResult {
  path: string | null;
  errorMsg?: string;
}

/**
 * 拉起微信原生媒体选择器选头像（相册/拍照），选中后 saveFile 永久化。
 * 用户取消静默（errorMsg 为空）；接口被拒（未配置隐私指引/未授权）
 * 时返回原始 errMsg，由调用方给出可操作的提示。
 * 隐私授权被拒后不会自动重弹，这里主动调 requirePrivacyAuthorize
 * 重新拉起授权弹窗并自动重试一次，用户同意后无需再点一次头像。
 */
export function chooseAvatarFromWeChat(): Promise<ChooseAvatarResult> {
  return chooseAvatarOnce().then((result) => {
    const msg = result.errorMsg || '';
    // 仅「用户拒绝过隐私授权」分支可恢复：重新拉起隐私授权弹窗。
    if (!/privacy/i.test(msg) || typeof wx.requirePrivacyAuthorize !== 'function') {
      return result;
    }
    return new Promise<ChooseAvatarResult>((resolve) => {
      try {
        wx.requirePrivacyAuthorize({
          success: () => resolve(chooseAvatarOnce()),
          fail: () => resolve(result), // 低版本不支持或仍被拒：原样透出提示
        });
      } catch (e) {
        resolve(result);
      }
    });
  });
}

function chooseAvatarOnce(): Promise<ChooseAvatarResult> {
  return new Promise((resolve) => {
    if (typeof wx.chooseMedia !== 'function') {
      resolve({ path: null, errorMsg: '当前环境不支持选择头像' });
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
            resolve({ path: null });
            return;
          }
          try {
            wx.getFileSystemManager().saveFile({
              tempFilePath: temp,
              success: (r) => {
                setAvatarPath(r.savedFilePath);
                resolve({ path: r.savedFilePath });
              },
              fail: () => resolve({ path: null, errorMsg: '头像文件保存失败，请重试' }),
            });
          } catch (e) {
            resolve({ path: null, errorMsg: '头像文件保存失败，请重试' });
          }
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || '';
          // 用户主动取消保持静默；其余（隐私未声明/相册未授权）透出给调用方提示。
          if (msg.includes('cancel')) {
            resolve({ path: null });
          } else {
            resolve({ path: null, errorMsg: msg || '相册拉起失败' });
          }
        },
      });
    } catch (e) {
      resolve({ path: null, errorMsg: '相册拉起失败' });
    }
  });
}

/** 恢复默认头像（清除自定义图片，回到元素色圆片）。 */
export function resetAvatar(): void {
  const path = getAvatarPath();
  setAvatarPath(null);
  setAvatarFileId(''); // 云端同步时据此判定「已恢复默认」
  if (path) {
    try {
      (wx.getFileSystemManager() as any).unlink?.({ filePath: path, fail: () => undefined });
    } catch (e) {
      // 静默
    }
  }
}

// ----------------------------------------------------------------------------
// 云端同步（昵称 + 头像落库 lami_profiles，跨设备一致）
// ----------------------------------------------------------------------------

function getAvatarFileId(): string {
  try {
    const v = wx.getStorageSync(AVATAR_FILEID_KEY);
    return typeof v === 'string' ? v : '';
  } catch (e) {
    return '';
  }
}

function setAvatarFileId(id: string): void {
  try {
    if (id) wx.setStorageSync(AVATAR_FILEID_KEY, id);
    else wx.removeStorageSync(AVATAR_FILEID_KEY);
  } catch (e) {
    // 静默
  }
}

/**
 * 把当前本地资料推送到云端：昵称 + 头像底色 + 头像 fileID。
 * 自定义头像图片尚未上传过时先 uploadFile 再存 fileID。
 * 失败不吞，由调用方决定是否提示。
 */
export function syncProfileToCloud(): Promise<void> {
  const patch: { name: string; avatarIndex: number; avatarFileId?: string } = {
    name: getNickname(),
    avatarIndex: getAvatarIndex(),
  };
  const path = getAvatarPath();
  const fileId = getAvatarFileId();
  if (path && fileId) {
    patch.avatarFileId = fileId;
    return saveCloudProfile(patch);
  }
  if (path) {
    // 新选的头像：先传云存储拿 fileID，再随档案一起落库。
    return uploadAvatarFile(path).then((id) => {
      setAvatarFileId(id);
      return saveCloudProfile({ ...patch, avatarFileId: id });
    });
  }
  patch.avatarFileId = ''; // 无自定义头像：显式清空云端旧头像
  return saveCloudProfile(patch);
}

/**
 * 启动时用云端档案覆盖本地（云端是权威源）：
 * 昵称/头像底色直接写入；头像图片按 fileID 比对，不同则下载替换。
 * 档案为 null（从未设置）时不动本地，由调用方引导授权。
 */
export function applyCloudProfile(result: CloudProfileResult): void {
  const p = result.profile;
  if (!p) return;
  if (typeof p.name === 'string' && p.name.trim()) {
    try {
      wx.setStorageSync(NICK_KEY, p.name.trim().slice(0, 12));
    } catch (e) {
      // 静默
    }
  }
  if (typeof p.avatarIndex === 'number' && p.avatarIndex >= 0 && p.avatarIndex < AVATAR_COLORS.length) {
    try {
      wx.setStorageSync(AVATAR_KEY, p.avatarIndex);
    } catch (e) {
      // 静默
    }
  }
  const cloudFileId = p.avatarFileId || '';
  const localFileId = getAvatarFileId();
  if (cloudFileId === localFileId && (cloudFileId === '') === !getAvatarPath()) return;
  if (!cloudFileId) {
    // 其他设备已恢复默认头像：本地同步清除。
    resetAvatar();
    return;
  }
  if (!result.avatarTempUrl) return; // 临时链接换取失败：下次启动再试
  wx.downloadFile({
    url: result.avatarTempUrl,
    success: (res) => {
      if (res.statusCode !== 200) return;
      try {
        wx.getFileSystemManager().saveFile({
          tempFilePath: res.tempFilePath,
          success: (r) => {
            setAvatarPath(r.savedFilePath);
            setAvatarFileId(cloudFileId);
          },
          fail: () => undefined,
        });
      } catch (e) {
        // 静默：下次启动重试
      }
    },
    fail: () => undefined,
  });
}

/** 拉取云端档案（供启动流程：覆盖本地 + 判断是否需要引导授权）。 */
export function loadCloudProfile(): Promise<CloudProfileResult> {
  return fetchCloudProfile();
}

// ----------------------------------------------------------------------------
// 首次启动资料设置引导（微信已不提供头像昵称授权接口，改为引导自助设置）
// ----------------------------------------------------------------------------

export function hasPromptedProfileSetup(): boolean {
  try {
    return wx.getStorageSync(PROFILE_PROMPT_KEY) === true;
  } catch (e) {
    return true; // 存储异常时不弹，避免反复打扰
  }
}

export function markProfileSetupPrompted(): void {
  try {
    wx.setStorageSync(PROFILE_PROMPT_KEY, true);
  } catch (e) {
    // 静默
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
