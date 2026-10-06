"""直接 SQL 验证 Catalog 类型、父子、字典与删除最终防线。"""

from __future__ import annotations

import uuid
from typing import Any

import psycopg
import pytest
from psycopg import sql

from tests.integration.test_geo_catalog import (
    CatalogDatabase,
    insert_row,
    insert_subject,
    legacy_snapshot,
)
from tests.integration.test_geo_catalog import (
    catalog_connection as catalog_connection,
)
from tests.integration.test_geo_catalog import (
    catalog_database as catalog_database,
)

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "patch,constraint",
    [
        ({"subject_type": "UNKNOWN"}, "ck_geo_subjects_type"),
        ({"canonical_name": None}, "ck_geo_subjects_product_identity"),
        ({"normalized_name": None}, "ck_geo_subjects_product_identity"),
        ({"display_name": None}, "ck_geo_subjects_product_identity"),
        ({"subject_type": "OWN_PRODUCT"}, "ck_geo_subjects_product_identity"),
        ({"canonical_name": "   "}, "ck_geo_subjects_names"),
        ({"normalized_name": " "}, "ck_geo_subjects_names"),
        ({"display_name": ""}, "ck_geo_subjects_names"),
        ({"description": "x" * 4001}, "ck_geo_subjects_names"),
        ({"revision": -1}, "ck_geo_subjects_revision_nonnegative"),
    ],
)
def test_subject_check_rejects_direct_sql(
    catalog_database: CatalogDatabase,
    catalog_connection: psycopg.Connection[Any],
    patch: dict[str, Any],
    constraint: str,
) -> None:
    with pytest.raises(psycopg.Error) as error, catalog_connection.transaction():
        insert_subject(catalog_connection, catalog_database.ids["actor"], **patch)
    assert (error.value.sqlstate, error.value.diag.constraint_name) == ("23514", constraint)


@pytest.mark.parametrize("field", ["canonical_name", "normalized_name", "display_name"])
def test_own_product_rejects_duplicate_name_storage(
    catalog_database: CatalogDatabase, catalog_connection: psycopg.Connection[Any], field: str
) -> None:
    with pytest.raises(psycopg.Error) as error, catalog_connection.transaction():
        insert_subject(
            catalog_connection,
            catalog_database.ids["actor"],
            subject_type="OWN_PRODUCT",
            product_id=catalog_database.ids["other_product"],
            **{field: "复制的名称"},
        )
    assert (error.value.sqlstate, error.value.diag.constraint_name) == (
        "23514",
        "ck_geo_subjects_product_identity",
    )


@pytest.mark.parametrize(
    "kind,parent,parent_type,state,constraint",
    [
        ("OWN_PRODUCT", "own_brand", "OWN_BRAND", None, None),
        ("COMPETITOR_PRODUCT", "competitor_brand", "COMPETITOR_BRAND", None, None),
        ("OWN_PRODUCT", None, None, None, None),
        ("COMPETITOR_PRODUCT", None, None, None, None),
        (
            "OWN_PRODUCT",
            "competitor_brand",
            "OWN_BRAND",
            "23503",
            "fk_geo_subjects_parent_identity",
        ),
        (
            "COMPETITOR_PRODUCT",
            "own_brand",
            "COMPETITOR_BRAND",
            "23503",
            "fk_geo_subjects_parent_identity",
        ),
        (
            "OWN_PRODUCT",
            "competitor_brand",
            "COMPETITOR_BRAND",
            "23514",
            "ck_geo_subjects_parent_type",
        ),
        (
            "COMPETITOR_PRODUCT",
            "reference",
            "COMPETITOR_BRAND",
            "23503",
            "fk_geo_subjects_parent_identity",
        ),
        (
            "COMPETITOR_PRODUCT",
            "missing",
            "COMPETITOR_BRAND",
            "23503",
            "fk_geo_subjects_parent_identity",
        ),
        ("COMPETITOR_PRODUCT", "competitor_brand", None, "23514", "ck_geo_subjects_parent_type"),
        ("COMPETITOR_PRODUCT", None, "COMPETITOR_BRAND", "23514", "ck_geo_subjects_parent_type"),
        ("OWN_BRAND", "own_brand", "OWN_BRAND", "23514", "ck_geo_subjects_parent_type"),
        (
            "COMPETITOR_BRAND",
            "competitor_brand",
            "COMPETITOR_BRAND",
            "23514",
            "ck_geo_subjects_parent_type",
        ),
        ("REFERENCE_PART", "own_brand", "OWN_BRAND", "23514", "ck_geo_subjects_parent_type"),
    ],
)
def test_parent_type_and_actual_parent_identity(
    catalog_database: CatalogDatabase,
    catalog_connection: psycopg.Connection[Any],
    kind: str,
    parent: str | None,
    parent_type: str | None,
    state: str | None,
    constraint: str | None,
) -> None:
    patch = {
        "subject_type": kind,
        "parent_subject_id": catalog_database.ids.get(parent, uuid.uuid4()) if parent else None,
        "parent_subject_type": parent_type,
    }
    if kind == "OWN_PRODUCT":
        patch["product_id"] = catalog_database.ids["other_product"]
    if state is None:
        insert_subject(catalog_connection, catalog_database.ids["actor"], **patch)
    else:
        with pytest.raises(psycopg.Error) as error, catalog_connection.transaction():
            insert_subject(catalog_connection, catalog_database.ids["actor"], **patch)
        assert (error.value.sqlstate, error.value.diag.constraint_name) == (state, constraint)


