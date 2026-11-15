import './qc.css'

import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ClipboardList,
  FileSearch,
  PlayCircle,
  Rocket,
  Target,
  type LucideIcon,
} from 'lucide-react'
import { type CSSProperties, useState } from 'react'

import type { Availability } from './content'
import { AvailabilityBadge } from './shared'

type NodeId = 'requirements' | 'cases' | 'runs' | 'defects' | 'release' | 'risk'

interface Crop {
  src: string
  natW: number
  natH: number
  x: number
  y: number
  w: number
  h: number
  alt: string
}

interface CenterNode {
  id: NodeId
  label: string
  icon: LucideIcon
  status: Availability
  /** Centre of the node on the 1000 x 500 map, as a percentage. */
  x: number
  y: number
  holds: string
  powers: string
  note?: string
  /** Figures visible in the sample screenshots, so the text never disagrees with the image. */
  stats?: Array<[value: string, label: string]>
  crop?: Crop
}

interface CenterEdge {
  id: string
  from: NodeId
  to: NodeId
  label: string
  text: string
  planned?: boolean
  /** Path and label position on the 1000 x 500 map. */
  path: string
  lx: number
  ly: number
  anchor?: 'start' | 'middle'
}

/** What each part of the picture is and does. Every "Available" statement was
 * checked against the backend: the traceability matrix and coverage report,
 * the run and defect models (a defect records its test case, run and step),
 * and get_release_readiness. */
const NODES: CenterNode[] = [
  {
    id: 'requirements',
    label: 'Requirements',
    icon: FileSearch,
    status: 'available',
    x: 12.5,
    y: 35,
    holds: 'Business requirements, with versions and the test cases linked to each one.',
    powers:
      'Requirement coverage and uncovered-requirement flags. Requirement change impact analysis flags the linked tests that may need review.',
    note: 'Impact analysis is AI-assisted and enabled per organization.',
    stats: [
      ['88.9%', 'requirement coverage'],
      ['8 of 9', 'requirements with a linked test'],
    ],
    crop: {
      src: '/marketing/requirements.jpg',
      natW: 1440,
      natH: 900,
      x: 264,
      y: 131,
      w: 1152,
      h: 175,
      alt: 'Requirements list showing 8 of 9 requirements with at least one linked test case, and one requirement with none',
    },
  },
  {
    id: 'cases',
    label: 'Test Cases',
    icon: ClipboardList,
    status: 'available',
    x: 37.5,
    y: 35,
    holds:
      'Structured test cases in one repository, with steps, expected results, versions and a review and approval workflow.',
    powers:
      'What is ready to execute and what each requirement is covered by. AI-assisted drafting and review are available where enabled.',
    note: 'AI-assisted drafting and review are enabled per organization.',
    stats: [
      ['160', 'test cases'],
      ['74%', 'approved'],
    ],
    crop: {
      src: '/marketing/repository.jpg',
      natW: 1440,
      natH: 900,
      x: 264,
      y: 209,
      w: 1152,
      h: 190,
      alt: 'Test repository listing test cases with project, status, priority and assignee',
    },
  },
  {
    id: 'runs',
    label: 'Test Runs',
    icon: PlayCircle,
    status: 'available',
    x: 62.5,
    y: 35,
    holds:
      'Test runs, such as a sprint regression, with each test case assigned to a tester and each step passed, failed or ignored.',
    powers: 'Execution completion, pass rate, trends over time, and tests whose results keep flipping.',
    stats: [
      ['6', 'active test runs'],
      ['95%', 'of steps passing'],
    ],
    crop: {
      src: '/marketing/run-detail.jpg',
      natW: 1440,
      natH: 900,
      x: 264,
      y: 85,
      w: 1152,
      h: 260,
      alt: 'A sprint regression test run listing test cases with status, step progress and assignee',
    },
  },
  {
    id: 'defects',
    label: 'Defects',
    icon: Bug,
    status: 'available',
    x: 62.5,
    y: 82,
    holds: 'Defects with severity, priority, status and SLA, linked to the test case, run and step that found them.',
    powers: 'Defect trends, aging against SLA, and open defects by severity.',
    stats: [
      ['28', 'open defects'],
      ['6', 'critical'],
    ],
    crop: {
      src: '/marketing/defects.jpg',
      natW: 1440,
      natH: 900,
      x: 264,
      y: 259,
      w: 1152,
      h: 335,
      alt: 'Defect list with severity, priority, status and SLA columns, including defects that breached their SLA',
    },
  },
  {
    id: 'release',
    label: 'Release Readiness',
    icon: Rocket,
    status: 'available',
    x: 87.5,
    y: 35,
    holds: 'No separate records. It is a view that brings the other parts together for one project.',
    powers:
      'Execution completion, pass rate, requirement coverage and open defects by severity in one place. It reports the evidence; the release decision stays with your team.',
    stats: [
      ['91.7%', 'execution completion'],
      ['83.3%', 'pass rate'],
      ['88.9%', 'requirement coverage'],
    ],
    crop: {
      src: '/marketing/readiness.jpg',
      natW: 1184,
      natH: 472,
      x: 0,
      y: 0,
      w: 1184,
      h: 472,
      alt: 'Release readiness showing 91.7% execution completion, 83.3% pass rate, 88.9% requirement coverage and open defects by severity',
    },
  },
  {
    id: 'risk',
    label: 'Risk-Based Testing',
    icon: Target,
    status: 'planned',
    x: 12.5,
    y: 82,
    holds:
      'Highlighting high-risk areas from requirement criticality, defect history, coverage and execution outcomes.',
    powers:
      'Prioritising test scope by risk, and recommending which regression tests to run for a change, with the reasoning behind each pick.',
  },
]

