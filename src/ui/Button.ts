// ============================================================================
// Button.ts — 按钮配置与命中检测（纯计算，与渲染解耦）
// ============================================================================

import { BUTTON_HEIGHT } from './constants';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'disabled';

export interface ButtonConfig {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  /** 可选自定义高度；缺省时按统一的 BUTTON_HEIGHT 绘制与命中。 */
  height?: number;
  variant?: ButtonVariant;
  enabled?: boolean;
}

export interface ButtonState {
  config: ButtonConfig;
}

/** 创建按钮状态数组 */
export function createButtonStates(configs: ButtonConfig[]): ButtonState[] {
  return configs.map((config) => ({ config }));
}

/** 命中检测：点击位置对应哪个按钮 */
export function hitTestButton(
  px: number,
  py: number,
  buttons: ButtonState[],
): ButtonState | null {
  for (const btn of buttons) {
    const { x, y, width } = btn.config;
    const h = btn.config.height ?? BUTTON_HEIGHT;
    if (px >= x && px <= x + width && py >= y && py <= y + h) {
      return btn;
    }
  }
  return null;
}