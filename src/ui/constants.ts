// ============================================================================
// constants.ts — UI 常量配置
// ============================================================================

/** 牌面尺寸 */
export const TILE_WIDTH = 40;
export const TILE_HEIGHT = 56;
export const TILE_RADIUS = 4;
export const TILE_GAP = 2;

/** 牌面颜色映射 */
export const TILE_COLORS_RGB: Record<string, string> = {
  red: '#E53935',
  blue: '#1E88E5',
  yellow: '#FDD835',
  black: '#212121',
  joker: '#9C27B0',
};

/** 牌面背景色 */
export const TILE_BG = '#FFFFFF';
export const TILE_BG_SELECTED = '#E3F2FD';
export const TILE_BORDER = '#BDBDBD';
export const TILE_SHADOW = 'rgba(0,0,0,0.15)';

/** Joker 牌特殊样式 */
export const JOKER_BG = '#F3E5F5';
export const JOKER_STAR_COLOR = '#9C27B0';

/** 牌架样式 */
export const RACK_BG = '#5D4037';
export const RACK_PADDING = 8;
export const RACK_HEIGHT = TILE_HEIGHT + RACK_PADDING * 2;

/** 桌面样式 */
export const BOARD_BG = '#2E7D32';
export const BOARD_GROUP_BG = 'rgba(255,255,255,0.1)';
export const BOARD_GROUP_BORDER = 'rgba(255,255,255,0.3)';
export const BOARD_GROUP_PADDING = 6;
export const BOARD_GROUP_GAP = 16;

/** 按钮样式 */
export const BUTTON_HEIGHT = 44;
export const BUTTON_RADIUS = 8;
export const BUTTON_COLORS = {
  primary: { bg: '#1976D2', text: '#FFFFFF' },
  secondary: { bg: '#757575', text: '#FFFFFF' },
  danger: { bg: '#D32F2F', text: '#FFFFFF' },
  disabled: { bg: '#BDBDBD', text: '#9E9E9E' },
};

/** 字体 */
export const FONT_FAMILY = 'PingFang SC, Microsoft YaHei, sans-serif';
export const FONT_SIZE_TILE = 18;
export const FONT_SIZE_TILE_SMALL = 14;
export const FONT_SIZE_BUTTON = 16;
export const FONT_SIZE_LABEL = 14;
export const FONT_SIZE_SCORE = 20;

/** 玩家信息区域 */
export const PLAYER_INFO_HEIGHT = 36;
export const PLAYER_INFO_BG = 'rgba(0,0,0,0.5)';
export const PLAYER_INFO_TEXT = '#FFFFFF';

/** 拖拽 */
export const DRAG_OFFSET_Y = -20;
export const DRAG_SCALE = 1.1;
/** 选中的牌上移距离（逻辑像素） */
export const SELECTED_LIFT = 10;

/** 动画 */
export const ANIMATION_DURATION = 200; // ms

/** 屏幕布局 (相对比例，会映射到安全区内的可用高度) */
export const LAYOUT = {
  boardTop: 0.12,        // 桌面区域顶部 (相对可用高度)
  boardBottom: 0.50,     // 桌面区域底部
  workingAreaTop: 0.52,  // 工作区顶部
  workingAreaBottom: 0.58, // 工作区底部
  rackTop: 0.62,         // 牌架顶部
  rackBottom: 0.92,      // 牌架底部
  buttonAreaTop: 0.93,   // 按钮区域顶部
};

/** 工作区样式 */
export const WORKING_AREA_BG = 'rgba(156, 39, 176, 0.15)';
export const WORKING_AREA_BORDER = '#9C27B0';
export const WORKING_AREA_LABEL = '工作区 (点击牌放回桌面)';
/** 工作区最小高度（空工作区也保留一个紧凑的标签 + 拖放目标区域）。 */
export const WORKING_AREA_HEIGHT = 44;