const EDGES: CenterEdge[] = [
  {
    id: 'req-cases',
    from: 'requirements',
    to: 'cases',
    label: 'Traceability',
    text: 'Each requirement is linked to the test cases that verify it, so coverage and gaps show up in the traceability matrix.',
    path: 'M200 175 L294 175',
    lx: 250,
    ly: 157,
  },
  {
    id: 'cases-runs',
    from: 'cases',
    to: 'runs',
    label: 'Execution',
    text: 'Test cases are added to test runs, where each step is passed, failed or ignored.',
    path: 'M450 175 L544 175',
    lx: 500,
    ly: 157,
  },
  {
    id: 'runs-release',
    from: 'runs',
    to: 'release',
    label: 'Pass rate',
    text: 'Execution completion and pass rate come from the run results.',
    path: 'M700 175 L794 175',
    lx: 750,
    ly: 157,
  },
  {
    id: 'runs-defects',
    from: 'runs',
    to: 'defects',
    label: 'Failures',
    text: 'A failed step can be raised as a defect that records the test case, run and step it came from.',
    path: 'M625 222 L625 357',
    lx: 641,
    ly: 296,
    anchor: 'start',
  },
  {
    id: 'defects-release',
    from: 'defects',
    to: 'release',
    label: 'Open defects',
    text: 'Open defects are counted by severity.',
    path: 'M700 410 C875 410 875 320 875 228',
    lx: 716,
    ly: 430,
    anchor: 'start',
  },
  {
    id: 'req-release',
    from: 'requirements',
    to: 'release',
    label: 'Coverage',
    text: 'Requirement coverage is the share of requirements with at least one linked test case.',
    path: 'M125 128 C125 30 875 30 875 122',
    lx: 500,
    ly: 44,
  },
  {
    id: 'req-risk',
    from: 'requirements',
    to: 'risk',
    label: 'Criticality',
    text: 'How critical a requirement is would inform where risk is highest.',
    planned: true,
    path: 'M100 222 L100 357',
    lx: 114,
    ly: 296,
    anchor: 'start',
  },
  {
    id: 'defects-risk',
    from: 'defects',
    to: 'risk',
    label: 'History',
    text: 'Defect history would inform where risk is highest.',
    planned: true,
    path: 'M550 410 L206 410',
    lx: 378,
    ly: 393,
  },
  {
    id: 'risk-cases',
    from: 'risk',
    to: 'cases',
    label: 'Scope',
    text: 'Risk would guide which test cases to prioritise or run for a change.',
    planned: true,
    path: 'M160 363 C160 290 375 300 375 228',
    lx: 292,
    ly: 324,
    anchor: 'start',
  },
]

const NODE_BY_ID = Object.fromEntries(NODES.map((n) => [n.id, n])) as Record<NodeId, CenterNode>
const STATUS_TEXT: Record<Availability, string> = {
  available: 'available today',
  partial: 'partly available',
  planned: 'planned, not available yet',
}

/** Fetches a node's screenshot ahead of the click so switching nodes doesn't flash an empty frame. */
function preload(node: CenterNode) {
  if (node.crop) new Image().src = node.crop.src
}

/** Shows a region of a screenshot at its true proportions, without cropping the file. */
function Crop({ crop }: { crop: Crop }) {
  return (
    <div className="lp-qc-crop" style={{ aspectRatio: `${crop.w} / ${crop.h}` }}>
      <img
        src={crop.src}
        alt={crop.alt}
        width={crop.natW}
        height={crop.natH}
        loading="lazy"
        decoding="async"
        style={{
          width: `${(crop.natW / crop.w) * 100}%`,
          marginLeft: `${(-crop.x / crop.w) * 100}%`,
          marginTop: `${(-crop.y / crop.w) * 100}%`,
        }}
      />
    </div>
  )
}

