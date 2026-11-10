"""Tier 1 / ADR-053: pluggable attachment storage (SR-6.5, SAAS-GAP-3).
Both backends implement the same StorageBackend contract and are
exercised here against the same behavioral assertions; LocalFilesystemStorage
still does real disk I/O (not mocked)."""

import pytest

from app.core.storage import (
    LocalFilesystemStorage,
    S3CompatibleStorage,
    StorageBackend,
    get_storage_backend,
)


@pytest.fixture
def local_backend(tmp_path) -> StorageBackend:
    return LocalFilesystemStorage(str(tmp_path))


@pytest.fixture
def s3_backend():
    moto = pytest.importorskip("moto")
    with moto.mock_aws():
        import boto3

        boto3.client("s3", region_name="us-east-1").create_bucket(
            Bucket="qtesthub-test-attachments"
        )
        yield S3CompatibleStorage(bucket="qtesthub-test-attachments", region="us-east-1")


@pytest.fixture(params=["local", "s3"])
def backend(request, local_backend, s3_backend) -> StorageBackend:
    return local_backend if request.param == "local" else s3_backend


def test_save_then_read_round_trips(backend: StorageBackend) -> None:
    reference = backend.save("tenant-a/test_case/case-1/evidence.png", b"fake-png-bytes")
    assert backend.read(reference) == b"fake-png-bytes"


def test_delete_removes_the_object(backend: StorageBackend) -> None:
    reference = backend.save("tenant-a/test_case/case-1/evidence.png", b"fake-png-bytes")
    backend.delete(reference)
    with pytest.raises(Exception):  # noqa: B017 -- backend-specific not-found error
        backend.read(reference)


def test_delete_is_idempotent_for_local_backend(local_backend: StorageBackend) -> None:
    # Local backend's delete uses missing_ok=True (matches the pre-existing
    # unlink(missing_ok=True) behavior) -- calling it twice must not raise.
    reference = local_backend.save("tenant-a/defect/d-1/log.txt", b"log contents")
    local_backend.delete(reference)
    local_backend.delete(reference)


def test_get_storage_backend_defaults_to_local() -> None:
    backend = get_storage_backend()
    assert isinstance(backend, LocalFilesystemStorage)
