"""県警の交通規制のオープンデータ（JARTIC）を確かめた結果を、blocklist.json に入れる（設計書 2.3）。

出典: 公益財団法人日本道路交通情報センター「交通規制情報」（https://www.jartic.or.jp/d/opendata/ 、
2026-11-01 公開・2026 年 9 月時点のデータ、2026-11-26 に利用）を加工して作成

regulations/jartic-review-*.json（規制ごとに人が確かめた結果）を読み、原付二種に掛かる規制
（appliesToClass2）の blockWayIds と missingWayIds を消す。まだ消えていない way だけを入れる。
入れ直しても重ならないように、項目に region（jartic-<県警>）を持たせ、入れ直すときは置き換える。

使い方: python merge_jartic.py blocklist.json data/way-index.jsonl regulations/jartic-review-*.json
"""

import json
import sys
from collections import defaultdict

SOURCE = "https://www.jartic.or.jp/d/opendata/202611010000/"
ATTRIBUTION = "出典: 公益財団法人日本道路交通情報センター「交通規制情報」を加工して作成（2026-11-26 に利用）"
CHECKED_AT = "2026-11-26"


def main() -> None:
    block_path, index_path, *review_paths = sys.argv[1:]
    removed_before = {}
    with open(index_path, encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            removed_before[row["id"]] = bool(set(row["removed"]) - {"blocklist"})

    block = json.load(open(block_path, encoding="utf-8"))
    block["entries"] = [e for e in block["entries"] if not str(e.get("region", "")).startswith("jartic-")]
    already = {way_id for entry in block["entries"] for way_id in entry["wayIds"]}

    added = defaultdict(int)
    for path in review_paths:
        for row in json.load(open(path, encoding="utf-8")):
            if not row.get("appliesToClass2"):
                continue
            way_ids = sorted(
                {w for w in (row.get("blockWayIds") or []) + (row.get("missingWayIds") or [])}
                - already
                - {w for w, removed in removed_before.items() if removed}
            )
            if not way_ids:
                continue
            prefecture = row["prefecture"]
            block["entries"].append(
                {
                    "name": row.get("section", "").split("：")[0][:40] or prefecture,
                    "section": row.get("section", ""),
                    "wayIds": way_ids,
                    "verdict": "通れない",
                    "confidence": f"県警の交通規制データ・位置の特定は {row.get('confidence', '?')}",
                    "evidence": f"{ATTRIBUTION}。規制時間: {row.get('time', '')}。{row.get('notes', '')}"[:600],
                    "sources": [SOURCE],
                    "jarticKey": row["key"],
                    "checkedAt": CHECKED_AT,
                    "region": f"jartic-{prefecture}",
                }
            )
            already |= set(way_ids)
            added[prefecture] += len(way_ids)
    json.dump(block, open(block_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("新たに消す way:", dict(added), "合計", sum(added.values()))


if __name__ == "__main__":
    main()
