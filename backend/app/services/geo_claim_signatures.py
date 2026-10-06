"""规则触发与恢复共享的同类错误身份；不保存声明正文。"""

import unicodedata
from hashlib import sha256

from app.schemas.geo_analysis import GeoClaimKind


def claim_signature(kind: GeoClaimKind, text: str) -> tuple[GeoClaimKind, str]:
    normalized = " ".join(unicodedata.normalize("NFKC", text).casefold().split())
    return kind, sha256(normalized.encode()).hexdigest()
