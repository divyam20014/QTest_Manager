import { Navigate, Route, Routes } from 'react-router-dom'

import { AppShell } from '@/routes/AppShell'
import { Dashboard } from '@/routes/Dashboard'
import { Login } from '@/routes/Login'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { DefectDetail } from '@/routes/defects/DefectDetail'
import { DefectsList } from '@/routes/defects/DefectsList'
import { ExecutionConsole } from '@/routes/execution/ExecutionConsole'
import { TestRunDetail } from '@/routes/execution/TestRunDetail'
import { TestRunsList } from '@/routes/execution/TestRunsList'
import { Administration } from '@/routes/admin/Administration'
import { ProjectDetail } from '@/routes/projects/ProjectDetail'
import { ProjectsList } from '@/routes/projects/ProjectsList'
import { Reporting } from '@/routes/reporting/Reporting'
import { TestCaseDetail } from '@/routes/testcases/TestCaseDetail'
import { TestCasesList } from '@/routes/testcases/TestCasesList'

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectsList />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/test-cases" element={<TestCasesList />} />
          <Route path="/test-cases/:testCaseId" element={<TestCaseDetail />} />
          <Route path="/projects/:projectId/test-runs" element={<TestRunsList />} />
          <Route path="/test-runs/:runId" element={<TestRunDetail />} />
          <Route path="/test-run-cases/:runCaseId" element={<ExecutionConsole />} />
          <Route path="/defects" element={<DefectsList />} />
          <Route path="/defects/:defectId" element={<DefectDetail />} />
          <Route path="/reporting" element={<Reporting />} />
          <Route path="/admin" element={<Administration />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
