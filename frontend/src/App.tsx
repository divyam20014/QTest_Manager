import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { RouteBoundary } from '@/components/RouteBoundary'
import { lazyRoute } from '@/lib/lazyRoute'

import { usePageTitleFromRoute } from '@/lib/usePageTitle'
import { AdminLayout } from '@/routes/admin/AdminLayout'
import { NotFound } from '@/routes/NotFound'
import { HomeGate } from '@/routes/HomeGate'
import { MarketingRoute } from '@/routes/MarketingRoute'
import { MARKETING_PATHS } from '@/routes/marketingPaths'

const AcceptInvite = lazyRoute(() => import('@/routes/AcceptInvite'), 'AcceptInvite')
const AppShell = lazyRoute(() => import('@/routes/AppShell'), 'AppShell')
const Login = lazyRoute(() => import('@/routes/Login'), 'Login')
const Signup = lazyRoute(() => import('@/routes/Signup'), 'Signup')
const PlatformAdmin = lazyRoute(() => import('@/routes/PlatformAdmin'), 'PlatformAdmin')
const Dashboard = lazyRoute(() => import('@/routes/Dashboard'), 'Dashboard')
const MyAccount = lazyRoute(() => import('@/routes/MyAccount'), 'MyAccount')
const DefectDetail = lazyRoute(() => import('@/routes/defects/DefectDetail'), 'DefectDetail')
const DefectsList = lazyRoute(() => import('@/routes/defects/DefectsList'), 'DefectsList')
const ExecutionConsole = lazyRoute(() => import('@/routes/execution/ExecutionConsole'), 'ExecutionConsole')
const ExecutionOverview = lazyRoute(() => import('@/routes/execution/ExecutionOverview'), 'ExecutionOverview')
const TestRunDetail = lazyRoute(() => import('@/routes/execution/TestRunDetail'), 'TestRunDetail')
const TestRunsList = lazyRoute(() => import('@/routes/execution/TestRunsList'), 'TestRunsList')
const TestRunsOverview = lazyRoute(() => import('@/routes/execution/TestRunsOverview'), 'TestRunsOverview')
const AccessRules = lazyRoute(() => import('@/routes/admin/AccessRules'), 'AccessRules')
const AuditLogs = lazyRoute(() => import('@/routes/admin/AuditLogs'), 'AuditLogs')
const Environments = lazyRoute(() => import('@/routes/admin/Environments'), 'Environments')
const RolesPermissions = lazyRoute(() => import('@/routes/admin/RolesPermissions'), 'RolesPermissions')
const Settings = lazyRoute(() => import('@/routes/admin/Settings'), 'Settings')
const UsersRoles = lazyRoute(() => import('@/routes/admin/UsersRoles'), 'UsersRoles')
const ProjectDetail = lazyRoute(() => import('@/routes/projects/ProjectDetail'), 'ProjectDetail')
const ProjectDashboard = lazyRoute(() => import('@/routes/projects/ProjectDashboard'), 'ProjectDashboard')
const ProjectsList = lazyRoute(() => import('@/routes/projects/ProjectsList'), 'ProjectsList')
const RequirementDetail = lazyRoute(() => import('@/routes/requirements/RequirementDetail'), 'RequirementDetail')
const RequirementsList = lazyRoute(() => import('@/routes/requirements/RequirementsList'), 'RequirementsList')
const TraceabilityMatrix = lazyRoute(() => import('@/routes/requirements/TraceabilityMatrix'), 'TraceabilityMatrix')
const CompliancePrintView = lazyRoute(() => import('@/routes/reporting/CompliancePrintView'), 'CompliancePrintView')
const Dashboards = lazyRoute(() => import('@/routes/dashboards/Dashboards'), 'Dashboards')
const DashboardView = lazyRoute(() => import('@/routes/dashboards/DashboardView'), 'DashboardView')
const Reporting = lazyRoute(() => import('@/routes/reporting/Reporting'), 'Reporting')
const ReportBuilder = lazyRoute(() => import('@/routes/reporting/ReportBuilder'), 'ReportBuilder')
const TestRepository = lazyRoute(() => import('@/routes/testrepository/TestRepository'), 'TestRepository')
const TestCaseDetail = lazyRoute(() => import('@/routes/testcases/TestCaseDetail'), 'TestCaseDetail')
const TestCasesList = lazyRoute(() => import('@/routes/testcases/TestCasesList'), 'TestCasesList')
const UserGuide = lazyRoute(() => import('@/routes/userGuide/UserGuide'), 'UserGuide')
const PlatformDocs = lazyRoute(() => import('@/routes/platformAdmin/PlatformDocs'), 'PlatformDocs')

// Design-system catalogue: dev server only. import.meta.env.DEV is replaced by
// a literal false in production builds, so this chunk is never emitted there.
const DesignCatalogue = import.meta.env.DEV ? lazy(() => import('@/routes/_DesignPreview')) : null

export function App() {
  usePageTitleFromRoute()
  const { pathname } = useLocation()
  return (
    <RouteBoundary resetKey={pathname}>
    <Suspense fallback={null}>
    <Routes>
      {MARKETING_PATHS.map((path) => (
        <Route key={path} path={path} element={<MarketingRoute />} />
      ))}
      {DesignCatalogue && (
        <Route
          path="/_design-system"
          element={
            <Suspense fallback={null}>
              <DesignCatalogue />
            </Suspense>
          }
        />
      )}
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/accept-invite/:token" element={<AcceptInvite />} />
      <Route path="/platform-admin" element={<PlatformAdmin />} />
      <Route path="/platform-admin/docs" element={<PlatformDocs />} />
      <Route path="/platform-admin/docs/:docId" element={<PlatformDocs />} />
      <Route element={<HomeGate />}>
        <Route path="/reporting/print" element={<CompliancePrintView />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboards" element={<Dashboards />} />
          <Route path="/dashboards/:dashboardId" element={<DashboardView />} />
          <Route path="/projects" element={<ProjectsList />} />
          <Route path="/projects/:projectId" element={<ProjectDashboard />} />
          <Route path="/projects/:projectId/details" element={<ProjectDetail />} />
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
          <Route path="/reporting/builder" element={<ReportBuilder />} />
          <Route path="/admin" element={<Navigate to="/admin/users" replace />} />
          <Route element={<AdminLayout />}>
            <Route path="/admin/users" element={<UsersRoles />} />
            <Route path="/admin/roles" element={<RolesPermissions />} />
            <Route path="/admin/audit-logs" element={<AuditLogs />} />
            <Route path="/admin/environments" element={<Environments />} />
            <Route path="/admin/access-rules" element={<AccessRules />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="/account" element={<MyAccount />} />
          <Route path="/user-guide" element={<UserGuide />} />
          {/* ADR-114: the old Documentation links land on the User Guide. */}
          <Route path="/brd" element={<Navigate to="/user-guide" replace />} />
          <Route path="/brd/*" element={<Navigate to="/user-guide" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </Suspense>
    </RouteBoundary>
  )
}
