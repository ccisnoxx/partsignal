"""GEO有限运行健康元数据；加法迁移，不回填或修改业务历史。"""

from alembic import op

revision = "0065_geo_observability"
down_revision = "0064_geo_retention"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    # 冻结本revision的枚举，不导入未来运行时模型。
    op.execute("""CREATE TABLE geo_operation_health (
        operation varchar(32) CONSTRAINT pk_geo_operation_health PRIMARY KEY,
        last_attempt_at timestamptz NOT NULL,
        last_success_at timestamptz,
        last_failure_at timestamptz,
        success_count bigint NOT NULL DEFAULT 0,
        failure_count bigint NOT NULL DEFAULT 0,
        duration_ms bigint NOT NULL DEFAULT 0,
        duration_total_ms bigint NOT NULL DEFAULT 0,
        CONSTRAINT ck_geo_operation_health_operation CHECK (operation IN (
            'scheduler_tick','scheduler_publish','worker_heartbeat','collect_task','analyze_task',
            'collection_dispatch','collection_recovery','analysis_dispatch','analysis_recovery',
            'retention','batch_build','opportunity_evaluate','storage_write')),
        CONSTRAINT ck_geo_operation_health_counts CHECK (
            success_count >= 0 AND failure_count >= 0 AND duration_ms >= 0
            AND duration_total_ms >= duration_ms),
        CONSTRAINT ck_geo_operation_health_time CHECK (
            (last_success_at IS NULL) = (success_count = 0) AND
            (last_failure_at IS NULL) = (failure_count = 0) AND
            (last_success_at IS NULL OR last_success_at <= last_attempt_at) AND
            (last_failure_at IS NULL OR last_failure_at <= last_attempt_at))
    )""")


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0065 运维故障事实须保留；停止采集并采用前向修复'
            USING ERRCODE='55000';
    END $$;""")
