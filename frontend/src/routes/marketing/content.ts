import {
  BarChart3,
  Bell,
  Briefcase,
  Bug,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  FileSearch,
  Fingerprint,
  GitCompareArrows,
  Globe,
  KeyRound,
  Layers,
  LayoutDashboard,
  LineChart,
  ListChecks,
  type LucideIcon,
  Network,
  PlayCircle,
  RefreshCw,
  Rocket,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Split,
  Target,
  TrendingUp,
  UserCog,
  Users,
  UsersRound,
  Workflow,
} from 'lucide-react'

export const CONTACT_TOPICS: Array<{ value: 'contact' | 'pricing' | 'enterprise' | 'demo'; label: string }> = [
  { value: 'contact', label: 'General enquiry' },
  { value: 'pricing', label: 'Pricing (Professional)' },
  { value: 'enterprise', label: 'Enterprise sales' },
  { value: 'demo', label: 'Product demonstration' },
]

export interface IconItem {
  icon: LucideIcon
  title: string
  body: string
}

export const PROBLEMS: IconItem[] = [
  {
    icon: Split,
    title: 'Fragmented Testing Workflows',
    body: 'Requirements, test cases, execution and defects are scattered across disconnected tools.',
  },
  {
    icon: Search,
    title: 'Limited Testing Visibility',
    body: 'QA managers struggle to understand actual testing progress, coverage and project quality.',
  },
  {
    icon: RefreshCw,
    title: 'Inefficient Test Management',
    body: 'Manual test case management and repetitive processes consume valuable engineering time.',
  },
  {
    icon: BarChart3,
    title: 'Disconnected Reporting',
    body: 'Important quality information is difficult to consolidate into meaningful management insights.',
  },
  {
    icon: ShieldCheck,
    title: 'Growing Governance Complexity',
    body: 'As teams and projects expand, consistent processes, permissions and accountability get harder to maintain.',
  },
]

/** The three brand pillars: Connect, Understand, Control. */
export const PILLARS: Array<IconItem & { verb: string }> = [
  {
    icon: Layers,
    verb: 'Connect',
    title: 'Unified QA lifecycle',
    body: 'Manage requirements, test cases, execution and defects in one connected platform.',
  },
  {
    icon: Cpu,
    verb: 'Understand',
    title: 'Quality intelligence',
    body: 'See coverage, trends and readiness signals that support informed release decisions.',
  },
  {
    icon: ShieldCheck,
    verb: 'Control',
    title: 'Enterprise governance',
    body: 'Keep roles, approvals and a verifiable audit trail consistent as teams scale.',
  },
]

/** Hero metric chips. Values are read from the demo-organization screenshots
 * (dashboard.jpg and readiness.jpg) so the chips never contradict the image. */
export const HERO_METRICS = [
  { label: 'Execution pass rate', value: 95, decimals: 0, suffix: '%', scope: 'Sample · all projects' },
  { label: 'Open defects', value: 28, decimals: 0, suffix: '', scope: 'Sample · all projects' },
  { label: 'Execution completion', value: 91.7, decimals: 1, suffix: '%', scope: 'Sample · one project' },
  { label: 'Requirement coverage', value: 88.9, decimals: 1, suffix: '%', scope: 'Sample · one project' },
]

export const CAPABILITIES: Array<IconItem & { anchor: string }> = [
  {
    icon: ClipboardList,
    anchor: 'test-management',
    title: 'Test Management',
    body: 'Create, organize, maintain and manage test cases through a structured and centralized repository.',
  },
  {
    icon: ListChecks,
    anchor: 'test-planning',
    title: 'Test Planning',
    body: 'Organize test suites, testing cycles and execution plans with better coordination and visibility.',
  },
  {
    icon: PlayCircle,
    anchor: 'test-execution',
    title: 'Test Execution',
    body: 'Execute test cases, capture results, maintain evidence and monitor execution progress.',
  },
  {
    icon: Bug,
    anchor: 'defect-management',
    title: 'Defect Management',
    body: 'Track defects, monitor their lifecycle and connect testing outcomes with quality improvement.',
  },
  {
    icon: FileSearch,
    anchor: 'requirements',
    title: 'Requirement Management',
    body: 'Connect business requirements with test coverage and establish end-to-end traceability.',
  },
  {
    icon: LineChart,
    anchor: 'reports',
    title: 'Reports & Analytics',
    body: 'Transform testing activities into meaningful insights through centralized reporting and analytics.',
  },
  {
    icon: Users,
    anchor: 'access',
    title: 'User & Access Management',
    body: 'Manage organizational users, roles and permissions with structured access control.',
  },
  {
    icon: ScrollText,
    anchor: 'governance',
    title: 'Audit & Governance',
    body: 'Maintain accountability and visibility through activity tracking and governance capabilities.',
  },
]

