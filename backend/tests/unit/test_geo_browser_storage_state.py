"""会话导入的域、期限和秘密错误边界。"""

import json
import traceback
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.errors import AppError
from app.services.geo_browser_storage_state import validate_storage_state

NOW = datetime(2026, 10, 5, tzinfo=UTC)
EXPIRES = NOW + timedelta(days=1)
WEBSITE = "https://chat.example.invalid/app"
CANARY = "仅限虚构测试-cookie-localStorage-秘密标记"


def state() -> dict[str, Any]:
    return {
        "cookies": [
            {
                "name": "test-session",
                "value": CANARY,
                "domain": ".chat.example.invalid",
                "path": "/",
                "expires": -1,
                "httpOnly": True,
                "secure": True,
                "sameSite": "Lax",
            }
        ],
        "origins": [
            {
                "origin": "https://chat.example.invalid",
                "localStorage": [{"name": "test", "value": CANARY}],
            }
        ],
    }


def validate(value: dict[str, Any], expires: datetime = EXPIRES, website: str = WEBSITE) -> str:
    return validate_storage_state(json.dumps(value), website, expires, NOW)


def test_returns_compact_canonical_state_without_modifying_secret_values() -> None:
    source = state()
    canonical = validate(source)
    assert json.loads(canonical) == source
    assert canonical == json.dumps(
        source, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    assert validate_storage_state(canonical, WEBSITE, EXPIRES, NOW) == canonical


def test_session_cookie_and_local_storage_only_imports_are_supported() -> None:
    source = state()
    source["cookies"] = []
    assert json.loads(validate(source)) == source
    source = state()
    source["origins"] = []
    source["cookies"][0]["expires"] = EXPIRES.timestamp()
    assert json.loads(validate(source)) == source


@pytest.mark.parametrize(
    "domain",
    [
        "example.invalid",
        ".example.invalid",
        "evil.chat.example.invalid",
        "chat.example.invalid.evil",
        "..chat.example.invalid",
    ],
)
def test_cookie_requires_exact_surface_hostname(domain: str) -> None:
    source = state()
    source["cookies"][0]["domain"] = domain
    with pytest.raises(AppError) as captured:
        validate(source)
    assert captured.value.code == "GEO_BROWSER_SESSION_INVALID"


@pytest.mark.parametrize(
    "origin",
    [
        "http://chat.example.invalid",
        "https://chat.example.invalid:444",
        "https://evil.example.invalid",
        "https://chat.example.invalid/path",
        "https://chat.example.invalid?secret=canary",
        "https://test@chat.example.invalid",
        "https://@chat.example.invalid",
        "https://chat.example.invalid#canary",
    ],
)
def test_local_storage_requires_same_https_origin(origin: str) -> None:
    source = state()
    source["origins"][0]["origin"] = origin
    with pytest.raises(AppError):
        validate(source)


def test_https_default_port_and_website_path_are_normalized_as_origin() -> None:
    source = state()
    source["origins"][0]["origin"] = "https://chat.example.invalid:443"
    assert json.loads(validate(source, website="https://chat.example.invalid:443/app")) == source


@pytest.mark.parametrize(
    "expiry",
    [
        NOW,
        NOW - timedelta(seconds=1),
        NOW + timedelta(days=30, microseconds=1),
        datetime(2026, 10, 6),
    ],
)
def test_requires_explicit_aware_future_expiry_at_most_30_days(expiry: datetime) -> None:
    with pytest.raises(AppError):
        validate(state(), expires=expiry)


def test_all_persistent_cookies_bound_the_declared_session_expiry() -> None:
    source = state()
    source["cookies"][0]["expires"] = EXPIRES.timestamp() - 1
    with pytest.raises(AppError):
        validate(source)
    source["cookies"][0]["expires"] = NOW.timestamp() - 1
    with pytest.raises(AppError):
        validate(source)
    source["cookies"][0]["expires"] = (NOW + timedelta(days=30)).timestamp()
    assert validate(source, NOW + timedelta(days=30))


@pytest.mark.parametrize(
    "field,value",
    [
        ("secure", "true"),
        ("httpOnly", 1),
        ("expires", True),
        ("expires", "-1"),
        ("expires", -2),
        ("sameSite", "unknown"),
        ("name", None),
        ("value", {}),
        ("path", "relative"),
    ],
)
def test_cookie_field_types_are_not_coerced(field: str, value: object) -> None:
    source = state()
    source["cookies"][0][field] = value
    with pytest.raises(AppError):
        validate(source)


@pytest.mark.parametrize(
    "raw",
    [
        "not-json",
        '{"cookies":[],"origins":[],"cookies":[]}',
        '{"cookies":[],"origins":[],"secret":"canary"}',
        '{"cookies":[],"origins":[]}',
        '{"cookies":NaN,"origins":[]}',
        '{"cookies":Infinity,"origins":[]}',
        '{"cookies":{},"origins":[]}',
        "null",
        "[]",
    ],
)
def test_closed_json_rejects_duplicate_keys_nonfinite_numbers_and_empty_state(raw: str) -> None:
    with pytest.raises(AppError) as captured:
        validate_storage_state(raw, WEBSITE, EXPIRES, NOW)
    assert captured.value.status_code == 422


def test_nested_duplicate_keys_records_and_unknown_fields_are_rejected() -> None:
    raw = json.dumps(state()).replace('"value":', '"value":"canary","value":', 1)
    with pytest.raises(AppError):
        validate_storage_state(raw, WEBSITE, EXPIRES, NOW)
    for location in ("cookies", "origins"):
        source = state()
        source[location].append(source[location][0].copy())
        with pytest.raises(AppError):
            validate(source)
    source = state()
    source["origins"][0]["localStorage"].append(source["origins"][0]["localStorage"][0].copy())
    with pytest.raises(AppError):
        validate(source)
    source = state()
    source["cookies"][0]["secret"] = CANARY
    with pytest.raises(AppError):
        validate(source)


@pytest.mark.parametrize("secret", [CANARY * (128 * 1024), "\ud800"])
def test_size_encoding_and_errors_do_not_expose_secret(secret: str) -> None:
    source = state()
    source["cookies"][0]["value"] = secret
    with pytest.raises(AppError) as captured:
        validate(source)
    rendered = "".join(traceback.format_exception(captured.value)) + repr(captured.value.details)
    assert CANARY not in rendered
    assert captured.value.message == "浏览器会话资料不符合安全契约"
    assert captured.value.details == {}


def test_exact_128_kib_input_is_accepted_and_one_extra_byte_is_rejected() -> None:
    raw = validate(state())
    raw = raw + " " * (128 * 1024 - len(raw.encode("utf-8")))
    assert validate_storage_state(raw, WEBSITE, EXPIRES, NOW)
    with pytest.raises(AppError):
        validate_storage_state(raw + " ", WEBSITE, EXPIRES, NOW)
