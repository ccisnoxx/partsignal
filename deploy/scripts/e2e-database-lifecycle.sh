#!/bin/sh

create_owned_e2e_database() {
  # cleanup 是否尝试与删除权分离；真正删除前由 PostgreSQL owner marker 裁决。
  e2e_database_cleanup_pending=1
  DATABASE_URL="$source_database_url" "$root/backend/.venv/bin/python" \
    "$root/deploy/scripts/e2e-database.py" create "$e2e_database_name" \
    "$e2e_database_owner_token" \
    >"$storage_dir/database-url"
  IFS= read -r DATABASE_URL <"$storage_dir/database-url"
  export DATABASE_URL
}

drop_owned_e2e_database() {
  test "$e2e_database_cleanup_pending" -eq 1 || return 0
  DATABASE_URL="$source_database_url" "$root/backend/.venv/bin/python" \
    "$root/deploy/scripts/e2e-database.py" drop "$e2e_database_name" \
    "$e2e_database_owner_token" >/dev/null || return $?
  printf '%s\n' "E2E_CLEANUP database=$e2e_database_name status=dropped"
}
