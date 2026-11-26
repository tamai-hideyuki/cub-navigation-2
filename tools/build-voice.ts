// 案内の声（m4a）を macOS の say で作る（設計書 4 章）。前の版の tools/build-route.ts と同じ作り方
// 使い方: node tools/build-voice.ts
//   app/assets/voice/<ID>.m4a と、アプリが読む一覧 app/src/clip-assets.ts を作る。
//   読む文が前回と同じ声は作り直さない（app/assets/voice/phrases.json に前回の文を残す）
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { allPhrases } from '../app/src/voice/phrases.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_DIRECTORY = join(ROOT, 'app/assets/voice');
const MANIFEST_FILE = join(VOICE_DIRECTORY, 'phrases.json');
const CLIP_ASSETS_FILE = join(ROOT, 'app/src/clip-assets.ts');

const VOICE = 'Kyoko';
const SPEECH_RATE_WORDS_PER_MINUTE = 180;
/** say はまれに固まるので打ち切ってやり直す（前の版で起きた） */
const SAY_TIMEOUT_MILLISECONDS = 20_000;
const SAY_ATTEMPTS = 3;

function speak(text: string, outputFile: string): void {
  const temporaryFile = outputFile.replace(/\.m4a$/, '.aiff');
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('say', ['-v', VOICE, '-r', String(SPEECH_RATE_WORDS_PER_MINUTE), '-o', temporaryFile, text], {
        timeout: SAY_TIMEOUT_MILLISECONDS,
      });
      break;
    } catch (error) {
      if (attempt >= SAY_ATTEMPTS) throw error;
      console.warn(`say をやり直す（${attempt}回目）: ${outputFile}`);
    }
  }
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', temporaryFile, outputFile]);
  rmSync(temporaryFile);
}

function main(): void {
  mkdirSync(VOICE_DIRECTORY, { recursive: true });
  const phrases = allPhrases();
  const previous: Record<string, string> = existsSync(MANIFEST_FILE) ? JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) : {};
  let made = 0;
  for (const [clipId, text] of Object.entries(phrases)) {
    const file = join(VOICE_DIRECTORY, `${clipId}.m4a`);
    if (previous[clipId] === text && existsSync(file)) continue;
    speak(text, file);
    made++;
  }
  writeFileSync(MANIFEST_FILE, JSON.stringify(phrases, null, 2) + '\n');

  const lines = Object.keys(phrases)
    .sort()
    .map((clipId) => `  '${clipId}': require('../assets/voice/${clipId}.m4a'),`);
  writeFileSync(
    CLIP_ASSETS_FILE,
    [
      '// tools/build-voice.ts が作る。手で書き換えない',
      'export const CLIP_ASSETS: Record<string, number> = {',
      ...lines,
      '};',
      '',
    ].join('\n'),
  );
  console.log(`声 ${Object.keys(phrases).length} 個（作ったのは ${made} 個）`);
}

main();
