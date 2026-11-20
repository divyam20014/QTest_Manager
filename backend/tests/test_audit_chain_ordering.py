"""The audit hash chain must verify even when events share a timestamp.

`record_audit_event` stamps `created_at` from the Python clock, which ticks
coarsely on some platforms (about 1-16 ms on Windows), so events written back
to back can get an identical timestamp. `verify_chain` re-walks the chain in
(created_at, id) order; `id` is a random UUID, so for tied events that order
used to disagree with the order they were chained in and a perfectly valid log
was reported as tampered with (the flaky
test_audit_api::test_verify_chain_reports_valid_for_untampered_log).
"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest

EVENT_COUNT = 12


def _frozen_datetime(moment: datetime) -> type:
    class _Frozen(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[no-untyped-def]
            return moment

    return _Frozen


@pytest.mark.parametrize(
    "frozen_at",
    [
        # Ahead of every real event: all new events tie with each other.
        datetime(2099, 1, 1, tzinfo=UTC),
        # Behind the tenant's existing events: the clock "went backwards" and
        # the new events also tie with each other.
        datetime(2000, 1, 1, tzinfo=UTC),
    ],
    ids=["tied-timestamps", "clock-went-backwards"],
)
def test_chain_verifies_when_events_share_a_timestamp(
    db_session, monkeypatch: pytest.MonkeyPatch, frozen_at: datetime
) -> None:
    from app.core import audit
    from app.core.db import set_tenant_context
    from app.schemas.platform import TenantCreateRequest
    from app.services import audit_service, platform_service

    tenant, admin = platform_service.create_tenant_with_admin(
        db_session,
        TenantCreateRequest(
            tenant_name="Audit Ordering Co",
            admin_name="Admin",
            admin_email="admin@audit-ordering.co",
            admin_password="AdminPassw0rd!",
        ),
    )
    set_tenant_context(db_session, str(tenant.id))

    monkeypatch.setattr(audit, "datetime", _frozen_datetime(frozen_at))
    for index in range(EVENT_COUNT):
        audit.record_audit_event(
            db_session,
            tenant_id=tenant.id,
            user_id=admin.id,
            action="test.tied_timestamp",
            entity_type="test",
            entity_id=uuid4(),
            metadata={"index": index},
        )
    db_session.commit()
    monkeypatch.undo()

    set_tenant_context(db_session, str(tenant.id))
    result = audit_service.verify_chain(db_session, tenant.id)
    assert result.valid, result
    assert result.checked_count >= EVENT_COUNT


def _tenant_with_chain(db_session):
    from app.core.db import set_tenant_context
    from app.schemas.platform import TenantCreateRequest
    from app.services import platform_service

    tenant, admin = platform_service.create_tenant_with_admin(
        db_session,
        TenantCreateRequest(
            tenant_name="Audit Legacy Co",
            admin_name="Admin",
            admin_email="admin@audit-legacy.co",
            admin_password="AdminPassw0rd!",
        ),
    )
    set_tenant_context(db_session, str(tenant.id))
    return tenant, admin


def _append_legacy_row(db_session, tenant, admin, *, stored_action: str, hashed_action: str):
    """Append a row hashed in the OLD payload shape (no `service_token_id` key),
    chained after the current head. `hashed_action` differs from `stored_action`
    to simulate a row edited after it was written."""
    import hashlib
    from datetime import timedelta

    from sqlalchemy import select

    from app.core.audit import _canonical
    from app.models.audit import AuditLog

    head = db_session.execute(
        select(AuditLog)
        .where(AuditLog.tenant_id == tenant.id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(1)
    ).scalar_one()
    created_at = head.created_at + timedelta(microseconds=1)
    entity_id = uuid4()
    payload = {
        "tenant_id": str(tenant.id),
        "user_id": str(admin.id),
        "platform_admin_id": None,
        "action": hashed_action,
        "entity_type": "test",
        "entity_id": str(entity_id),
        "metadata": None,
        "created_at": created_at.isoformat(),
        "prev_hash": head.record_hash,
    }
    row = AuditLog(
        tenant_id=tenant.id,
        user_id=admin.id,
        action=stored_action,
        entity_type="test",
        entity_id=entity_id,
        event_metadata=None,
        prev_hash=head.record_hash,
        record_hash=hashlib.sha256(_canonical(payload).encode()).hexdigest(),
        created_at=created_at,
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_chain_accepts_rows_hashed_before_service_token_id_existed(db_session) -> None:
    from app.core import audit
    from app.core.db import set_tenant_context
    from app.services import audit_service

    tenant, admin = _tenant_with_chain(db_session)
    _append_legacy_row(
        db_session, tenant, admin, stored_action="test.legacy", hashed_action="test.legacy"
    )
    # A current-format event chained after the legacy row. (The helper's commit
    # ends the transaction, which resets the tenant context row-level security needs.)
    set_tenant_context(db_session, str(tenant.id))
    audit.record_audit_event(
        db_session,
        tenant_id=tenant.id,
        user_id=admin.id,
        action="test.current",
        entity_type="test",
        entity_id=uuid4(),
    )
    db_session.commit()

    set_tenant_context(db_session, str(tenant.id))
    result = audit_service.verify_chain(db_session, tenant.id)
    assert result.valid, result


def test_chain_still_detects_an_edited_legacy_row(db_session) -> None:
    from app.core.db import set_tenant_context
    from app.services import audit_service

    tenant, admin = _tenant_with_chain(db_session)
    edited = _append_legacy_row(
        db_session, tenant, admin, stored_action="test.edited", hashed_action="test.original"
    )

    set_tenant_context(db_session, str(tenant.id))
    result = audit_service.verify_chain(db_session, tenant.id)
    assert not result.valid
    assert result.broken_at_id == edited.id