def test_self_parent_is_rejected(
    catalog_database: CatalogDatabase, catalog_connection: psycopg.Connection[Any]
) -> None:
    subject_id = uuid.uuid4()
    with pytest.raises(psycopg.Error) as error, catalog_connection.transaction():
        insert_subject(
            catalog_connection,
            catalog_database.ids["actor"],
            id=subject_id,
            parent_subject_id=subject_id,
            parent_subject_type="COMPETITOR_BRAND",
        )
    assert (error.value.sqlstate, error.value.diag.constraint_name) == (
        "23514",
        "ck_geo_subjects_parent_not_self",
    )


def test_active_product_unique_includes_reenable(
    catalog_database: CatalogDatabase, catalog_connection: psycopg.Connection[Any]
) -> None:
    connection, ids = catalog_connection, catalog_database.ids
    active = insert_subject(
        connection, ids["actor"], subject_type="OWN_PRODUCT", product_id=ids["other_product"]
    )
    disabled = [
        insert_subject(
            connection,
            ids["actor"],
            subject_type="OWN_PRODUCT",
            product_id=ids["other_product"],
            is_active=False,
        )
        for _ in range(2)
    ]
    for statement, params in [
        (
            "INSERT INTO geo_subjects (id, subject_type, product_id, created_by) "
            "VALUES (%s, 'OWN_PRODUCT', %s, %s)",
            (uuid.uuid4(), ids["other_product"], ids["actor"]),
        ),
        ("UPDATE geo_subjects SET is_active = true WHERE id = %s", (disabled[0],)),
    ]:
        with pytest.raises(psycopg.Error) as error, connection.transaction():
            connection.execute(statement, params)
        assert (error.value.sqlstate, error.value.diag.constraint_name) == (
            "23505",
            "uq_geo_subjects_active_own_product",
        )
    connection.execute("UPDATE geo_subjects SET is_active = false WHERE id = %s", (active,))
    connection.execute("UPDATE geo_subjects SET is_active = true WHERE id = %s", (disabled[0],))


