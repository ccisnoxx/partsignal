"""重新分析的首次采集事实资格；权限、配置与事务由各自边界裁决。"""


def reanalyzable(status: str, *, collected: bool) -> bool:
    return collected and status in {"COMPLETED", "NEEDS_REVIEW", "FAILED"}
