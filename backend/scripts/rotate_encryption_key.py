"""Re-encrypt every Fernet-encrypted column under the PRIMARY key (ADR-084).

AI_CREDENTIAL_ENCRYPTION_KEY is a comma-separated list: the first key encrypts,
every key decrypts. To rotate, deploy ``NEW,OLD``, run this script, then deploy
``NEW`` only. Encrypted columns covered:

  * platform_admins.mfa_secret_encrypted   (Platform Admin TOTP secrets)
  * tenants.ai_api_key_encrypted           (tenant AI provider API keys)
  * sso_configs.client_secret_encrypted    (tenant OIDC client secrets; RLS)

Modes (mutually exclusive):
  (default)  dry run: counts per column - total, already on the primary key,
             needing rotation, undecryptable. Writes nothing.
  --apply    re-encrypts every value that is not already on the primary key, in
             ONE transaction (all or nothing). Refuses to start if ANY value
             cannot be decrypted by any configured key. Idempotent.
  --verify   checks every value decrypts with the PRIMARY key alone (run this
             before dropping the old key). Exit 1 if any does not.

Tenant-scoped tables (sso_configs) are read and written per tenant under the
normal ``app.current_tenant`` RLS variable, exactly like the application does;
RLS is never disabled or bypassed. Connects with MIGRATION_DATABASE_URL (falls
back to DATABASE_URL). Never prints a key, a secret or a ciphertext - counts only.

Usage (from the api container):
    python -m scripts.rotate_encryption_key            # dry run
    python -m scripts.rotate_encryption_key --apply
    python -m scripts.rotate_encryption_key --verify

Exit codes: 0 ok, 1 verify failed / work remains, 2 refused (bad key list or
undecryptable values).
"""

import argparse
import sys
from dataclasses import dataclass

from cryptography.fernet import InvalidToken, MultiFernet
from sqlalchemy import Connection, create_engine, text

from app.core.config import get_settings
from app.core.crypto import CredentialEncryptionError, parse_keys

# (table, column, tenant_scoped)
TARGETS: tuple[tuple[str, str, bool], ...] = (
    ("platform_admins", "mfa_secret_encrypted", False),
    ("tenants", "ai_api_key_encrypted", False),
    ("sso_configs", "client_secret_encrypted", True),
)


@dataclass
class ColumnResult:
    table: str
    column: str
    total: int = 0  # non-null values
    on_primary: int = 0
    needs_rotation: int = 0
    undecryptable: int = 0
    rotated: int = 0

    @property
    def label(self) -> str:
        return f"{self.table}.{self.column}"


def _classify(token: str, primary: MultiFernet, every: MultiFernet) -> str:
    """'primary' | 'old' | 'bad'. Never raises, never exposes the value."""
    data = token.encode()
    try:
        primary.decrypt(data)
        return "primary"
    except InvalidToken:
        pass
    try:
        every.decrypt(data)
        return "old"
    except InvalidToken:
        return "bad"


def _set_tenant(conn: Connection, tenant_id: str) -> None:
    conn.execute(text("SELECT set_config('app.current_tenant', :t, true)"), {"t": str(tenant_id)})


def _rows(conn: Connection, table: str, column: str, tenant_scoped: bool, lock: bool):
    """Yields (id, tenant_id_or_None, value) for every non-null value."""
    suffix = " FOR UPDATE" if lock else ""
    if not tenant_scoped:
        query = text(f"SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL{suffix}")
        for row in conn.execute(query).all():
            yield row[0], None, row[1]
        return
    tenant_ids = [r[0] for r in conn.execute(text("SELECT id FROM tenants ORDER BY id")).all()]
    for tenant_id in tenant_ids:
        _set_tenant(conn, tenant_id)
        query = text(f"SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL{suffix}")
        for row in conn.execute(query).all():
            yield row[0], tenant_id, row[1]


