"""Створення таблиці dataset_snapshots (каталог ML-датасетів DDoS).

Revision ID: 0002_dataset_snapshots
Revises: 0001_ddos_snapshots
Create Date: 2026-08-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0002_dataset_snapshots"
down_revision = "0001_ddos_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Idempotentність: якщо таблицю вже створив init_db (create_all) — пропускаємо.
    if bind.dialect.has_table(bind, "dataset_snapshots"):
        return

    op.create_table(
        "dataset_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dataset_name", sa.String(), nullable=False),
        sa.Column("category", sa.String(), nullable=False),
        sa.Column("license", sa.String(), nullable=False),
        sa.Column("source_url", sa.String(), nullable=False),
        sa.Column("docs_url", sa.String(), nullable=True),
        sa.Column("freshness", sa.String(), nullable=True),
        sa.Column("record_count", sa.Integer(), nullable=True),
        sa.Column("last_checked", sa.DateTime(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Index("ix_dataset_snapshots_name", "dataset_name"),
        sa.Index("ix_dataset_snapshots_captured_at", "captured_at"),
    )


def downgrade() -> None:
    op.drop_table("dataset_snapshots")
