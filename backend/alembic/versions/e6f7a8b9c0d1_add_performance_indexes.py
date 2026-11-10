"""add missing indexes found investigating GAP-69's NFR misses (gap-closure pass, ADR-057)

Root cause for `GET /projects/{id}/test-cases?search=&priority=` measuring
162ms against a 100ms target: `project_id` and `assignee_id`/`module_id`
are foreign keys with NO index at all (Postgres only auto-indexes primary
keys and unique constraints, never foreign keys) -- every list call was a
sequential scan over every test case in the tenant's whole table, done
TWICE (once for the page, once for the separate COUNT query). Adding a
composite `(tenant_id, project_id)` index (the two columns every list call
always filters by, search/priority/status/assignee/module are additional,
optional filters on top) turns that into an index scan.

`defects` has the identical shape (`project_id` FK, no index) and was not
separately measured in the performance pass, but the same root cause
applies -- added defensively, same low cost.

Deliberately NOT adding a pg_trgm GIN index for the `ILIKE '%search%'`
case in this pass -- that needs the `pg_trgm` extension enabled, which is
a bigger, separate infra decision (extension availability varies by
hosting provider) not warranted for this specific, already-measured gap;
the plain B-tree index still helps every *unfiltered-by-search* list call,
which is the common case, and callers that do search still benefit from
the additive `project_id` filter no longer needing a sequential scan.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-11-11 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        'ix_test_cases_tenant_project', 'test_cases', ['tenant_id', 'project_id']
    )
    op.create_index(
        'ix_defects_tenant_project', 'defects', ['tenant_id', 'project_id']
    )


def downgrade() -> None:
    op.drop_index('ix_defects_tenant_project', table_name='defects')
    op.drop_index('ix_test_cases_tenant_project', table_name='test_cases')
