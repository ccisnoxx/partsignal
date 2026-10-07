"""GEO-505 有限、版本化的明确声明语义；未知表达不推断为已批准事实。"""

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal

from app.schemas.geo_analysis import GeoClaimKind as Kind

CLAIM_RULE_VERSION = "geo-claims-v1"
SENTENCE_BREAK = re.compile(r"[。！？!?;；\n\r]|(?<![0-9０-９])\.(?![0-9０-９])")
_UNCERTAIN = re.compile(
    r"是否|能否|据说|可能|或许|大约|约为|至少|至多|仅作为|只是示例|"
    r"不代表|并非|不一定|(?:或|或者|\bor\b)\s*[+-]?\d|[?？“”\"`]|"
    r"\b(?:might|perhaps|about|example|whether)\b",
    re.I,
)
_HYPHENS = str.maketrans(dict.fromkeys("‐‑‒–−﹣－", "-"))
_NUMBER = r"[+-]?\d+(?:\.\d+)?"
_PART = r"[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+"
_VOLTAGE = re.compile(
    rf"(?:供电电压|工作电压|电源电压|supply\s+voltage)\s*(?:为|是|[:：=]|is)?\s*"
    rf"({_NUMBER})\s*(mV|V)\b|({_NUMBER})\s*(mV|V)\s*器件",
    re.I,
)
_PACKAGE = re.compile(
    r"(?:封装|package)\s*(?:为|是|[:：=]|is)?\s*([A-Za-z]+[- ]?\d+(?:-[A-Za-z0-9]+)*)",
    re.I,
)
_TEMPERATURE = re.compile(
    rf"(?:工作温度|温度范围|operating\s+temperature)\s*(?:为|是|[:：=]|is)?\s*"
    rf"({_NUMBER})\s*(?:°\s*C)?\s*(?:至|到|~|～|to)\s*({_NUMBER})\s*°?\s*C\b",
    re.I,
)
_IDENTITY = re.compile(r"(?:品牌|brand)\s*(?:为|是|[:：=]|is)\s*([^,，。;；\n]+)", re.I)
_CERTIFICATE = re.compile(
    r"(?:(未获得|未通过|没有获得)|已获得|已通过|获得|通过|认证[:：])"
    r"[^,，。;；\n]{0,30}?(?:认证\s*)?([A-Z][A-Z0-9-]*\d[A-Z0-9-]*)\b",
    re.I,
)
_CERT_UNKNOWN = re.compile(r"未提供.*认证|认证.*(?:未知|未确认)|certification.*unknown", re.I)
_LIFECYCLE = re.compile(
    r"(?:生命周期|lifecycle)\s*(?:为|是|[:：=]|is)?\s*"
    r"(ACTIVE|EOL|NRND|停产|在产|量产|不推荐新设计)",
    re.I,
)
_APPLICATION = re.compile(r"(?:应用[:：]|适用于|application[:：])\s*([^,，。;；\n]+)", re.I)
_REPLACE = re.compile(
    rf"(?:(不能|不可|不支持)替代|(?:可|可以|能够)(?:无条件|直接)?替代)\s*({_PART})"
    rf"|可作为[^,，。;；\n]{{0,24}}?({_PART})\s*的(?:条件)?替代",
    re.I,
)
_CONDITIONS = re.compile(
    r"(?:仅在|只有在|在|如果)\s*(.+?)\s*(?:条件下|时|后)"
    r"(?=$|[,，]|\s*(?:才)?(?:可|能够|[A-Z]))",
    re.I,
)
_CONDITION_CUE = re.compile(r"仅在|只有|如果|除非|条件|当.+时|在.+(?:时|后|下)")
_CONDITION_JOIN = re.compile(r"、|且|并且|以及|\band\b", re.I)
_PIN = re.compile(r"引脚(?:定义)?(?:为)?(不一致|不兼容|一致|兼容)")
_GENERIC = re.compile(r"(?:参数|性能|功能|规格)\s*(?:为|是|[:：=])\s*([^,，。;；\n]+)")


def text_key(text: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).casefold().translate(_HYPHENS))


@dataclass(frozen=True)
class Assertion:
    kind: Kind
    key: str
    value: tuple[str, ...] = field(repr=False)
    conditions: tuple[str, ...] = field(repr=False, default=())
    uncertain: bool = False


def _volts(value: str, unit: str) -> str:
    volts = Decimal(value) / (1000 if unit.casefold() == "mv" else 1)
    return str(volts.normalize())


def _explicit_scalar(text: str, match: re.Match[str]) -> bool:
    # 只接受闭合标量句法；不能从计划/要求、未知型号或备选值内部截出一个真值。
    clauses = [row.strip() for row in re.split(r"[,，]", text[: match.start()])]
    prefix = clauses[-1]
    # 逗号不能清除支配后文的计划/归属。只有已闭合明确属性或已支持的独立
    # 产品介绍才允许进入下一属性；其他前导语义整体保持无法判断。
    scalar_patterns = (_VOLTAGE, _PACKAGE, _TEMPERATURE, _CERTIFICATE, _LIFECYCLE, _PIN)
    if any(
        row != "该后缀型号是独立产品"
        and not any(pattern.fullmatch(row) for pattern in scalar_patterns)
        for row in clauses[:-1]
    ):
        return False
    return prefix in {
        "",
        "的",
        "该器件的",
        "该产品的",
        "本产品的",
        "是独立的",
        "-",
        "*",
        "+",
    } and bool(re.match(r"\s*(?:$|[。;；,，.!])", text[match.end() :]))


