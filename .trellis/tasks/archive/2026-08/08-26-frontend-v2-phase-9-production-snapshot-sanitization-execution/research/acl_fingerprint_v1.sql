-- acl-fingerprint-v1-md5
-- 只允许在已建立的 REPEATABLE READ READ ONLY preflight transaction 内执行。
-- 输出仅含 scope、item count、domain boolean 与 fingerprint，不输出 raw ACL 或 role name。

WITH expanded AS (
  SELECT
    acl.grantor,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_database AS database_row
  CROSS JOIN LATERAL aclexplode(
    COALESCE(database_row.datacl, acldefault('d', database_row.datdba))
  ) AS acl
  WHERE database_row.datname = current_database()
)
SELECT
  'database_acl' AS scope,
  count(*) AS item_count,
  COALESCE(
    bool_and(
      grantor IS NOT NULL
      AND grantee IS NOT NULL
      AND privilege_type IN ('CONNECT', 'CREATE', 'TEMPORARY')
      AND is_grantable IS NOT NULL
    ),
    true
  ) AS domain_valid,
  md5(
    COALESCE(
      string_agg(
        grantor::text || ':' || grantee::text || ':' ||
        privilege_type || ':' || is_grantable::text,
        ',' ORDER BY grantor, grantee, privilege_type, is_grantable
      ),
      ''
    )
  ) AS fingerprint,
  md5(
    COALESCE(
      string_agg(
        grantor::text || ':' || grantee::text || ':' ||
        privilege_type || ':' || is_grantable::text,
        ',' ORDER BY grantor, grantee, privilege_type, is_grantable
      ) FILTER (
        WHERE NOT (
          grantee = 0
          AND privilege_type = 'TEMPORARY'
        )
      ),
      ''
    )
  ) AS without_public_temporary_fingerprint
FROM expanded;

WITH expanded AS (
  SELECT
    acl.grantor,
    acl.grantee,
    acl.privilege_type,
    acl.is_grantable
  FROM pg_namespace AS namespace_row
  CROSS JOIN LATERAL aclexplode(
    COALESCE(namespace_row.nspacl, acldefault('n', namespace_row.nspowner))
  ) AS acl
  WHERE namespace_row.nspname = 'public'
)
SELECT
  'public_schema_acl' AS scope,
  count(*) AS item_count,
  COALESCE(
    bool_and(
      grantor IS NOT NULL
      AND grantee IS NOT NULL
      AND privilege_type IN ('CREATE', 'USAGE')
      AND is_grantable IS NOT NULL
    ),
    true
  ) AS domain_valid,
  md5(
    COALESCE(
      string_agg(
        grantor::text || ':' || grantee::text || ':' ||
        privilege_type || ':' || is_grantable::text,
        ',' ORDER BY grantor, grantee, privilege_type, is_grantable
      ),
      ''
    )
  ) AS fingerprint
FROM expanded;
