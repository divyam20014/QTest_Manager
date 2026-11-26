"""ADR-120 (22-field standard, step 6): standard import (template, preview, commit) and
export for test cases and defects.

Templates (22 headers, instructions, dropdown validation), csv / xlsx reading and its
limits, preview without writing, token scoping and expiry, atomic commit, skip-invalid,
id preservation, the async job above the threshold, permissions, RLS, and the export
guarantees (all 22 fields, columns=, ids=, filters, formula guard, truncation, round trip).
"""

import csv
import io
import zipfile
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.import_columns import DEFECT_COLUMNS, TEST_CASE_COLUMNS
from app.services import export_common, import_export_service, job_service
from tests.conftest import STRICT_CREATE_HEADER
from tests.test_defect_standard import (
    as_user,
    make_defect,
    set_status,
    user_id_of,
)
from tests.test_project_role_scoping import _bootstrap_tenant, _login_and_verify
from tests.test_test_case_standard import (
    ADMIN_PW,
    _custom_role_user,
    add_user,
    create_case,
    setup_env,
)

TC = "/api/v1/test-cases"
DF = "/api/v1/defects"
TC_H = {c.key: c.header for c in TEST_CASE_COLUMNS}
DF_H = {c.key: c.header for c in DEFECT_COLUMNS}
HEADERS = {"test_case": TC_H, "defect": DF_H}
BASE = {"test_case": TC, "defect": DF}
STRICT = {STRICT_CREATE_HEADER: "1"}


# --- builders -----------------------------------------------------------------------------------


def tc_row(i: int = 1, **over) -> dict:
    row = {
        "title": f"Imported test case {i:04d}",
        "module": "Claims/Total Loss",
        "priority": "High",
        "preconditions": "User exists",
        "test_data": "id=1",
        "steps": "1. Open the page | url=/ | The page opens\n2. Click Save | | It is saved",
        "expected_result": "Everything works",
        "test_type": "Functional",
        "severity": "Major",
        "automation_status": "Manual",
        "requirement_ref": "US-1",
    }
    row.update(over)
    return row


def df_row(i: int = 1, **over) -> dict:
    row = {
        "title": f"Imported defect {i:04d}",
        "description": "Something is broken",
        "repro_steps": "1. Open the page | | The page opens\n2. Click Save",
        "expected_result": "It saves",
        "actual_result": "It does not",
        "environment": "QA",
        "severity": "Major",
        "priority": "High",
    }
    row.update(over)
    return row


def csv_bytes(kind: str, rows: list[dict], drop: tuple[str, ...] = ()) -> bytes:
    headers = HEADERS[kind]
    keys: list[str] = []
    for row in rows:
        for key in row:
            if key not in keys and key not in drop:
                keys.append(key)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([headers[k] for k in keys])
    for row in rows:
        writer.writerow([row.get(k, "") for k in keys])
    return buffer.getvalue().encode("utf-8")


def xlsx_bytes(kind: str, rows: list[dict]) -> bytes:
    headers = HEADERS[kind]
    keys: list[str] = []
    for row in rows:
        for key in row:
            if key not in keys:
                keys.append(key)
    workbook = Workbook()
    sheet = workbook.active
    sheet.append([headers[k] for k in keys])
    for row in rows:
        sheet.append([row.get(k, "") for k in keys])
    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def preview(client, kind, project_id, content, name="import.csv", **kw):
    return client.post(
        f"{BASE[kind]}/import/preview",
        data={"project_id": project_id},
        files={"file": (name, io.BytesIO(content), "application/octet-stream")},
        **kw,
    )


def do_preview(client, kind, project_id, content, name="import.csv") -> dict:
    response = preview(client, kind, project_id, content, name)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def commit(client, kind, token, mode="all_or_nothing"):
    return client.post(f"{BASE[kind]}/import/commit", json={"token": token, "mode": mode})


def count_rows(owner_engine, table: str) -> int:
    with owner_engine.begin() as conn:
        return conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()


def messages(data: dict, severity: str | None = None) -> list[str]:
    return [
        f"{i['row_number']}|{i['column']}|{i['message']}"
        for i in data["issues"]
        if severity is None or i["severity"] == severity
    ]


def cases_of(client, project_id: str) -> list[dict]:
    response = client.get(f"/api/v1/projects/{project_id}/test-cases", params={"page_size": 100})
    return response.json()["data"]["items"]


def defects_of(client, project_id: str) -> list[dict]:
    response = client.get(DF, params={"project_id": project_id, "page_size": 100})
    return response.json()["data"]["items"]


# --- templates ----------------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["test_case", "defect"])
def test_template_has_all_22_headers_instructions_and_dropdowns(
    client, platform_admin, kind
) -> None:
    setup_env(client, platform_admin)
    catalog = client.get(f"{BASE[kind]}/columns").json()["data"]["fields"]
    labels = [f["label"] for f in catalog]
    assert len(labels) == 22

    xlsx = client.get(f"{BASE[kind]}/import-template.xlsx")
    assert xlsx.status_code == 200
    assert "attachment" in xlsx.headers["content-disposition"]
    workbook = load_workbook(io.BytesIO(xlsx.content))
    assert workbook.sheetnames[1:] == ["Instructions", "Allowed values"]
    data = workbook.worksheets[0]
    header = [c.value for c in data[1]]
    assert header[:22] == labels
    assert any(c.value for c in data[2])  # the example row
    assert data.freeze_panes == "A2"
    validations = data.data_validations.dataValidation
    assert validations and all(v.type == "list" for v in validations)
    covered = {str(v.sqref) for v in validations}
    priority_col = chr(ord("A") + header.index("Priority"))
    assert any(s.startswith(priority_col) for s in covered)
    allowed = workbook["Allowed values"]
    values = {c.value for row in allowed.iter_rows() for c in row if c.value}
    assert {"High", "Medium", "Low"} <= values
    if kind == "test_case":
        assert "Candidate for Automation" in values and "End-to-End" in values
        assert "Critical" in values  # severity list
    else:
        assert {"New", "In Progress", "Closed", "Won't Fix"} <= values
    instructions = workbook["Instructions"]
    flat = "\n".join(str(c.value) for row in instructions.iter_rows() for c in row if c.value)
    assert "N. action | test data | expected result" in flat
    assert "Required" in flat
    # Mandatory columns are marked (amber header), read-only ones greyed.
    mandatory = [c for c in (TEST_CASE_COLUMNS if kind == "test_case" else DEFECT_COLUMNS)]
    title_cell = data.cell(1, header.index("Title") + 1)
    assert title_cell.fill.fgColor.rgb.endswith("FDE68A")
    assert any(c.mandatory for c in mandatory)

    template_csv = client.get(f"{BASE[kind]}/import-template.csv")
    assert template_csv.status_code == 200
    rows = list(csv.reader(io.StringIO(template_csv.text)))
    assert rows[0][:22] == labels and len(rows) == 2


