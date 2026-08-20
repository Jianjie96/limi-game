// ============================================================================
// src/ui/online.ts — 在线对战协调器（OnlineCoordinator）
// ----------------------------------------------------------------------------
// 职责：把云端权威状态（公开状态 + 本人手牌）映射成本机草稿引擎可加载的
// 「mask 状态」——本人手牌真实、其他玩家以占位牌替代（保密）、牌池仅保留数量。
//
// 同步策略：
//   - watch 推送 → version 更新或非本人回合 → loadState 整体覆盖并重绘
//   - 本人回合草稿进行中（已产生操作日志）→ 仅缓存，提交完成后对齐
//   - 出牌：本地克隆引擎预校验（即时反馈）→ sendMove 云端回放校验 →
//     成功用权威状态对齐；失败回滚到回合开始
// ============================================================================

import { RummikubEngine } from '../game/engine';
import type { Tile, TileGroup, PlayerState, GameState } from '../game/types';
import { TurnPhase } from '../game/types';
import {
  initGame,
  sendMove,
  sendPass,
  watchGame,
  type PublicGameState,
} from '../cloud/game';

/** GameScene 暴露给协调器的最小接口（避免循环依赖）。 */
export interface OnlineSceneHost {
  showMessage(msg: string, duration?: number): void;
}

/** 占位牌：仅用于填充他人牌架数量与牌池数量，不参与任何规则计算。 */
function placeholderTiles(count: number, baseId: number): Tile[] {
  const tiles: Tile[] = [];
  for (let i = 0; i < count; i++) {
    tiles.push({ id: baseId + i, color: 'red', number: 1 });
  }
  return tiles;
}

function handIdsKey(hand: readonly Tile[]): string {
  return hand
    .map((t) => t.id)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * 由公开状态 + 本人手牌构造完整 GameState JSON（mask 状态）。
 * - 本人牌架：真实手牌；其他玩家：占位牌（仅数量正确）
 * - 牌池：占位牌（仅数量正确，摸牌由云端执行）
 * - 回合上下文：按回合起点重建（工作区必为空，摸牌只发生在云端）
 */
export function buildMaskedStateJson(
  pub: PublicGameState,
  hand: readonly Tile[],
  selfIndex: number
): string {
  const players: PlayerState[] = pub.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    hasMadeInitialMeld: p.hasMadeInitialMeld,
    rack:
      i === selfIndex
        ? hand.map((t) => ({ ...t }))
        : placeholderTiles(p.rackCount, 1000 + i * 200),
  }));

  const pool = placeholderTiles(pub.poolCount, 5000);
  const board: TileGroup[] = JSON.parse(JSON.stringify(pub.board));
  const currentRack = players[pub.currentPlayerIndex]?.rack ?? [];

  const state: GameState = {
    phase: pub.phase as GameState['phase'],
    players,
    currentPlayerIndex: pub.currentPlayerIndex,
    board,
    pool,
    turnPhase: TurnPhase.PLAY,
    turnContext: {
      phase: TurnPhase.PLAY,
      boardSnapshot: JSON.parse(JSON.stringify(board)),
      poolSnapshot: [],
      rackAtTurnStart: currentRack.map((t) => ({ ...t })),
      workingArea: [],
      replacedJokers: [],
      hasDrawnFromPool: false,
      drawnTile: null,
      drawnTileId: null,
      hasPlacedFromRack: false,
      rackTilesPlacedThisTurn: [],
      consecutivePasses: 0,
      justDrawnTilePlaced: false,
    },
    turnNumber: pub.turnNumber,
    config: pub.config,
    result: pub.result,
  };
  return JSON.stringify(state);
}

// ----------------------------------------------------------------------------
// OnlineCoordinator
// ----------------------------------------------------------------------------

export class OnlineCoordinator {
  private closeWatch: (() => void) | null = null;
  private latestPublic: PublicGameState | null = null;
  private latestHand: Tile[] | null = null;
  private appliedVersion = 0;
  private appliedHandKey = '';
  /** 本人回合起点快照（提交失败时本地回滚用）。 */
  private turnStartJson = '';
  /** 正在等待云端响应（期间 watch 推送仅缓存）。 */
  private busy = false;
  private hostRetry = 0;

  constructor(
    private engine: RummikubEngine,
    private scene: OnlineSceneHost,
    private code: string,
    private selfOpenid: string,
    private selfIndex: number,
    private isHost: boolean
  ) {}

  /** 启动同步：开局（房主）+ watch 订阅。initialPublic 为轮询拿到的最新公开状态。 */
  begin(initialPublic?: PublicGameState): void {
    if (initialPublic) this.latestPublic = initialPublic;

    this.closeWatch = watchGame(this.code, this.selfOpenid, (pub, hand) => {
      this.latestPublic = pub;
      if (hand) this.latestHand = hand;
      this.tryApply();
    });

    if (this.isHost) {
      this.requestInit();
    } else {
      this.tryApply();
    }
  }

  dispose(): void {
    if (this.closeWatch) {
      this.closeWatch();
      this.closeWatch = null;
    }
  }

  // --------------------------------------------------------------------------
  // 开局
  // --------------------------------------------------------------------------