export const LIFECYCLE = [
  { title: 'Define', body: 'Capture and organize business requirements.' },
  { title: 'Design', body: 'Create structured test cases and establish test coverage.' },
  { title: 'Plan', body: 'Organize test suites, test cycles and testing activities.' },
  { title: 'Execute', body: 'Run test cases, capture evidence and track results.' },
  { title: 'Analyze', body: 'Understand defects, execution progress and quality trends.' },
  { title: 'Improve', body: 'Use quality insights to make better testing and release decisions.' },
]

export type Availability = 'available' | 'partial' | 'planned'

export const INTELLIGENCE: Array<IconItem & { status: Availability; note?: string; detail: string }> = [
  {
    icon: GitCompareArrows,
    title: 'Requirement Impact Analysis',
    body: 'Understand how requirement changes affect existing test coverage.',
    detail:
      'Compares a requirement with its previous version and flags the linked test cases that may need review, with the reason for each.',
    status: 'available',
    note: 'AI-assisted · enabled per organization',
  },
  {
    icon: Target,
    title: 'Risk-Based Testing',
    body: 'Prioritize testing activities based on business and application risk.',
    detail: 'Weighting test scope by business impact and likelihood of failure is on the roadmap.',
    status: 'planned',
  },
  {
    icon: Workflow,
    title: 'Intelligent Regression Recommendations',
    body: 'Identify potentially relevant regression coverage when application changes occur.',
    detail: 'Recommending which regression tests to run for a given change, with the reasoning behind each pick, is on the roadmap.',
    status: 'planned',
  },
  {
    icon: Network,
    title: 'Test Coverage Intelligence',
    body: 'Understand coverage gaps and identify areas requiring additional attention.',
    detail:
      'Coverage reports and a requirements traceability matrix show which requirements have linked tests, which were executed, and which are uncovered.',
    status: 'available',
  },
  {
    icon: TrendingUp,
    title: 'Defect Trend Analysis',
    body: 'Identify recurring defect patterns and quality improvement opportunities.',
    detail: 'Defect inflow versus closure over time, root-cause categories, reopen tracking and aging against SLA.',
    status: 'available',
  },
  {
    icon: Rocket,
    title: 'Release Readiness Insights',
    body: 'Bring testing progress, defects and coverage information together to support release decisions.',
    detail:
      'Execution completion, pass rate, open defects by severity and requirement coverage in one view per project, plus workload and flaky-test signals.',
    status: 'available',
  },
]

/** Home-page differentiators. Every status was checked against the backend:
 * traceability matrix + coverage report, the three AI endpoints, release
 * readiness, workload + flaky-test reports, and the review workflow, audit
 * hash chain and project-scoped roles. */
export const DIFFERENTIATORS: Array<IconItem & { status: Availability; note?: string }> = [
  {
    icon: Network,
    title: 'End-to-End Traceability Intelligence',
    body: 'Link requirements to test cases and see linked, executed, passed and failed counts per requirement, with uncovered requirements flagged.',
    status: 'available',
  },
  {
    icon: Target,
    title: 'Risk-Based Testing Intelligence',
    body: 'Highlighting high-risk areas from requirement criticality, defect history, coverage and execution outcomes is on the roadmap.',
    status: 'planned',
  },
  {
    icon: Cpu,
    title: 'AI-Assisted Testing',
    body: 'Draft test cases from a requirement, get review suggestions on a test case, and analyze how a requirement change affects linked tests. Drafts always need human approval.',
    status: 'available',
    note: 'Enabled per organization',
  },
  {
    icon: Rocket,
    title: 'Release Readiness Intelligence',
    body: 'Execution completion, pass rate, requirement coverage and open defects by severity in one view per project. It reports the evidence; the release decision stays with your team.',
    status: 'available',
  },
  {
    icon: TrendingUp,
    title: 'QA Productivity Intelligence',
    body: 'Workload per tester and tests whose results keep flipping are available today. Execution-efficiency and bottleneck analysis are planned.',
    status: 'partial',
  },
  {
    icon: ScrollText,
    title: 'QA Governance and Audit Intelligence',
    body: 'A review and approval workflow for test cases, a tamper-evident audit log, and roles that can be scoped to a single project.',
    status: 'available',
  },
]