@pytest.mark.parametrize("field", ["subject_type", "product_id", "created_by", "created_at"])
def test_subject_identity_guard(
    catalog_database: CatalogDatabase, catalog_connection: psycopg.Connection[Any], field: str
) -> None:
    connection, ids = catalog_connection, catalog_database.ids
    subject = insert_subject(
        connection, ids["actor"], subject_type="OWN_PRODUCT", product_id=ids["other_product"]
    )
    assignment = {
        "subject_type": "'REFERENCE_PART'",
        "product_id": "NULL",
        "created_by": "NULL",
        "created_at": "created_at + interval '1 second'",
    }[field]
    with pytest.raises(psycopg.Error) as error, connection.transaction():
        connection.execute(
            sql.SQL("UPDATE geo_subjects SET {} = {} WHERE id = %s").format(
                sql.Identifier(field), sql.SQL(assignment)
            ),
            (subject,),
        )
    assert error.value.sqlstate == "55000"
    connection.execute(
        "UPDATE geo_subjects SET description = '新监测用途', "
        "revision = revision + 1, updated_at = now() WHERE id = %s",
        (subject,),
    )
    assert connection.execute(
        "SELECT revision FROM geo_subjects WHERE id = %s", (subject,)
    ).fetchone() == (1,)


@pytest.mark.parametrize(
    "patch,constraint",
    [
        ({"alias_kind": "UNKNOWN"}, "ck_geo_subject_aliases_kind"),
        ({"alias": " "}, "ck_geo_subject_aliases_text"),
        ({"normalized_alias": ""}, "ck_geo_subject_aliases_text"),
        ({"language_code": "ZH"}, "ck_geo_subject_aliases_language"),
        ({"language_code": "../zh"}, "ck_geo_subject_aliases_language"),
        ({"language_code": "a"}, "ck_geo_subject_aliases_language"),
        ({"language_code": "abcdefghi"}, "ck_geo_subject_aliases_language"),
    ],
)
def test_alias_checks(
    catalog_database: CatalogDatabase,
    catalog_connection: psycopg.Connection[Any],
    patch: dict[str, Any],
    constraint: str,
) -> None:
    with pytest.raises(psycopg.Error) as error, catalog_connection.transaction():
        insert_row(
            catalog_connection,
            "geo_subject_aliases",
            {
                "id": uuid.uuid4(),
                "subject_id": catalog_database.ids["reference"],
                "alias": "虚构型号",
                "normalized_alias": "虚构型号",
                "alias_kind": "NAME",
                **patch,
            },
        )
    assert (error.value.sqlstate, error.value.diag.constraint_name) == ("23514", constraint)


@pytest.mark.parametrize(
    "hostname",
    [
        "EXAMPLE.test",
        "127.0.0.1",
        "::1",
        "https://example.test",
        "a.test:443",
        "a.test/path",
        "a.test?x",
        "a.test#x",
        "user@a.test",
        "*.test",
        "a..test",
        "-a.test",
        "a-.test",
        "a.test.",
        "a test",
        "虚构.test",
        "x" * 64 + ".test",
        "localhost",
        "",
    ],
)
def test_hostname_sql_boundary(
    catalog_database: CatalogDatabase, catalog_connection: psycopg.Connection[Any], hostname: str
) -> None:
    with pytest.raises(psycopg.Error) as error, catalog_connection.transaction():
        insert_row(
            catalog_connection,
            "geo_subject_domains",
            {
                "id": uuid.uuid4(),
                "subject_id": catalog_database.ids["reference"],
                "hostname": hostname,
                "relation_type": "OWNED",
            },
        )
    assert (error.value.sqlstate, error.value.diag.constraint_name) == (
        "23514",
        "ck_geo_subject_domains_hostname",
    )


@pytest.mark.parametrize(
    "patch,constraint",
    [
        ({"relation_type": "UNKNOWN"}, "ck_geo_subject_domains_relation"),
        ({"is_active": False}, "ck_geo_subject_domains_active"),
    ],
)
def test_domain_checks(
    catalog_database: CatalogDatabase,
    catalog_connection: psycopg.Connection[Any],
    patch: dict[str, Any],
    constraint: str,
) -> None:
    with pytest.raises(psycopg.Error) as error, catalog_connection.transaction():
        insert_row(
            catalog_connection,
            "geo_subject_domains",
            {
                "id": uuid.uuid4(),
                "subject_id": catalog_database.ids["reference"],
                "hostname": "example.test",
                "relation_type": "OWNED",
                **patch,
            },
        )
    assert (error.value.sqlstate, error.value.diag.constraint_name) == ("23514", constraint)