export default function QualityIntelligenceCenter() {
  const [selected, setSelected] = useState<NodeId>('release')
  const node = NODE_BY_ID[selected]
  const connected = EDGES.filter((e) => e.from === selected || e.to === selected)
  const related = new Set(connected.flatMap((e) => [e.from, e.to]))

  return (
    <div className="lp-qc lp-dark">
      <div className="lp-qc-bar">
        <p>Select a part of the picture to see how it connects.</p>
        <ul className="lp-qc-key" aria-hidden="true">
          <li>
            <i className="lp-qc-key-solid" />
            Available today
          </li>
          <li>
            <i className="lp-qc-key-dashed" />
            Planned
          </li>
        </ul>
      </div>

      <div className="lp-qc-map">
        <svg className="lp-qc-svg" viewBox="0 0 1000 500" aria-hidden="true" focusable="false">
          <defs>
            <marker
              id="lp-qc-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="#64748b" />
            </marker>
            <marker
              id="lp-qc-arrow-active"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="#c7d2fe" />
            </marker>
            <marker
              id="lp-qc-arrow-planned"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0 0 L10 5 L0 10 z" fill="#f59e0b" />
            </marker>
          </defs>
          {EDGES.map((edge) => {
            const active = edge.from === selected || edge.to === selected
            const state = active ? 'active' : 'dim'
            const marker = edge.planned ? 'planned' : active ? 'active' : 'idle'
            return (
              <g key={edge.id}>
                <path
                  d={edge.path}
                  className="lp-qc-edge"
                  data-state={state}
                  data-planned={edge.planned ? 'true' : undefined}
                  vectorEffect="non-scaling-stroke"
                  markerEnd={`url(#lp-qc-arrow${marker === 'idle' ? '' : `-${marker}`})`}
                />
                <text
                  x={edge.lx}
                  y={edge.ly}
                  textAnchor={edge.anchor ?? 'middle'}
                  className="lp-qc-elabel"
                  data-state={state}
                  data-planned={edge.planned ? 'true' : undefined}
                >
                  {edge.label}
                </text>
              </g>
            )
          })}
        </svg>

        {NODES.map((n) => {
          const Icon = n.icon
          return (
            <button
              key={n.id}
              type="button"
              className="lp-qc-node"
              style={{ '--x': `${n.x}%`, '--y': `${n.y}%` } as CSSProperties}
              data-planned={n.status === 'planned' ? 'true' : undefined}
              data-related={related.has(n.id) ? 'true' : undefined}
              aria-pressed={selected === n.id}
              aria-controls="lp-qc-detail"
              onClick={() => setSelected(n.id)}
              onPointerEnter={() => preload(n)}
              onFocus={() => preload(n)}
            >
              <span className="lp-qc-node-icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="lp-qc-node-label">{n.label}</span>
              {n.status === 'planned' && <span className="lp-qc-node-tag">Planned</span>}
              <span className="sr-only">, {STATUS_TEXT[n.status]}</span>
            </button>
          )
        })}
      </div>

      <div
        id="lp-qc-detail"
        key={selected}
        className="lp-qc-detail"
        role="region"
        aria-label={`${node.label} details`}
        aria-live="polite"
      >
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="lp-qc-detail-title">{node.label}</h3>
            <AvailabilityBadge status={node.status} />
          </div>
          {node.note && <p className="lp-qc-detail-note">{node.note}</p>}
          <dl className="lp-qc-facts">
            <div>
              <dt>{node.status === 'planned' ? 'The idea' : 'What it holds'}</dt>
              <dd>{node.holds}</dd>
            </div>
            <div>
              <dt>{node.status === 'planned' ? 'What it would do' : 'The insight it powers'}</dt>
              <dd>{node.powers}</dd>
            </div>
          </dl>
          <h4 className="lp-qc-links-title">Connected to</h4>
          <ul className="lp-qc-links">
            {connected.map((edge) => {
              const outgoing = edge.from === selected
              const other = NODE_BY_ID[outgoing ? edge.to : edge.from]
              return (
                <li key={edge.id}>
                  {outgoing ? (
                    <ArrowRight className="lp-qc-dir" aria-hidden="true" />
                  ) : (
                    <ArrowLeft className="lp-qc-dir" aria-hidden="true" />
                  )}
                  <span>
                    <span className="lp-qc-link-head">
                      {outgoing ? 'To' : 'From'} <b>{other.label}</b> &middot; {edge.label}
                      {edge.planned && <AvailabilityBadge status="planned" />}
                    </span>
                    <span className="lp-qc-link-text">{edge.text}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="lp-qc-media">
          {node.crop ? (
            <>
              {node.stats && (
                <dl className="lp-qc-stats">
                  {node.stats.map(([value, label]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <Crop crop={node.crop} />
              <p className="lp-qc-caption">
                Real product screenshot &middot; sample data from a fictional organization.
              </p>
            </>
          ) : (
            <div className="lp-qc-roadmap">
              <p className="lp-qc-roadmap-title">On the roadmap</p>
              <p>
                Risk-based testing and regression recommendations are planned. They are not available in QTestHub today,
                so there is nothing to show yet.
              </p>
            </div>
          )}
        </div>
      </div>

      <ul
        className="sr-only"
        aria-label="Relationships between requirements, tests, runs, defects and release readiness"
      >
        {EDGES.map((edge) => (
          <li key={edge.id}>
            {NODE_BY_ID[edge.from].label} to {NODE_BY_ID[edge.to].label}, {edge.label}: {edge.text}
            {edge.planned ? ' Planned, not available yet.' : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