export const ROLES: Array<IconItem & { group: 'qa-managers' | 'qa-teams' | 'engineering' }> = [
  {
    icon: BarChart3,
    group: 'qa-managers',
    title: 'For QA Managers',
    body: 'Gain visibility into team performance, project quality, execution progress and testing outcomes.',
  },
  {
    icon: UsersRound,
    group: 'qa-teams',
    title: 'For QA Leads',
    body: 'Coordinate test planning, manage execution activities and maintain testing consistency.',
  },
  {
    icon: ClipboardCheck,
    group: 'qa-teams',
    title: 'For QA Engineers',
    body: 'Create, organize and execute test cases through structured testing workflows.',
  },
  {
    icon: FileSearch,
    group: 'qa-teams',
    title: 'For Business Analysts',
    body: 'Maintain requirement visibility and connect business expectations with testing coverage.',
  },
  {
    icon: Briefcase,
    group: 'engineering',
    title: 'For Engineering Managers',
    body: 'Understand testing progress, defect trends and potential delivery risks.',
  },
  {
    icon: UserCog,
    group: 'engineering',
    title: 'For Enterprise Administrators',
    body: 'Manage users, organizational access and platform governance.',
  },
]

/** Only capabilities confirmed in the codebase. No certification claims. */
export const SECURITY: IconItem[] = [
  {
    icon: KeyRound,
    title: 'Role-Based Access Control',
    body: 'System roles and custom roles with granular permissions, plus project-scoped role overrides.',
  },
  {
    icon: Fingerprint,
    title: 'Multi-Factor Sign-In',
    body: 'Every sign-in is completed with a one-time verification code after the password step.',
  },
  {
    icon: Network,
    title: 'Multi-Tenant Data Isolation',
    body: "Each organization's data is isolated in the database with PostgreSQL row-level security.",
  },
  {
    icon: ScrollText,
    title: 'Tamper-Evident Audit Log',
    body: 'An append-only, hash-chained record of who did what, and when, that can be verified.',
  },
  {
    icon: Globe,
    title: 'IP Allowlists',
    body: 'Optionally restrict the networks your organization can sign in from.',
  },
  {
    icon: ShieldCheck,
    title: 'Session Management',
    body: 'Review and revoke active sessions; suspending an organization ends its sessions immediately.',
  },
  {
    icon: UserCog,
    title: 'Single Sign-On (OIDC)',
    body: 'Organizations can configure OpenID Connect single sign-on.',
  },
  {
    icon: Users,
    title: 'SCIM User Provisioning',
    body: 'Provision and update users from an identity provider through a SCIM 2.0 endpoint.',
  },
]

export const ENTERPRISE_POINTS = [
  'Role-Based Access Control',
  'Organizational User Management',
  'Structured Permissions',
  'Multi-Tenant Architecture',
  'Audit and Activity Tracking',
  'Centralized QA Operations',
]

export const WHY_POINTS = [
  'One centralized platform for QA operations.',
  'Better visibility into testing activities.',
  'Structured requirement-to-test traceability.',
  'More organized execution workflows.',
  'Meaningful reporting and analytics.',
  'Enterprise-oriented access and governance.',
]

export const FAQ = [
  {
    q: 'What is QTestHub?',
    a: 'QTestHub is an enterprise-oriented Quality Engineering and Test Management platform for managing requirements, test cases, test planning, execution, defects and quality analytics.',
  },
  {
    q: 'Who can use QTestHub?',
    a: 'QA Engineers, QA Leads, QA Managers, Business Analysts, Engineering Managers and organizations managing software testing operations.',
  },
  {
    q: 'Can QTestHub manage the complete testing lifecycle?',
    a: 'Yes. It supports connected QA workflows from requirement management and test design through execution, defect tracking and reporting.',
  },
  {
    q: 'Does QTestHub support multiple organizations?',
    a: 'Yes. The platform is multi-tenant: each organization has its own users, roles and data, isolated from every other organization.',
  },
  {
    q: 'Does QTestHub offer AI capabilities?',
    a: 'Some, today. AI-assisted test case generation, AI test case review and requirement change impact analysis are available and switched on per organization. Risk-based testing and intelligent regression recommendations are planned and not available yet.',
  },
  {
    q: 'Does QTestHub offer enterprise licensing?',
    a: 'Enterprise engagements are available for organizations with advanced governance, administration or deployment requirements. Contact our team to discuss them.',
  },
  {
    q: 'Can we request a product demonstration?',
    a: 'Absolutely. Submit a demo request and our team will discuss your requirements and arrange a suitable demonstration.',
  },
  {
    q: 'How is our data protected?',
    a: 'Each organization is isolated from every other, access is governed by roles that can be scoped to a single project, and changes are recorded in a tamper-evident audit log. The Security page lists the controls in detail.',
  },
  {
    q: 'Can we choose where our data is hosted?',
    a: 'Not yet. A data region can be recorded for an organization as readiness information, but there is no per-region hosting today. Contact our team if this is a requirement for you.',
  },
  {
    q: 'How can we get pricing information?',
    a: 'Contact our team for Professional and Enterprise pricing. You can also create a free organization yourself and explore the platform first.',
  },
]

