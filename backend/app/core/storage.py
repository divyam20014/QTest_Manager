import abc
from pathlib import Path

from app.core.config import get_settings


class StorageBackend(abc.ABC):
    """Tier 1 / ADR-053: pluggable attachment storage (SR-6.5, SAAS-GAP-3).

    Schema-agnostic by design -- `Attachment.storage_path` stays an opaque
    reference string regardless of backend (a filesystem path for
    LocalFilesystemStorage, an `s3://bucket/key` URI for
    S3CompatibleStorage); nothing but this module interprets it.
    """

    @abc.abstractmethod
    def save(self, key: str, contents: bytes) -> str:
        """Writes `contents` under `key` and returns an opaque reference
        string to pass back into read()/delete() later."""

    @abc.abstractmethod
    def read(self, reference: str) -> bytes: ...

    @abc.abstractmethod
    def delete(self, reference: str) -> None: ...


class LocalFilesystemStorage(StorageBackend):
    """Matches today's exact on-disk behavior (ADR-012) -- the default, so
    existing dev/test/prod deployments need no migration."""

    def __init__(self, base_dir: str) -> None:
        self.base_dir = Path(base_dir)

    def save(self, key: str, contents: bytes) -> str:
        path = self.base_dir / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(contents)
        return str(path)

    def read(self, reference: str) -> bytes:
        return Path(reference).read_bytes()

    def delete(self, reference: str) -> None:
        Path(reference).unlink(missing_ok=True)


_S3_PREFIX = "s3://"


class S3CompatibleStorage(StorageBackend):
    """Works against AWS S3 or any S3-compatible endpoint (MinIO, DO
    Spaces, ...) via a configurable `endpoint_url`."""

    def __init__(
        self,
        bucket: str,
        *,
        endpoint_url: str | None = None,
        region: str | None = None,
        access_key: str | None = None,
        secret_key: str | None = None,
    ) -> None:
        import boto3  # local import: optional dependency, only needed for this backend

        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            region_name=region or None,
            aws_access_key_id=access_key or None,
            aws_secret_access_key=secret_key or None,
        )

    def _reference(self, key: str) -> str:
        return f"{_S3_PREFIX}{self._bucket}/{key}"

    def _parse(self, reference: str) -> tuple[str, str]:
        if not reference.startswith(_S3_PREFIX):
            raise ValueError(f"Not an s3:// reference: {reference}")
        bucket, _, key = reference[len(_S3_PREFIX) :].partition("/")
        return bucket, key

    def save(self, key: str, contents: bytes) -> str:
        self._client.put_object(Bucket=self._bucket, Key=key, Body=contents)
        return self._reference(key)

    def read(self, reference: str) -> bytes:
        bucket, key = self._parse(reference)
        obj = self._client.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()  # type: ignore[no-any-return]

    def delete(self, reference: str) -> None:
        bucket, key = self._parse(reference)
        self._client.delete_object(Bucket=bucket, Key=key)


def get_storage_backend() -> StorageBackend:
    settings = get_settings()
    if settings.storage_backend == "s3":
        return S3CompatibleStorage(
            bucket=settings.s3_bucket,
            endpoint_url=settings.s3_endpoint_url,
            region=settings.s3_region,
            access_key=settings.s3_access_key_id,
            secret_key=settings.s3_secret_access_key,
        )
    return LocalFilesystemStorage(settings.attachments_dir)
