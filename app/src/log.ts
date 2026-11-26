// 走行の記録。1行1件の JSON を Documents/navigation-log.txt に足していく（後でケーブル越しに読む）
import { File, Paths } from 'expo-file-system';

import { formatLogLine, newestLines } from './log-format';

const logFile = new File(Paths.document, 'navigation-log.txt');

export function writeLog(event: string, detail: Record<string, unknown> = {}): void {
  try {
    if (!logFile.exists) logFile.create();
    logFile.write(formatLogLine(new Date(), event, detail), { append: true });
  } catch (error) {
    console.warn('記録に失敗', error);
  }
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
