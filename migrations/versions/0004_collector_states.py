"""Створення таблиці collector_states (стан збирання за джерелом) та
NOT NULL для threats.external_id (v1.6.2, інкрементальний збір + захист від NULL-дублів).

Revision ID: 0004_collector_states
Revises: 0003_threat_is_backfill
Create Date: 2026-10-27
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_collector_states"
down_revision = "0003_threat_is_backfill"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Таблиця collector_states (ідемпотентно)
    if not bind.dialect.has_table(bind, "collector_states"):
        op.create_table(
            "collector_states",
            sa.Column("source", sa.String(), primary_key=True),
            sa.Column("last_fetched_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    # 2. NOT NULL для threats.external_id (ідемпотентно)
    # SQLite не підтримує ALTER COLUMN — використовуємо batch mode.
    with op.batch_alter_table("threats") as batch_op:
        batch_op.alter_column("external_id", existing_type=sa.String(), nullable=False)


def downgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("threats") as batch_op:
        batch_op.alter_column("external_id", existing_type=sa.String(), nullable=True)
    if bind.dialect.has_table(bind, "collector_states"):
        op.drop_table("collector_states")