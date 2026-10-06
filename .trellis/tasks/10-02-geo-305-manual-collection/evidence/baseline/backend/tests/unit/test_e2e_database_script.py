"""验证 E2E 数据库 helper 的精确名称边界与幂等删除语义。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest


def load_script() -> ModuleType:
    script_path = Path(__file__).parents[3] / "deploy" / "scripts" / "e2e-database.py"
    spec = importlib.util.spec_from_file_location("partsignal_e2e_database", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResult:
    def __init__(self, row: tuple[str | None] | None = None) -> None:
        self.row = row

    def fetchone(self) -> tuple[str | None] | None:
        return self.row


class FakeConnection:
    def __init__(
        self,
        statements: list[tuple[str, tuple[str, ...] | None]],
        owner_rows: list[tuple[str | None] | None] | None = None,
        fail_prefix: str | None = None,
    ) -> None:
        self.statements = statements
        self.owner_rows = owner_rows or []
        self.fail_prefix = fail_prefix

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(
        self,
        statement: object,
        parameters: tuple[str, ...] | None = None,
    ) -> FakeResult:
        rendered = statement if isinstance(statement, str) else statement.as_string()
        self.statements.append((rendered, parameters))
        if self.fail_prefix and rendered.startswith(self.fail_prefix):
            raise RuntimeError("受控数据库客户端失败")
        if rendered.startswith("SELECT shobj_description"):
            return FakeResult(self.owner_rows.pop(0))
        return FakeResult()


def test_create_records_owner_marker(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_script()
    statements: list[tuple[str, tuple[str, ...] | None]] = []
    connections: list[tuple[str, bool]] = []

    def connect(url: str, *, autocommit: bool) -> FakeConnection:
        connections.append((url, autocommit))
        return FakeConnection(statements)

    monkeypatch.setattr(module.psycopg, "connect", connect)
    database_name = "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef"
    owner_token = "fedcba9876543210fedcba9876543210"
    source_url = "postgresql+psycopg://example.invalid/partsignal"

    result = module.manage_database("create", database_name, owner_token, source_url)

    assert statements == [
        (f'CREATE DATABASE "{database_name}"', None),
        (
            f'COMMENT ON DATABASE "{database_name}" IS '
            f"'partsignal-e2e-owner:{owner_token}'",
            None,
        ),
    ]
    assert result == f"postgresql+psycopg://example.invalid/{database_name}"
    assert connections == [("postgresql://example.invalid/postgres", True)]


def test_create_comment_failure_never_drops_without_verified_marker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    statements: list[tuple[str, tuple[str, ...] | None]] = []
    database_name = "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef"
    owner_token = "fedcba9876543210fedcba9876543210"
    monkeypatch.setattr(
        module.psycopg,
        "connect",
        lambda *_args, **_kwargs: FakeConnection(
            statements,
            fail_prefix="COMMENT ON DATABASE",
        ),
    )

    with pytest.raises(RuntimeError, match="受控数据库客户端失败"):
        module.manage_database(
            "create",
            database_name,
            owner_token,
            "postgresql+psycopg://example.invalid/partsignal",
        )

    assert [statement for statement, _ in statements] == [
        f'CREATE DATABASE "{database_name}"',
        f'COMMENT ON DATABASE "{database_name}" IS '
        f"'partsignal-e2e-owner:{owner_token}'",
    ]


def test_drop_requires_matching_owner_and_is_idempotent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    statements: list[tuple[str, tuple[str, ...] | None]] = []
    database_name = "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef"
    owner_token = "fedcba9876543210fedcba9876543210"
    marker = f"partsignal-e2e-owner:{owner_token}"
    owner_rows: list[tuple[str | None] | None] = [(marker,), None]

    monkeypatch.setattr(
        module.psycopg,
        "connect",
        lambda *_args, **_kwargs: FakeConnection(statements, owner_rows),
    )

    deleted = module.manage_database(
        "drop",
        database_name,
        owner_token,
        "postgresql+psycopg://example.invalid/partsignal",
    )
    absent = module.manage_database(
        "drop",
        database_name,
        owner_token,
        "postgresql+psycopg://example.invalid/partsignal",
    )

    select_statement = (
        "SELECT shobj_description(oid, 'pg_database') "
        "FROM pg_database WHERE datname = %s"
    )
    assert statements == [
        (select_statement, (database_name,)),
        (f'DROP DATABASE "{database_name}" WITH (FORCE)', None),
        (select_statement, (database_name,)),
    ]
    assert deleted == f"E2E_CLEANUP database={database_name} status=deleted"
    assert absent == f"E2E_CLEANUP database={database_name} status=absent"


def test_drop_refuses_database_owned_by_another_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    statements: list[tuple[str, tuple[str, ...] | None]] = []
    database_name = "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef"
    owner_token = "fedcba9876543210fedcba9876543210"
    monkeypatch.setattr(
        module.psycopg,
        "connect",
        lambda *_args, **_kwargs: FakeConnection(
            statements,
            [("partsignal-e2e-owner:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",)],
        ),
    )

    with pytest.raises(ValueError, match="所有权不匹配"):
        module.manage_database(
            "drop",
            database_name,
            owner_token,
            "postgresql+psycopg://example.invalid/partsignal",
        )

    assert all(not statement.startswith("DROP DATABASE") for statement, _ in statements)


@pytest.mark.parametrize(
    "database_name",
    [
        "partsignal",
        "partsignal_e2e_20260925_12345",
        "partsignal_e2e_20260925_other",
        "partsignal_e2e_20260925_0123456789abcdef0123456789abcde",
        "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef_extra",
        "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef;DROP",
        "partsignal_e2e_٢٠٢٦٠٩٢٥_0123456789abcdef0123456789abcdef",
    ],
)
def test_invalid_or_non_owned_database_name_is_rejected_before_connect(
    monkeypatch: pytest.MonkeyPatch,
    database_name: str,
) -> None:
    module = load_script()
    monkeypatch.setattr(
        module.psycopg,
        "connect",
        lambda *_args, **_kwargs: pytest.fail("非受控名称不得连接 PostgreSQL"),
    )

    with pytest.raises(ValueError, match="数据库名不符合受控前缀"):
        module.manage_database(
            "drop",
            database_name,
            "fedcba9876543210fedcba9876543210",
            "postgresql+psycopg://example.invalid/partsignal",
        )


@pytest.mark.parametrize(
    "owner_token",
    ["", "12345", "G" * 32, "a" * 31, "a" * 33],
)
def test_invalid_owner_token_is_rejected_before_connect(
    monkeypatch: pytest.MonkeyPatch,
    owner_token: str,
) -> None:
    module = load_script()
    monkeypatch.setattr(
        module.psycopg,
        "connect",
        lambda *_args, **_kwargs: pytest.fail("非法 owner token 不得连接 PostgreSQL"),
    )

    with pytest.raises(ValueError, match="owner token 不符合受控格式"):
        module.manage_database(
            "drop",
            "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef",
            owner_token,
            "postgresql+psycopg://example.invalid/partsignal",
        )


def test_allowlisted_database_name_fits_postgresql_identifier_limit() -> None:
    database_name = "partsignal_e2e_20260925_0123456789abcdef0123456789abcdef"

    assert len(database_name.encode()) == 56