def scan(conn: Connection, raw_keys: str, apply: bool = False) -> list[ColumnResult]:
    """Classifies every encrypted value; with apply=True and nothing undecryptable,
    re-encrypts the ones not on the primary key (caller owns the transaction)."""
    fernets = parse_keys(raw_keys)
    primary = MultiFernet([fernets[0]])
    every = MultiFernet(fernets)

    results: list[ColumnResult] = []
    pending: list[tuple[ColumnResult, object, object, str, str]] = []
    for table, column, scoped in TARGETS:
        result = ColumnResult(table, column)
        results.append(result)
        for row_id, tenant_id, value in _rows(conn, table, column, scoped, lock=apply):
            result.total += 1
            kind = _classify(value, primary, every)
            if kind == "primary":
                result.on_primary += 1
            elif kind == "old":
                result.needs_rotation += 1
                # MultiFernet.rotate on a copy: proves it rotates, keeps the original.
                rotated = every.rotate(value.encode()).decode()
                pending.append((result, row_id, tenant_id, value, rotated))
            else:
                result.undecryptable += 1

    if apply and not any(r.undecryptable for r in results):
        for result, row_id, tenant_id, old, new in pending:
            if tenant_id is not None:
                _set_tenant(conn, str(tenant_id))
            table, column = result.table, result.column
            updated = conn.execute(
                text(f"UPDATE {table} SET {column} = :new WHERE id = :id AND {column} = :old"),
                {"new": new, "id": row_id, "old": old},
            )
            if updated.rowcount != 1:
                raise RuntimeError(f"{result.label}: a row changed during rotation; rolled back")
            if _classify(new, primary, every) != "primary":
                raise RuntimeError(f"{result.label}: re-encrypted value failed self-check")
            result.rotated += 1
    return results


def _report(results: list[ColumnResult]) -> None:
    print(f"{'column':45} {'values':>7} {'primary':>8} {'to rotate':>10} {'undecryptable':>14}")
    for r in results:
        print(
            f"{r.label:45} {r.total:>7} {r.on_primary:>8} {r.needs_rotation:>10} "
            f"{r.undecryptable:>14}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true", help="re-encrypt (default is a dry run)")
    group.add_argument(
        "--verify", action="store_true", help="check all values decrypt with the primary key alone"
    )
    args = parser.parse_args(argv)

    settings = get_settings()
    raw = settings.ai_credential_encryption_key
    try:
        keys = parse_keys(raw)
    except CredentialEncryptionError as exc:
        print(f"Refusing to run: {exc}", file=sys.stderr)
        return 2
    print(f"Configured keys: {len(keys)} (first is the primary/encrypting key)")

    engine = create_engine(settings.migration_database_url or settings.database_url)
    try:
        with engine.begin() as conn:
            results = scan(conn, raw, apply=False)
            _report(results)
            bad = sum(r.undecryptable for r in results)
            todo = sum(r.needs_rotation for r in results)
            if bad:
                print(
                    f"Refusing: {bad} value(s) cannot be decrypted by any configured key. "
                    "Add the missing old key to AI_CREDENTIAL_ENCRYPTION_KEY and retry. "
                    "Nothing was changed."
                )
                return 2
            if args.verify:
                if todo:
                    print(f"VERIFY FAILED: {todo} value(s) still need the old key. Do not drop it.")
                    return 1
                print("VERIFY OK: every value decrypts with the primary key alone.")
                return 0
            if not args.apply:
                print(f"Dry run - nothing changed. {todo} value(s) would be re-encrypted.")
                return 0
            if not todo:
                print("Nothing to rotate; every value is already on the primary key.")
                return 0
            applied = scan(conn, raw, apply=True)
            rotated = sum(r.rotated for r in applied)
            print(f"Re-encrypted {rotated} value(s) under the primary key (committed).")
    finally:
        engine.dispose()
    print("Next: run with --verify, then deploy with only the new key.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
