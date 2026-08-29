#!/usr/bin/env bash
set -euo pipefail

readonly RUN_ID='pss_20260828_09'
readonly SOURCE_HOST='hostdzire'
readonly SOURCE_CONTAINER='postgres'
readonly SOURCE_DATABASE='partsignal'
readonly BOOTSTRAP_ROLE='partsignal'
readonly APPLICATION_NAME="${RUN_ID}_execution_preflight"
readonly ACL_SHA256='829cbf5dc3f3bb061c458f76773e9e3920cd422a0e3e882c000e693df1e81cae'
readonly SQL_STREAM_SHA256='8de9b3d24827645c34af6f9280e51b56c6570d48f9911c653929918186977bfe'
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly ACL_SQL="${SCRIPT_DIR}/acl_fingerprint_v1.sql"

fail() {
  printf 'database_preflight_error=%s\n' "$1" >&2
  exit 1
}

sha256_file() {
  local path=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  else
    shasum -a 256 "$path" | awk '{print $1}'
  fi
}

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

emit_sql() {
  cat <<'SQL'
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'identity', current_database() = 'partsignal', current_user = (SELECT datdba::regrole FROM pg_database WHERE datname = current_database()), current_setting('server_version_num') = '160014', current_setting('default_transaction_read_only') = 'on', current_setting('transaction_read_only') = 'on', current_setting('transaction_isolation') = 'repeatable read';
SELECT 'revision', count(*) = 1, bool_and(version_num = '0043_geo_platform_identity') FROM alembic_version;
SELECT 'database_oid', md5(oid::text) FROM pg_database WHERE datname = current_database();
SQL
  cat "$ACL_SQL"
  cat <<'SQL'
WITH expanded AS (
  SELECT a.grantee, a.privilege_type
  FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
  WHERE d.datname=current_database()
) SELECT 'database_public', bool_or(grantee=0 AND privilege_type='CONNECT'), bool_or(grantee=0 AND privilege_type='TEMPORARY') FROM expanded;
WITH expanded AS (
  SELECT a.grantee, a.privilege_type
  FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
  WHERE n.nspname='public'
) SELECT 'schema_public', bool_or(grantee=0 AND privilege_type='USAGE'), bool_or(grantee=0 AND privilege_type='CREATE') FROM expanded;
SELECT 'candidate_absent', NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pss_export_20260828_09');
SELECT 'objects',
  count(*) FILTER (WHERE c.relkind='r'),
  count(*) FILTER (WHERE c.relkind='S'),
  count(*) FILTER (WHERE c.relkind='v'),
  count(*) FILTER (WHERE c.relkind='m'),
  count(*) FILTER (WHERE c.relrowsecurity)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public';
SELECT 'functions', count(*), count(*) FILTER (WHERE p.prosecdef), count(*) FILTER (WHERE d.objid IS NOT NULL),
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE' AND NOT a.is_grantable))
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
LEFT JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'
WHERE n.nspname='public' AND p.prokind::text IN ('f','p');
SELECT 'guc', name, setting, source, context, pending_restart, COALESCE(sourcefile LIKE '%postgresql.auto.conf',false)
FROM pg_settings WHERE name IN ('log_destination','log_line_prefix','log_min_duration_statement','log_statement','logging_collector') ORDER BY name;
WITH candidates AS (
  SELECT rule_number, auth_method,
    CASE WHEN address='127.0.0.1'::inet THEN 'loopback_v4' WHEN address='::1'::inet THEN 'loopback_v6' ELSE 'other' END AS scope
  FROM pg_hba_file_rules
  WHERE error IS NULL AND type='host' AND ('all'=ANY(database) OR 'partsignal'=ANY(database))
    AND ('all'=ANY(user_name) OR 'pss_export_20260828_09'=ANY(user_name))
    AND address='127.0.0.1'::inet
  ORDER BY rule_number
) SELECT 'hba', count(*), min(rule_number), (array_agg(auth_method ORDER BY rule_number))[1], (array_agg(scope ORDER BY rule_number))[1] FROM candidates;
SELECT 'completion', current_setting('transaction_read_only')='on', txid_current_if_assigned() IS NULL;
ROLLBACK;
SQL
}

verify_local_contract() {
  [[ -f "$ACL_SQL" && ! -L "$ACL_SQL" ]] || fail 'ACL_SQL_IDENTITY'
  [[ "$(sha256_file "$ACL_SQL")" == "$ACL_SHA256" ]] || fail 'ACL_SQL_SHA256'
  [[ "$(emit_sql | sha256_stdin)" == "$SQL_STREAM_SHA256" ]] || fail 'SQL_STREAM_SHA256'
}

