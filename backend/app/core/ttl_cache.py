"""Short-TTL in-process cache for expensive read-only report queries (ADR-113).

Scope and safety rules:

* In-process only (no Redis): each uvicorn worker has its own cache, so a value
  can be at most `report_cache_ttl_seconds` old on another worker. TTL is kept
  small (default 20 s, hard ceiling 60 s) and 0 disables the cache entirely.
* The key always starts with the tenant id and always contains the caller's
  role and user id plus every argument of the call (project, filters, ...), so a
  value computed for one tenant / user / role / visibility scope can never be
  served to another. The tenant id is also the unit of invalidation.
* Writes invalidate: any commit whose session flushed rows of a table the reports
  read (REPORT_TABLES; not sessions, audit rows, notifications, ...) drops that
  tenant's entries; an ORM-level bulk INSERT/UPDATE/DELETE on such a table drops
  everything. Raw-SQL writers call `invalidate_all()` themselves. The TTL bounds
  whatever slips through (other workers, the background worker process).
* Only successful results are cached (an exception propagates and caches nothing)
  and every hit is returned as a deep copy, so a caller mutating a result cannot
  poison later hits.
"""

import threading
import time
from collections.abc import Callable
from functools import wraps
from typing import Any, TypeVar
from uuid import UUID

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import get_settings

MAX_TTL_SECONDS = 60.0

# Tables whose rows feed the cached report functions (counts, names, scoping and
# the tester-visibility switches on `tenants`). Anything else -- sessions, audit
# rows, notifications, idempotency keys, ... -- is written on almost every request
# and cannot change a report, so it must not flush the cache.
REPORT_TABLES = frozenset(
    {
        "tenants",
        "users",
        "projects",
        "project_members",
        "test_cases",
        "test_case_versions",
        "test_runs",
        "test_run_cases",
        "execution_steps",
        "defects",
        "defect_links",
        "requirements",
        "requirement_test_case_links",
        "tasks",
        "task_statuses",
        "task_test_case_links",
        "releases",
        "builds",
        "environments",
        "test_modules",
        "roles",
        "role_permissions",
    }
)
MAX_ENTRIES_PER_TENANT = 256

T = TypeVar("T")


class TTLCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data: dict[UUID, dict[Any, tuple[float, Any]]] = {}
        self._key_locks: dict[tuple[UUID, Any], threading.Lock] = {}

    def key_lock(self, tenant_id: UUID, key: Any) -> threading.Lock:
        """One lock per cache key: concurrent identical requests wait for the first
        to compute instead of all running the same heavy query (a stampede)."""
        with self._lock:
            if len(self._key_locks) > 4 * MAX_ENTRIES_PER_TENANT:
                self._key_locks = {k: lk for k, lk in self._key_locks.items() if lk.locked()}
            return self._key_locks.setdefault((tenant_id, key), threading.Lock())

    def get(self, tenant_id: UUID, key: Any) -> tuple[bool, Any]:
        now = time.monotonic()
        with self._lock:
            entry = self._data.get(tenant_id, {}).get(key)
            if entry is not None and entry[0] > now:
                return True, entry[1]
        return False, None

    def put(self, tenant_id: UUID, key: Any, value: Any, ttl: float) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = self._data.setdefault(tenant_id, {})
            if len(bucket) >= MAX_ENTRIES_PER_TENANT:
                for stale in [k for k, (exp, _v) in bucket.items() if exp <= now]:
                    del bucket[stale]
                if len(bucket) >= MAX_ENTRIES_PER_TENANT:
                    bucket.clear()
            bucket[key] = (now + ttl, value)

    def invalidate_tenant(self, tenant_id: UUID) -> None:
        with self._lock:
            self._data.pop(tenant_id, None)

    def invalidate_all(self) -> None:
        with self._lock:
            self._data.clear()


cache = TTLCache()


def invalidate_all() -> None:
    cache.invalidate_all()


def _ttl() -> float:
    return min(max(get_settings().report_cache_ttl_seconds, 0.0), MAX_TTL_SECONDS)


def _freeze(value: Any) -> Any:
    """Hashable, order-independent, type-tagged form of a call argument."""
    if isinstance(value, dict):
        return tuple(sorted((k, _freeze(v)) for k, v in value.items()))
    if isinstance(value, list | tuple | set | frozenset):
        return tuple(_freeze(v) for v in value)
    return (type(value).__name__, repr(value))


def _snapshot(value: Any) -> Any:
    """A deep copy for pydantic results, so cached and served values never alias."""
    return value.model_copy(deep=True) if hasattr(value, "model_copy") else value


def cached_report(name: str) -> Callable[[Callable[..., T]], Callable[..., T]]:
    """Cache a report function `fn(db, tenant_id, role_code, user_id, *args, **kwargs)`."""

    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @wraps(fn)
        def wrapper(
            db: Session, tenant_id: UUID, role_code: str, user_id: UUID, *args: Any, **kwargs: Any
        ) -> T:
            ttl = _ttl()
            if ttl <= 0:
                return fn(db, tenant_id, role_code, user_id, *args, **kwargs)
            key = (name, role_code, user_id, _freeze(args), _freeze(kwargs))
            hit, value = cache.get(tenant_id, key)
            if not hit:
                with cache.key_lock(tenant_id, key):
                    hit, value = cache.get(tenant_id, key)  # filled while we waited
                    if not hit:
                        result = fn(db, tenant_id, role_code, user_id, *args, **kwargs)
                        cache.put(tenant_id, key, _snapshot(result), ttl)
                        return result
            return _snapshot(value)

        return wrapper

    return decorator


# --- invalidation hooks -------------------------------------------------------


@event.listens_for(Session, "after_flush")
def _remember_touched_tenants(session: Session, _flush_context: Any) -> None:
    touched: set[UUID] = session.info.setdefault("_report_cache_tenants", set())
    for obj in (*session.new, *session.dirty, *session.deleted):
        if getattr(obj, "__tablename__", None) not in REPORT_TABLES:
            continue
        tenant_id = getattr(obj, "tenant_id", None)
        if tenant_id is None and getattr(obj, "__tablename__", None) == "tenants":
            tenant_id = obj.id
        if tenant_id is None:
            session.info["_report_cache_all"] = True
        else:
            touched.add(tenant_id)


@event.listens_for(Session, "do_orm_execute")
def _bulk_dml_invalidates_all(state: Any) -> None:
    if state.is_insert or state.is_update or state.is_delete:
        table = getattr(state.statement, "table", None)
        if table is None or getattr(table, "name", None) in REPORT_TABLES:
            state.session.info["_report_cache_all"] = True


@event.listens_for(Session, "after_commit")
def _invalidate_on_commit(session: Session) -> None:
    if session.info.pop("_report_cache_all", False):
        cache.invalidate_all()
        session.info.pop("_report_cache_tenants", None)
        return
    for tenant_id in session.info.pop("_report_cache_tenants", ()):
        cache.invalidate_tenant(tenant_id)


@event.listens_for(Session, "after_rollback")
def _forget_on_rollback(session: Session) -> None:
    session.info.pop("_report_cache_all", None)
    session.info.pop("_report_cache_tenants", None)