  private requestInit(): void {
    initGame(this.code)
      .then((payload) => {
        this.latestPublic = payload.public;
        this.latestHand = payload.hand;
        this.tryApply();
      })
      .catch((e: Error) => {
        // 幂等开局偶发竞争（对方正在初始化）：稍后重试，最多 3 次。
        if (this.hostRetry < 3) {
          this.hostRetry++;
          setTimeout(() => this.requestInit(), 1500);
        } else {
          this.scene.showMessage(`开局失败：${e.message}`, 3200);
        }
      });
  }

  // --------------------------------------------------------------------------
  // 出牌 / Pass
  // --------------------------------------------------------------------------

  /** 出牌：本地克隆预校验（即时反馈）→ 云端回放校验（权威裁决）。 */
  submit(): void {
    if (this.busy) return;
    const st = this.engine.getState();
    if (st.phase !== 'PLAYING' || st.currentPlayerIndex !== this.selfIndex) return;

    // ops 必须在本地预校验之前取出（submitTurn 成功会清空日志）。
    const ops = [...this.engine.getTurnOps()];

    try {
      const clone = RummikubEngine.fromState(this.engine.serializeState());
      const res = clone.submitTurn();
      if (!res.valid) {
        // 与本地模式一致：失败即回滚到回合开始。
        if (this.turnStartJson) this.engine.loadState(this.turnStartJson);
        const msg = res.errors.map((er) => er.message).join('; ');
        this.scene.showMessage(`出牌失败: ${msg}`, 3000);
        return;
      }
    } catch (e: any) {
      this.scene.showMessage(e.message || '操作失败', 3000);
      return;
    }

    this.busy = true;
    sendMove(this.code, ops)
      .then((resp) => {
        this.busy = false;
        if (resp.ok && resp.payload) {
          this.applyPayload(resp.payload.public, resp.payload.hand);
          this.scene.showMessage('出牌成功');
        } else {
          const msg =
            resp.errors?.map((er) => er.message).join('; ') ||
            resp.message ||
            '出牌失败';
          if (resp.payload) {
            // 云端返回权威状态 → 按其对齐（等价于回滚）。
            this.applyPayload(resp.payload.public, resp.payload.hand);
          } else if (this.turnStartJson) {
            this.engine.loadState(this.turnStartJson);
          }
          this.scene.showMessage(msg, 3000);
        }
        this.tryApply(); // 消费 busy 期间缓存的推送
      })
      .catch((e: Error) => {
        this.busy = false;
        // 网络失败：保留草稿不回滚，提示重试。
        this.scene.showMessage(e.message || '网络异常，请重试', 3000);
      });
  }

  /** Pass：摸一张并结束回合（云端执行）。 */
  pass(): void {
    if (this.busy) return;
    const st = this.engine.getState();
    if (st.phase !== 'PLAYING' || st.currentPlayerIndex !== this.selfIndex) return;

    this.busy = true;
    sendPass(this.code)
      .then((resp) => {
        this.busy = false;
        if (resp.ok && resp.payload) {
          this.applyPayload(resp.payload.public, resp.payload.hand);
          this.scene.showMessage('Pass 成功，摸牌 1 张');
        } else {
          this.scene.showMessage(resp.message || '操作失败', 3000);
        }
        this.tryApply();
      })
      .catch((e: Error) => {
        this.busy = false;
        this.scene.showMessage(e.message || '网络异常，请重试', 3000);
      });
  }

  // --------------------------------------------------------------------------
  // 状态对齐
  // --------------------------------------------------------------------------

  private applyPayload(pub: PublicGameState, hand: Tile[]): void {
    this.latestPublic = pub;
    this.latestHand = hand;
    this.apply(pub, hand);
  }

  /** 尝试把最新推送应用到引擎（带去重与草稿保护）。 */
  private tryApply(): void {
    const pub = this.latestPublic;
    const hand = this.latestHand;
    if (!pub || !hand || this.busy) return;

    const handKey = handIdsKey(hand);
    if (pub.version < this.appliedVersion) return;
    if (pub.version === this.appliedVersion && handKey === this.appliedHandKey) return;

    // 本人回合草稿进行中且版本未变 → 不打断操作，latest* 已缓存，稍后对齐。
    const myTurn = pub.phase === 'PLAYING' && pub.currentPlayerIndex === this.selfIndex;
    const drafting = this.engine.getTurnOps().length > 0;
    if (myTurn && drafting && pub.version === this.appliedVersion) return;

    this.apply(pub, hand);
  }

  /** loadState 整体覆盖草稿引擎（mask 状态）。 */
  private apply(pub: PublicGameState, hand: Tile[]): void {
    this.appliedVersion = pub.version;
    this.appliedHandKey = handIdsKey(hand);

    const json = buildMaskedStateJson(pub, hand, this.selfIndex);
    this.engine.loadState(json);

    const myTurn = pub.phase === 'PLAYING' && pub.currentPlayerIndex === this.selfIndex;
    this.turnStartJson = myTurn ? json : '';

    if (pub.phase === 'GAME_OVER' && pub.result) {
      const winner = pub.result.playerResults.find((r) => r.isWinner);
      this.scene.showMessage(`游戏结束! ${winner?.playerName ?? ''} 获胜!`, 3200);
    }
  }
}
