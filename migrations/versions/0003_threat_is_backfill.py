"""Додавання threats.is_backfill (v1.6.1, фікс New 24h).

Технічні імпорти без реальної дати джерела (Spamhaus DROP, ET Compromised)
більше не потрапляють у метрику new_cve_24h.

Revision ID: 0003_threat_is_backfill
Revises: 0002_dataset_snapshots
Create Date: 2026-08-22
"""
import sqlalchemy as sa
from alembic import op

revision = "0003_threat_is_backfill"
down_revision = "0002_dataset_snapshots"
branch_labels = None
depends_on = None


def _has_column(bind, table: str, column: str) -> bool:
    insp = sa.inspect(bind)
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # Idempotentність: init_db (create_all) міг вже додати колонку.
    if not _has_column(bind, "threats", "is_backfill"):
        op.add_column(
            "threats",
            sa.Column("is_backfill", sa.Boolean(), nullable=False,
                      server_default=sa.false()),
        )
        op.create_index("ix_threats_is_backfill", "threats", ["is_backfill"])


def downgrade() -> None:
    bind = op.get_bind()
    if _has_column(bind, "threats", "is_backfill"):
        op.drop_index("ix_threats_is_backfill", table_name="threats")
        op.drop_column("threats", "is_backfill")
