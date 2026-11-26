"""二輪車通行規制区間の一覧と OSM の道を突き合わせた結果を、blocklist.json に入れる。

jmpsa/result-*.json（行ごとの結果）と jmpsa/safe-side.json（安全側で足す候補）を読み、
- 通れる道として残っている way（keptWayIds）がある行は、blocklist の項目にする
- allowlist に入っている way が通れない区間に入っていたら、allowlist から外す
同じ行をもう一度入れても重ならないように、項目に jmpsaNo を持たせ、入れ直すときは置き換える。

使い方: python merge_jmpsa.py jmpsa blocklist.json allowlist.json
  jmpsa/rows.json: 一覧の全部の行（2026-11-26 に取った）。relevant.json: 原付二種に関係する行
"""

import glob
import json
import os
import sys

PAGES = {
    "滋賀": "area-120-135.html",
    "京都": "area-120-136.html",
    "大阪": "area-120-137.html",
    "兵庫": "area-120-138.html",
    "奈良": "area-120-139.html",
    "和歌山": "area-120-145.html",
}
BASE = "https://www.jmpsa.or.jp/society/roadinfo/"
CHECKED_AT = "2026-11-26"


def main() -> None:
    jmpsa_dir, block_path, allow_path = sys.argv[1:4]
    rows = {r["no"]: r for r in json.load(open(os.path.join(jmpsa_dir, "relevant.json"), encoding="utf-8"))}
    results = []
    for path in sorted(glob.glob(os.path.join(jmpsa_dir, "result-*.json"))):
        results += json.load(open(path, encoding="utf-8"))
    # 位置を特定しきれなかった行・確度が低い行は、候補の道も消す側に倒す（safe-side.json）
    safe_path = os.path.join(jmpsa_dir, "safe-side.json")
    safe = {int(k): v for k, v in json.load(open(safe_path)).items()} if os.path.exists(safe_path) else {}
    for result in results:
        extra = safe.get(result["no"], [])
        if extra:
            result["keptWayIds"] = sorted(set(result.get("keptWayIds") or []) | set(extra))
            result["confidence"] = f"{result.get('confidence', '?')}（候補の道も安全側で消す）"

    block = json.load(open(block_path, encoding="utf-8"))
    allow = json.load(open(allow_path, encoding="utf-8"))
    block["entries"] = [e for e in block["entries"] if "jmpsaNo" not in e]

    added, conflicts = 0, set()
    for result in sorted(results, key=lambda r: r["no"]):
        kept = sorted(set(result.get("keptWayIds") or []))
        if not kept:
            continue
        row = rows[result["no"]]
        block["entries"].append(
            {
                "name": row["route"],
                "section": result.get("section") or row["section"],
                "wayIds": kept,
                "verdict": "通れない",
                "confidence": f"二輪車協会の一覧（府県警の提供）・位置の特定は {result.get('confidence', '?')}",
                "evidence": f"規制対象: {row['target']}。規制時間: {row['time']}。一覧の区間: {row['section']}",
                "time": row["time"],
                "howLocated": result.get("howLocated"),
                "sources": [BASE + PAGES[row["pref"]]],
                "checkedAt": CHECKED_AT,
                "jmpsaNo": row["no"],
            }
        )
        added += 1
        conflicts |= set(kept)

    removed_from_allow = 0
    for entry in allow["entries"]:
        before = len(entry["wayIds"])
        entry["wayIds"] = [w for w in entry["wayIds"] if w not in conflicts]
        if len(entry["wayIds"]) != before:
            removed_from_allow += before - len(entry["wayIds"])
            entry["evidence"] += "。二輪車協会の一覧で通れないと分かった way を外した"
    allow["entries"] = [e for e in allow["entries"] if e["wayIds"]]

    json.dump(block, open(block_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(allow, open(allow_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"行の結果 {len(results)}・blocklist に入れた行 {added}・way {len(conflicts)}・allowlist から外した way {removed_from_allow}")


if __name__ == "__main__":
    main()
