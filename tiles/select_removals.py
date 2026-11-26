"""消す道を決める（設計書 2.3）。

osmium で出した道の OPL を読み、消す way の ID と、その理由ごとの一覧、怪しい道の一覧を書く。
時間帯で通れないだけの道（読める書き方の :conditional、または blocklist の timeRule）は消さずに、
Valhalla が読める規制（time_rules.py）を out/time-rules.json に書く。prepare.sh がそれを道に書き込む。

使い方: python select_removals.py ways.opl blocklist.json allowlist.json out/
  ways.opl: highway か route=ferry を持つ way（osmium cat -f opl）
"""

import json
import os
import sys
from collections import Counter, defaultdict
from urllib.parse import unquote

from time_rules import load_holidays, parse_clauses, parse_conditional, to_valhalla

# 二輪・原付の通行のタグ
TWO_WHEEL_KEYS = ("motorcycle", "access:motorcycle", "moped", "access:moped")
# 車全体の通行のタグ
VEHICLE_KEYS = ("motor_vehicle", "access")
# 通れる値
PASSABLE_VALUES = {"yes", "designated", "permissive", "destination", "customers", "delivery"}
# 通れない値（迷う値も通れない側に入れる）
BLOCKED_VALUES = {"no", "private", "permit", "dismount", "agricultural", "forestry", "use_sidepath", "unknown"}
CONDITIONAL_KEYS = tuple(f"{k}:conditional" for k in TWO_WHEEL_KEYS + VEHICLE_KEYS)

MAJOR_ROADS = {"trunk", "primary"}
LINK_ROADS = {"trunk_link", "primary_link", "motorway_link"}
FACILITY_WORDS = ("バイパス", "道路", "有料")


def parse_opl_way(line: str):
    """OPL の way の行から (id, tags, node_ids) を取り出す。"""
    fields = line.rstrip("\n").split(" ")
    way_id = int(fields[0][1:])
    tags: dict[str, str] = {}
    nodes: list[int] = []
    for field in fields[1:]:
        if field.startswith("T") and len(field) > 1:
            for pair in field[1:].split(","):
                if "=" in pair:
                    key, value = pair.split("=", 1)
                    tags[unquote_opl(key)] = unquote_opl(value)
        elif field.startswith("N") and len(field) > 1:
            nodes = [int(n[1:]) for n in field[1:].split(",") if n]
    return way_id, tags, nodes


def unquote_opl(text: str) -> str:
    """OPL の %xxxx% を文字に戻す。"""
    out, i = [], 0
    while i < len(text):
        if text[i] == "%":
            end = text.index("%", i + 1)
            out.append(chr(int(text[i + 1 : end], 16)))
            i = end + 1
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def reasons_for(tags: dict[str, str]) -> list[str]:
    """この道を消す理由（空なら消さない）。"""
    reasons = []
    highway = tags.get("highway", "")
    # 1段目: 道の種類
    if highway in ("motorway", "motorway_link"):
        reasons.append("motorway")
    if tags.get("motorroad") == "yes":
        reasons.append("motorroad")
    if tags.get("toll") == "yes":
        reasons.append("toll")
    if tags.get("route") == "ferry":
        reasons.append("ferry")
    # 2段目: 通行のタグ
    for key in TWO_WHEEL_KEYS:
        value = tags.get(key)
        if value is None:
            continue
        if value in BLOCKED_VALUES:
            reasons.append("twowheel")
        elif value not in PASSABLE_VALUES:
            reasons.append("unknown-value")
    for key in VEHICLE_KEYS:
        value = tags.get(key)
        if value is not None and value in BLOCKED_VALUES:
            reasons.append("vehicle")
    for key in CONDITIONAL_KEYS:
        value = tags.get(key)
        if value is not None and any(part.strip().startswith(tuple(BLOCKED_VALUES)) for part in value.split(";")):
            reasons.append("conditional")
    return sorted(set(reasons))


LAYER_ONE = {"motorway", "motorroad", "toll", "ferry"}


def time_rule_for(tags: dict[str, str], reasons: list[str], entry, holidays):
    """時間帯で通れないだけの道なら、Valhalla に渡す規制の文字列を返す。いつも通れないなら None"""
    if set(reasons) - {"conditional", "blocklist"}:
        return None  # 他の理由でも通れない
    if "blocklist" in reasons and not entry.get("timeRule"):
        return None  # 人が確かめて、いつも通れない
    clauses = []
    if "conditional" in reasons:
        for key in CONDITIONAL_KEYS:
            value = tags.get(key)
            if value is None or not any(part.strip().startswith(tuple(BLOCKED_VALUES)) for part in value.split(";")):
                continue
            parsed = parse_conditional(value)
            if parsed is None:
                return None  # 読めない書き方（winter など）は、いつも通れないことにする
            clauses += parsed
    if entry and entry.get("timeRule"):
        parsed = parse_clauses(entry["timeRule"])
        if parsed is None:
            sys.exit(f"blocklist の timeRule が読めない: {entry['name']} {entry['timeRule']}")
        clauses += parsed
    return to_valhalla(clauses, holidays) if clauses else None


