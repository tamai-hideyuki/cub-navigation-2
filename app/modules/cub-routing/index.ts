// 端末の中でルートを計算する（設計書 2.1）。中身は valhalla-mobile
import { requireNativeModule } from 'expo-modules-core';

type CubRoutingNativeModule = {
  open(tileExtractPath: string): Promise<number>;
  isOpen(): boolean;
  route(requestJson: string): Promise<{ responseJson: string; milliseconds: number }>;
  close(): void;
  memoryFootprintMegabytes(): number;
};

const native = requireNativeModule<CubRoutingNativeModule>('CubRouting');

/** タイルの tar（valhalla_tiles.tar）を開く。開くのにかかったミリ秒を返す */
export function openTiles(tileExtractPath: string): Promise<number> {
  return native.open(tileExtractPath);
}

export function isOpen(): boolean {
  return native.isOpen();
}

/** Valhalla の /route と同じ要求を渡し、答えと計算にかかったミリ秒（端末の中で測った値）を返す */
export async function route(request: object): Promise<{ response: unknown; milliseconds: number }> {
  const result = await native.route(JSON.stringify(request));
  return { response: JSON.parse(result.responseJson), milliseconds: result.milliseconds };
}

export function closeTiles(): void {
  native.close();
}

/** アプリが使っているメモリ（MB） */
export function memoryFootprintMegabytes(): number {
  return native.memoryFootprintMegabytes();
}
