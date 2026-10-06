"""问题变体的无 I/O 语义；问题文本不进行大小写或型号折叠。"""

import re
import unicodedata
from enum import StrEnum

PROMPT_MAX_LENGTH = 8000
LANGUAGE_PATTERN = r"^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$"
REGION_PATTERN = r"^[A-Za-z]{2}$"


class GeoPromptMentionMode(StrEnum):
    BRANDED = "BRANDED"
    UNBRANDED = "UNBRANDED"


class GeoPromptPriority(StrEnum):
    CORE = "CORE"
    STANDARD = "STANDARD"
    EXPLORATORY = "EXPLORATORY"


def normalize_prompt_text(value: str) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", value).split())
    if not normalized or len(normalized) > PROMPT_MAX_LENGTH:
        raise ValueError("问题文本规范化后必须为 1..8000 字符")
    if "\x00" in normalized:
        raise ValueError("问题文本不能包含 NUL 字符")
    return normalized


def normalize_prompt_language(value: str) -> str:
    if not 2 <= len(value) <= 16 or re.fullmatch(LANGUAGE_PATTERN, value) is None:
        raise ValueError("语言必须为 2..16 字符的语言标签")
    return value.lower()


def normalize_prompt_region(value: str) -> str:
    if re.fullmatch(REGION_PATTERN, value) is None:
        raise ValueError("地区必须为两位 ASCII 字母代码")
    return value.upper()
