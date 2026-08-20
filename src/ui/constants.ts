// ============================================================================
// constants.ts — UI 常量配置（卡通风格：参考斗地主类棋牌游戏视觉）
// ============================================================================

/** 牌面尺寸 */
export const TILE_WIDTH = 40;
export const TILE_HEIGHT = 56;
/** 卡通风大圆角 */
export const TILE_RADIUS = 7;
export const TILE_GAP = 2;

/** 牌面颜色映射（高饱和卡通色） */
export const TILE_COLORS_RGB: Record<string, string> = {
  red: '#F44336',
  blue: '#2196F3',
  yellow: '#FFA000',
  black: '#37474F',
  joker: '#8E24AA',
};

/** 牌面底色（象牙白渐变端点） */
export const TILE_BG = '#FFFDF5';
export const TILE_BG_BOTTOM = '#F3E9D2';
export const TILE_BG_SELECTED = '#FFF3C4';
export const TILE_BORDER = '#E0D3B8';
export const TILE_SHADOW = 'rgba(0,0,0,0.28)';

/** Joker 牌特殊样式 */
export const JOKER_BG = '#F3E5F5';
export const JOKER_STAR_COLOR = '#8E24AA';

/** 牌架样式（木纹暖棕） */
export const RACK_BG = '#8D6E63';
export const RACK_BG_DARK = '#5D4037';
export const RACK_BORDER = '#3E2723';
export const RACK_PADDING = 8;
export const RACK_HEIGHT = TILE_HEIGHT + RACK_PADDING * 2;

/** 桌面样式（绒布绿 + 木质包边） */
export const BOARD_BG = '#2E7D32';
export const BOARD_FELT_DARK = '#174A1D';
export const BOARD_FRAME = '#8D6E63';
export const BOARD_GROUP_BG = 'rgba(255,255,255,0.14)';
export const BOARD_GROUP_BORDER = 'rgba(255,255,255,0.38)';
export const BOARD_GROUP_HIGHLIGHT_BG = 'rgba(255,213,79,0.22)';
export const BOARD_GROUP_HIGHLIGHT_BORDER = '#FFD54F';
export const BOARD_GROUP_PADDING = 6;
export const BOARD_GROUP_GAP = 16;

/** 金色主题（描边 / 强调色） */
export const GOLD = '#FFD54F';
export const GOLD_DEEP = '#FFA000';

/** 按钮样式（卡通渐变胶囊按钮） */
export const BUTTON_HEIGHT = 44;
/** 胶囊圆角 = 高度一半 */
export const BUTTON_RADIUS = BUTTON_HEIGHT / 2;
export const BUTTON_COLORS = {
  primary: { top: '#FFCA28', bottom: '#FF8F00', border: '#C66900', text: '#7A3E00' },
  secondary: { top: '#90A4AE', bottom: '#607D8B', border: '#37474F', text: '#FFFFFF' },
  danger: { top: '#EF5350', bottom: '#C62828', border: '#8E1B1B', text: '#FFFFFF' },
  disabled: { top: '#CFD8DC', bottom: '#B0BEC5', border: '#90A4AE', text: '#78909C' },
};

/** 字体 */
export const FONT_FAMILY = 'PingFang SC, Microsoft YaHei, sans-serif';
export const FONT_SIZE_TILE = 22;
export const FONT_SIZE_TILE_SMALL = 17;
export const FONT_SIZE_BUTTON = 17;
export const FONT_SIZE_LABEL = 14;
export const FONT_SIZE_SCORE = 20;

/** 玩家信息区域 */
export const PLAYER_INFO_HEIGHT = 36;
export const PLAYER_INFO_BG = 'rgba(15,40,20,0.72)';
export const PLAYER_INFO_TEXT = '#FFFFFF';
export const AVATAR_COLORS = ['#FF7043', '#42A5F5', '#AB47BC', '#66BB6A'];

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
export const WORKING_AREA_BG = 'rgba(142, 36, 170, 0.18)';
export const WORKING_AREA_BORDER = '#FFD54F';
export const WORKING_AREA_LABEL = '工作区 (点击牌放回桌面)';
/** 工作区最小高度（空工作区也保留一个紧凑的标签 + 拖放目标区域）。 */
export const WORKING_AREA_HEIGHT = 44;
