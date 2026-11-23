"""ADR-115: data model for the 22-field Test Case / Defect standard (step 1)

Revision ID: c1a7e3f9b5d2
Revises: b4d6f8a0c2e3
Create Date: 2026-11-26 09:00:00.000000

Purely additive: no existing row is rewritten except the display-id backfill.

* ``entity_counters`` (tenant_id, kind, next_value) -- per-tenant gap-tolerant
  counters behind the human ids ``TC_000001`` / ``BUG_000001`` (RLS + grants like
  every tenant table).
* test_cases: display_seq/display_id (immutable via trigger), test_type, severity,
  automation_status (default 'Manual'), environment, requirement_ref, soft delete.
* test_case_versions: postconditions, expected_result. Steps: per-step test_data.
* Execution records hold execution-specific data: test_run_cases.actual_result /
  executed_by / executed_at and execution_steps.actual_result.
* defects: display ids, preconditions, resolution, labels, repro_steps (jsonb),
  build_found, fix_version, root_cause_notes, test_run_case_id.
* saved_views.columns (jsonb).
* ck_defects_status widened to 11 codes (legacy Open/Verified stay valid),
  ck_test_runs_type allows 'Retest', ck_field_options_field_key accepts the new
  option keys; new CHECKs for automation_status and defects.resolution.
* New permission codes, granted to the roles that hold the nearest existing
  equivalent (so nobody gains access they did not have), plus Admin/Manager all.
* Field option defaults (Test Type, test case severity, defect severity Major /
  Minor) seeded additively for existing tenants.
* Backfill: display ids per tenant ordered by created_at,id (soft-deleted defects
  included), counters set past the maximum, defects.test_run_case_id derived where
  exactly one run case matches the (run, case) pair.

Indexes (UNIQUE display_id etc.) are built CONCURRENTLY in the next migration.

Downgrade reverses everything. Defects in the six new statuses are mapped to the
nearest legacy status first (Assigned/In Progress/Reopened -> Open, Retest ->
Fixed, Rejected/Deferred -> Closed); 'Retest' runs become 'Regression'.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "c1a7e3f9b5d2"
down_revision: str | None = "b4d6f8a0c2e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APP_ROLE = "qtesthub_app"

NEW_DEFECT_STATUSES = ("Assigned", "In Progress", "Retest", "Reopened", "Rejected", "Deferred")
ALL_DEFECT_STATUSES = ("New", "Open", "Fixed", "Verified", "Closed", *NEW_DEFECT_STATUSES)
LEGACY_DEFECT_STATUSES = ("New", "Open", "Fixed", "Verified", "Closed")

OLD_FIELD_KEYS = ("defect_severity", "test_case_priority", "defect_priority")
NEW_FIELD_KEYS = ("test_type", "test_case_severity")

TEST_TYPES = (
    "Functional",
    "Regression",
    "Smoke",
    "Sanity",
    "Integration",
    "System",
    "UAT",
    "Performance",
    "Security",
    "Usability",
    "Compatibility",
    "API",
)

AUTOMATION_STATUSES = ("Manual", "Automated", "Candidate for Automation")
RESOLUTIONS = (
    "Fixed",
    "Duplicate",
    "Won't Fix",
    "Cannot Reproduce",
    "By Design",
    "Not Applicable",
)

# (code, description, parent code whose holders also get it)
NEW_PERMISSIONS: list[tuple[str, str, str]] = [
    ("defect.edit", "Edit defect fields", "defect.create"),
    ("defect.assign", "Assign a defect to a user", "defect.close"),
    ("defect.change_status", "Change a defect's status", "defect.create"),
    ("defect.import", "Bulk import defects", "defect.create"),
    ("defect.export", "Export defects", "defect.close"),
    ("testcase.execute", "Execute test cases", "executionstep.record"),
    ("testcase.export", "Export test cases", "testcase.bulk_import_export"),
]
BUILT_IN_ROLES_ALL = ("admin", "manager")


def _in_list(values: Sequence[str]) -> str:
    return ",".join("'" + v.replace("'", "''") + "'" for v in values)


def _add_check(table: str, name: str, expr: str) -> None:
    # NOT VALID + VALIDATE keeps the exclusive lock short on big tables.
    op.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({expr}) NOT VALID")
    op.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")


def _backfill_display_ids(table: str, kind: str, prefix: str) -> None:
    op.execute(
        f"""
        UPDATE {table} t
        SET display_seq = s.seq,
            display_id = '{prefix}' || lpad(s.seq::text, 6, '0')
        FROM (
            SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS seq
            FROM {table}
        ) s
        WHERE t.id = s.id
        """
    )
    op.execute(
        f"""
        INSERT INTO entity_counters (tenant_id, kind, next_value)
        SELECT tenant_id, '{kind}', max(display_seq) + 1
        FROM {table}
        GROUP BY tenant_id
        ON CONFLICT (tenant_id, kind) DO UPDATE SET next_value = EXCLUDED.next_value
        """
    )


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)

    # --- entity_counters -------------------------------------------------------
    op.create_table(
        "entity_counters",
        sa.Column("id", uuid, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("tenant_id", uuid, nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("next_value", sa.BigInteger(), nullable=False, server_default="1"),
        sa.CheckConstraint("kind in ('test_case','defect')", name="ck_entity_counters_kind"),
        sa.CheckConstraint("next_value >= 1", name="ck_entity_counters_next_value"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "kind", name="uq_entity_counters_tenant_kind"),
    )
    op.create_index(op.f("ix_entity_counters_tenant_id"), "entity_counters", ["tenant_id"])
    op.execute("ALTER TABLE entity_counters ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE entity_counters FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON entity_counters
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        """
    )
    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON entity_counters TO {APP_ROLE}")

    # --- test_cases ------------------------------------------------------------
    op.add_column("test_cases", sa.Column("display_seq", sa.Integer(), nullable=True))
    op.add_column("test_cases", sa.Column("display_id", sa.Text(), nullable=True))
    op.add_column("test_cases", sa.Column("test_type", sa.Text(), nullable=True))
    op.add_column("test_cases", sa.Column("severity", sa.Text(), nullable=True))
    op.add_column(
        "test_cases",
        sa.Column("automation_status", sa.Text(), nullable=True, server_default="Manual"),
    )
    op.add_column("test_cases", sa.Column("environment", sa.Text(), nullable=True))
    op.add_column("test_cases", sa.Column("requirement_ref", sa.Text(), nullable=True))
    op.add_column("test_cases", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "test_cases",
        sa.Column("deleted_by", uuid, sa.ForeignKey("users.id"), nullable=True),
    )
    _add_check(
        "test_cases",
        "ck_test_cases_automation_status",
        f"automation_status is null or automation_status in ({_in_list(AUTOMATION_STATUSES)})",
    )

    # --- versions / steps ------------------------------------------------------
    op.add_column("test_case_versions", sa.Column("postconditions", sa.Text(), nullable=True))
    op.add_column("test_case_versions", sa.Column("expected_result", sa.Text(), nullable=True))
    op.add_column("test_case_version_steps", sa.Column("test_data", sa.Text(), nullable=True))

    # --- execution records -----------------------------------------------------
    op.add_column("test_run_cases", sa.Column("actual_result", sa.Text(), nullable=True))
    op.add_column(
        "test_run_cases",
        sa.Column("executed_by", uuid, sa.ForeignKey("users.id"), nullable=True),
    )
    op.add_column(
        "test_run_cases", sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("execution_steps", sa.Column("actual_result", sa.Text(), nullable=True))

    # --- defects ---------------------------------------------------------------
    op.add_column("defects", sa.Column("display_seq", sa.Integer(), nullable=True))
    op.add_column("defects", sa.Column("display_id", sa.Text(), nullable=True))
    op.add_column("defects", sa.Column("preconditions", sa.Text(), nullable=True))
    op.add_column("defects", sa.Column("resolution", sa.Text(), nullable=True))
    op.add_column(
        "defects",
        sa.Column(
            "labels",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
    )
    op.add_column("defects", sa.Column("repro_steps", postgresql.JSONB(), nullable=True))
    op.add_column("defects", sa.Column("build_found", sa.Text(), nullable=True))
    op.add_column("defects", sa.Column("fix_version", sa.Text(), nullable=True))
    op.add_column("defects", sa.Column("root_cause_notes", sa.Text(), nullable=True))
    op.add_column(
        "defects",
        sa.Column("test_run_case_id", uuid, sa.ForeignKey("test_run_cases.id"), nullable=True),
    )
    _add_check(
        "defects",
        "ck_defects_resolution",
        f"resolution is null or resolution in ({_in_list(RESOLUTIONS)})",
    )

    # --- saved views -----------------------------------------------------------
    op.add_column("saved_views", sa.Column("columns", postgresql.JSONB(), nullable=True))

    # --- widened CHECK constraints ---------------------------------------------
    op.execute("ALTER TABLE defects DROP CONSTRAINT ck_defects_status")
    _add_check("defects", "ck_defects_status", f"status in ({_in_list(ALL_DEFECT_STATUSES)})")
    op.execute("ALTER TABLE test_runs DROP CONSTRAINT ck_test_runs_type")
    _add_check(
        "test_runs", "ck_test_runs_type", "run_type in ('Regression','Sanity','Smoke','Retest')"
    )
    op.execute("ALTER TABLE field_options DROP CONSTRAINT ck_field_options_field_key")
    _add_check(
        "field_options",
        "ck_field_options_field_key",
        f"field_key in ({_in_list(OLD_FIELD_KEYS + NEW_FIELD_KEYS)})",
    )

    # --- backfill (raw SQL: bypasses the ORM soft-delete hook, so deleted rows count)
    _backfill_display_ids("test_cases", "test_case", "TC_")
    _backfill_display_ids("defects", "defect", "BUG_")
    op.execute(
        """
        UPDATE defects d
        SET test_run_case_id = m.run_case_id
        FROM (
            SELECT tenant_id, test_run_id, test_case_id, (array_agg(id))[1] AS run_case_id
            FROM test_run_cases
            GROUP BY tenant_id, test_run_id, test_case_id
            HAVING count(*) = 1
        ) m
        WHERE d.tenant_id = m.tenant_id
          AND d.test_run_id = m.test_run_id
          AND d.test_case_id = m.test_case_id
          AND d.test_run_case_id IS NULL
        """
    )

    # --- display ids are immutable once assigned -------------------------------
    op.execute(
        """
        CREATE OR REPLACE FUNCTION enforce_display_id_immutable() RETURNS trigger AS $$
        BEGIN
            IF OLD.display_id IS NOT NULL
               AND (NEW.display_id IS DISTINCT FROM OLD.display_id
                    OR NEW.display_seq IS DISTINCT FROM OLD.display_seq) THEN
                RAISE EXCEPTION 'display_id is immutable once assigned'
                    USING ERRCODE = 'integrity_constraint_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    for table in ("test_cases", "defects"):
        op.execute(
            f"""
            CREATE TRIGGER trg_{table}_display_id_immutable
            BEFORE UPDATE OF display_id, display_seq ON {table}
            FOR EACH ROW EXECUTE FUNCTION enforce_display_id_immutable()
            """
        )

    # --- field option defaults for existing tenants (additive) ------------------
    option_sets: list[tuple[str, tuple[str, ...], int]] = [
        ("test_type", TEST_TYPES, 0),
        ("test_case_severity", ("Critical", "Major", "Minor"), 0),
        # Existing defect_severity rows hold orders 0..3; append after them.
        ("defect_severity", ("Major", "Minor"), 4),
    ]
    for field_key, codes, start in option_sets:
        for offset, code in enumerate(codes):
            op.execute(
                sa.text(
                    """
                    INSERT INTO field_options (tenant_id, field_key, code, label, sort_order)
                    SELECT id, :field_key, :code, :code, :sort_order FROM tenants
                    ON CONFLICT DO NOTHING
                    """
                ).bindparams(field_key=field_key, code=code, sort_order=start + offset)
            )

    # --- permissions ----------------------------------------------------------------
    conn = op.get_bind()
    for code, description, parent in NEW_PERMISSIONS:
        permission_id = conn.execute(
            sa.text(
                "INSERT INTO permissions (code, description) VALUES (:code, :description) "
                "ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description "
                "RETURNING id"
            ),
            {"code": code, "description": description},
        ).scalar_one()
        # Same holders as the nearest existing equivalent (built-in and custom roles).
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "SELECT rp.role_id, :pid FROM role_permissions rp "
                "JOIN permissions p ON p.id = rp.permission_id AND p.code = :parent "
                "ON CONFLICT DO NOTHING"
            ),
            {"pid": permission_id, "parent": parent},
        )
        # Admin and Manager always get every new code.
        conn.execute(
            sa.text(
                "INSERT INTO role_permissions (role_id, permission_id) "
                "SELECT id, :pid FROM roles WHERE code IN ('admin','manager') "
                "AND tenant_id IS NULL ON CONFLICT DO NOTHING"
            ),
            {"pid": permission_id},
        )


def downgrade() -> None:
    conn = op.get_bind()

    # permissions
    for code, _description, _parent in NEW_PERMISSIONS:
        conn.execute(
            sa.text(
                "DELETE FROM role_permissions WHERE permission_id = "
                "(SELECT id FROM permissions WHERE code = :code)"
            ),
            {"code": code},
        )
        conn.execute(sa.text("DELETE FROM permissions WHERE code = :code"), {"code": code})

    # field options: drop the new keys, and Major/Minor defect severities nobody uses
    op.execute("DELETE FROM field_options WHERE field_key IN ('test_type','test_case_severity')")
    op.execute(
        """
        DELETE FROM field_options fo
        WHERE fo.field_key = 'defect_severity' AND fo.code IN ('Major','Minor')
          AND NOT EXISTS (
              SELECT 1 FROM defects d WHERE d.tenant_id = fo.tenant_id AND d.severity = fo.code
          )
        """
    )

    # triggers
    for table in ("defects", "test_cases"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_display_id_immutable ON {table}")
    op.execute("DROP FUNCTION IF EXISTS enforce_display_id_immutable()")

    # CHECK constraints back to their previous definitions (map data first)
    op.execute("ALTER TABLE field_options DROP CONSTRAINT ck_field_options_field_key")
    _add_check(
        "field_options", "ck_field_options_field_key", f"field_key in ({_in_list(OLD_FIELD_KEYS)})"
    )
    op.execute("UPDATE test_runs SET run_type = 'Regression' WHERE run_type = 'Retest'")
    op.execute("ALTER TABLE test_runs DROP CONSTRAINT ck_test_runs_type")
    _add_check("test_runs", "ck_test_runs_type", "run_type in ('Regression','Sanity','Smoke')")
    op.execute(
        """
        UPDATE defects SET status = CASE status
            WHEN 'Assigned' THEN 'Open'
            WHEN 'In Progress' THEN 'Open'
            WHEN 'Reopened' THEN 'Open'
            WHEN 'Retest' THEN 'Fixed'
            WHEN 'Rejected' THEN 'Closed'
            WHEN 'Deferred' THEN 'Closed'
            ELSE status END
        WHERE status IN ('Assigned','In Progress','Reopened','Retest','Rejected','Deferred')
        """
    )
    op.execute("ALTER TABLE defects DROP CONSTRAINT ck_defects_status")
    _add_check("defects", "ck_defects_status", f"status in ({_in_list(LEGACY_DEFECT_STATUSES)})")

    # columns
    op.drop_column("saved_views", "columns")
    op.execute("ALTER TABLE defects DROP CONSTRAINT IF EXISTS ck_defects_resolution")
    for column in (
        "test_run_case_id",
        "root_cause_notes",
        "fix_version",
        "build_found",
        "repro_steps",
        "labels",
        "resolution",
        "preconditions",
        "display_id",
        "display_seq",
    ):
        op.drop_column("defects", column)
    op.drop_column("execution_steps", "actual_result")
    for column in ("executed_at", "executed_by", "actual_result"):
        op.drop_column("test_run_cases", column)
    op.drop_column("test_case_version_steps", "test_data")
    op.drop_column("test_case_versions", "expected_result")
    op.drop_column("test_case_versions", "postconditions")
    op.execute("ALTER TABLE test_cases DROP CONSTRAINT IF EXISTS ck_test_cases_automation_status")
    for column in (
        "deleted_by",
        "deleted_at",
        "requirement_ref",
        "environment",
        "automation_status",
        "severity",
        "test_type",
        "display_id",
        "display_seq",
    ):
        op.drop_column("test_cases", column)

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON entity_counters")
    op.drop_table("entity_counters")
