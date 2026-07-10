"""创建追加式内容审核记录。"""

from alembic import op
from app.migration_schema_v1 import Base

revision = "0005_content_review"
down_revision = "0004_content_production"
branch_labels = None
depends_on = None

TABLES = ["content_review_records"]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=[Base.metadata.tables[name] for name in TABLES])
    op.execute(
        """
        CREATE TRIGGER content_review_records_append_only
        BEFORE UPDATE OR DELETE ON content_review_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
