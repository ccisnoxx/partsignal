"""独立复核发现的真实认证并发与 Unicode 搜索反例。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from sqlalchemy import event, text

from tests.integration.geo_catalog_support import PREFIX, CatalogAPI
from tests.integration.geo_catalog_support import catalog_api as catalog_api
from tests.integration.geo_catalog_support import catalog_engine as catalog_engine

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("path", ["", "/{id}"])
def test_read_snapshot_does_not_flush_session_after_same_cookie_write(
    catalog_api: CatalogAPI, path: str
) -> None:
    api = catalog_api
    row = api.create()
    paused, release = Event(), Event()
    reader_connection = None
    reader_updates: list[str] = []

    def pause_reader(connection, cursor, statement, parameters, context, many):
        nonlocal reader_connection
        if "FROM sessions" in statement and not paused.is_set():
            reader_connection = connection
            paused.set()
            assert release.wait(timeout=10)

    def record_updates(connection, cursor, statement, parameters, context, many):
        if connection is reader_connection and statement.lstrip().startswith("UPDATE sessions"):
            reader_updates.append(statement)

    event.listen(api.engine, "after_cursor_execute", pause_reader)
    event.listen(api.engine, "before_cursor_execute", record_updates)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            result = pool.submit(api.admin.get, PREFIX + path.format(id=row["id"]))
            try:
                assert paused.wait(timeout=5)
                # 使用同一真实 Cookie 的命令提交 last_seen_at，而读取快照已建立。
                api.create(canonical_name="并发的新对象")
            finally:
                release.set()
            response = result.result(timeout=10)
            assert response.status_code == 200
            if path == "":
                assert response.json()["total"] == 1
            else:
                assert response.json()["id"] == row["id"]
    finally:
        release.set()
        event.remove(api.engine, "after_cursor_execute", pause_reader)
        event.remove(api.engine, "before_cursor_execute", record_updates)
    assert reader_updates == []


@pytest.mark.parametrize(
    ("field", "stored", "search"),
    [
        ("part_number", "ＰＳ-104-A", "ＰＳ-104-A"),
        ("part_number", "ＰＳ-104-A", "ps-104-a"),
        ("part_number", "Straße-104-A", "strasse-104-a"),
        ("brand", "虚构 Straße", "STRASSE"),
        ("brand", "ß" * 160, "ss"),
    ],
)
def test_own_product_search_uses_current_unicode_identity(
    catalog_api: CatalogAPI, field: str, stored: str, search: str
) -> None:
    api = catalog_api
    with api.factory() as db:
        # 列名来自封闭测试参数，值始终绑定；Product 可合法保留全角或展开字符。
        db.execute(
            text(f"UPDATE products SET {field}=:value WHERE id=:id"),
            {"value": stored, "id": api.product_id},
        )
        db.commit()
    response = api.admin.post(
        PREFIX, json={"subject_type": "OWN_PRODUCT", "product_id": str(api.product_id)}
    )
    assert response.status_code == 201
    sid = response.json()["id"]
    result = api.admin.get(PREFIX, params={"q": search}).json()
    assert result["total"] == 1 and result["items"][0]["id"] == sid
    assert result["items"][0]["product"][field] == stored
    if field == "part_number":
        assert api.admin.get(PREFIX, params={"q": search.replace("-", "")}).json()["total"] == 0
        assert (
            api.admin.get(
                PREFIX, params={"q": search.replace("-a", "-b").replace("-A", "-B")}
            ).json()["total"]
            == 0
        )


def test_display_name_search_uses_same_unicode_key(catalog_api: CatalogAPI) -> None:
    api = catalog_api
    row = api.create(canonical_name="一个不同型号", display_name="虚构 Straße-104")
    result = api.admin.get(PREFIX, params={"q": "ＳＴＲＡＳＳＥ-104"}).json()
    assert result["total"] == 1 and result["items"][0]["id"] == row["id"]
