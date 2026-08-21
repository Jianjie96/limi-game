// ============================================================================
// constants.ts — UI 常量配置
// ----------------------------------------------------------------------------
// 视觉基调：参考《原神》的二次元开放世界风格（黄昏暮色主题）——
// 暮蓝天色渐变、深色墨玻璃面板、香槟金描边、元素系柔和配色，
// 色彩绚丽而和谐，低亮度不刺眼，清新愉悦。
// ============================================================================

/** 牌面尺寸 */
export const TILE_WIDTH = 40;
export const TILE_HEIGHT = 56;
/** 圆润牌角 */
export const TILE_RADIUS = 7;
export const TILE_GAP = 2;

/** 牌面颜色映射（元素系柔和色：火/水/岩/雷） */
export const TILE_COLORS_RGB: Record<string, string> = {
  red: '#F26B5E',
  blue: '#46B7E8',
  yellow: '#EFA93F',
  black: '#54617A',
  joker: '#A168E0',
};

/** 牌面底色（暖象牙白渐变端点） */
export const TILE_BG = '#FFFEF9';
export const TILE_BG_BOTTOM = '#F5EDDA';
export const TILE_BG_SELECTED = '#FFF6D9';
export const TILE_BORDER = '#E5D9BE';
/** 深底上的柔和投影 */
export const TILE_SHADOW = 'rgba(8,16,24,0.32)';

/** Joker 牌特殊样式 */
export const JOKER_BG = '#F6EFFC';
export const JOKER_STAR_COLOR = '#A168E0';

/** 牌架样式（磨砂玻璃面板） */
export const RACK_PADDING = 8;
export const RACK_HEIGHT = TILE_HEIGHT + RACK_PADDING * 2;

/** 背景天色（黄昏暮色：黛蓝 → 青碧 → 暖赭，中低亮度耐看） */
export const SKY_TOP = '#3F6D8E';
export const SKY_MID = '#5B8C85';
export const SKY_BOTTOM = '#B08D62';

/** 深色墨玻璃面板（青灰半透明，长时间观看不疲劳） */
export const FROST = 'rgba(28,46,58,0.52)';
export const FROST_STRONG = 'rgba(24,40,52,0.75)';
export const FROST_BORDER = 'rgba(255,255,255,0.24)';

/** 香槟金主题（描边 / 强调色） */
export const GOLD = '#D3BC8E';
export const GOLD_DEEP = '#B08A45';
export const GOLD_SOFT = '#E9D9B4';

/** 文字色（暖白主色 / 柔和米灰次级，深色面板上清晰不刺目） */
export const INK = '#F2ECDD';
export const INK_SOFT = '#C6BDA9';

/** 桌面牌组托盘 */
export const BOARD_GROUP_BG = 'rgba(255,255,255,0.10)';
export const BOARD_GROUP_BORDER = 'rgba(211,188,142,0.55)';
export const BOARD_GROUP_HIGHLIGHT_BG = 'rgba(233,201,127,0.30)';
export const BOARD_GROUP_HIGHLIGHT_BORDER = '#D8A94E';
export const BOARD_GROUP_PADDING = 6;
export const BOARD_GROUP_GAP = 16;

/** 按钮样式（香槟金主按钮 + 磨砂玻璃次按钮） */
export const BUTTON_HEIGHT = 44;
/** 胶囊圆角 = 高度一半 */
export const BUTTON_RADIUS = BUTTON_HEIGHT / 2;
export const BUTTON_COLORS = {
  primary: { top: '#F7DFA0', bottom: '#DBAF57', border: '#B08A45', text: '#6B4E1E' },
  secondary: { top: 'rgba(58,80,94,0.92)', bottom: 'rgba(36,54,66,0.85)', border: '#D3BC8E', text: '#F2ECDD' },
  danger: { top: '#F79A8E', bottom: '#E5695C', border: '#C24B3F', text: '#FFFFFF' },
  disabled: { top: 'rgba(70,86,96,0.60)', bottom: 'rgba(52,66,76,0.55)', border: 'rgba(211,188,142,0.4)', text: 'rgba(242,236,221,0.45)' },
};

/** 字体 */
export const FONT_FAMILY = 'PingFang SC, Microsoft YaHei, sans-serif';
export const FONT_SIZE_TILE = 22;
export const FONT_SIZE_TILE_SMALL = 17;
export const FONT_SIZE_BUTTON = 17;
export const FONT_SIZE_LABEL = 14;
export const FONT_SIZE_SCORE = 20;

/** 玩家信息区域（墨玻璃顶栏） */
export const PLAYER_INFO_HEIGHT = 36;
export const PLAYER_INFO_BG = 'rgba(20,36,48,0.62)';
export const PLAYER_INFO_TEXT = '#F2ECDD';
/** 对手头像元素色（火/水/雷/草） */
export const AVATAR_COLORS = ['#FF8A65', '#5CC8F0', '#B78AEB', '#8BC98B'];

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
  rackTop: 0.62,         // 牌架顶部
  rackBottom: 0.92,      // 牌架底部
  buttonAreaTop: 0.93,   // 按钮区域顶部
};

/** 牌架最小高度：至少一行牌 + 上下留白，避免牌少/为空时退化成细条。 */
export const RACK_MIN_HEIGHT = TILE_HEIGHT + RACK_PADDING * 2;
