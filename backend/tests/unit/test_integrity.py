"""验证发布完整性预检在迁移前和迁移后采用正确的缺表合同。"""

from __future__ import annotations

import json
import sys
from typing import Any

import pytest

from app import cli
from app.services.integrity import publication_integrity_issues

TABLE_NAMES = (
    "content_tasks",
    "content_versions",
    "publication_works",
    "published_articles",
)


class _Rows:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self.rows = rows

    def one(self) -> tuple[Any, ...]:
        return self.rows[0]

    def all(self) -> list[tuple[Any, ...]]:
        return self.rows


class _Database:
    def __init__(self, *results: list[tuple[Any, ...]]) -> None:
        self.results = [_Rows(rows) for rows in results]

    def __enter__(self) -> _Database:
        return self

    def __exit__(self, *_args: object) -> None:
        pass

    def execute(self, _statement: object) -> _Rows:
        assert self.results, "缺表后不得查询尚不存在的业务表"
        return self.results.pop(0)


@pytest.mark.parametrize("missing_table", TABLE_NAMES)
def test_strict_integrity_reports_each_missing_core_table(missing_table: str) -> None:
    catalog = tuple(None if name == missing_table else name for name in TABLE_NAMES)
    db = _Database([catalog])

    issues = publication_integrity_issues(db, require_schema=True)  # type: ignore[arg-type]

    assert issues == [
        {
            "check": "publication_schema",
            "record_type": "Table",
            "record_id": missing_table,
            "reason_code": "REQUIRED_TABLE_MISSING",
            "related_ids": [],
        }
    ]
    assert not db.results


def test_default_integrity_allows_unmigrated_schema() -> None:
    db = _Database([(None, None, None, None)])

    assert publication_integrity_issues(db) == []  # type: ignore[arg-type]
    assert not db.results


def test_complete_schema_still_checks_publication_history() -> None:
    db = _Database(
        [TABLE_NAMES],
        [("task-without-article",)],
        [],
    )

    assert publication_integrity_issues(db, require_schema=True) == [  # type: ignore[arg-type]
        {
            "check": "publication_closure",
            "record_type": "ContentTask",
            "record_id": "task-without-article",
            "reason_code": "COMPLETED_WITHOUT_PUBLISHED_ARTICLE",
            "related_ids": [],
        }
    ]
    assert not db.results


@pytest.mark.parametrize(
    ("args", "expected_exit", "expected_issues"),
    [
        (["preflight-integrity"], 0, []),
        (
            ["preflight-integrity", "--require-schema"],
            1,
            [
                {
                    "check": "publication_schema",
                    "record_type": "Table",
                    "record_id": "published_articles",
                    "reason_code": "REQUIRED_TABLE_MISSING",
                    "related_ids": [],
                }
            ],
        ),
    ],
)
def test_preflight_cli_schema_mode_and_exit(
    args: list[str],
    expected_exit: int,
    expected_issues: list[dict[str, object]],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    db = _Database([(*TABLE_NAMES[:3], None)])
    monkeypatch.setattr(cli, "SessionLocal", lambda: db)
    monkeypatch.setattr(sys, "argv", ["app.cli", *args])

    if expected_exit:
        with pytest.raises(SystemExit) as exit_info:
            cli.main()
        assert exit_info.value.code == expected_exit
    else:
        cli.main()

    assert json.loads(capsys.readouterr().out) == expected_issues
    assert not db.results
