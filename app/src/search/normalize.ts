// 検索の文字をそろえる（tiles/build_search.py の normalize と同じ決まり）。画面・端末に依存しない
// 全角・半角、大文字・小文字、カタカナ・ひらがなの違いをなくし、空白を取る

export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}
