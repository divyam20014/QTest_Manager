#!/usr/bin/env python3
"""Run the browser tests against a throwaway stack of their own (ADR-134).

    npm run test:e2e                         (from frontend/)
    npm run test:e2e -- e2e/smoke.spec.ts    any Playwright arguments work
    python scripts/run_e2e.py --list         (from the repository root)

It creates the database `qtesthub_e2e` in the running Postgres container, migrates it,
seeds the test platform admin, starts an API (port 8100), a background worker and a web
server (port 5175) from the working tree, runs Playwright, then stops everything and
drops the database. The development app and its database are never used.

Needs: `docker compose up -d db`, and the backend and frontend dependencies installed.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

# The only database this script creates or drops.
DATABASE = "qtesthub_e2e"
API_PORT = 8100
WEB_PORT = 5175
WEB_URL = f"http://localhost:{WEB_PORT}"
API_URL = f"http://localhost:{API_PORT}/api/v1"

# Matches e2e/fixtures.ts. Dev/test values: the seed script refuses them in production.
PLATFORM_ADMIN = (
    "owner@qtesthub.local",
    "Sup3rSecret1Pass",
    "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
)

# A test may not name the development stack, even in a file this run does not select.
FORBIDDEN_IN_TESTS = re.compile(
    r"(localhost|127\.0\.0\.1):(5173|8000)\b|'-d',\s*'qtesthub'"
)


class Stop(Exception):
    """A reason not to run, in words for the person running it."""


def say(message: str) -> None:
    print(f"[e2e] {message}", flush=True)


# --- checks before anything is created -------------------------------------------------------


def check_tests_name_no_real_address() -> None:
    found = []
    for path in sorted((FRONTEND / "e2e").glob("*.ts")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith(("//", "*", "/*")):
                continue
            # target.ts names the forbidden ports in order to refuse them.
            if path.name != "target.ts" and FORBIDDEN_IN_TESTS.search(line):
                found.append(f"  {path.relative_to(ROOT)}:{number}: {line.strip()}")
    if found:
        raise Stop(
            "These tests name the real app or database. Use WEB_URL, API_BASE_URL or DB_NAME "
            "from e2e/target.ts instead:\n" + "\n".join(found)
        )


def check_ports_are_free() -> None:
    for port in (API_PORT, WEB_PORT):
        for host in ("127.0.0.1", "::1"):
            family = socket.AF_INET6 if ":" in host else socket.AF_INET
            with socket.socket(family, socket.SOCK_STREAM) as probe:
                probe.settimeout(1)
                if probe.connect_ex((host, port)) == 0:
                    raise Stop(
                        f"Port {port} is already in use. Tests never reuse a running server, "
                        "because it might be connected to real data. Stop it and run again."
                    )


def compose(*args: str, **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["docker", "compose", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
        **kwargs,
    )


def database_logins() -> dict[str, tuple[str, str]]:
    """The user names and passwords the development stack really uses.

    Migrations SET the passwords of the shared database roles, which belong to the whole
    Postgres server. Migrating the test database with any other password would stop the
    real app from signing in to its own database, so the real ones are reused. They are
    read from Docker's resolved configuration and never printed.
    """
    done = compose("config", "--format", "json")
    if done.returncode != 0:
        raise Stop("`docker compose config` failed. Is Docker running?\n" + done.stderr)
    env = json.loads(done.stdout)["services"]["api"]["environment"]
    logins = {}
    for key in ("DATABASE_URL", "MIGRATION_DATABASE_URL", "IDENTIFY_DATABASE_URL"):
        parts = urlsplit(env[key])
        logins[key] = (parts.username or "", parts.password or "")
    logins["APP_DB_PASSWORD"] = ("", env.get("APP_DB_PASSWORD", "qtesthub_app"))
    logins["IDENTIFY_DB_PASSWORD"] = (
        "",
        env.get("IDENTIFY_DB_PASSWORD", "qtesthub_identify"),
    )
    return logins


def psql(owner: str, statement: str) -> None:
    done = compose(
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        owner,
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-qc",
        statement,
    )
    if done.returncode != 0:
        raise Stop(
            "The database command failed. Is it running (`docker compose up -d db`)?\n"
            + done.stderr
        )


def drop_database(owner: str) -> None:
    psql(owner, f"drop database if exists {DATABASE} with (force)")


def stack_environment(
    logins: dict[str, tuple[str, str]], attachments: str
) -> dict[str, str]:
    def url(key: str) -> str:
        user, password = logins[key]
        return f"postgresql+psycopg://{quote(user)}:{quote(password, safe='')}@localhost:5432/{DATABASE}"

    env = dict(os.environ)
    # Everything that could reach outside this computer is set explicitly, so that neither
    # the shell nor a local .env file can switch it on.
    env.update(
        {
            "DATABASE_URL": url("DATABASE_URL"),
            "MIGRATION_DATABASE_URL": url("MIGRATION_DATABASE_URL"),
            "IDENTIFY_DATABASE_URL": url("IDENTIFY_DATABASE_URL"),
            "APP_DB_PASSWORD": logins["APP_DB_PASSWORD"][1],
            "IDENTIFY_DB_PASSWORD": logins["IDENTIFY_DB_PASSWORD"][1],
            "ENVIRONMENT": "development",
            "MFA_DELIVERY_MODE": "simulated",
            "NOTIFICATION_EMAIL_DELIVERY_MODE": "simulated",
            "SMTP_HOST": "",
            "SENTRY_DSN": "",
            "STORAGE_BACKEND": "local",
            "ATTACHMENTS_DIR": attachments,
            "AI_CREDENTIAL_ENCRYPTION_KEY": base64.urlsafe_b64encode(
                os.urandom(32)
            ).decode(),
            "AUTH_RATE_LIMIT_MULTIPLIER": "10",
            "CORS_ALLOW_ORIGINS": json.dumps(
                [WEB_URL, f"http://127.0.0.1:{WEB_PORT}"]
            ),
            "REPORT_CACHE_TTL_SECONDS": "20",
            "DB_STATEMENT_TIMEOUT_MS": "30000",
            "REQUIRE_ACTUAL_RESULT_ON_FAIL": "true",
        }
    )
    return env


# --- the stack -------------------------------------------------------------------------------


def start(
    name: str,
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    logs: Path,
    running: list,
):
    log = open(logs / f"{name}.log", "w", encoding="utf-8")  # noqa: SIM115 -- closed in stop()
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        # Its own group, so that its child processes can be stopped with it.
        start_new_session=os.name != "nt",
    )
    running.append((name, process, log))
    return process


def stop(running: list) -> None:
    for _name, process, log in reversed(running):
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    capture_output=True,
                )
            else:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
        log.close()


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def wait_for(what: str, url: str, running: list, logs: Path, seconds: int = 240) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        for name, process, _log in running:
            if process.poll() is not None:
                raise Stop(f"The {name} stopped while starting. See {logs / (name + '.log')}")
        try:
            fetch(url)
            return
        except OSError:
            time.sleep(2)
    raise Stop(f"The {what} did not answer within {seconds} seconds. See {logs}")


def check_web_calls_the_test_api() -> None:
    """The web server must have been built with the test API's address: without it, the app
    falls back to the development API on port 8000."""
    module = fetch(f"{WEB_URL}/src/api/client.ts")
    configured = re.search(r'"VITE_API_BASE_URL"\s*:\s*"([^"]*)"', module)
    if configured is None or configured.group(1) != API_URL:
        raise Stop("The test web server is not pointed at the test API. Nothing was run.")


def main(arguments: list[str]) -> int:
    node = shutil.which("node")
    playwright = FRONTEND / "node_modules" / "@playwright" / "test" / "cli.js"
    vite = FRONTEND / "node_modules" / "vite" / "bin" / "vite.js"
    if not node or not playwright.exists() or not vite.exists():
        raise Stop("Install the frontend dependencies first: npm install (in frontend/).")

    check_tests_name_no_real_address()
    check_ports_are_free()
    logins = database_logins()
    owner = logins["MIGRATION_DATABASE_URL"][0]

    logs = Path(tempfile.mkdtemp(prefix="qtesthub-e2e-logs-"))
    attachments = tempfile.mkdtemp(prefix="qtesthub-e2e-files-")
    env = stack_environment(logins, attachments)
    running: list = []
    created = False
    try:
        say(f"creating the throwaway database {DATABASE}")
        drop_database(owner)  # left over from a run that was killed
        psql(owner, f"create database {DATABASE} owner {owner}")
        created = True
        for step, command in (
            ("migrating", ["-m", "alembic", "upgrade", "head"]),
            (
                "adding the test platform admin",
                [
                    "-m",
                    "scripts.seed_platform_admin",
                    "--email",
                    PLATFORM_ADMIN[0],
                    "--password",
                    PLATFORM_ADMIN[1],
                    "--totp-secret",
                    PLATFORM_ADMIN[2],
                ],
            ),
        ):
            say(step)
            done = subprocess.run(
                [sys.executable, *command],
                cwd=BACKEND,
                env=env,
                text=True,
                capture_output=True,
            )
            if done.returncode != 0:
                raise Stop(f"{step} failed:\n{done.stdout}\n{done.stderr}")

        say(f"starting the API, worker and web server (logs: {logs})")
        start(
            "api",
            # One process: the tests run one at a time, and extra uvicorn workers are not
            # reliable on Windows.
            [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(API_PORT)],
            BACKEND,
            env,
            logs,
            running,
        )
        start(
            "worker",
            [sys.executable, "-m", "app.worker"],
            BACKEND,
            {**env, "DB_STATEMENT_TIMEOUT_MS": "0"},
            logs,
            running,
        )
        start(
            "web",
            # 127.0.0.1 answers to both loopback names in a browser.
            [node, str(vite), "--port", str(WEB_PORT), "--strictPort", "--host", "127.0.0.1"],
            FRONTEND,
            {**os.environ, "VITE_API_BASE_URL": API_URL},
            logs,
            running,
        )
        wait_for("API", f"{API_URL}/ready", running, logs)
        wait_for("web server", f"{WEB_URL}/", running, logs)
        check_web_calls_the_test_api()

        say("running Playwright")
        tests = subprocess.run(
            [node, str(playwright), "test", *arguments],
            cwd=FRONTEND,
            env={
                **os.environ,
                "E2E_WEB_URL": WEB_URL,
                "E2E_API_BASE_URL": API_URL,
                "E2E_DB_NAME": DATABASE,
                "E2E_ISOLATED_STACK": "1",
            },
        )
        if tests.returncode != 0:
            say(f"tests failed; server logs are in {logs}")
        return tests.returncode
    finally:
        say("stopping the servers and dropping the database")
        stop(running)
        if created:
            try:
                drop_database(owner)
            except Stop as problem:
                say(f"could not drop {DATABASE}; the next run will: {problem}")
        shutil.rmtree(attachments, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except Stop as reason:
        say(str(reason))
        sys.exit(2)
    except KeyboardInterrupt:
        sys.exit(130)