def _relation_conditions(prefix: str) -> tuple[tuple[str, ...], bool]:
    blocks = list(_CONDITIONS.finditer(prefix))
    conditions = tuple(
        sorted(
            {
                text_key(item)
                for block in blocks
                for item in _CONDITION_JOIN.split(block[1])
                if item.strip()
            }
        )
    )
    remaining = prefix
    for block in reversed(blocks):
        remaining = remaining[: block.start()] + remaining[block.end() :]
    # 任何无法消费的限定语保守拒绝；空集合只有在确实没有条件时表示无条件。
    remaining = re.sub(r"[,，\s]|并且|以及|且|也|才|的", "", remaining)
    explicit_unconditional = remaining in {"无条件", "直接"} and not conditions
    return conditions, bool(remaining) and not explicit_unconditional


def parse_assertions(text: str) -> tuple[Assertion, ...]:
    """输入已移除对象名称；仅解析明确命名属性，不把型号数字当参数。"""
    normalized = unicodedata.normalize("NFKC", text).translate(_HYPHENS)
    uncertain = bool(_UNCERTAIN.search(normalized))
    assertions: list[Assertion] = []
    replacements = list(_REPLACE.finditer(normalized))
    previous_end = 0
    for replacement in replacements:
        negative, target, conditional_target = replacement.groups()
        conditions, unresolved = _relation_conditions(
            normalized[previous_end : replacement.start()]
        )
        if conditional_target and not conditions:
            unresolved = True
        tail = normalized[replacement.end() :]
        tail_closed = bool(re.match(r"\s*(?:$|[。;；,，.!])", tail))
        assertions.append(
            Assertion(
                Kind.REPLACEMENT_RELATION,
                "replacement",
                (text_key(target or conditional_target), "no" if negative else "yes"),
                conditions,
                uncertain or unresolved or not tail_closed,
            )
        )
        previous_end = replacement.end()
    if replacements:
        # 关系条件中的电压/封装不是独立无条件参数声明。
        return tuple(assertions)
    uncertain = uncertain or bool(_CONDITION_CUE.search(normalized))
    for match in _VOLTAGE.finditer(normalized):
        value, unit, implicit_value, implicit_unit = match.groups()
        remainder = normalized[match.end() :].lstrip()
        bounded = bool(re.match(r"(?:至|到|[-~～]|to\b|±)", remainder, re.I))
        assertions.append(
            Assertion(
                Kind.PARAMETER,
                "supply_voltage",
                (_volts(value or implicit_value, unit or implicit_unit),),
                uncertain=uncertain or bounded or not _explicit_scalar(normalized, match),
            )
        )
    for match in _PACKAGE.finditer(normalized):
        assertions.append(
            Assertion(
                Kind.PACKAGE,
                "package",
                (text_key(match[1]),),
                uncertain=uncertain or not _explicit_scalar(normalized, match),
            )
        )
    for match in _TEMPERATURE.finditer(normalized):
        assertions.append(
            Assertion(
                Kind.TEMPERATURE_GRADE,
                "operating_temperature",
                (str(Decimal(match[1]).normalize()), str(Decimal(match[2]).normalize())),
                uncertain=uncertain or not _explicit_scalar(normalized, match),
            )
        )
    for match in _IDENTITY.finditer(normalized):
        assertions.append(
            Assertion(
                Kind.IDENTITY,
                "brand",
                (text_key(match[1]),),
                uncertain=uncertain or not _explicit_scalar(normalized, match),
            )
        )
    if not _CERT_UNKNOWN.search(normalized):
        for match in _CERTIFICATE.finditer(normalized):
            assertions.append(
                Assertion(
                    Kind.CERTIFICATION,
                    "certificate:" + text_key(match[2]),
                    ("no" if match[1] else "yes",),
                    uncertain=uncertain or not _explicit_scalar(normalized, match),
                )
            )
    for match in _LIFECYCLE.finditer(normalized):
        value = {"在产": "active", "量产": "active", "停产": "eol", "不推荐新设计": "nrnd"}.get(
            match[1], match[1].casefold()
        )
        assertions.append(
            Assertion(
                Kind.LIFECYCLE_STATUS,
                "lifecycle",
                (value,),
                uncertain=uncertain or not _explicit_scalar(normalized, match),
            )
        )
    for match in _APPLICATION.finditer(normalized):
        assertions.append(
            Assertion(
                Kind.APPLICATION,
                "application",
                (text_key(match[1]),),
                uncertain=uncertain or not _explicit_scalar(normalized, match),
            )
        )
    for match in _PIN.finditer(normalized):
        assertions.append(
            Assertion(
                Kind.COMPATIBILITY_CONDITION,
                "pin_compatibility",
                ("no" if match[1].startswith("不") else "yes",),
                uncertain=uncertain or not _explicit_scalar(normalized, match),
            )
        )
    for match in _GENERIC.finditer(normalized):
        assertions.append(
            Assertion(Kind.OTHER, "unsupported", (text_key(match[1]),), uncertain=True)
        )
    # 已知类型但格式不支持（范围、比较、无值）仍保留声明，不能静默漏报。
    labels = (
        (Kind.PARAMETER, "supply_voltage", r"供电电压|工作电压|supply\s+voltage"),
        (Kind.PACKAGE, "package", r"封装|package"),
        (Kind.TEMPERATURE_GRADE, "operating_temperature", r"工作温度|温度范围"),
        (Kind.CERTIFICATION, "certificate:unknown", r"认证|certification"),
        (Kind.REPLACEMENT_RELATION, "replacement", r"替代|replacement|replace"),
    )
    for kind, key, pattern in labels:
        if not any(row.kind == kind for row in assertions) and re.search(pattern, normalized, re.I):
            assertions.append(Assertion(kind, key, (), uncertain=True))
    return tuple(assertions)
