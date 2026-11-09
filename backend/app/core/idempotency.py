from collections.abc import Callable
from typing import TypeVar
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import set_tenant_context
from app.models.idempotency import IdempotencyKey

T = TypeVar("T")


def with_idempotency(
    db: Session,
    tenant_id: UUID,
    user_id: UUID,
    scope: str,
    idempotency_key: str | None,
    create: Callable[[], T],
    get_by_id: Callable[[UUID], T],
    entity_id_of: Callable[[T], UUID],
) -> T:
    """Reliability hardening (GAP-67): if the caller supplies an
    `Idempotency-Key` header, a retried/duplicated create request with the
    same key returns the original entity instead of creating a duplicate.
    Without a key, behavior is unchanged (a new entity is always created)
    -- this is opt-in, so no existing caller's behavior changes.
    """
    if not idempotency_key:
        return create()

    existing_id = db.execute(
        select(IdempotencyKey.entity_id).where(
            IdempotencyKey.tenant_id == tenant_id,
            IdempotencyKey.user_id == user_id,
            IdempotencyKey.scope == scope,
            IdempotencyKey.key == idempotency_key,
        )
    ).scalar_one_or_none()
    if existing_id is not None:
        return get_by_id(existing_id)

    result = create()
    # `create()` commits its own transaction; app.current_tenant is a
    # transaction-LOCAL GUC (ADR-007), so it resets after that commit and
    # must be re-asserted before this INSERT's RLS check runs.
    set_tenant_context(db, str(tenant_id))
    db.add(
        IdempotencyKey(
            tenant_id=tenant_id,
            user_id=user_id,
            scope=scope,
            key=idempotency_key,
            entity_id=entity_id_of(result),
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # A concurrent identical request raced past the SELECT above and
        # already recorded this key -- safe to ignore. Both requests'
        # entities exist; only this key->entity mapping didn't get
        # recorded for the loser, which just means a third retry with the
        # same key would create one more entity rather than deduping
        # against the winner. Acceptable: the common case (sequential
        # retries, not a true race) is still fully deduped.
        db.rollback()
    return result
