"""telemetries sensor air & auv_status.heading boleh NULL

Sensor yang mati / belum terpasang (mis. TDS) dulu membuat seluruh baris
telemetri dibuang. Kini nilainya disimpan NULL agar sensor lain tetap
tercatat, tanpa angka 0 palsu yang merusak rata-rata. Heading kosong
(kompas tak mengirim data) juga NULL, bukan "N".

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-14 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, Sequence[str], None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SENSOR_COLUMNS = ('ph_level', 'tds_value', 'dissolved_oxygen', 'water_temp')


def upgrade() -> None:
    for col in SENSOR_COLUMNS:
        op.alter_column('telemetries', col, existing_type=sa.Double(), nullable=True)
    op.alter_column('auv_status', 'heading', existing_type=sa.String(50), nullable=True)


def downgrade() -> None:
    for col in SENSOR_COLUMNS:
        op.execute(f"UPDATE telemetries SET {col} = 0 WHERE {col} IS NULL")
        op.alter_column('telemetries', col, existing_type=sa.Double(), nullable=False)
    op.execute("UPDATE auv_status SET heading = 'N' WHERE heading IS NULL")
    op.alter_column('auv_status', 'heading', existing_type=sa.String(50), nullable=False)