def test_dictionary_uniqueness_and_cross_subject_ambiguity(
    catalog_database: CatalogDatabase, catalog_connection: psycopg.Connection[Any]
) -> None:
    connection, ids = catalog_connection, catalog_database.ids
    for table, unique_key, extra, constraint in [
        (
            "geo_subject_aliases",
            {"normalized_alias": "虚构型号"},
            {
                "alias": "虚构型号",
                "alias_kind": "NAME",
                "language_code": "zh-hans",
                "is_active": False,
            },
            "uq_geo_subject_aliases_subject_normalized",
        ),
        (
            "geo_subject_domains",
            {"hostname": "example.test"},
            {"relation_type": "OFFICIAL"},
            "uq_geo_subject_domains_subject_hostname",
        ),
    ]:
        for subject in [ids["reference"], ids["competitor_brand"]]:
            insert_row(
                connection,
                table,
                {"id": uuid.uuid4(), "subject_id": subject, **unique_key, **extra},
            )
        with pytest.raises(psycopg.Error) as error, connection.transaction():
            insert_row(
                connection,
                table,
                {
                    "id": uuid.uuid4(),
                    "subject_id": ids["reference"],
                    **unique_key,
                    **extra,
                    "is_active": True,
                },
            )
        assert (error.value.sqlstate, error.value.diag.constraint_name) == ("23505", constraint)
    for hostname in ["xn--fsqu00a.example", ".".join(["a" * 63] * 3 + ["b" * 61])]:
        insert_row(
            connection,
            "geo_subject_domains",
            {
                "id": uuid.uuid4(),
                "subject_id": ids["reference"],
                "hostname": hostname,
                "relation_type": "OTHER",
            },
        )


@pytest.mark.parametrize(
    "target,constraint",
    [
        ("products", "fk_geo_subjects_product_id_products"),
        ("users", "fk_geo_subjects_created_by_users"),
        ("geo_subjects", "fk_geo_subjects_parent_identity"),
    ],
)
def test_external_deletion_is_restricted(
    catalog_database: CatalogDatabase,
    catalog_connection: psycopg.Connection[Any],
    target: str,
    constraint: str,
) -> None:
    connection, ids = catalog_connection, catalog_database.ids
    insert_subject(
        connection,
        ids["other_actor"],
        subject_type="OWN_PRODUCT",
        product_id=ids["other_product"],
        parent_subject_id=ids["own_brand"],
        parent_subject_type="OWN_BRAND",
        is_active=False,
    )
    target_id = {
        "products": ids["other_product"],
        "users": ids["other_actor"],
        "geo_subjects": ids["own_brand"],
    }[target]
    with pytest.raises(psycopg.Error) as error, connection.transaction():
        connection.execute(
            sql.SQL("DELETE FROM {} WHERE id = %s").format(sql.Identifier(target)), (target_id,)
        )
    assert (error.value.sqlstate, error.value.diag.constraint_name) == ("23503", constraint)


def test_subject_delete_cascades_only_current_dictionary(
    catalog_database: CatalogDatabase, catalog_connection: psycopg.Connection[Any]
) -> None:
    connection = catalog_connection
    subject = insert_subject(connection, catalog_database.ids["actor"])
    insert_row(
        connection,
        "geo_subject_aliases",
        {
            "id": uuid.uuid4(),
            "subject_id": subject,
            "alias": "别名",
            "normalized_alias": "别名",
            "alias_kind": "LEGACY",
        },
    )
    insert_row(
        connection,
        "geo_subject_domains",
        {
            "id": uuid.uuid4(),
            "subject_id": subject,
            "hostname": "example.test",
            "relation_type": "DISTRIBUTOR",
        },
    )
    connection.execute("DELETE FROM geo_subjects WHERE id = %s", (subject,))
    for table in ["geo_subject_aliases", "geo_subject_domains"]:
        assert connection.execute(
            sql.SQL("SELECT count(*) FROM {} WHERE subject_id = %s").format(sql.Identifier(table)),
            (subject,),
        ).fetchone() == (0,)
    assert legacy_snapshot(connection, catalog_database.ids) == catalog_database.before
