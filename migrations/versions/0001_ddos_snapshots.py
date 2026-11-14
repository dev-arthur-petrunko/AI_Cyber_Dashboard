"""Створення таблиці ddos_snapshots (DDoS-статистика Cloudflare Radar).

Revision ID: 0001_ddos_snapshots
Revises:
Create Date: 2026-08-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0001_ddos_snapshots"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Idempotentність: якщо таблицю вже створив init_db (create_all) — пропускаємо.
    if bind.dialect.has_table(bind, "ddos_snapshots"):
        return

    op.create_table(
        "ddos_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.Column("metric_type", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("license", sa.String(), nullable=False),
        sa.Index("ix_ddos_snapshots_captured_at", "captured_at"),
        sa.Index("ix_ddos_snapshots_scope", "scope"),
        sa.Index("ix_ddos_snapshots_metric_type", "metric_type"),
        sa.Index("ix_ddos_snapshots_scope_metric", "scope", "metric_type"),
    )


def downgrade() -> None:
    op.drop_table("ddos_snapshots")
