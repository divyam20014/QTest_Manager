# QTestHub — Backup & Restore Guide

Two independent things need backing up, and they must be backed up
**together, on the same schedule** — a database row referencing an
attachment, with no corresponding file in the attachments backup (or vice
versa), is a dangling reference. This is cosmetic (a broken download link),
not silent data corruption, but it's still worth keeping in sync.

## 1. Database backup

```bash
POSTGRES_HOST=... POSTGRES_USER=... PGPASSWORD=... \
  ./deployment/scripts/backup_database.sh
```
Produces `backups/qtesthub_<UTC-timestamp>.dump` (pg_dump custom format,
compressed). No credentials appear in the filename or in any output this
script prints. `BACKUP_RETENTION_DAYS` (default 14) prunes older dumps
automatically on every run.

## 2. File (attachment) backup

Only relevant when `STORAGE_BACKEND=local` (the default). If you've switched
to `STORAGE_BACKEND=s3`, your object storage provider's own backup/versioning
features are the equivalent of this step — a local tar of an empty/unused
directory backs up nothing.

```bash
ATTACHMENTS_DIR=/path/to/attachments/volume \
  ./deployment/scripts/backup_files.sh
```
Produces `backups/attachments_<UTC-timestamp>.tar.gz`.

## 3. Schedule and retention

Run both scripts back-to-back, on the same schedule (e.g. a nightly cron job
or your platform's scheduled-job feature), so the pair is point-in-time
consistent. Ship the resulting files to durable, off-host storage (object
storage, a separate backup server) — these scripts only write locally;
getting the output off the host is a separate, environment-specific step
this repo doesn't automate (it depends entirely on what off-host storage
you actually have).

**Recovery point objective (RPO) and recovery time objective (RTO) are
configurable targets you choose, not guarantees this repo provides.** A
nightly schedule gives you an RPO of "up to 24 hours of data since the last
backup" — tighten it (e.g. hourly) if your tolerance for data loss is lower.
RTO depends entirely on how fast you can provision a replacement environment
and run the restore procedure below — time it in a real drill, don't guess.

## 4. Restore procedure

```bash
POSTGRES_HOST=... POSTGRES_USER=... PGPASSWORD=... \
  ./deployment/scripts/restore_database.sh backups/qtesthub_<timestamp>.dump
```
This is **destructive** — it drops and recreates the target database. It
requires you to type the target database's name back as an explicit
confirmation before proceeding; there is no `--force`/non-interactive bypass,
by design (never silently overwrite a production database). After restoring,
run `alembic upgrade head` (`docs/deployment/DATABASE_MIGRATION.md`) to
confirm the restored schema matches what the currently-running application
code expects.

For attachments, extract the tar back into the attachments volume's path:
```bash
tar -xzf backups/attachments_<timestamp>.tar.gz -C /path/to/attachments/volume
```

## 5. Recovery verification — a real test restore, not "the file exists"

```bash
POSTGRES_HOST=... POSTGRES_USER=... PGPASSWORD=... \
  ./deployment/scripts/verify_backup.sh backups/qtesthub_<timestamp>.dump
```
This restores the dump into a **disposable, temporary database** on the
same server (never the real application database), runs a real query
against it (`SELECT count(*) FROM tenants`), reports the result, and drops
the temporary database. A backup that merely exists on disk is not evidence
it's restorable — a truncated transfer, wrong `pg_dump` version, or silent
corruption only shows up when you actually try to restore it. Run this
periodically against your real backups, not only when you actually need a
restore.

## 6. Consistency between database records and stored files

If the database backup and the file backup were taken even slightly out of
sync (e.g. a file uploaded after the DB dump but before the file-system tar),
a restored environment can have either: a DB row pointing at an attachment
file that isn't in the restored tar (download fails, nothing else affected),
or an orphaned file in the tar with no referencing DB row (harmless, just
unreferenced disk space). Taking both backups back-to-back (§3) minimizes
the window where this can happen; it does not eliminate it entirely for a
system under continuous write load, which is an inherent property of backing
up two independent stores rather than a single transactional source — not
something a backup script can fix on its own.
