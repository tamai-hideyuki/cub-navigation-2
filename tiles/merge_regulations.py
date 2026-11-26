"""県警の交通規制などを調べた結果（regulations/<地域>-result.json）を、blocklist.json と allowlist.json に入れる。

二輪車協会の一覧が無い府県（三重県）用。行の形は data/mie-result.json と同じ:
  {"name", "section", "verdict", "blockWayIds", "candidateWayIds", "allowWayIds", "evidence", "sources", "confidence"}
- blockWayIds は消す。candidateWayIds（場所を特定しきれなかった候補）も、安全側で消す
- allowWayIds は、怪しい道に出ても人が確かめた道として allowlist に入れる
同じ地域をもう一度入れても重ならないように、項目に region を持たせ、入れ直すときは置き換える。

使い方: python merge_regulations.py mie regulations/mie-result.json blocklist.json allowlist.json
"""

import json
import sys

CHECKED_AT = "2026-11-26"


def main() -> None:
    region, result_path, block_path, allow_path = sys.argv[1:5]
    results = json.load(open(result_path, encoding="utf-8"))
    block = json.load(open(block_path, encoding="utf-8"))
    allow = json.load(open(allow_path, encoding="utf-8"))
    block["entries"] = [e for e in block["entries"] if e.get("region") != region]
    allow["entries"] = [e for e in allow["entries"] if e.get("region") != region]

    blocked: set[int] = set()
    for result in results:
        ways = sorted(set(result.get("blockWayIds") or []))
        candidates = sorted(set(result.get("candidateWayIds") or []) - set(ways))
        for way_ids, confidence in ((ways, result["confidence"]), (candidates, f"{result['confidence']}（候補を安全側で消す）")):
            if not way_ids:
                continue
            block["entries"].append(
                {
                    "name": result["name"],
                    "section": result["section"],
                    "wayIds": way_ids,
                    "verdict": "通れない",
                    "confidence": confidence,
                    "evidence": result["evidence"],
                    "sources": result["sources"],
                    "checkedAt": CHECKED_AT,
                    "region": region,
                }
            )
            blocked |= set(way_ids)
    for result in results:
        way_ids = sorted(set(result.get("allowWayIds") or []) - blocked)
        if not way_ids:
            continue
        allow["entries"].append(
            {
                "name": result["name"],
                "section": result["section"],
                "wayIds": way_ids,
                "verdict": "通れる",
                "confidence": result["confidence"],
                "evidence": result["evidence"],
                "sources": result["sources"],
                "checkedAt": CHECKED_AT,
                "region": region,
            }
        )
    json.dump(block, open(block_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(allow, open(allow_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"{region}: 消す way {len(blocked)}・通れる way {sum(len(e['wayIds']) for e in allow['entries'] if e.get('region') == region)}")


if __name__ == "__main__":
    main()
