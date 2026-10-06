"""仅增加计划配置聚合；不创建批次、运行或改写历史观测。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0047_geo_monitoring_plans"
down_revision = "0046_geo_surfaces_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION geo_plan_timezone_valid(value text) RETURNS boolean
        LANGUAGE sql STABLE STRICT AS $$
            SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = value)
                AND value NOT LIKE 'posix/%' AND value NOT LIKE 'right/%'
        $$;
    """)
    op.create_table(
        "geo_monitoring_plans",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="DISABLED"),
        sa.Column("repeat_count", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("schedule_kind", sa.String(16), nullable=False, server_default="MANUAL_ONLY"),
        sa.Column("cron_expression", sa.String(120)),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Asia/Shanghai"),
        sa.Column("budget_limit", sa.Numeric(14, 6)),
        sa.Column("rule_set_revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_geo_monitoring_plans")),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_geo_monitoring_plans_creator"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_geo_monitoring_plans_updater"),
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "length(name) BETWEEN 1 AND 200 AND name !~ '^[[:space:]]|[[:space:]]$'",
            name=op.f("ck_geo_monitoring_plans_name"),
        ),
        sa.CheckConstraint(
            "status IN ('DISABLED','ACTIVE','PAUSED','ARCHIVED')",
            name=op.f("ck_geo_monitoring_plans_status"),
        ),
        sa.CheckConstraint(
            "repeat_count BETWEEN 1 AND 10", name=op.f("ck_geo_monitoring_plans_repeat")
        ),
        sa.CheckConstraint(
            "(schedule_kind = 'MANUAL_ONLY' AND cron_expression IS NULL) OR (schedule_kind = 'CRON' AND cron_expression IS NOT NULL AND length(cron_expression) BETWEEN 9 AND 120 AND cron_expression ~ '^[!-~]+( [!-~]+){4}$')",
            name=op.f("ck_geo_monitoring_plans_schedule"),
        ),
        sa.CheckConstraint(
            "geo_plan_timezone_valid(timezone)", name=op.f("ck_geo_monitoring_plans_timezone")
        ),
        sa.CheckConstraint(
            "budget_limit IS NULL OR (budget_limit >= 0 AND budget_limit < 'Infinity'::numeric)",
            name=op.f("ck_geo_monitoring_plans_budget"),
        ),
        sa.CheckConstraint("revision >= 0", name=op.f("ck_geo_monitoring_plans_revision")),
        sa.CheckConstraint(
            "rule_set_revision >= 1", name=op.f("ck_geo_monitoring_plans_rule_revision")
        ),
    )
    for suffix, columns in [
        ("status_updated", ["status", "updated_at", "id"]),
        ("creator", ["created_by"]),
        ("updater", ["updated_by"]),
    ]:
        op.create_index(f"ix_geo_monitoring_plans_{suffix}", "geo_monitoring_plans", columns)
    # 三种关系分别拥有明确资源语义；只在父聚合显式删除时级联关系自身。
    for suffix, column, target, label in [
        ("subjects", "subject_id", "geo_subjects", "subject"),
        ("prompts", "prompt_variant_id", "geo_prompt_variants", "prompt"),
        ("profiles", "collection_profile_id", "geo_collection_profiles", "profile"),
    ]:
        table = f"geo_monitoring_plan_{suffix}"
        columns = [
            sa.Column("plan_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(column, postgresql.UUID(as_uuid=True), nullable=False),
        ]
        constraints = [
            sa.PrimaryKeyConstraint("plan_id", column, name=op.f(f"pk_{table}")),
            sa.ForeignKeyConstraint(
                ["plan_id"],
                ["geo_monitoring_plans.id"],
                name=op.f(f"fk_{table}_plan"),
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                [column], [f"{target}.id"], name=op.f(f"fk_{table}_{label}"), ondelete="RESTRICT"
            ),
        ]
        if suffix == "subjects":
            columns.append(sa.Column("role", sa.String(16), nullable=False))
            constraints.append(
                sa.CheckConstraint(
                    "role IN ('PRIMARY','COMPETITOR','REFERENCE')",
                    name=op.f("ck_geo_monitoring_plan_subjects_role"),
                )
            )
        op.create_table(table, *columns, *constraints)
        op.create_index(f"ix_{table}_{label}", table, [column, "plan_id"])
    op.execute("""
        CREATE FUNCTION geo_guard_monitoring_plan() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF NEW.status <> 'DISABLED' OR NEW.revision <> 0 THEN
                    RAISE EXCEPTION '计划必须从 DISABLED revision 0 创建'
                        USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_initial';
                END IF;
                RETURN NEW;
            END IF;
            IF OLD.status = 'ARCHIVED' AND (TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD) THEN
                RAISE EXCEPTION '归档计划只读'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_archived';
            END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            IF ROW(NEW.id, NEW.created_by, NEW.created_at)
                IS DISTINCT FROM ROW(OLD.id, OLD.created_by, OLD.created_at) THEN
                RAISE EXCEPTION '计划创建身份不可变'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_identity';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER geo_monitoring_plan_guard BEFORE INSERT OR UPDATE OR DELETE
            ON geo_monitoring_plans FOR EACH ROW EXECUTE FUNCTION geo_guard_monitoring_plan();

        CREATE FUNCTION geo_guard_plan_membership() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE parent uuid; state text;
        BEGIN
            IF TG_OP = 'UPDATE' AND NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
                RAISE EXCEPTION '关系不可移动到其他计划，必须显式替换'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_membership_identity';
            END IF;
            parent := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
            SELECT status INTO state FROM geo_monitoring_plans WHERE id = parent FOR UPDATE;
            IF state = 'ARCHIVED' THEN
                RAISE EXCEPTION '归档计划关系只读'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_archived';
            END IF;
            -- 锁本身不能阻止 RR 旧快照写偏斜；建立父行 MVCC 写冲突，不改逻辑 revision。
            UPDATE geo_monitoring_plans SET revision = revision WHERE id = parent;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END $$;

        CREATE FUNCTION geo_check_plan_complete() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE parent uuid;
        BEGIN
            IF TG_TABLE_NAME = 'geo_monitoring_plans' THEN
                parent := NEW.id;
            ELSE
                parent := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END;
            END IF;
            IF NOT EXISTS (SELECT 1 FROM geo_monitoring_plans WHERE id = parent) THEN
                RETURN NULL; -- 父聚合已被显式删除，关系级联不要求重建它。
            END IF;
            IF NOT EXISTS (SELECT 1 FROM geo_monitoring_plan_subjects
                           WHERE plan_id = parent AND role = 'PRIMARY') THEN
                RAISE EXCEPTION '计划至少需要一个 PRIMARY'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_primary_required';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM geo_monitoring_plan_prompts WHERE plan_id = parent) THEN
                RAISE EXCEPTION '计划至少需要一个问题变体'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_prompt_required';
            END IF;
            IF NOT EXISTS (SELECT 1 FROM geo_monitoring_plan_profiles WHERE plan_id = parent) THEN
                RAISE EXCEPTION '计划至少需要一个采集配置'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_monitoring_plans_profile_required';
            END IF;
            RETURN NULL;
        END $$;
        CREATE CONSTRAINT TRIGGER geo_monitoring_plan_complete AFTER INSERT OR UPDATE
            ON geo_monitoring_plans DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION geo_check_plan_complete();
    """)
    for suffix in ("subjects", "prompts", "profiles"):
        table = f"geo_monitoring_plan_{suffix}"
        op.execute(f"""
            CREATE TRIGGER {table}_guard BEFORE INSERT OR UPDATE OR DELETE
                ON {table} FOR EACH ROW EXECUTE FUNCTION geo_guard_plan_membership();
            CREATE CONSTRAINT TRIGGER {table}_complete AFTER INSERT OR UPDATE OR DELETE
                ON {table} DEFERRABLE INITIALLY DEFERRED
                FOR EACH ROW EXECUTE FUNCTION geo_check_plan_complete();
        """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            RAISE EXCEPTION '0047 MonitoringPlan 无法安全降级；保留配置并使用前向修复'
                USING ERRCODE = '55000';
        END $$;
    """)
