// 案内の声の一覧（設計書 4 章）。ルートがその場で変わるので、道路名は読まず、距離と向きの組み合わせで案内する。
// 声のファイルは tools/build-voice.ts が macOS の say で作る。画面・端末に依存しない
import { COMMON_CLIPS, type ClipId, type TurnDirection } from '../navigation/types.ts';

/** 曲がる所までの距離の言い方。far は 300m 手前、near は 50m 手前（前の版と同じ） */
export type GuidanceDistance = 'far' | 'near';

export const DISTANCE_TEXT: Record<GuidanceDistance, string> = {
  far: '300メートル先、',
  near: 'まもなく、',
};

export const DIRECTION_TEXT: Record<TurnDirection, string> = {
  left: '左です',
  right: '右です',
  slight_left: '斜め左です',
  slight_right: '斜め右です',
  sharp_left: '大きく左です',
  sharp_right: '大きく右です',
  keep_left: '左側を進みます',
  keep_right: '右側を進みます',
  uturn: 'Uターンです',
  roundabout: 'ロータリーです',
  arrive: '目的地です',
};

/** 1つで鳴らす声（前の版の COMMON_CLIPS に、リルートの声を足した） */
export const COMMON_TEXT: Record<string, string> = {
  [COMMON_CLIPS.start]: '案内を始めます',
  [COMMON_CLIPS.offRoute]: 'ルートを外れています',
  [COMMON_CLIPS.onRoute]: 'ルートに戻りました',
  [COMMON_CLIPS.arrive]: '目的地に着きました。お疲れさまでした',
  [COMMON_CLIPS.test]: 'テストです。聞こえますか',
  'common-rerouted': 'ルートを計算し直しました',
  'common-no-route': 'ルートが見つかりません',
  'common-unreachable': 'この目的地へは、125ccでは行けません',
};

/**
 * 案内の鳴らし方（PoC 6 で比べる）
 * - parts: 距離と向きを別々の声にして続けて鳴らす
 * - joined: 距離と向きをつないだ1つの声を鳴らす
 */
export type JoinMode = 'parts' | 'joined';

export function guidanceClips(
  distance: GuidanceDistance,
  direction: TurnDirection,
  mode: JoinMode,
): ClipId[] {
  return mode === 'joined'
    ? [`joined-${distance}-${direction}`]
    : [`part-${distance}`, `part-${direction}`];
}

/** 作る声の全部（ID → 読む文） */
export function allPhrases(): Record<ClipId, string> {
  const phrases: Record<ClipId, string> = { ...COMMON_TEXT };
  const distances = Object.keys(DISTANCE_TEXT) as GuidanceDistance[];
  const directions = Object.keys(DIRECTION_TEXT) as TurnDirection[];
  for (const distance of distances) phrases[`part-${distance}`] = DISTANCE_TEXT[distance];
  for (const direction of directions) phrases[`part-${direction}`] = DIRECTION_TEXT[direction];
  for (const distance of distances) {
    for (const direction of directions) {
      phrases[`joined-${distance}-${direction}`] =
        DISTANCE_TEXT[distance] + DIRECTION_TEXT[direction];
    }
  }
  return phrases;
}
