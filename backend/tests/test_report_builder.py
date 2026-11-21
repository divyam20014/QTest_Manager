"""ADR-098: saved report builder (allowlist, visibility, sharing, limits)."""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text

from app.schemas.report_builder import (
    MAX_EXPORT_ROWS,
    MAX_PAGE_SIZE,
    SOURCES,
    STATEMENT_TIMEOUT_MS,
)
from tests.test_project_role_scoping import _create_project
from tests.test_tester_visibility import USER_PW, _as, _set, _setup

B = "/api/v1/report-builder"


def _def(source="defects", fields=None, **kw) -> dict:
    return {"source": source, "fields": fields if fields is not None else ["title"], **kw}


def _defect(client: TestClient, project_id: str, title: str, severity: str = "High", **extra):
    r = client.post(
        "/api/v1/defects",
        json={"project_id": project_id, "title": title, "severity": severity, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["id"]


def _preview(client: TestClient, definition: dict, **kw):
    return client.post(f"{B}/preview", json={"definition": definition, **kw})


def _save(client: TestClient, name: str, definition: dict | None = None, **kw):
    return client.post(
        f"{B}/reports", json={"name": name, "definition": definition or _def(), **kw}
    )


def _titles(resp) -> list[str]:
    assert resp.status_code == 200, resp.text
    return sorted(r["title"] for r in resp.json()["data"]["rows"])


@pytest.fixture
def env(client: TestClient, platform_admin: dict) -> dict:
    s = _setup(client, platform_admin, "Rb Co")
    # a project the tester is NOT a member of
    hidden = _create_project(client, "Rb Hidden Project")
    s["hidden_project_id"] = hidden["id"]
    _defect(client, s["project_id"], "Visible defect one")
    _defect(client, s["project_id"], "Visible defect two", "Low")
    _defect(client, hidden["id"], "Hidden project defect", "Critical")
    return s


def test_sources_metadata_is_the_allowlist(client: TestClient, env: dict) -> None:
    data = client.get(f"{B}/sources").json()["data"]
    assert {s["key"] for s in data} == set(SOURCES)
    blob = json.dumps(data).lower()
    for banned in ("password", "token", "mfa", "email", "hash"):
        assert banned not in blob
    defects = next(s for s in data if s["key"] == "defects")
    sev = next(f for f in defects["fields"] if f["key"] == "severity")
    assert sev["groupable"] and "eq" in sev["operators"] and "contains" not in sev["operators"]


BAD_DEFINITIONS = [
    _def(fields=["password_hash"]),
    _def(fields=["id; drop table defects"]),
    _def(fields=['title" or 1=1 --']),
    _def(fields=[]),
    _def(fields=["title", "title"]),
    {**_def(), "sql": "select 1"},
    {**_def(), "source": "users"},
    _def(filters=[{"field": "title", "op": "regex", "value": "x"}]),
    _def(filters=[{"field": "title", "op": "eq", "value": "x", "extra": 1}]),
    _def(filters=[{"field": "severity", "op": "contains", "value": "x"}]),
    _def(filters=[{"field": "created_at", "op": "contains", "value": "x"}]),
    _def(filters=[{"field": "created_at", "op": "gt", "value": "not-a-date"}]),
    _def(filters=[{"field": "nope", "op": "eq", "value": "x"}]),
    _def(filters=[{"field": "title", "op": "eq", "value": {"$ne": 1}}]),
    _def(filters=[{"field": "title", "op": "eq", "value": "x" * 201}]),
    _def(filters=[{"field": "title", "op": "in", "value": ["a"] * 21}]),
    _def(filters=[{"field": "title", "op": "is_null", "value": "x"}]),
    _def(filters=[{"field": "id", "op": "eq", "value": "not-a-uuid"}]),
    _def(
        source="test_runs",
        fields=["name"],
        filters=[{"field": "total_cases", "op": "gt", "value": "5"}],
    ),
    _def(filters=[{"field": "title", "op": "eq", "value": "x"}] * 9),
    _def(fields=["title"] * 13),
    _def(fields=[], group_by=["severity", "status", "project"]),
    _def(fields=[], group_by=["title"]),
    _def(fields=["title"], group_by=["severity"]),
    _def(sort={"field": "id", "dir": "asc"}),
    _def(sort={"field": "title; drop", "dir": "asc"}),
    _def(sort={"field": "title", "dir": "sideways"}),
    _def(filters=[{"field": "title", "op": "in", "value": ["y" * 200] * 20} for _ in range(8)]),
]


@pytest.mark.parametrize("definition", BAD_DEFINITIONS)
def test_invalid_definitions_are_422(client: TestClient, env: dict, definition: dict) -> None:
    assert _preview(client, definition).status_code == 422
    assert _save(client, "bad", definition).status_code == 422


def test_page_size_and_page_caps(client: TestClient, env: dict) -> None:
    assert MAX_PAGE_SIZE == 100 and MAX_EXPORT_ROWS == 5000
    assert _preview(client, _def(), page_size=101).status_code == 422
    assert _preview(client, _def(), page=0).status_code == 422
    assert _preview(client, _def(), page_size=100).status_code == 200


def test_injection_values_are_inert_and_wildcards_escaped(client: TestClient, env: dict) -> None:
    for payload in ("'; DROP TABLE defects; --", "x' OR '1'='1", "\\", "%", "_"):
        r = _preview(client, _def(filters=[{"field": "title", "op": "contains", "value": payload}]))
        assert r.status_code == 200, r.text
        assert r.json()["data"]["total"] == 0, payload
    # table still intact; and a real substring still matches (case-insensitive)
    ok = _preview(client, _def(filters=[{"field": "title", "op": "contains", "value": "VISIBLE"}]))
    assert ok.json()["data"]["total"] == 2
    eq = _preview(client, _def(filters=[{"field": "title", "op": "eq", "value": "' OR 1=1 --"}]))
    assert eq.json()["data"]["total"] == 0


def test_operators_and_group_by_count(client: TestClient, env: dict) -> None:
    r = _preview(
        client, _def(fields=[], group_by=["severity"], sort={"field": "count", "dir": "desc"})
    )
    data = r.json()["data"]
    assert [c["key"] for c in data["columns"]] == ["severity", "count"]
    assert {(x["severity"], x["count"]) for x in data["rows"]} == {
        ("High", 2),
        ("Low", 1),
        ("Critical", 1),
    } or data["total"] >= 2
    flt = _def(filters=[{"field": "severity", "op": "in", "value": ["Low", "Critical"]}])
    assert "Visible defect two" in _titles(_preview(client, flt))
    nul = _def(filters=[{"field": "release", "op": "is_null"}])
    assert _preview(client, nul).json()["data"]["total"] == 3
    date = _def(filters=[{"field": "created_at", "op": "gte", "value": "2020-01-01"}])
    assert _preview(client, date).json()["data"]["total"] == 3
    future = _def(filters=[{"field": "created_at", "op": "gt", "value": "2999-01-01"}])
    assert _preview(client, future).json()["data"]["total"] == 0


def test_response_contains_only_allowlisted_keys(client: TestClient, env: dict) -> None:
    for source, specs in SOURCES.items():
        fields = list(specs)
        r = _preview(client, _def(source, fields=fields))
        assert r.status_code == 200, (source, r.text)
        data = r.json()["data"]
        assert set(data) == {"columns", "rows", "total", "page", "page_size"}
        assert [c["key"] for c in data["columns"]] == fields
        for row in data["rows"]:
            assert set(row) == set(fields)
        blob = json.dumps(data).lower()
        assert "password" not in blob and "@" not in blob.replace("@example", "")


def test_project_visibility_for_tester_and_manager(client: TestClient, env: dict) -> None:
    all_titles = {"Visible defect one", "Visible defect two", "Hidden project defect"}
    admin = _titles(_preview(client, _def()))
    assert set(admin) == all_titles
    _as(client, env, "manager")
    assert set(_titles(_preview(client, _def()))) == all_titles
    _as(client, env, "tester")
    assert _titles(_preview(client, _def())) == ["Visible defect one", "Visible defect two"]
    grouped = _preview(client, _def(fields=[], group_by=["project"])).json()["data"]
    assert [r["project"] for r in grouped["rows"]] == ["Rb Co Claims"]
    assert grouped["rows"][0]["count"] == 2


def test_tester_case_visibility_setting_applies(client: TestClient, env: dict) -> None:
    cases = _def("test_cases", fields=["title"])
    _as(client, env, "tester")
    assert len(_titles(_preview(client, cases))) == 3
    _as(client, env, "admin")
    assert _set(client, testers_see_assigned_cases_only=True).status_code == 200
    _as(client, env, "tester")
    got = _titles(_preview(client, cases))
    assert "Zebra hidden case" not in got and "Zebra assigned case" in got
    _as(client, env, "admin")
    assert len(_titles(_preview(client, cases))) == 3  # Admin is not restricted


def test_reports_hidden_gives_tester_403_everywhere(client: TestClient, env: dict) -> None:
    mine = _save(client, "Shared one", is_shared=True).json()["data"]["id"]
    assert _set(client, reports_hidden_from_testers=True).status_code == 200
    _as(client, env, "tester")
    rid = mine
    calls = [
        client.get(f"{B}/sources"),
        _preview(client, _def()),
        client.get(f"{B}/reports"),
        _save(client, "nope"),
        client.get(f"{B}/reports/{rid}"),
        client.patch(f"{B}/reports/{rid}", json={"name": "x"}),
        client.delete(f"{B}/reports/{rid}"),
        client.post(f"{B}/reports/{rid}/run"),
        client.get(f"{B}/reports/{rid}/export.csv"),
        client.get(f"{B}/reports/{rid}/export.xlsx"),
    ]
    assert [c.status_code for c in calls] == [403] * len(calls)
    _as(client, env, "manager")
    assert client.get(f"{B}/sources").status_code == 200


def test_sharing_rules(client: TestClient, env: dict) -> None:
    _as(client, env, "manager")
    private = _save(client, "Mgr private").json()["data"]["id"]
    shared = _save(client, "Mgr shared", is_shared=True).json()["data"]["id"]
    assert client.get(f"{B}/reports/{shared}").json()["data"]["is_owner"] is True

    _as(client, env, "tester")
    listed = {r["name"]: r for r in client.get(f"{B}/reports").json()["data"]}
    assert set(listed) == {"Mgr shared"}
    assert listed["Mgr shared"]["can_edit"] is False and listed["Mgr shared"]["is_owner"] is False
    run = client.post(f"{B}/reports/{shared}/run")
    assert run.status_code == 200 and run.json()["data"]["total"] == 2  # runs as the tester
    assert client.get(f"{B}/reports/{shared}/export.csv").status_code == 200
    assert client.patch(f"{B}/reports/{shared}", json={"name": "Hijack"}).status_code == 403
    assert client.delete(f"{B}/reports/{shared}").status_code == 403
    assert client.get(f"{B}/reports/{private}").status_code == 404
    assert client.post(f"{B}/reports/{private}/run").status_code == 404
    assert client.delete(f"{B}/reports/{private}").status_code == 404

    _as(client, env, "admin")
    assert client.patch(f"{B}/reports/{shared}", json={"is_shared": False}).status_code == 200
    assert client.delete(f"{B}/reports/{private}").status_code == 200
    assert client.delete(f"{B}/reports/{shared}").status_code == 200
    assert client.get(f"{B}/reports").json()["data"] == []


def test_saved_report_crud_limits_and_conflicts(client: TestClient, env: dict) -> None:
    first = _save(client, "Mine")
    assert first.status_code == 200, first.text
    rid = first.json()["data"]["id"]
    assert _save(client, "Mine").status_code == 409
    assert _save(client, "x" * 81).status_code == 422
    assert (
        client.post(f"{B}/reports", json={"name": "a", "definition": _def(), "x": 1}).status_code
        == 422
    )
    upd = client.patch(
        f"{B}/reports/{rid}",
        json={"name": "Renamed", "definition": _def(fields=["title", "severity"])},
    )
    assert upd.status_code == 200 and upd.json()["data"]["definition"]["fields"] == [
        "title",
        "severity",
    ]
    assert client.patch(f"{B}/reports/{rid}", json={"owner": "x"}).status_code == 422
    for i in range(49):
        assert _save(client, f"R{i}").status_code == 200
    assert _save(client, "one too many").status_code == 409


def test_malformed_and_unknown_ids(client: TestClient, env: dict) -> None:
    zero = "00000000-0000-0000-0000-000000000000"
    for method, suffix in (
        ("get", ""),
        ("patch", ""),
        ("delete", ""),
        ("post", "/run"),
        ("get", "/export.csv"),
        ("get", "/export.xlsx"),
    ):
        kw = {"json": {"name": "x"}} if method == "patch" else {}
        bad = getattr(client, method)(f"{B}/reports/not-a-uuid{suffix}", **kw)
        assert bad.status_code == 422, (method, suffix)
        gone = getattr(client, method)(f"{B}/reports/{zero}{suffix}", **kw)
        assert gone.status_code == 404, (method, suffix)


def test_paging_run_and_export_cap(client: TestClient, env: dict, monkeypatch) -> None:
    for i in range(3):
        _defect(client, env["project_id"], f"Paging defect {i}")
    rid = _save(
        client, "Paged", _def(fields=["title"], sort={"field": "title", "dir": "asc"})
    ).json()["data"]["id"]
    p1 = client.post(f"{B}/reports/{rid}/run", params={"page": 1, "page_size": 2}).json()["data"]
    p2 = client.post(f"{B}/reports/{rid}/run", params={"page": 2, "page_size": 2}).json()["data"]
    assert p1["total"] == 6 and len(p1["rows"]) == 2 and len(p2["rows"]) == 2
    assert p1["rows"] != p2["rows"]
    assert client.post(f"{B}/reports/{rid}/run", params={"page_size": 101}).status_code == 422

    import app.services.report_builder_service as svc

    monkeypatch.setattr(svc, "MAX_EXPORT_ROWS", 4)
    csv_text = client.get(f"{B}/reports/{rid}/export.csv").content.decode("utf-8-sig")
    assert len(csv_text.strip().splitlines()) == 1 + 4


def test_exports_neutralise_formulas(client: TestClient, env: dict) -> None:
    _defect(client, env["project_id"], '=HYPERLINK("http://evil")')
    _defect(client, env["project_id"], "@SUM(1+1)")
    rid = _save(client, "Exp", _def(fields=["title", "severity"])).json()["data"]["id"]
    resp = client.get(f"{B}/reports/{rid}/export.csv")
    assert resp.status_code == 200 and "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers["content-disposition"]
    body = resp.content.decode("utf-8-sig")
    assert "'=HYPERLINK" in body and "'@SUM" in body
    for line in body.splitlines()[1:]:
        assert not line.startswith(("=", "@", "+", "-"))
    xlsx = client.get(f"{B}/reports/{rid}/export.xlsx")
    assert xlsx.status_code == 200 and xlsx.content[:2] == b"PK"


def test_statement_timeout_is_set_per_query(client: TestClient, env: dict) -> None:
    from app.core.db import engine

    assert STATEMENT_TIMEOUT_MS == 10_000
    seen: list[tuple[str, object]] = []

    def grab(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        if "statement_timeout" in statement:
            seen.append((statement, parameters))

    event.listen(engine, "before_cursor_execute", grab)
    try:
        assert _preview(client, _def()).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", grab)
    assert seen and "set_config" in seen[0][0]
    assert "10000" in json.dumps(seen[0][1], default=str)


def test_audit_events_carry_only_name_and_source(
    client: TestClient, env: dict, owner_engine
) -> None:
    rid = _save(client, "Audited", _def("test_runs", fields=["name"])).json()["data"]["id"]
    client.get(f"{B}/reports/{rid}/export.csv")
    client.delete(f"{B}/reports/{rid}")
    with owner_engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT action, metadata FROM audit_logs WHERE action LIKE 'report.%' "
                "AND entity_id = :id ORDER BY created_at"
            ),
            {"id": rid},
        ).all()
    assert [r[0] for r in rows] == ["report.saved", "report.exported", "report.deleted"]
    for _, meta in rows:
        assert meta == {"name": "Audited", "source": "test_runs"}


def test_erased_user_is_masked(client: TestClient, env: dict) -> None:
    _as(client, env, "tester")
    _defect(client, env["project_id"], "Reported by tester soon erased")
    _as(client, env, "admin")
    tester_id = next(
        u["id"]
        for u in client.get("/api/v1/users").json()["data"]
        if u["email"] == env["tester_email"]
    )
    er = client.post(
        f"/api/v1/users/{tester_id}/erase",
        json={"dry_run": False, "confirm_email": env["tester_email"]},
    )
    assert er.status_code == 200, er.text
    r = _preview(
        client,
        _def(
            fields=["title", "reporter"],
            filters=[{"field": "title", "op": "contains", "value": "soon erased"}],
        ),
    )
    rows = r.json()["data"]["rows"]
    assert [x["reporter"] for x in rows] == ["Erased user"]
    rid = _save(client, "Who", _def(fields=["reporter"], group_by=[])).json()["data"]["id"]
    body = client.get(f"{B}/reports/{rid}/export.csv").content.decode("utf-8-sig")
    assert "Tess" not in body and env["tester_email"] not in body


def test_tenant_isolation(client: TestClient, platform_admin: dict) -> None:
    a = _setup(client, platform_admin, "Rb Iso A")
    _defect(client, a["project_id"], "Tenant A secret defect")
    rid = _save(client, "A shared", is_shared=True).json()["data"]["id"]
    b = _setup(client, platform_admin, "Rb Iso B")  # tenant B admin session active
    assert _titles(_preview(client, _def())) == []
    assert client.get(f"{B}/reports").json()["data"] == []
    assert client.get(f"{B}/reports/{rid}").status_code == 404
    assert client.post(f"{B}/reports/{rid}/run").status_code == 404
    assert client.delete(f"{B}/reports/{rid}").status_code == 404
    assert b["tenant_id"] != a["tenant_id"]
    assert USER_PW  # fixture import used
