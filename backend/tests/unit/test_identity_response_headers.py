"""锁定登录与登出响应中的多个独立 Set-Cookie 实例。"""

from datetime import UTC, datetime
from http.cookies import SimpleCookie
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

from fastapi import Response

from app.config import settings
from app.main import app
from app.routers import identity as identity_router


def _set_cookie_values(response: Response) -> list[str]:
    """读取原始 Header occurrence，避免把多个 Cookie 当作一个逗号值。"""
    return [
        value.decode("latin-1")
        for name, value in response.raw_headers
        if name.lower() == b"set-cookie"
    ]


def _cookie_map(values: list[str]) -> dict[str, SimpleCookie]:
    result: dict[str, SimpleCookie] = {}
    for value in values:
        cookie = SimpleCookie()
        cookie.load(value)
        assert len(cookie) == 1
        name = next(iter(cookie))
        assert name not in result
        result[name] = cookie
    return result


def _declared_header_names(value: object) -> list[str]:
    """递归收集 inline 与 component response 的 OpenAPI Header 名称。"""
    if isinstance(value, list):
        return [name for item in value for name in _declared_header_names(item)]
    if not isinstance(value, dict):
        return []
    names = list(value.get("headers", {})) if isinstance(value.get("headers"), dict) else []
    return names + [
        name
        for key, item in value.items()
        if key != "headers"
        for name in _declared_header_names(item)
    ]


def _fake_user() -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        username="tester",
        display_name="测试用户",
        account_type="ENGINEER",
        is_active=True,
        must_change_password=False,
        revision=0,
        created_at=datetime.now(UTC),
    )


def test_login_keeps_two_independent_cookie_occurrences_and_security_attributes(
    monkeypatch,
) -> None:
    session_token = "session-token"
    csrf_token = "csrf-token"
    monkeypatch.setattr(
        identity_router,
        "login_command",
        lambda db, payload: (_fake_user(), session_token, csrf_token),
    )
    response = Response()

    identity_router.login(payload=Mock(), response=response, db=Mock())

    values = _set_cookie_values(response)
    assert len(values) == 2
    cookies = _cookie_map(values)
    assert set(cookies) == {settings.session_cookie_name, settings.csrf_cookie_name}

    session = cookies[settings.session_cookie_name][settings.session_cookie_name]
    assert session.value == session_token
    assert session["max-age"] == str(settings.session_ttl_seconds)
    assert session["path"] == "/"
    assert session["samesite"] == "lax"
    assert bool(session["httponly"])
    assert bool(session["secure"]) is settings.cookie_secure

    csrf = cookies[settings.csrf_cookie_name][settings.csrf_cookie_name]
    assert csrf.value == csrf_token
    assert csrf["max-age"] == str(settings.session_ttl_seconds)
    assert csrf["path"] == "/"
    assert csrf["samesite"] == "strict"
    assert not csrf["httponly"]
    assert bool(csrf["secure"]) is settings.cookie_secure


def test_logout_keeps_two_independent_cookie_deletion_occurrences(monkeypatch) -> None:
    monkeypatch.setattr(identity_router, "logout_command", lambda db, current: None)
    response = Response()

    identity_router.logout(
        response=response,
        db=Mock(),
        current=Mock(),
        _csrf=Mock(),
    )

    values = _set_cookie_values(response)
    assert len(values) == 2
    cookies = _cookie_map(values)
    assert set(cookies) == {settings.session_cookie_name, settings.csrf_cookie_name}
    for name, cookie in cookies.items():
        morsel = cookie[name]
        assert morsel.value == ""
        assert morsel["max-age"] == "0"
        assert morsel["expires"]
        assert morsel["path"] == "/"
        assert morsel["samesite"] == "lax"
        assert not morsel["secure"]
        assert not morsel["httponly"]


def test_openapi_does_not_fake_multiple_set_cookie_occurrences_as_one_header() -> None:
    assert "set-cookie" not in {
        name.lower() for name in _declared_header_names(app.openapi())
    }
