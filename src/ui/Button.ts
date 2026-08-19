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
    if (px >= x && px <= x + width && py >= y && py <= y + BUTTON_HEIGHT) {
      return btn;
    }
  }
  return null;
}