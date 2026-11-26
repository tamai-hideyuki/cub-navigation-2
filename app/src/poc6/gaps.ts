// PoC 6: 記録から、声のつなぎ目の間（1つ目の鳴り終わり → 2つ目の鳴り始め）を測る。画面・端末に依存しない

type LogEntry = { time: string; event: string; clipId?: string | null };

export type ClipGap = { fromClipId: string; toClipId: string; gapMilliseconds: number };

/** 記録の行（書いた順）から、鳴り終わってすぐ次が鳴り始めた所の間を取り出す。間が maxGap を超えるものは、続けて鳴らしたものではないとみなす */
export function clipGaps(lines: string[], maxGapMilliseconds = 3000): ClipGap[] {
  const gaps: ClipGap[] = [];
  let lastFinish: { clipId: string; milliseconds: number } | null = null;
  for (const line of lines) {
    let entry: LogEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const milliseconds = Date.parse(entry.time);
    if (entry.event === 'clip-finish' && entry.clipId) {
      lastFinish = { clipId: entry.clipId, milliseconds };
    } else if (entry.event === 'clip-play' && entry.clipId) {
      if (lastFinish && milliseconds - lastFinish.milliseconds <= maxGapMilliseconds) {
        gaps.push({ fromClipId: lastFinish.clipId, toClipId: entry.clipId, gapMilliseconds: milliseconds - lastFinish.milliseconds });
      }
      lastFinish = null;
    }
  }
  return gaps;
}