def load_list(path: str) -> dict[int, dict]:
    """blocklist.json・allowlist.json を読み、way の ID → 項目 にする。

    形: {"entries": [{"name", "section", "wayIds": [...], "verdict", "evidence", "sources": [...], "checkedAt"}]}
    1つの項目は、根拠が同じ1つの区間。way の ID は OSM の編集で変わるので、
    見つからなくなったらビルドを止める（main の missing_blocklist）。
    """
    entries = json.load(open(path, encoding="utf-8"))["entries"]
    by_id: dict[int, dict] = {}
    for entry in entries:
        if not entry.get("sources"):
            sys.exit(f"{path}: 根拠（sources）の無い項目がある: {entry.get('name')}")
        for way_id in entry["wayIds"]:
            by_id[way_id] = entry
    return by_id


def main() -> None:
    opl_path, blocklist_path, allowlist_path, out_dir = sys.argv[1:5]
    os.makedirs(out_dir, exist_ok=True)
    blocklist = load_list(blocklist_path)
    allowlist = load_list(allowlist_path)
    holidays = load_holidays()
    timed: dict[int, str] = {}

    removed: dict[int, list[str]] = {}
    unknown_values: list[dict] = []
    kept_major: dict[int, dict] = {}
    names_of_removed: set[str] = set()
    node_to_link = set()
    major_nodes: dict[int, list[int]] = {}
    seen_blocklist: set[int] = set()

    with open(opl_path, encoding="utf-8") as f:
        for line in f:
            if not line.startswith("w"):
                continue
            way_id, tags, nodes = parse_opl_way(line)
            reasons = reasons_for(tags)
            if way_id in blocklist:
                reasons.append("blocklist")
                seen_blocklist.add(way_id)
            if way_id in allowlist and not (set(reasons) & LAYER_ONE) and "blocklist" not in reasons:
                reasons = []
            highway = tags.get("highway", "")
            rule = time_rule_for(tags, reasons, blocklist.get(way_id), holidays) if reasons else None
            if rule:
                timed[way_id] = rule  # 消さずに、時間帯の規制を書き込む
                if highway in LINK_ROADS:
                    node_to_link.update(nodes)
                continue
            if reasons:
                removed[way_id] = reasons
                if tags.get("name"):
                    names_of_removed.add(tags["name"])
                if "unknown-value" in reasons:
                    unknown_values.append(
                        {"id": way_id, "name": tags.get("name"), **{k: tags[k] for k in TWO_WHEEL_KEYS if k in tags}}
                    )
            elif highway in MAJOR_ROADS and way_id not in allowlist:
                # allowlist の道は人が確かめたので、怪しい道に出さない
                kept_major[way_id] = {"id": way_id, "name": tags.get("name"), "highway": highway, "ref": tags.get("ref")}
                major_nodes[way_id] = nodes
            if highway in LINK_ROADS:
                node_to_link.update(nodes)

    # 怪しい道: 残った trunk・primary のうち、
    # 消した道と同じ「施設の名前」（バイパス・道路・有料）のもの、
    # または名前に「バイパス」「道路」があって出入口（*_link）とつながるもの。
    # 「国道1号」のような路線の名前は、一部だけ消えるのがふつうなので見ない
    suspicious = []
    for way_id, info in kept_major.items():
        name = info["name"] or ""
        why = []
        if name and name in names_of_removed and any(w in name for w in FACILITY_WORDS):
            why.append("消した道と同じ名前")
        if ("バイパス" in name or "道路" in name) and any(n in node_to_link for n in major_nodes[way_id]):
            why.append("バイパスの名前で出入口とつながる")
        if why:
            suspicious.append({**info, "why": why})

    missing_blocklist = sorted(set(blocklist) - seen_blocklist)

    with open(os.path.join(out_dir, "removed-ids.txt"), "w") as f:
        for way_id in sorted(removed):
            f.write(f"w{way_id}\n")
    with open(os.path.join(out_dir, "timed-ids.txt"), "w") as f:
        for way_id in sorted(timed):
            f.write(f"w{way_id}\n")
    json.dump({str(k): v for k, v in sorted(timed.items())}, open(os.path.join(out_dir, "time-rules.json"), "w"), indent=1)
    counts = Counter(r for rs in removed.values() for r in rs)
    report = {
        "removedWays": len(removed),
        "timedWays": len(timed),
        "byReason": dict(sorted(counts.items())),
        "unknownValues": unknown_values,
        "suspiciousWays": sorted(suspicious, key=lambda s: (s["name"] or "", s["id"])),
        "missingBlocklist": missing_blocklist,
    }
    json.dump(report, open(os.path.join(out_dir, "removals.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    print(f"消す way: {len(removed)}")
    print(f"時間帯の規制を書き込む way: {len(timed)}")
    for reason, n in sorted(counts.items()):
        print(f"  {reason}: {n}")
    print(f"決まりに無い値: {len(unknown_values)}")
    by_name = defaultdict(int)
    for s in suspicious:
        by_name[s["name"]] += 1
    print(f"怪しい道: {len(suspicious)} 本（名前 {len(by_name)} 種類）")
    if missing_blocklist:
        sys.exit(f"blocklist の way が見つからない: {missing_blocklist}")


if __name__ == "__main__":
    main()
