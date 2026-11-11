import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'

import { fetchComplianceDetail } from '@/api/reporting'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth'
import { isManagerOrAbove } from '@/api/auth'
import { STATUS_DISPLAY } from '@/routes/testcases/statusDisplay'

export function CompliancePrintView() {
  const { user } = useAuth()
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const canView = isManagerOrAbove(user)

  const reportQuery = useQuery({
    queryKey: ['reports', 'compliance-detail', periodFrom, periodTo],
    queryFn: () =>
      fetchComplianceDetail({
        periodFrom: periodFrom ? new Date(periodFrom).toISOString() : undefined,
        periodTo: periodTo ? new Date(periodTo).toISOString() : undefined,
      }),
    enabled: canView,
  })

  if (!canView) return <Navigate to="/reporting" replace />

  const report = reportQuery.data

  return (
    <div className="compliance-print mx-auto max-w-4xl p-6 text-black">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .compliance-print { color: #000 !important; max-width: 100% !important; }
          .compliance-print table { break-inside: avoid; }
          .compliance-print section { break-inside: avoid-page; }
        }
        .compliance-print table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .compliance-print th, .compliance-print td {
          border: 1px solid #000; padding: 4px 8px; text-align: left;
        }
        .compliance-print th { background: #e5e5e5; }
      `}</style>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div>
          <Link to="/reporting" className="text-xs text-[var(--muted-foreground)] hover:underline">
            ← Back to Reporting
          </Link>
          <h1 className="text-lg font-semibold">Compliance Report (Print / PDF)</h1>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Period from"
            type="date"
            value={periodFrom}
            onChange={(e) => setPeriodFrom(e.target.value)}
            className="w-40"
          />
          <Input
            aria-label="Period to"
            type="date"
            value={periodTo}
            onChange={(e) => setPeriodTo(e.target.value)}
            className="w-40"
          />
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--muted)]"
          >
            Print / Save as PDF
          </button>
        </div>
      </div>

      {!report ? (
        <p>Loading compliance report…</p>
      ) : (
        <>
          <header className="mb-6">
            <h1 className="text-xl font-bold">{report.tenant_name} — Compliance Report</h1>
            <p>Generated: {new Date(report.generated_at).toLocaleString()}</p>
            <p>Reporting Officer: {report.reporting_officer_name} ({report.reporting_officer_email})</p>
            <p>
              Reporting Period: {report.period_from ? new Date(report.period_from).toLocaleDateString() : 'All time'}
              {' '}to{' '}
              {report.period_to ? new Date(report.period_to).toLocaleDateString() : 'present'}
            </p>
          </header>

          <section className="mb-6">
            <h2 className="mb-2 text-base font-semibold">Summary</h2>
            <table>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Total Test Cases</th>
                  <th>Approved</th>
                  <th>Draft</th>
                  <th>Ready for Review</th>
                  <th>Open Defects</th>
                  <th>Critical Defects</th>
                  <th>Requirement Coverage</th>
                  <th>SLA Breached</th>
                </tr>
              </thead>
              <tbody>
                {report.projects.map((p) => (
                  <tr key={p.project_id}>
                    <td>{p.name}</td>
                    <td>{p.domain}</td>
                    <td>{p.total_test_cases}</td>
                    <td>{p.approved_test_cases}</td>
                    <td>{p.draft_test_cases}</td>
                    <td>{p.ready_for_review_test_cases}</td>
                    <td>{p.open_defects}</td>
                    <td>{p.critical_defects}</td>
                    <td>
                      {p.requirement_covered}/{p.requirement_total} ({p.requirement_coverage_percentage}%)
                    </td>
                    <td>{p.defect_aging.total_breached}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {report.trend && (
            <section className="mb-6">
              <h2 className="mb-2 text-base font-semibold">Period-over-Period Trend</h2>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>Current Period</th>
                    <th>Prior Period</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Test Cases Created</td>
                    <td>{report.trend.test_cases_created_current}</td>
                    <td>{report.trend.test_cases_created_prior}</td>
                  </tr>
                  <tr>
                    <td>Defects Opened</td>
                    <td>{report.trend.defects_opened_current}</td>
                    <td>{report.trend.defects_opened_prior}</td>
                  </tr>
                  <tr>
                    <td>Defects Closed</td>
                    <td>{report.trend.defects_closed_current}</td>
                    <td>{report.trend.defects_closed_prior}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {report.projects.map((p) => (
            <section key={p.project_id} className="mb-6">
              <h2 className="mb-2 text-base font-semibold">
                {p.name} ({p.domain})
              </h2>

              <h3 className="mb-1 text-sm font-semibold">Defect Aging by Severity</h3>
              <table className="mb-4">
                <thead>
                  <tr>
                    <th>Severity</th>
                    <th>Open</th>
                    <th>SLA Breached</th>
                  </tr>
                </thead>
                <tbody>
                  {p.defect_aging.buckets.map((b) => (
                    <tr key={b.severity}>
                      <td>{b.severity}</td>
                      <td>{b.open_count}</td>
                      <td>{b.breached_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="mb-1 text-sm font-semibold">Test Cases</h3>
              <table className="mb-4">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {p.test_cases.map((tc) => (
                    <tr key={tc.id}>
                      <td>{tc.id}</td>
                      <td>{tc.title}</td>
                      <td>
                        {STATUS_DISPLAY[tc.status as keyof typeof STATUS_DISPLAY]?.label ?? tc.status}
                      </td>
                      <td>{tc.priority}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="mb-1 text-sm font-semibold">Defects</h3>
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Severity</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {p.defects.map((d) => (
                    <tr key={d.id}>
                      <td>{d.id}</td>
                      <td>{d.title}</td>
                      <td>{d.severity}</td>
                      <td>{d.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
