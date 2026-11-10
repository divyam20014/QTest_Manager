FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Tier 0 / ADR-052: run the app as a non-root user. The container still
# starts as root (default) so the entrypoint can fix up ownership of
# /data/attachments -- a mounted volume whose on-disk ownership from a
# previous (pre-hardening) run may still be root -- before dropping
# privileges via `su`, rather than baking a chown in at build time that a
# runtime volume mount would shadow anyway.
RUN addgroup --system app && adduser --system --ingroup app app \
    && mkdir -p /data/attachments

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --retries=10 --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/ready')" || exit 1

CMD ["sh", "-c", "chown -R app:app /data/attachments && su app -s /bin/sh -c 'alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000'"]
