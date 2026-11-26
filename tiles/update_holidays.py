"""内閣府の「国民の祝日」の CSV を、tiles/holidays-jp.csv の形にする（設計書 2.3・9 章）。

内閣府の CSV は Shift_JIS（cp932）で、1955 年から翌年までが入っている。UTF-8 にし、今年から後だけ残す。
時間帯の規制の「PH」（祝日）を日付に書き換えるのに使う（time_rules.py）。

使い方: python update_holidays.py syukujitsu.csv holidays-jp.csv
  中身が前と同じなら書き換えない。形がおかしければ止める
"""

import csv
import io
import sys
from datetime import date


def main() -> None:
    source, destination = sys.argv[1:3]
    text = open(source, "rb").read().decode("cp932")
    rows = list(csv.reader(io.StringIO(text)))
    header, body = rows[0], [row for row in rows[1:] if row]
    if len(header) != 2 or not body:
        sys.exit(f"祝日の CSV の形が違う: {header}")
    this_year = date.today().year
    kept = []
    for day_text, name in body:
        year, month, day = map(int, day_text.split("/"))
        date(year, month, day)  # 日付として読めなければ止まる
        if year >= this_year:
            kept.append([day_text, name])
    if not kept:
        sys.exit("今年から後の祝日が無い")
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(kept)
    try:
        before = open(destination, encoding="utf-8").read()
    except FileNotFoundError:
        before = ""
    if out.getvalue() == before:
        print(f"祝日の一覧: 変わっていない（{kept[0][0]}〜{kept[-1][0]}）")
        return
    open(destination, "w", encoding="utf-8").write(out.getvalue())
    print(f"祝日の一覧: 書き換えた（{kept[0][0]}〜{kept[-1][0]}、{len(kept)} 日）")


if __name__ == "__main__":
    main()