build_remote_argv() {
  REMOTE_ARGV=(
    docker exec -i
    --env 'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=10s -c lock_timeout=1s -c idle_in_transaction_session_timeout=30s'
    --env "PGAPPNAME=${APPLICATION_NAME}"
    "$SOURCE_CONTAINER"
    psql -X --set=ON_ERROR_STOP=1
    "--username=${BOOTSTRAP_ROLE}"
    "--dbname=${SOURCE_DATABASE}"
  )
}

build_remote_command() {
  local token
  REMOTE_COMMAND=''
  for token in "${REMOTE_ARGV[@]}"; do
    printf -v token '%q' "$token"
    REMOTE_COMMAND+="${token} "
  done
  REMOTE_COMMAND=${REMOTE_COMMAND% }
}

verify_remote_boundary() {
  local expected actual
  [[ ${#REMOTE_ARGV[@]} -eq 13 ]] || fail 'REMOTE_ARGV_COUNT'
  [[ "${REMOTE_ARGV[0]}" == 'docker' && "${REMOTE_ARGV[1]}" == 'exec' ]] || fail 'REMOTE_ARGV_PREFIX'
  [[ "${REMOTE_ARGV[2]}" == '-i' && "${REMOTE_ARGV[7]}" == "$SOURCE_CONTAINER" ]] || fail 'REMOTE_ARGV_IDENTITY'
  [[ " ${REMOTE_ARGV[*]} " != *' sh -lc '* ]] || fail 'REMOTE_SHELL_FORBIDDEN'
  build_remote_command
  bash -n -c "$REMOTE_COMMAND"
  expected=$(printf '<%s>\n' "${REMOTE_ARGV[@]}")
  actual=$(bash -c "set -- ${REMOTE_COMMAND}; printf '<%s>\\n' \"\$@\"")
  [[ "$actual" == "$expected" ]] || fail 'REMOTE_ARGV_ROUNDTRIP'
}

validate_window_authorization() {
  local start_epoch=$1
  local end_epoch=$2
  local now_epoch=$3
  local supplied=${4-}
  local expected="${RUN_ID}:${start_epoch}:${end_epoch}"

  [[ "$start_epoch" =~ ^[0-9]{10}$ && "$end_epoch" =~ ^[0-9]{10}$ ]] || return 1
  (( end_epoch > start_epoch && end_epoch - start_epoch <= 1800 )) || return 1
  (( now_epoch >= start_epoch && now_epoch < end_epoch )) || return 1
  [[ "$supplied" == "$expected" ]]
}

self_check() {
  local synthetic_start=2000000000
  local synthetic_end=2000001800
  local synthetic_now=2000000001

  verify_local_contract
  build_remote_argv
  verify_remote_boundary
  validate_window_authorization "$synthetic_start" "$synthetic_end" "$synthetic_now" \
    "${RUN_ID}:${synthetic_start}:${synthetic_end}"
  ! validate_window_authorization "$synthetic_start" "$synthetic_end" "$synthetic_now" ''
  ! validate_window_authorization "$synthetic_start" "$synthetic_end" "$synthetic_end" \
    "${RUN_ID}:${synthetic_start}:${synthetic_end}"
  ! validate_window_authorization "$synthetic_start" "$((synthetic_end + 1))" "$synthetic_now" \
    "${RUN_ID}:${synthetic_start}:$((synthetic_end + 1))"
  printf 'database_preflight_self_check=PASS\n'
  printf 'run_id=%s\n' "$RUN_ID"
  printf 'production_connected=false\n'
  printf 'ssh_executed=false\n'
  printf 'docker_executed=false\n'
  printf 'database_connected=false\n'
}

run_preflight() {
  [[ $# -eq 2 ]] || fail 'WINDOW_ARGV_COUNT'
  local start_epoch=$1
  local end_epoch=$2
  local now_epoch
  local authorization_value=${PSS_PRODUCTION_WINDOW_AUTHORIZATION-}
  now_epoch=$(date +%s)

  verify_local_contract
  build_remote_argv
  verify_remote_boundary
  validate_window_authorization "$start_epoch" "$end_epoch" "$now_epoch" \
    "$authorization_value" || fail 'WINDOW_AUTHORIZATION'

  emit_sql | /usr/bin/ssh "$SOURCE_HOST" "$REMOTE_COMMAND"
}

case "${1-}" in
  self-check)
    [[ $# -eq 1 ]] || fail 'SELF_CHECK_ARGV_COUNT'
    self_check
    ;;
  run)
    shift
    run_preflight "$@"
    ;;
  *)
    fail 'COMMAND'
    ;;
esac
