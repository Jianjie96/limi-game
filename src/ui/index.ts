// ============================================================================
// ui/index.ts — UI 模块统一导出（原生 Canvas 2D 版本）
// ============================================================================

export { GameScene } from './GameScene';

export {
  getTileBounds,
  hitTestTile,
  roundRectPath,
  drawNumberTile,
  drawJokerTile,
  drawLogicalTile,
  drawPhysicalTile,
} from './renderer';
export type { TileRenderOptions } from './renderer';

export {
  layoutRack,
  hitTestRack,
} from './Rack';
export type { RackConfig, RackTileSlot } from './Rack';

export {
  layoutBoard,
  hitTestBoard,
  hitTestBoardGroup,
} from './Board';
export type { BoardConfig, BoardGroupSlot, BoardTileSlot } from './Board';

export {
  createButtonStates,
  hitTestButton,
} from './Button';
export type { ButtonVariant, ButtonConfig, ButtonState } from './Button';

export {
  getScreenInfo,
} from './screen';
export type { ScreenInfo } from './screen';

export * from './constants';