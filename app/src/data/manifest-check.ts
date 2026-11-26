// Mac から写したデータの manifest.json を読み、入っているファイルと合うかを見る（設計書 9.3）。
// 端末に依存しない（Node でテストできる）。ファイルを読むのは manifest.ts

export type ManifestFile = { path: string; bytes: number; sha256: string };

export type Manifest = {
  schemaVersion: number;
  /** 元の OSM のデータの日付（Geofabrik の pbf の時刻、UTC） */
  osmDate: string;
  builtAt: string;
  files: Record<string, ManifestFile>;
  timedWays?: number;
};

/** manifest.json の中身を読む。形が違えば null */
export function parseManifest(text: string): Manifest | null {
  try {
    const value = JSON.parse(text);
    if (typeof value?.osmDate !== 'string' || typeof value?.files !== 'object' || value.files === null) return null;
    for (const entry of Object.values(value.files) as ManifestFile[]) {
      if (typeof entry?.path !== 'string' || typeof entry?.bytes !== 'number') return null;
    }
    return value as Manifest;
  } catch {
    return null;
  }
}

/**
 * 入っているファイルの大きさが manifest と合うかを見て、合わないファイルの説明を返す。
 * sha256 は、大きいファイル（約 800MB）を起動のたびに読むことになるので見ない。写す途中で止まったファイルは大きさで分かる
 */
export function fileProblems(manifest: Manifest, sizeOf: (path: string) => number | null): string[] {
  const problems: string[] = [];
  for (const entry of Object.values(manifest.files)) {
    const size = sizeOf(entry.path);
    if (size === null) problems.push(`${entry.path} が無い`);
    else if (size !== entry.bytes) problems.push(`${entry.path} の大きさが違う（写す途中で止まった？）`);
  }
  return problems;
}

/** 「地図 2026/11/25（2日前）」。osmDate は UTC なので、日本の日付にして出す */
export function mapDateLabel(osmDate: string, now: Date): string {
  const date = new Date(osmDate);
  if (Number.isNaN(date.getTime())) return '地図の日付が分からない';
  const japan = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const label = `${japan.getUTCFullYear()}/${japan.getUTCMonth() + 1}/${japan.getUTCDate()}`;
  const days = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  return `地図 ${label}（${days <= 0 ? '今日' : `${days}日前`}）`;
}
