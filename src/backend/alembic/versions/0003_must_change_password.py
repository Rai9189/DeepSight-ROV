"""users.must_change_password

Password awal/reset dibuat admin (acak) dan wajib diganti pengguna saat login.
Akun lama diisi False — password mereka sudah milik sendiri.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-09 22:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003'
down_revision: Union[str, Sequence[str], None] = '0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    cols = {c['name'] for c in sa.inspect(op.get_bind()).get_columns('users')}
    if 'must_change_password' not in cols:
        # server_default hanya untuk mengisi baris lama, lalu dilepas (default diisi ORM)
        op.add_column('users', sa.Column('must_change_password', sa.Boolean(), nullable=False,
                                         server_default=sa.false()))
        op.alter_column('users', 'must_change_password', server_default=None,
                        existing_type=sa.Boolean(), existing_nullable=False)


def downgrade() -> None:
    op.drop_column('users', 'must_change_password')