export const TOUR = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    image: '/marketing/dashboard.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub dashboard for a fictional insurer showing project, test case and defect counts, an execution pass-rate gauge, test case status and a 30-day execution trend',
    title: 'One view of quality across every project',
    points: ['Projects, test cases and defects at a glance', 'Execution pass rate and 30-day trend', 'Critical items that need attention'],
  },
  {
    id: 'repository',
    label: 'Test Cases',
    icon: ClipboardList,
    image: '/marketing/repository.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub test repository listing test cases across projects with status, priority, assignee and step counts',
    title: 'A structured, searchable test repository',
    points: ['Modules, filters, saved views and column controls', 'Versioned test cases with a review workflow', 'Bulk import from CSV'],
  },
  {
    id: 'execution',
    label: 'Test Execution',
    icon: PlayCircle,
    image: '/marketing/execution.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub execution console showing a test run case list, step-by-step instructions with expected results, and pass, fail and ignore controls',
    title: 'Execute step by step, with evidence',
    points: ['Pass, fail or ignore each step with keyboard shortcuts', 'Attachments and comments on every step', 'Regression, sanity and smoke runs with assignees'],
  },
  {
    id: 'defects',
    label: 'Defect Management',
    icon: Bug,
    image: '/marketing/defects.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub defect list with severity, priority, status, SLA and reporter columns and filters',
    title: 'Defects linked to the tests that found them',
    points: ['Severity, priority and a controlled status workflow', 'SLA aging and breach tracking', 'Duplicate suggestions while logging'],
  },
  {
    id: 'traceability',
    label: 'Traceability',
    icon: Network,
    image: '/marketing/traceability.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub requirements traceability matrix showing linked test cases, pass, fail, blocked and not-executed counts and coverage per requirement',
    title: 'Requirements traced to tests and results',
    points: ['Coverage per requirement, with gaps flagged', 'Passed, failed and not-executed breakdowns', 'CSV export for reviews and audits'],
  },
  {
    id: 'reports',
    label: 'Reports & Analytics',
    icon: LineChart,
    image: '/marketing/reports.jpg',
    width: 1184,
    height: 768,
    alt: 'QTestHub reporting page with 30-day execution trend and defect opened-versus-closed trend charts',
    title: 'Reports that answer release questions',
    points: ['Execution and defect trends over time', 'Defect aging against SLA', 'Compliance reports as PDF or CSV'],
  },
] as const

export const FEATURE_EXTRAS: IconItem[] = [
  {
    icon: SlidersHorizontal,
    title: 'Configurable Fields',
    body: 'Tailor severity, priority and other option lists to how your organization works.',
  },
  {
    icon: Bell,
    title: 'Notifications & Scheduled Reports',
    body: 'In-app notifications for key events, and compliance reports emailed on a schedule.',
  },
  {
    icon: Workflow,
    title: 'CI Result Ingestion',
    body: 'Post automated test results from your CI pipeline through a token-authenticated webhook.',
  },
  {
    icon: Search,
    title: 'Global Search & Command Palette',
    body: 'Find test cases, defects and requirements from anywhere, and jump between screens with Ctrl+K.',
  },
  {
    icon: Cpu,
    title: 'AI-Assisted Authoring',
    body: 'Draft test cases from requirements and get AI review suggestions. Enabled per organization; drafts always need human approval.',
  },
  {
    icon: ClipboardCheck,
    title: 'Shared Steps & Test Data',
    body: 'Reuse common steps across test cases and run parameterized tests against data sets.',
  },
]
