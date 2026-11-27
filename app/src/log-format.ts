// 走行の記録の書式（純粋な関数）。ファイルへの書き込みは log.ts

/** 1件を1行の JSON にする */
export function formatLogLine(
  time: Date,
  event: string,
  detail: Record<string, unknown> = {},
): string {
  return JSON.stringify({ time: time.toISOString(), event: event, ...detail }) + '\n';
}

/** 記録の最後の lineCount 行を、新しい順に並べる（画面に出す用） */
export function newestLines(text: string, lineCount: number): string {
  const lines = text
    .trim()
    .split('\n')
    .filter((line) => line !== '');
  return lines.slice(-lineCount).reverse().join('\n');
}
