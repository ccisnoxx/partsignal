"""Cron集合沿Celery解析；窗口是IANA墙钟的第一次有效UTC映射。"""

from calendar import monthrange
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from celery.schedules import crontab


def next_window(expression: str, timezone: str, after: datetime) -> datetime:
    if after.tzinfo is None or after.utcoffset() is None:
        raise ValueError("调度基准必须包含时区")
    rules = crontab.from_string(expression)
    zone = ZoneInfo(timezone)
    local = after.astimezone(zone)
    absolute = after.astimezone(UTC)
    # Gregorian日历400年重复；不逐分钟扫描多年，也不接受永不发生的2月31日。
    for year in range(local.year, min(10000, local.year + 401)):
        for month in sorted(rules.month_of_year):
            if (year, month) < (local.year, local.month):
                continue
            for day in sorted(rules.day_of_month):
                if day > monthrange(year, month)[1]:
                    continue
                current = date(year, month, day)
                if current < local.date() or current.isoweekday() % 7 not in rules.day_of_week:
                    continue
                for hour in sorted(rules.hour):
                    for minute in sorted(rules.minute):
                        candidate = datetime(year, month, day, hour, minute, tzinfo=zone, fold=0)
                        utc = candidate.astimezone(UTC)
                        if utc <= absolute:
                            continue
                        if utc.astimezone(zone).replace(tzinfo=None) != candidate.replace(
                            tzinfo=None
                        ):
                            continue  # DST跳过不存在分钟；重复墙钟仅fold=0。
                        return utc
    raise ValueError("Cron在一个Gregorian周期内没有可执行日期")
