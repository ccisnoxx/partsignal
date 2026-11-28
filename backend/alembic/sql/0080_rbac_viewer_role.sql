-- Slice 1A: 三级 RBAC，新增领导只读账号类型 VIEWER（服务端全量写操作 fail-closed 拦截）

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS ck_users_ck_users_account_type,
    DROP CONSTRAINT IF EXISTS ck_users_account_type,
    ADD CONSTRAINT ck_users_account_type
        CHECK (account_type IN ('ADMIN', 'ENGINEER', 'VIEWER'));