def test_template_permissions(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    nobody = as_user(
        client, env, _custom_role_user(client, env, "Nobody", ["project.view.all"], member=False)
    )
    for kind in ("test_case", "defect"):
        for ext in ("xlsx", "csv"):
            assert nobody.get(f"{BASE[kind]}/import-template.{ext}").status_code == 403
            assert client.get(f"{BASE[kind]}/import-template.{ext}").status_code == 200
    tester = add_user(client, env, "tester")
    assert tester
    tester_client = as_user(client, env, f"tester@{env['slug']}.example.com")
    assert tester_client.get(f"{TC}/import-template.csv").status_code == 200


# --- preview: valid files, no writes ------------------------------------------------------------


def test_preview_valid_csv_writes_nothing_and_commit_creates(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    rows = [
        tc_row(i, module="Claims/Total Loss/Settlement" if i == 1 else "Billing") for i in (1, 2)
    ]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    assert data["totals"] == {"rows": 2, "valid": 2, "warnings": 0, "errors": 0, "importable": 2}
    assert data["file_type"] == "csv" and data["token"] and data["expires_at"]
    assert set(data["modules_to_create"]) == {
        "Claims/Total Loss",
        "Claims/Total Loss/Settlement",
        "Billing",
    }
    assert data["rows"][0]["status"] == "valid" and data["rows"][0]["data"]["steps"] == "2 steps"
    # Nothing written: no cases, no new modules, the counter did not move.
    assert cases_of(client, env["project_id"]) == []
    modules = client.get(f"/api/v1/projects/{env['project_id']}/modules").json()["data"]
    assert [m["name"] for m in modules] == ["Claims"]
    assert count_rows(owner_engine, "test_case_versions") == 0

    result = commit(client, "test_case", data["token"])
    assert result.status_code == 200, result.text
    summary = result.json()["data"]
    assert summary["created"] == 2 and summary["skipped"] == 0 and summary["failed"] == 0
    assert summary["async"] is False and summary["modules_created"] == 3
    assert [m["display_id"] for m in summary["ids"]] == ["TC_000001", "TC_000002"]
    cases = cases_of(client, env["project_id"])
    assert {c["display_id"] for c in cases} == {"TC_000001", "TC_000002"}
    detail = client.get(f"{TC}/{summary['ids'][0]['id']}").json()["data"]
    assert [s["action"] for s in detail["steps"]] == ["Open the page", "Click Save"]
    assert (
        detail["steps"][0]["test_data"] == "url=/"
        and detail["steps"][1]["expected"] == "It is saved"
    )
    assert detail["test_type"] == "Functional" and detail["requirement_ref"] == "US-1"
    assert detail["status"] == "draft" and detail["expected_result"] == "Everything works"
    # Audit: one summary event and one compact event per created case.
    with owner_engine.begin() as conn:
        created = conn.execute(
            text("SELECT count(*) FROM audit_logs WHERE action = 'testcase.created'")
        ).scalar_one()
        batch = conn.execute(
            text("SELECT metadata FROM audit_logs WHERE action = 'testcase.bulk_imported'")
        ).scalar_one()
    assert created == 2 and batch["created_count"] == 2 and batch["source"] == "standard"
    assert client.get("/api/v1/audit-logs/verify-chain").json()["data"]["valid"] is True
    # A second commit of the same token is refused.
    assert commit(client, "test_case", data["token"]).status_code == 409


def test_valid_xlsx_defect_import(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    rows = [df_row(1, module="Core/Auth", labels="Login; UI"), df_row(2)]
    data = do_preview(
        client, "defect", env["project_id"], xlsx_bytes("defect", rows), "defects.xlsx"
    )
    assert data["file_type"] == "xlsx" and data["totals"]["errors"] == 0
    assert "Core/Auth" in data["modules_to_create"]
    summary = commit(client, "defect", data["token"]).json()["data"]
    assert summary["created"] == 2
    defects = defects_of(client, env["project_id"])
    assert {d["display_id"] for d in defects} == {"BUG_000001", "BUG_000002"}
    first = client.get(f"{DF}/{summary['ids'][0]['id']}").json()["data"]
    assert first["labels"] == ["login", "ui"] and first["status"] == "New"
    assert first["reported_by_name"] == "Admin A" and first["created_at"]
    assert [s["action"] for s in first["repro_steps"]] == ["Open the page", "Click Save"]
    assert first["repro_steps"][0]["expected_result"] == "The page opens"


def test_headers_are_matched_loosely_and_legacy_headers_work(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    content = (
        b"title;MODULE;Sub Module;priority;Prerequisite;test_data;Steps;expected result;Status\n"
        b'"Legacy header case";Claims;Total Loss;High;"Logged in";"x=1";'
        b'"Open|Opens|url=/;Click|Clicked";"All good";Draft\n'
    )
    data = do_preview(client, "test_case", env["project_id"], content)
    assert data["totals"]["errors"] == 0, messages(data)
    assert "Claims/Total Loss" in data["modules_to_create"]
    summary = commit(client, "test_case", data["token"]).json()["data"]
    detail = client.get(f"{TC}/{summary['ids'][0]['id']}").json()["data"]
    assert detail["steps"][0]["test_data"] == "url=/" and detail["preconditions"] == "Logged in"


# --- preview: file-level problems ----------------------------------------------------------------


def test_missing_mandatory_columns_is_one_clear_error(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    content = csv_bytes("test_case", [tc_row()], drop=("steps", "expected_result", "module"))
    response = preview(client, "test_case", env["project_id"], content)
    assert response.status_code == 422
    message = response.json()["error"]["message"]
    assert "Module" in message and "Test Steps" in message and "Expected Result" in message
    assert "Title" not in message
    fields = response.json()["error"]["fields"]
    assert set(fields) == {"Module", "Test Steps", "Expected Result"}


def test_unknown_columns_are_warned_and_read_only_columns_ignored(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    content = (
        csv_bytes("test_case", [tc_row(execution_status="Pass", actual_result="x")])
        .decode()
        .replace("Test Type", "Colour Of Sky")
        .encode()
    )
    data = do_preview(client, "test_case", env["project_id"], content)
    assert data["totals"]["errors"] == 0
    assert data["unknown_columns"] == ["Colour Of Sky"]
    assert set(data["ignored_columns"]) == {"Execution Status", "Actual Result"}
    assert any("Unknown column" in w for w in data["file_warnings"])


@pytest.mark.parametrize(
    ("name", "content", "needle"),
    [
        ("data.txt", b"a,b\n1,2\n", ".xlsx or .csv"),
        ("data.csv", b"", "empty"),
        ("data.xls", b"x", ".xls"),
        ("data.xlsm", b"x", "Macro"),
        ("data.xlsx", b"this is not a zip", "not a valid .xlsx"),
        ("data.csv", b"a,b\x00\n1,2\n", "not a text"),
        ("data.csv", "Title\né".encode("latin-1"), "UTF-8"),
        (
            "data.csv",
            b"Title,Module,Priority,Preconditions,Test Data,Test Steps,Expected Result\n",
            "no data rows",
        ),
    ],
)
def test_bad_files_are_rejected(client, platform_admin, name, content, needle) -> None:
    env = setup_env(client, platform_admin)
    response = preview(client, "test_case", env["project_id"], content, name)
    assert response.status_code == 422, response.text
    assert needle.lower() in response.json()["error"]["message"].lower()


def _zip_with(entries: dict[str, bytes]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return out.getvalue()


def test_oversize_macro_formula_and_zip_bomb_files(client, platform_admin, monkeypatch) -> None:
    env = setup_env(client, platform_admin)
    pid = env["project_id"]
    good = xlsx_bytes("test_case", [tc_row()])

    # Oversize (limit lowered for the test).
    monkeypatch.setattr(get_settings(), "import_file_max_bytes", 1000)
    big = preview(client, "test_case", pid, b"Title\n" + b"x" * 2000)
    assert big.status_code == 422 and "limit" in big.json()["error"]["message"]
    monkeypatch.undo()

    # A macro part inside an otherwise valid workbook.
    with zipfile.ZipFile(io.BytesIO(good)) as archive:
        entries = {n: archive.read(n) for n in archive.namelist()}
    macro = _zip_with({**entries, "xl/vbaProject.bin": b"\x00\x01"})
    response = preview(client, "test_case", pid, macro, "m.xlsx")
    assert response.status_code == 422 and "macros" in response.json()["error"]["message"]

    # An external link part.
    linked = _zip_with({**entries, "xl/externalLinks/externalLink1.xml": b"<x/>"})
    response = preview(client, "test_case", pid, linked, "l.xlsx")
    assert response.status_code == 422 and "links" in response.json()["error"]["message"]

    # A formula cell (written with openpyxl: a string starting with '=' is a formula).
    workbook = Workbook()
    sheet = workbook.active
    sheet.append([TC_H["title"], TC_H["module"]])
    sheet.append(["=1+1", "Claims"])
    out = io.BytesIO()
    workbook.save(out)
    response = preview(client, "test_case", pid, out.getvalue(), "f.xlsx")
    assert response.status_code == 422 and "formulas" in response.json()["error"]["message"]

    # A decompression bomb: 30 MB of zeros that compress to a few KB.
    bomb = _zip_with({**entries, "xl/worksheets/sheet9.xml": b"\x00" * (30 * 1024 * 1024)})
    assert len(bomb) < 200_000
    response = preview(client, "test_case", pid, bomb, "b.xlsx")
    assert response.status_code == 422 and "bomb" in response.json()["error"]["message"]

    # Uncompressed size limit.
    monkeypatch.setattr(get_settings(), "import_zip_max_uncompressed_bytes", 10)
    response = preview(client, "test_case", pid, good, "z.xlsx")
    assert response.status_code == 422 and "expands" in response.json()["error"]["message"]
    monkeypatch.undo()

    # Row limit.
    monkeypatch.setattr(get_settings(), "import_max_rows", 2)
    rows = [tc_row(i) for i in range(1, 5)]
    response = preview(client, "test_case", pid, csv_bytes("test_case", rows))
    assert response.status_code == 422 and "rows" in response.json()["error"]["message"]


# --- preview: row validation --------------------------------------------------------------------


def test_row_validation_messages_for_test_cases(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    rows = [
        tc_row(1, priority="hgih"),  # near miss -> suggestion
        tc_row(2, priority="high"),  # case-insensitive match is fine
        tc_row(3, test_type="Nonsense", severity="Huge", automation_status="Sometimes"),
        tc_row(4, title="abc", steps="", expected_result=""),
        tc_row(5, steps="1. only an action"),
        tc_row(6, assignee="nobody@example.com"),
        tc_row(7, module="A//B"),
        tc_row(8, steps="1. a | b | c | d"),
    ]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    by_row = {r["row_number"]: r for r in data["rows"]}
    first = " ".join(i["message"] for i in by_row[2]["errors"])
    assert "Did you mean 'High'" in first
    assert by_row[3]["status"] == "valid"
    assert data["rows"][1]["data"]["priority"] == "High"  # canonical value shown
    types = " ".join(i["message"] for i in by_row[4]["errors"])
    assert "Test Type" in types and "Severity" in types and "Automation Status" in types
    errs4 = " ".join(i["message"] for i in by_row[5]["errors"])
    assert "at least 5" in errs4 and "Expected Result is required" in errs4
    assert "At least one step" in errs4
    assert "no expected result" in " ".join(i["message"] for i in by_row[6]["errors"])
    assert "not an active user" in " ".join(i["message"] for i in by_row[7]["errors"])
    assert "empty part" in " ".join(i["message"] for i in by_row[8]["errors"])
    assert "more than three parts" in " ".join(i["message"] for i in by_row[9]["errors"])
    assert data["totals"]["errors"] == 7 and data["totals"]["valid"] == 1
    assert {i["column"] for i in data["issues"]} >= {"Priority", "Test Type", "Title"}
    # The rows endpoint filters and pages the stored result.
    page = client.get(
        f"{TC}/import/preview/{data['token']}/rows", params={"status": "error", "limit": 3}
    ).json()["data"]
    assert page["total"] == 7 and len(page["rows"]) == 3


def test_assignee_by_email_is_accepted(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    email = f"tester@{env['slug']}.example.com"
    data = do_preview(
        client, "test_case", env["project_id"], csv_bytes("test_case", [tc_row(assignee=email)])
    )
    assert data["totals"]["errors"] == 0
    summary = commit(client, "test_case", data["token"]).json()["data"]
    detail = client.get(f"{TC}/{summary['ids'][0]['id']}").json()["data"]
    assert detail["assignee_id"] == user_id_of(client, email)


def test_duplicate_ids_titles_and_malformed_ids(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    existing = create_case(client, env, "Already in the project")
    rows = [
        tc_row(1, display_id="TC_000100"),
        tc_row(2, display_id="TC_000100"),  # duplicate inside the file -> error
        tc_row(3, display_id="tc-7"),  # malformed -> warning, assigned
        tc_row(4, display_id=existing["display_id"]),  # exists -> warning, assigned
        tc_row(5, title="Already in the project"),  # duplicate title -> warning
        tc_row(6, title="Same title twice"),
        tc_row(7, title="Same title twice"),
    ]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    by_row = {r["row_number"]: r for r in data["rows"]}
    assert by_row[3]["status"] == "error" and "Duplicate id" in by_row[3]["errors"][0]["message"]
    assert (
        by_row[4]["status"] == "warning" and "not a valid id" in by_row[4]["warnings"][0]["message"]
    )
    assert (
        by_row[5]["status"] == "warning" and "already used" in by_row[5]["warnings"][0]["message"]
    )
    assert (
        by_row[6]["status"] == "warning" and "already exists" in by_row[6]["warnings"][0]["message"]
    )
    assert by_row[8]["status"] == "warning" and "row 7" in by_row[8]["warnings"][0]["message"]
    assert data["totals"] == {"rows": 7, "valid": 2, "warnings": 4, "errors": 1, "importable": 6}


def test_defect_row_validation(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, "Linkable case")
    rows = [
        df_row(1, linked_issues=f"{case['display_id']}; TC_999999"),
        df_row(2, status="Closed"),  # Closed needs a resolution
        df_row(3, status="Closed", resolution="Duplicate"),
        df_row(4, status="Fixed"),  # resolution defaults to Fixed
        df_row(5, status="New", resolution="Fixed"),  # New must not carry one
        df_row(6, status="Rejected", resolution="Won't Fix"),
        df_row(7, severity="Blocker", priority="Urgent"),
        df_row(8, status="Nope"),
        df_row(9, assignee="ghost@example.com"),
        df_row(10, labels="x" * 41),
        df_row(11, root_cause="cosmic_rays"),
        df_row(12, linked_issues=case["display_id"], labels="a; b", root_cause="code_defect"),
    ]
    data = do_preview(client, "defect", env["project_id"], csv_bytes("defect", rows))
    by_row = {r["row_number"]: r for r in data["rows"]}

    def msgs(row: int) -> str:
        return " ".join(i["message"] for i in by_row[row]["errors"])

    assert "TC_999999" in msgs(2) and "does not exist" in msgs(2)
    assert "resolution is required" in msgs(3)
    assert by_row[4]["status"] == "valid"
    assert by_row[5]["status"] == "valid" and by_row[5]["data"]["resolution"] == "Fixed"
    assert "not valid for status" in msgs(6)  # New must not carry a resolution
    assert by_row[7]["status"] == "valid"
    assert "Severity" in msgs(8) and "Priority" in msgs(8)
    assert "Status" in msgs(9)
    assert "not an active user" in msgs(10)
    assert "at most 40" in msgs(11)
    assert "Root Cause" in msgs(12)
    assert (
        by_row[13]["status"] == "valid"
        and by_row[13]["data"]["linked_issues"] == case["display_id"]
    )


def test_defect_status_permissions_and_assignee_rules(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester")
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    rows = [
        df_row(1),
        df_row(2, status="Assigned"),
        df_row(3, status="Closed", resolution="Fixed"),
        df_row(4, assignee=f"tester@{env['slug']}.example.com"),
    ]
    data = do_preview(tester, "defect", env["project_id"], csv_bytes("defect", rows))
    by_row = {r["row_number"]: r for r in data["rows"]}
    assert by_row[2]["status"] == "valid" and by_row[3]["status"] == "valid"
    assert "not allowed to import defects in status 'Closed'" in by_row[4]["errors"][0]["message"]
    assert "not allowed to assign" in by_row[5]["errors"][0]["message"]
    # The Admin may do both.
    admin_data = do_preview(client, "defect", env["project_id"], csv_bytes("defect", rows))
    assert admin_data["totals"]["errors"] == 0


# --- commit modes, atomicity, ids ---------------------------------------------------------------


def test_all_or_nothing_blocks_and_skip_invalid_imports_the_rest(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    rows = [tc_row(1), tc_row(2, priority="Bogus"), tc_row(3, module="New/Area")]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    assert data["totals"]["errors"] == 1
    blocked = commit(client, "test_case", data["token"])
    assert (
        blocked.status_code == 422 and "nothing was imported" in blocked.json()["error"]["message"]
    )
    assert cases_of(client, env["project_id"]) == []
    assert count_rows(owner_engine, "test_modules") == 1  # only 'Claims'

    skipped = commit(client, "test_case", data["token"], "skip_invalid")
    assert skipped.status_code == 200, skipped.text
    summary = skipped.json()["data"]
    assert summary["created"] == 2 and summary["skipped"] == 1 and summary["failed"] == 0
    assert summary["errors"] and summary["errors"][0]["row_number"] == 3
    assert len(cases_of(client, env["project_id"])) == 2
    # A module only the skipped row would have created is not created.
    assert (
        count_rows(owner_engine, "test_modules") == 1 + 3
    )  # Claims, Claims/Total Loss, New, New/Area


def test_a_failure_mid_commit_inserts_nothing(
    client, platform_admin, owner_engine, monkeypatch
) -> None:
    env = setup_env(client, platform_admin)
    rows = [tc_row(i) for i in (1, 2, 3)]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    real = import_export_service._insert_chunks
    calls = {"n": 0}

    def flaky(db, model, batch):
        calls["n"] += 1
        if calls["n"] == 2:  # after the cases, while inserting the versions
            raise RuntimeError("injected failure")
        return real(db, model, batch)

    monkeypatch.setattr(import_export_service, "_insert_chunks", flaky)
    with pytest.raises(RuntimeError, match="injected"):
        commit(client, "test_case", data["token"])
    monkeypatch.undo()
    assert count_rows(owner_engine, "test_cases") == 0
    assert count_rows(owner_engine, "test_case_version_steps") == 0
    assert count_rows(owner_engine, "test_modules") == 1  # the new modules rolled back too
    with owner_engine.begin() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM audit_logs WHERE action LIKE '%bulk_imported'")
            ).scalar_one()
            == 0
        )
    # The counter rolled back with it and the token is still usable.
    retry = commit(client, "test_case", data["token"])
    assert retry.status_code == 200 and retry.json()["data"]["ids"][0]["display_id"] == "TC_000001"


def test_ids_are_preserved_and_the_counter_moves_past_them(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    rows = [
        tc_row(1, display_id="TC_000500"),
        tc_row(2),
        tc_row(3, display_id="TC_000007"),
    ]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    assert data["totals"]["errors"] == 0
    summary = commit(client, "test_case", data["token"]).json()["data"]
    ids = {m["row_number"]: m["display_id"] for m in summary["ids"]}
    assert ids[2] == "TC_000500" and ids[4] == "TC_000007"
    assert ids[3] == "TC_000501"  # assigned after the highest kept id
    fresh = create_case(client, env, "Created after the import")
    assert fresh["display_id"] == "TC_000502"
    # Same for defects.
    drows = [df_row(1, display_id="BUG_000040"), df_row(2)]
    d = do_preview(client, "defect", env["project_id"], csv_bytes("defect", drows))
    dsummary = commit(client, "defect", d["token"]).json()["data"]
    assert [m["display_id"] for m in dsummary["ids"]] == ["BUG_000040", "BUG_000041"]
    assert make_defect(client, env)["display_id"] == "BUG_000042"


def test_defect_commit_writes_status_resolution_links_and_modules(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    case_a = create_case(client, env, "Case A to link")
    case_b = create_case(client, env, "Case B to link")
    rows = [
        df_row(
            1,
            status="Closed",
            resolution="Duplicate",
            linked_issues=f"{case_a['display_id']}; {case_b['display_id']}",
            module="Deep/Er/Still",
            build_found="1.2.3",
            fix_version="1.3",
            root_cause="code_defect",
            root_cause_notes="A note",
            preconditions="Logged in",
        )
    ]
    data = do_preview(client, "defect", env["project_id"], csv_bytes("defect", rows))
    assert data["totals"]["errors"] == 0, messages(data)
    summary = commit(client, "defect", data["token"]).json()["data"]
    d = client.get(f"{DF}/{summary['ids'][0]['id']}").json()["data"]
    assert d["status"] == "Closed" and d["resolution"] == "Duplicate" and d["closed_at"]
    assert {c["display_id"] for c in d["linked_test_cases"]} == {
        case_a["display_id"],
        case_b["display_id"],
    }
    assert d["build_found"] == "1.2.3" and d["fix_version"] == "1.3"
    assert d["root_cause"] == "code_defect" and d["preconditions"] == "Logged in"
    assert d["module_name"] == "Still"
    assert client.get("/api/v1/audit-logs/verify-chain").json()["data"]["valid"] is True


# --- tokens: scoping, expiry, tenants -----------------------------------------------------------


def test_token_is_scoped_to_user_tenant_kind_and_expiry(
    client, platform_admin, owner_engine
) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "manager")
    other_user = as_user(client, env, f"manager@{env['slug']}.example.com")
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", [tc_row()]))
    token = data["token"]
    # Another user of the same tenant: not found.
    assert commit(other_user, "test_case", token).status_code == 404
    assert other_user.get(f"{TC}/import/preview/{token}/rows").status_code == 404
    # The wrong kind.
    assert commit(client, "defect", token).status_code == 404
    # Another tenant.
    other_tenant = TestClient(client.app)
    boot = _bootstrap_tenant(other_tenant, platform_admin, "Beta Corp")
    _login_and_verify(other_tenant, boot["tenant"]["id"], "admin@betacorp.example.com", ADMIN_PW)
    assert commit(other_tenant, "test_case", token).status_code == 404
    # Garbage and unknown tokens.
    assert commit(client, "test_case", "not-a-token").status_code == 404
    assert commit(client, "test_case", str(uuid4())).status_code == 404
    # A bad mode.
    assert (
        client.post(f"{TC}/import/commit", json={"token": token, "mode": "yolo"}).status_code == 422
    )
    # Expiry.
    with owner_engine.begin() as conn:
        conn.execute(text("UPDATE import_sessions SET expires_at = now() - interval '1 minute'"))
    expired = commit(client, "test_case", token)
    assert expired.status_code == 404 and "expired" in expired.json()["error"]["message"]
    # Expired sessions are purged by the next preview.
    do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", [tc_row(2)]))
    assert count_rows(owner_engine, "import_sessions") == 1


def test_project_must_exist_and_testers_must_be_assigned(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    add_user(client, env, "tester", project_member=False)
    tester = as_user(client, env, f"tester@{env['slug']}.example.com")
    content = csv_bytes("test_case", [tc_row()])
    assert preview(tester, "test_case", env["project_id"], content).status_code == 403
    assert preview(client, "test_case", str(uuid4()), content).status_code == 404
    assert (
        preview(tester, "defect", env["project_id"], csv_bytes("defect", [df_row()])).status_code
        == 403
    )


def test_permission_matrix_for_preview_and_commit(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    tc_importer = as_user(
        client, env, _custom_role_user(client, env, "TC Importer", ["testcase.bulk_import_export"])
    )
    tc_creator = as_user(
        client, env, _custom_role_user(client, env, "TC Creator", ["testcase.create"])
    )
    df_importer = as_user(
        client, env, _custom_role_user(client, env, "DF Importer", ["defect.import"])
    )
    df_creator = as_user(
        client, env, _custom_role_user(client, env, "DF Creator", ["defect.create"])
    )
    tc = csv_bytes("test_case", [tc_row()])
    df = csv_bytes("defect", [df_row()])
    for who in (tc_importer, tc_creator):
        data = do_preview(who, "test_case", env["project_id"], tc)
        assert commit(who, "test_case", data["token"]).status_code == 200
        assert preview(who, "defect", env["project_id"], df).status_code == 403
    for who in (df_importer, df_creator):
        data = do_preview(who, "defect", env["project_id"], df)
        assert commit(who, "defect", data["token"]).status_code == 200
        assert preview(who, "test_case", env["project_id"], tc).status_code == 403
    # A holder of the other module's code gets nothing from this module's endpoints.
    for outsider, kind in ((tc_importer, "defect"), (df_importer, "test_case")):
        assert commit(outsider, kind, str(uuid4())).status_code == 403
        assert outsider.get(f"{BASE[kind]}/import/preview/{uuid4()}/rows").status_code == 403
        assert outsider.get(f"{BASE[kind]}/import/status/{uuid4()}").status_code == 403


def test_tenant_isolation_of_projects_and_data(client, platform_admin) -> None:
    env = setup_env(client, platform_admin, "Alpha Corp")
    other = TestClient(client.app)
    boot = _bootstrap_tenant(other, platform_admin, "Beta Corp")
    _login_and_verify(other, boot["tenant"]["id"], "admin@betacorp.example.com", ADMIN_PW)
    content = csv_bytes("test_case", [tc_row()])
    assert preview(other, "test_case", env["project_id"], content).status_code == 404
    data = do_preview(client, "test_case", env["project_id"], content)
    commit(client, "test_case", data["token"])
    assert other.get("/api/v1/test-cases").json()["data"]["total"] == 0


# --- big import through the job queue -----------------------------------------------------------


def test_large_import_runs_as_a_job(client, platform_admin, owner_engine) -> None:
    env = setup_env(client, platform_admin)
    rows = [tc_row(i, module="Bulk/Area") for i in range(1, 5001)]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    assert data["totals"]["importable"] == 5000 and data["async_commit"] is True
    queued = commit(client, "test_case", data["token"])
    assert queued.status_code == 200, queued.text
    body = queued.json()["data"]
    assert body["async"] is True and body["status"] == "queued"
    job_id = body["job_id"]
    # A queued token cannot be committed twice, and the job is only readable by its creator.
    assert commit(client, "test_case", data["token"]).status_code == 409
    assert client.get(f"{TC}/import/status/{job_id}").json()["data"]["status"] == "queued"
    assert client.get(f"{DF}/import/status/{job_id}").status_code == 404
    worker = SessionLocal()
    try:
        assert job_service.run_once(worker) is True
    finally:
        worker.close()
    status = client.get(f"{TC}/import/status/{job_id}").json()["data"]
    assert status["status"] == "succeeded", status
    assert status["result"]["created"] == 5000 and status["result"]["async"] is True
    assert count_rows(owner_engine, "test_cases") == 5000
    first = status["result"]["ids"][0]["display_id"]
    last = status["result"]["ids"][-1]["display_id"]
    assert (first, last) == ("TC_000001", "TC_005000")
    assert client.get("/api/v1/audit-logs/verify-chain").json()["data"]["valid"] is True


def test_a_failed_job_releases_the_token(client, platform_admin, owner_engine, monkeypatch) -> None:
    env = setup_env(client, platform_admin)
    monkeypatch.setattr(get_settings(), "import_async_threshold", 1)
    rows = [tc_row(i) for i in (1, 2, 3)]
    data = do_preview(client, "test_case", env["project_id"], csv_bytes("test_case", rows))
    job_id = commit(client, "test_case", data["token"]).json()["data"]["job_id"]
    real = import_export_service._insert_chunks

    def boom(db, model, batch):
        raise RuntimeError("worker failure")

    monkeypatch.setattr(import_export_service, "_insert_chunks", boom)
    worker = SessionLocal()
    try:
        job_service.run_once(worker)
    finally:
        worker.close()
    status = client.get(f"{TC}/import/status/{job_id}").json()["data"]
    assert status["status"] == "failed" and "worker failure" in status["error"]
    assert count_rows(owner_engine, "test_cases") == 0
    monkeypatch.setattr(import_export_service, "_insert_chunks", real)
    monkeypatch.setattr(get_settings(), "import_async_threshold", 2000)
    assert commit(client, "test_case", data["token"]).status_code == 200


# --- export -------------------------------------------------------------------------------------


def _csv(response) -> list[list[str]]:
    assert response.status_code == 200, response.text
    return list(csv.reader(io.StringIO(response.text)))


def test_test_case_export_columns_ids_filters_and_formula_guard(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    a = create_case(client, env, "Alpha case here", priority="High")
    b = create_case(client, env, '=HYPERLINK("http://x") case', priority="Low")
    create_case(client, env, "Gamma case here", priority="High", test_type="UI")
    base = f"/api/v1/projects/{env['project_id']}/test-cases/export"
    rows = _csv(client.get(f"{base}.csv"))
    labels = [c["label"] for c in client.get(f"{TC}/columns").json()["data"]["fields"]]
    assert rows[0][:22] == labels and len(rows) == 4
    # Selected columns, in order; ids= narrows to the selected rows.
    picked = _csv(client.get(f"{base}.csv", params={"columns": "title,display_id"}))
    assert picked[0] == ["Title", "Test Case ID"] and len(picked) == 4
    only = _csv(
        client.get(f"{base}.csv", params={"ids": f"{a['id']},{b['id']}", "columns": "title"})
    )
    assert len(only) == 3
    # Filters.
    high = _csv(client.get(f"{base}.csv", params={"priority": "High", "columns": "title"}))
    assert len(high) == 3
    ui = _csv(client.get(f"{base}.csv", params={"test_type": "UI", "columns": "title"}))
    assert [r[0] for r in ui[1:]] == ["Gamma case here"]
    # Formula-injection guard on the csv and the workbook.
    guarded = [r[0] for r in only[1:] if r[0].lstrip("'").startswith("=")]
    assert guarded and guarded[0].startswith("'=")
    workbook = load_workbook(io.BytesIO(client.get(f"{base}.xlsx").content))
    sheet = workbook.worksheets[0]
    assert sheet.freeze_panes == "A2" and sheet["A1"].font.bold
    assert sheet.column_dimensions["A"].width and sheet.max_row == 4
    titles = [sheet.cell(r, labels.index("Title") + 1).value for r in range(2, 5)]
    assert not any(str(t).startswith("=") for t in titles)
    # Bad parameters are 422.
    assert client.get(f"{base}.csv", params={"columns": "nope"}).status_code == 422
    assert client.get(f"{base}.csv", params={"ids": "xyz"}).status_code == 422


def test_export_is_cut_and_flagged_above_the_cap(client, platform_admin, monkeypatch) -> None:
    env = setup_env(client, platform_admin)
    for i in range(3):
        create_case(client, env, f"Case number {i} here")
        make_defect(client, env, title=f"Defect number {i} here")
    monkeypatch.setattr(export_common, "EXPORT_MAX_ROWS", 2)
    monkeypatch.setattr("app.services.defect_export_service.EXPORT_MAX_ROWS", 2)
    tc = client.get(f"/api/v1/projects/{env['project_id']}/test-cases/export.csv")
    assert tc.headers["x-result-truncated"] == "true" and len(_csv(tc)) == 3
    df = client.get(f"{DF}/export.csv")
    assert df.headers["x-result-truncated"] == "true" and len(_csv(df)) == 3
    xl = client.get(f"{DF}/export.xlsx")
    assert xl.headers["x-result-truncated"] == "true"
    monkeypatch.undo()
    ok = client.get(f"{DF}/export.csv")
    assert "x-result-truncated" not in ok.headers and len(_csv(ok)) == 4


def test_defect_export_has_the_22_fields_ids_and_filters(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    d1 = make_defect(client, env, title="Defect one critical", severity="Critical")
    make_defect(client, env, title="Defect two minor", severity="Minor")
    labels = [c["label"] for c in client.get(f"{DF}/columns").json()["data"]["fields"]]
    rows = _csv(client.get(f"{DF}/export.csv"))
    assert rows[0][:22] == labels and rows[0][22] == "Root Cause Notes"
    assert len(_csv(client.get(f"{DF}/export.csv", params={"ids": d1["id"]}))) == 2
    assert len(_csv(client.get(f"{DF}/export.csv", params={"severity": "Critical"}))) == 2
    cols = _csv(client.get(f"{DF}/export.csv", params={"columns": "title,labels"}))
    assert cols[0] == ["Title", "Labels / Tags"]


# --- round trips --------------------------------------------------------------------------------


def _round_trip(client, kind: str, project_id: str, fmt: str) -> dict:
    if kind == "test_case":
        url = f"/api/v1/projects/{project_id}/test-cases/export.{fmt}"
    else:
        url = f"{DF}/export.{fmt}"
    response = client.get(url, params={"project_id": project_id} if kind == "defect" else None)
    assert response.status_code == 200
    return do_preview(client, kind, project_id, response.content, f"export.{fmt}")


@pytest.mark.parametrize("fmt", ["csv", "xlsx"])
def test_test_case_export_reimports_with_zero_errors(client, platform_admin, fmt) -> None:
    env = setup_env(client, platform_admin)
    steps = [
        {"action": "Open | the page", "expected": "It opens", "test_data": "url=/a|b"},
        {"action": "Click Save", "expected": "Saved", "test_data": None},
    ]
    create_case(
        client, env, "Full round trip case", steps=steps, test_type="API", severity="Critical",
        automation_status="Candidate for Automation", environment="Staging",
        requirement_ref="REQ-9", postconditions="Cleaned up", description="Describes **it**",
    )  # fmt: skip
    create_case(client, env, "=cmd|' /C calc'!A0 injection title")
    data = _round_trip(client, "test_case", env["project_id"], fmt)
    assert data["totals"]["errors"] == 0, messages(data, "error")
    assert data["totals"]["rows"] == 2
    assert data["ignored_columns"]  # execution columns are read and ignored
    summary = commit(client, "test_case", data["token"]).json()["data"]
    assert summary["created"] == 2
    assert len(cases_of(client, env["project_id"])) == 4
    copies = [c for c in cases_of(client, env["project_id"]) if c["display_id"] > "TC_000002"]
    full = next(c for c in copies if c["title"] == "Full round trip case")
    detail = client.get(f"{TC}/{full['id']}").json()["data"]
    assert [s["action"] for s in detail["steps"]] == ["Open | the page", "Click Save"]
    assert (
        detail["steps"][0]["test_data"] == "url=/a|b"
        and detail["steps"][0]["expected"] == "It opens"
    )
    assert detail["test_type"] == "API" and detail["severity"] == "Critical"
    assert detail["automation_status"] == "Candidate for Automation"
    assert detail["environment"] == "Staging" and detail["requirement_ref"] == "REQ-9"
    assert detail["postconditions"] == "Cleaned up" and detail["description"] == "Describes **it**"
    injected = next(c for c in copies if "injection" in c["title"])
    assert injected["title"].startswith("=cmd")  # the guard quote was read back off


@pytest.mark.parametrize("fmt", ["csv", "xlsx"])
def test_defect_export_reimports_with_zero_errors(
    client, platform_admin, owner_engine, fmt
) -> None:
    env = setup_env(client, platform_admin)
    case = create_case(client, env, "Case linked to defects")
    add_user(client, env, "tester")
    tester_email = f"tester@{env['slug']}.example.com"
    full = make_defect(
        client, env, title="Full round trip defect", severity="Critical", priority="Low",
        labels=["Alpha", "beta"], test_case_id=case["id"], build_found="9.9",
        fix_version="10.0", root_cause="design_flaw", root_cause_notes="Because",
        preconditions="Pre", assigned_to=user_id_of(client, tester_email),
        repro_steps=[
            {"action": "Step | one", "test_data": "d=1", "expected_result": "E one"},
            {"action": "Step two"},
        ],
    )  # fmt: skip
    closed = make_defect(client, env, title="Closed round trip defect")
    set_status(owner_engine, closed["id"], "Closed", "Cannot Reproduce")
    data = _round_trip(client, "defect", env["project_id"], fmt)
    assert data["totals"]["errors"] == 0, messages(data, "error")
    assert data["totals"]["rows"] == 2
    summary = commit(client, "defect", data["token"]).json()["data"]
    assert summary["created"] == 2
    clones = [
        d
        for d in defects_of(client, env["project_id"])
        if d["id"] not in (full["id"], closed["id"])
    ]
    clone = next(c for c in clones if c["title"] == "Full round trip defect")
    detail = client.get(f"{DF}/{clone['id']}").json()["data"]
    original = client.get(f"{DF}/{full['id']}").json()["data"]
    for key in (
        "severity", "priority", "labels", "build_found", "fix_version", "root_cause",
        "root_cause_notes", "preconditions", "environment", "description", "expected_result",
        "actual_result", "assigned_to", "status", "module_id",
    ):  # fmt: skip
        assert detail[key] == original[key], key
    assert [s["action"] for s in detail["repro_steps"]] == ["Step | one", "Step two"]
    assert detail["repro_steps"][0]["test_data"] == "d=1"
    assert [c["display_id"] for c in detail["linked_test_cases"]] == [case["display_id"]]
    closed_clone = next(c for c in clones if c["title"] == "Closed round trip defect")
    assert closed_clone["status"] == "Closed" and closed_clone["resolution"] == "Cannot Reproduce"
    assert closed_clone["display_id"] not in (full["display_id"], closed["display_id"])
    # The reporter is the importing user, whoever it was in the file.
    assert detail["reported_by_name"] == "Admin A"


def test_export_headers_equal_template_headers(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    create_case(client, env, "Header check case")
    make_defect(client, env)
    tc_template = list(csv.reader(io.StringIO(client.get(f"{TC}/import-template.csv").text)))[0]
    tc_export = _csv(client.get(f"/api/v1/projects/{env['project_id']}/test-cases/export.csv"))[0]
    assert tc_export[: len(tc_template)] == tc_template
    df_template = list(csv.reader(io.StringIO(client.get(f"{DF}/import-template.csv").text)))[0]
    df_export = _csv(client.get(f"{DF}/export.csv"))[0]
    assert df_export[: len(df_template)] == df_template


# --- the Task column ----------------------------------------------------------------------------


def _new_task(client, project_id: str, title: str) -> dict:
    response = client.post(f"/api/v1/projects/{project_id}/tasks", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _task_detail(client, task_id: str) -> dict:
    return client.get(f"/api/v1/tasks/{task_id}").json()["data"]


def _export_by_title(client, url: str, **kw) -> tuple[list[str], dict[str, str]]:
    table = list(csv.reader(io.StringIO(client.get(url, **kw).text)))
    header = table[0]
    return header, {r[header.index("Title")]: r[header.index("Task")] for r in table[1:]}


def test_test_case_import_links_tasks_and_export_lists_them(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    pid = env["project_id"]
    one, two = _new_task(client, pid, "First task"), _new_task(client, pid, "Second task")
    # Repeats and lower case are accepted; each task is linked once.
    refs = f"{two['display_id']}; {one['display_id'].lower()}; {one['display_id']}"
    rows = [tc_row(1, task=refs), tc_row(2, task="")]
    data = do_preview(client, "test_case", pid, csv_bytes("test_case", rows))
    assert data["totals"]["errors"] == 0, messages(data)
    assert {"key": "task", "label": "Task"} in data["preview_columns"]
    assert commit(client, "test_case", data["token"]).status_code == 200
    for task in (one, two):
        linked = _task_detail(client, task["id"])["test_cases"]
        assert [c["title"] for c in linked] == ["Imported test case 0001"]
    assert "task.test_case_linked" in client.get(f"/api/v1/tasks/{one['id']}/history").text

    header, cells = _export_by_title(client, f"/api/v1/projects/{pid}/test-cases/export.csv")
    assert header[-1] == "Task"
    assert cells["Imported test case 0001"] == f"{one['display_id']}; {two['display_id']}"
    assert cells["Imported test case 0002"] == ""


def test_defect_import_sets_the_task_and_export_shows_it(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    pid = env["project_id"]
    task = _new_task(client, pid, "Claims form")
    content = csv_bytes("defect", [df_row(1, task=task["display_id"]), df_row(2)])
    data = do_preview(client, "defect", pid, content)
    assert data["totals"]["errors"] == 0, messages(data)
    assert {"key": "task", "label": "Task"} in data["preview_columns"]
    assert commit(client, "defect", data["token"]).status_code == 200
    by_title = {d["title"]: d for d in defects_of(client, pid)}
    assert by_title["Imported defect 0001"]["task_id"] == task["id"]
    assert by_title["Imported defect 0002"]["task_id"] is None

    header, cells = _export_by_title(client, f"{DF}/export.csv", params={"project_id": pid})
    assert header[-1] == "Task"
    assert cells["Imported defect 0001"] == task["display_id"]
    assert cells["Imported defect 0002"] == ""


@pytest.mark.parametrize(("kind", "make"), [("test_case", tc_row), ("defect", df_row)])
def test_a_task_that_is_deleted_or_unknown_is_a_row_error(
    client, platform_admin, kind, make
) -> None:
    env = setup_env(client, platform_admin)
    pid = env["project_id"]
    gone = _new_task(client, pid, "To be deleted")
    assert client.delete(f"/api/v1/tasks/{gone['id']}").status_code == 200
    rows = [make(1, task=gone["display_id"]), make(2, task="TASK_999999")]
    data = do_preview(client, kind, pid, csv_bytes(kind, rows))
    assert data["totals"]["errors"] == 2, messages(data)
    assert all("does not exist in this project" in m for m in messages(data, "error"))


def test_a_defect_takes_only_one_task(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    pid = env["project_id"]
    one, two = _new_task(client, pid, "First task"), _new_task(client, pid, "Second task")
    content = csv_bytes("defect", [df_row(1, task=f"{one['display_id']}; {two['display_id']}")])
    data = do_preview(client, "defect", pid, content)
    assert any("only one task" in m for m in messages(data, "error")), messages(data)


def test_linking_tasks_by_import_needs_task_manage(client, platform_admin) -> None:
    env = setup_env(client, platform_admin)
    pid = env["project_id"]
    task = _new_task(client, pid, "Guarded task")
    creator = as_user(
        client, env, _custom_role_user(client, env, "TC Creator", ["testcase.create"])
    )
    content = csv_bytes("test_case", [tc_row(1, task=task["display_id"])])
    data = do_preview(creator, "test_case", pid, content)
    assert any("not allowed to link" in m for m in messages(data, "error")), messages(data)
    # Without a task the same importer is unaffected.
    plain = do_preview(creator, "test_case", pid, csv_bytes("test_case", [tc_row(2)]))
    assert plain["totals"]["errors"] == 0, messages(plain)
    assert _task_detail(client, task["id"])["test_cases"] == []
