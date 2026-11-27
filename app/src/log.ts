// 走行の記録。1行1件の JSON を Documents/navigation-log.txt に足していく（後でケーブル越しに読む）。
// 走行中は、走行ごとの記録（Documents/logs/<出発の日時>.jsonl、設計書 3.1）にも同じものを書く
import { File, Paths } from 'expo-file-system';

import { formatLogLine, newestLines } from './log-format';

const logFile = new File(Paths.document, 'navigation-log.txt');

/** 走行ごとの記録のフォルダ（tools/pull-logs.sh で Mac に写す） */
export const TRIP_LOG_DIRECTORY = 'logs';

let tripLogFile: File | null = null;

function append(file: File, event: string, detail: Record<string, unknown>): void {
  try {
    if (!file.exists) file.create({ intermediates: true });
    file.write(formatLogLine(new Date(), event, detail), { append: true });
  } catch (error) {
    console.warn('記録に失敗', error);
  }
}

/** 出来事（案内・計算し直しなど）を残す。走行中なら、走行ごとの記録にも書く */
export function writeLog(event: string, detail: Record<string, unknown> = {}): void {
  append(logFile, event, detail);
  if (tripLogFile !== null) append(tripLogFile, event, detail);
}

/** 走行ごとの記録にだけ書く（毎秒の位置など、量が多いもの） */
export function writeTripLog(event: string, detail: Record<string, unknown> = {}): void {
  if (tripLogFile !== null) append(tripLogFile, event, detail);
}

/** 走行ごとの記録を開く。同じ名前なら続きに書く（アプリが起こし直されたとき） */
export function openTripLog(fileName: string): void {
  tripLogFile = new File(Paths.document, TRIP_LOG_DIRECTORY, fileName);
}

export function closeTripLog(): void {
  tripLogFile = null;
}

export function isTripLogOpen(): boolean {
  return tripLogFile !== null;
}

/** 記録の最後の lineCount 行を、書いた順に返す */
export function readRecentLogLines(lineCount: number): string[] {
  try {
    if (!logFile.exists) return [];
    return logFile
      .textSync()
      .trim()
      .split('\n')
      .filter((line) => line !== '')
      .slice(-lineCount);
  } catch {
    return [];
  }
}

export function readLogTail(lineCount: number): string {
  try {
    return logFile.exists ? newestLines(logFile.textSync(), lineCount) : '';
  } catch {
    return '';
  }
}
