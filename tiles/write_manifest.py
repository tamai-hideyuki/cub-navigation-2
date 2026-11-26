"""iPhone に入れるデータの素性を manifest.json に書く（設計書 9.3）。

使い方: python write_manifest.py <release のフォルダ> <inputs の sha256>
  release のフォルダには valhalla_tiles.tar・map/kansai.pmtiles・map/fonts/・search/search.sqlite が入っている
  data/kansai-latest.osm.pbf・data/out/removals.json・data/out/time-rules.json も読む
"""

import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

from make_area import PREFECTURES

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
SCHEMA_VERSION = 1
# iPhone の Documents の中の置き場所（アプリの src/data/manifest.ts と合わせる）
FILES = {
    "routingTiles": "valhalla_tiles.tar",
    "mapTiles": "map/kansai.pmtiles",
    "search": "search/search.sqlite",
}
FONTS = "map/fonts"


def sha256_of(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fonts_entry(release: str) -> dict:
    """フォントは小さなファイルがたくさんあるので、まとめて1つの sha256 にする"""
    digest = hashlib.sha256()
    files = []
    root = os.path.join(release, FONTS)
    for directory, _, names in sorted(os.walk(root)):
        for name in sorted(names):
            if not name.endswith(".pbf"):
                continue
            path = os.path.join(directory, name)
            relative = os.path.relpath(path, release)
            files.append(relative)
            digest.update(relative.encode())
            digest.update(open(path, "rb").read())
    return {"directory": FONTS, "files": len(files), "sha256": digest.hexdigest()}


def main() -> None:
    release, inputs_hash = sys.argv[1:3]
    pbf = os.path.join(DATA, "kansai-latest.osm.pbf")
    osm_date = subprocess.run(
        ["osmium", "fileinfo", "-g", "header.option.osmosis_replication_timestamp", pbf],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    removals = json.load(open(os.path.join(DATA, "out", "removals.json"), encoding="utf-8"))
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "osmDate": osm_date,
        "pbfMd5": open(pbf + ".md5").read().split()[0],
        "builtAt": datetime.now(timezone(timedelta(hours=9))).isoformat(timespec="seconds"),
        "area": sorted(PREFECTURES),
        "inputsSha256": inputs_hash,
        "files": {},
        "fonts": fonts_entry(release),
        "removedWays": removals["removedWays"],
        "removedByReason": removals["byReason"],
        "timedWays": removals.get("timedWays", 0),
        "suspiciousWays": len(removals["suspiciousWays"]),
    }
    for key, relative in FILES.items():
        path = os.path.join(release, relative)
        manifest["files"][key] = {"path": relative, "bytes": os.path.getsize(path), "sha256": sha256_of(path)}
    json.dump(manifest, open(os.path.join(release, "manifest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"manifest.json: OSM {osm_date}・消す way {manifest['removedWays']}・時間帯の規制 {manifest['timedWays']}")


if __name__ == "__main__":
    main()
