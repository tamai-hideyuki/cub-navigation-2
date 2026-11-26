// Mac から写したデータ（tools/install-data.sh）の manifest.json を読む（設計書 9.3）
import { File, Paths } from 'expo-file-system';

import { fileProblems, parseManifest, type Manifest } from './manifest-check';

const MANIFEST_FILE = new File(Paths.document, 'manifest.json');

export type InstalledData = { manifest: Manifest | null; problems: string[] };

/** 入っているデータの素性と、ファイルの足りない・壊れたもの */
export function readInstalledData(): InstalledData {
  try {
    if (!MANIFEST_FILE.exists) return { manifest: null, problems: ['manifest.json が無い（Mac で tools/install-data.sh を動かす）'] };
    const manifest = parseManifest(MANIFEST_FILE.textSync());
    if (!manifest) return { manifest: null, problems: ['manifest.json が読めない'] };
    const problems = fileProblems(manifest, (path) => {
      const file = new File(Paths.document, path);
      return file.exists ? (file.size ?? 0) : null;
    });
    return { manifest, problems };
  } catch (error) {
    return { manifest: null, problems: [`manifest.json を読めない: ${String(error)}`] };
  }
}

/** 入っている地図の OSM の日付（ルートに持たせる。無ければ 'unknown'） */
export function installedOsmDate(): string {
  return readInstalledData().manifest?.osmDate ?? 'unknown';
}
