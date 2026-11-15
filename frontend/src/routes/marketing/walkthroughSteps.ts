/** A highlighted region of a screenshot, as percentages of the image. */
export interface Callout {
  x: number
  y: number
  w: number
  h: number
  label: string
}

export interface WalkthroughStep {
  id: string
  image: string
  width: number
  height: number
  alt: string
  title: string
  body: string
  scope?: string
  callouts: Callout[]
}

/** Every callout was placed by measuring the real screenshot in
 * /public/marketing, so each ring sits on the UI element its label names. */
export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'dashboard',
    image: '/marketing/dashboard.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub dashboard with project, test case and defect counts, an execution pass-rate gauge and a list of critical items needing attention',
    title: 'Start with the big picture',
    body: 'The dashboard shows testing status and project health across every project at a glance.',
    scope: 'Sample data · all projects',
    callouts: [
      { x: 79.2, y: 31.8, w: 19.2, h: 30.8, label: 'Execution pass rate across all executed steps' },
      { x: 18.3, y: 65.2, w: 26.1, h: 34.8, label: 'Critical defects that need attention first' },
    ],
  },
  {
    id: 'traceability',
    image: '/marketing/traceability.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub requirements traceability matrix with linked test cases, passed, failed, blocked and not-executed counts and coverage per requirement',
    title: 'Trace requirements to test results',
    body: 'Every requirement is linked to the test cases that verify it, with the latest results rolled up.',
    scope: 'Sample data · one project',
    callouts: [
      { x: 88.4, y: 33.2, w: 10.4, h: 41.4, label: 'Coverage for each requirement' },
      { x: 18.3, y: 70.1, w: 80.4, h: 4.5, label: 'Requirements with no linked tests are flagged Uncovered' },
    ],
  },
  {
    id: 'repository',
    image: '/marketing/repository.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub test repository with search and filters, saved filters, column controls and test cases across projects with status, priority and assignee',
    title: 'Keep every test case in one repository',
    body: 'Search and filter across projects, save views and choose columns. Each case moves through review before it is approved.',
    scope: 'Sample data · all projects',
    callouts: [
      { x: 18.3, y: 14.6, w: 80.4, h: 7.6, label: 'Search, filter, save views and choose columns' },
      {
        x: 86.2,
        y: 26.4,
        w: 11.8,
        h: 45.6,
        label: 'Draft cases are submitted for review; approved cases can be deprecated',
      },
    ],
  },
  {
    id: 'run',
    image: '/marketing/run-detail.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub test run for a sprint regression listing test cases with status, step progress and an assignee for each',
    title: 'Plan a run and assign the work',
    body: 'Group test cases into a run, such as a sprint regression, and assign each case to a tester.',
    scope: 'Sample data · one project',
    callouts: [
      {
        x: 18.3,
        y: 9.6,
        w: 80.4,
        h: 5.4,
        label: 'An active regression run, with controls to add cases, pause or finish',
      },
      { x: 74.4, y: 20.6, w: 10.9, h: 79, label: 'Each test case is assigned to a team member' },
    ],
  },
  {
    id: 'execution',
    image: '/marketing/execution.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub execution console with a run case list, step-by-step instructions with expected results, and pass, fail and ignore buttons',
    title: 'Execute step by step',
    body: 'Work through each step against its expected result, and record the outcome as you go.',
    scope: 'Sample data · one test case',
    callouts: [
      {
        x: 38.2,
        y: 21.6,
        w: 38.1,
        h: 20.2,
        label: 'Each step shows its expected result, with attachments and comments',
      },
      { x: 59.3, y: 89.8, w: 17.6, h: 5.4, label: 'Pass, fail or ignore the step, with keyboard shortcuts' },
    ],
  },
  {
    id: 'defects',
    image: '/marketing/defects.jpg',
    width: 1440,
    height: 900,
    alt: 'QTestHub defect list with filters and severity, priority, status, SLA and reporter columns',
    title: 'Track defects against SLAs',
    body: 'Log defects with severity and priority, and see which ones have breached their SLA.',
    scope: 'Sample data · all projects',
    callouts: [
      { x: 18.3, y: 14.8, w: 80.4, h: 12.2, label: 'Filter by project, status, severity, reporter and date' },
      { x: 64.2, y: 28.6, w: 15.8, h: 71.4, label: 'Status and SLA, with breaches flagged' },
    ],
  },
  {
    id: 'readiness',
    image: '/marketing/readiness.jpg',
    width: 1184,
    height: 472,
    alt: 'QTestHub release readiness with test cases, execution completion, pass rate, requirement coverage and open defects by severity, beside workload and flaky tests',
    title: 'Bring it together for release decisions',
    body: 'Release readiness reports execution completion, pass rate, requirement coverage and open defects by severity. The release decision stays with your team.',
    scope: 'Sample data · one project',
    callouts: [
      { x: 1.2, y: 3, w: 32, h: 93.6, label: 'Readiness evidence for one project' },
      { x: 67, y: 3, w: 32, h: 93.6, label: 'Tests whose results keep flipping' },
    ],
  },
]
