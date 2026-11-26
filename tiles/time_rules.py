"""時間帯つきの規制の書き方を読み、Valhalla が読める形に直す（設計書 2.3・3 章）。

OSM の書き方（opening_hours の一部）: 「no @ (Su,PH 00:00-06:00)」「no @ (Mo-Fr 07:30-09:00; Sa,Su,PH off)」
- 曜日（Mo〜Su、範囲・カンマ区切り）・PH（祝日）・時間（HH:MM-HH:MM、カンマ区切り）・off だけを読む
- それ以外（winter・hazmat・競馬開催日など）は読めない。読めない規制の道は、いつも通れないことにする（安全側）
- Valhalla は日本の祝日（PH）を知らないので、PH を祝日の日付（「Nov 23」）に置き換える。日付には年が入らないので、
  入れた年の祝日を毎年の祝日として扱う（祝日でない日を規制の日に数えることがあるが、遠回りになるだけで安全側）
- 「off」の節（「Sa,Su,PH off」）は捨てる。休日も規制の日として扱う（安全側）
"""

import csv
import os
import re
from datetime import date, timedelta

DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
RESTRICTED_VALUES = {"no", "private", "destination", "delivery", "permit"}
# 「PH -1 day」は祝日の前の日（二輪車協会の一覧の「休日の前日」を書くため）
DAY_TOKEN = r"(?:PH -1 day|(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)"
DAYS_PART = rf"{DAY_TOKEN}(?:,\s*{DAY_TOKEN})*"
TIME_RANGE = r"\d{1,2}:\d{2}-\d{1,2}:\d{2}"
TIMES_PART = rf"{TIME_RANGE}(?:,\s*{TIME_RANGE})*"
CLAUSE = re.compile(rf"^(?P<days>{DAYS_PART})?\s*(?P<times>{TIMES_PART})?\s*(?P<off>off)?$")


def load_holidays(path: str = os.path.join(os.path.dirname(__file__), "holidays-jp.csv")) -> list[date]:
    """内閣府の祝日の一覧（tiles/holidays-jp.csv）"""
    with open(path, encoding="utf-8") as f:
        rows = list(csv.reader(f))[1:]
    return [date(*map(int, row[0].split("/"))) for row in rows if row]


def parse_clauses(condition: str):
    """「Su,PH 00:00-06:00; Mo-Fr 07:30-09:00」→ [(曜日の集合, 祝日から何日ずらすかの集合, [時間]), …]。読めなければ None

    祝日の集合は、PH なら {0}、「PH -1 day」（祝日の前の日）なら {-1}"""
    clauses = []
    for part in condition.split(";"):
        part = part.strip()
        if not part:
            continue
        match = CLAUSE.match(part)
        if not match or not (match.group("days") or match.group("times")):
            return None
        if match.group("off"):
            continue  # 「off」は捨てる（安全側）
        days, holiday_offsets = set(), set()
        for token in (match.group("days") or "").split(","):
            token = token.strip()
            if not token:
                continue
            if token == "PH":
                holiday_offsets.add(0)
            elif token == "PH -1 day":
                holiday_offsets.add(-1)
            elif "-" in token:
                start, end = token.split("-")
                i, j = DAYS.index(start), DAYS.index(end)
                days |= {DAYS[(i + k) % 7] for k in range((j - i) % 7 + 1)}
            else:
                days.add(token)
        if not match.group("days"):
            days = set(DAYS)  # 曜日が無ければ毎日
        times = [zero_pad(t.strip()) for t in (match.group("times") or "00:00-24:00").split(",")]
        same_day = [t for t in times if not crosses_midnight(t)]
        if same_day:
            clauses.append((days, holiday_offsets, same_day))
        for t in times:
            if crosses_midnight(t):
                # 「19:00-07:00」は「19:00-24:00」と、次の日の「00:00-07:00」に分ける
                start, end = t.split("-")
                clauses.append((days, holiday_offsets, [f"{start}-24:00"]))
                if end != "00:00":
                    next_days = {DAYS[(DAYS.index(d) + 1) % 7] for d in days}
                    clauses.append((next_days, {o + 1 for o in holiday_offsets}, [f"00:00-{end}"]))
    return clauses


def crosses_midnight(time_range: str) -> bool:
    start, end = time_range.split("-")
    return end <= start


def zero_pad(time_range: str) -> str:
    """「9:00-17:00」→「09:00-17:00」"""
    return "-".join(f"{int(h):02d}:{m}" for h, m in (t.split(":") for t in time_range.split("-")))


def parse_conditional(value: str):
    """「no @ (Su,PH 00:00-06:00)」のような値から、通れない時間の節を取り出す。読めなければ None"""
    clauses = []
    for piece in re.split(r";\s*(?=[a-z_]+\s*@)", value.strip()):
        match = re.match(r"^\s*([a-z_]+)\s*@\s*\(?(.+?)\)?\s*$", piece)
        if not match:
            return None
        restriction, condition = match.groups()
        if restriction not in RESTRICTED_VALUES:
            return None  # 「yes @ …」など、時間で通れるようになる書き方は扱わない
        parsed = parse_clauses(condition)
        if parsed is None:
            return None
        clauses += parsed
    return clauses or None


def to_valhalla(clauses, holidays: list[date]) -> str:
    """節を Valhalla が読める条件の文字列にする（PH は祝日の日付に置き換える）"""
    parts = []
    for days, holiday_offsets, times in clauses:
        ordered = [d for d in DAYS if d in days]
        time_text = ",".join(times)
        if ordered:
            parts.append(f"{','.join(compress(ordered))} {time_text}")
        dates = {(h + timedelta(days=offset)).timetuple()[1:3] for h in holidays for offset in holiday_offsets}
        for month, day in sorted(dates):
            parts.append(f"{MONTHS[month - 1]} {day:02d} {time_text}")
    return "no @ (" + "; ".join(dict.fromkeys(parts)) + ")"  # 同じ節は1つに


def compress(days: list[str]) -> list[str]:
    """['Mo','Tu','We','Th','Fr'] → ['Mo-Fr']"""
    indexes = [DAYS.index(d) for d in days]
    groups, start, previous = [], indexes[0], indexes[0]
    for index in indexes[1:] + [None]:
        if index is not None and index == previous + 1:
            previous = index
            continue
        groups.append(DAYS[start] if start == previous else f"{DAYS[start]}-{DAYS[previous]}")
        if index is not None:
            start = previous = index
    return groups


if __name__ == "__main__":
    holidays = load_holidays()
    for sample in ["no @ (Sa,PH -1 day 21:00-24:00; Su,PH 00:00-05:00)", "no @ (Su,PH 00:00-06:00)", "no @ (Mo-Su 19:00-07:00)", "no @ (10:00-00:00)", "no @ (Su, PH 13:00-19:00; Sa 15:00-19:00)", "no @ (Mo-Fr 07:30-09:00; Sa,Su,PH off)", "no @ (winter)", "no@(10:00-19:00)", "no @ (Sa,Su,PH)"]:
        clauses = parse_conditional(sample)
        print(sample, "→", to_valhalla(clauses, holidays)[:200] if clauses else "読めない")
