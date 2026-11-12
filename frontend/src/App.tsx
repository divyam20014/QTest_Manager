import { Navigate, Route, Routes } from 'react-router-dom'

import { usePageTitleFromRoute } from '@/lib/usePageTitle'
import { AcceptInvite } from '@/routes/AcceptInvite'
import { AppShell } from '@/routes/AppShell'
import { Dashboard } from '@/routes/Dashboard'
import { Login } from '@/routes/Login'
import { Signup } from '@/routes/Signup'
import { NotFound } from '@/routes/NotFound'
import { PlatformAdmin } from '@/routes/PlatformAdmin'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { DefectDetail } from '@/routes/defects/DefectDetail'
import { DefectsList } from '@/routes/defects/DefectsList'
import { ExecutionConsole } from '@/routes/execution/ExecutionConsole'
import { ExecutionOverview } from '@/routes/execution/ExecutionOverview'
import { TestRunDetail } from '@/routes/execution/TestRunDetail'
import { TestRunsList } from '@/routes/execution/TestRunsList'
import { TestRunsOverview } from '@/routes/execution/TestRunsOverview'
import { AuditLogs } from '@/routes/admin/AuditLogs'
import { Environments } from '@/routes/admin/Environments'
import { RolesPermissions } from '@/routes/admin/RolesPermissions'
import { Settings } from '@/routes/admin/Settings'
import { UsersRoles } from '@/routes/admin/UsersRoles'
import { ProjectDetail } from '@/routes/projects/ProjectDetail'
import { ProjectsList } from '@/routes/projects/ProjectsList'
import { RequirementDetail } from '@/routes/requirements/RequirementDetail'
import { RequirementsList } from '@/routes/requirements/RequirementsList'
import { TraceabilityMatrix } from '@/routes/requirements/TraceabilityMatrix'
import { MyAccount } from '@/routes/MyAccount'
import { CompliancePrintView } from '@/routes/reporting/CompliancePrintView'
import { Reporting } from '@/routes/reporting/Reporting'
import { TestRepository } from '@/routes/testrepository/TestRepository'
import { TestCaseDetail } from '@/routes/testcases/TestCaseDetail'
import { TestCasesList } from '@/routes/testcases/TestCasesList'

export function App() {
  usePageTitleFromRoute()
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/accept-invite/:token" element={<AcceptInvite />} />
      <Route path="/platform-admin" element={<PlatformAdmin />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/reporting/print" element={<CompliancePrintView />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectsList />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/requirements" element={<RequirementsList />} />
          <Route
            path="/projects/:projectId/traceability-matrix"
            element={<TraceabilityMatrix />}
          />
          <Route path="/requirements/:requirementId" element={<RequirementDetail />} />
          <Route path="/projects/:projectId/test-cases" element={<TestCasesList />} />
          <Route path="/test-cases/:testCaseId" element={<TestCaseDetail />} />
          <Route path="/projects/:projectId/test-runs" element={<TestRunsList />} />
          <Route path="/test-runs/:runId" element={<TestRunDetail />} />
          <Route path="/test-run-cases/:runCaseId" element={<ExecutionConsole />} />
          <Route path="/test-repository" element={<TestRepository />} />
          <Route path="/test-runs" element={<TestRunsOverview />} />
          <Route path="/execution" element={<ExecutionOverview />} />
          <Route path="/defects" element={<DefectsList />} />
          <Route path="/defects/:defectId" element={<DefectDetail />} />
          <Route path="/reporting" element={<Reporting />} />
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/users" element={<UsersRoles />} />
          <Route path="/admin/roles" element={<RolesPermissions />} />
          <Route path="/admin/audit-logs" element={<AuditLogs />} />
          <Route path="/admin/environments" element={<Environments />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/account" element={<MyAccount />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
