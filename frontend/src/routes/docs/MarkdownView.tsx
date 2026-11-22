import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Link } from 'react-router-dom'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import type { DocSummary } from '@/api/docs'
import { findDocBySourceLink } from '@/routes/docs/docsManifest'
import { MermaidDiagram } from '@/routes/docs/MermaidDiagram'

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS = [rehypeSlug]

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node as ReactElement<{ children?: ReactNode }>).props.children)
  return ''
}

/**
 * Renders a document's Markdown. Raw HTML inside the text is never executed
 * (react-markdown shows it as text and no rehype-raw is used), URLs go through
 * react-markdown's own sanitiser, and external links open in a new tab.
 */
export function MarkdownView({
  source,
  docs,
  basePath = '',
}: {
  source: string
  docs: readonly DocSummary[]
  /** Where document links point, e.g. "/platform-admin/docs". */
  basePath?: string
}) {
  const components: Components = {
    pre({ children }) {
      const child = Children.toArray(children)[0]
      if (isValidElement(child)) {
        const props = (child as ReactElement<{ className?: string; children?: ReactNode }>).props
        if (/\blanguage-mermaid\b/.test(props.className ?? '')) {
          return <MermaidDiagram source={textOf(props.children).replace(/\n$/, '')} />
        }
      }
      // Focusable so a long line can be scrolled with the keyboard.
      return <pre tabIndex={0}>{children}</pre>
    },
    table({ children }) {
      return (
        <div className="brd-table-wrap" tabIndex={0} role="region" aria-label="Table (scrolls sideways)">
          <table>{children}</table>
        </div>
      )
    },
    a({ href, children }: ComponentProps<'a'>) {
      if (!href) return <>{children}</>
      if (href.startsWith('#')) return <a href={href}>{children}</a>
      if (/^https?:\/\//i.test(href)) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      }
      if (/^mailto:/i.test(href)) return <a href={href}>{children}</a>
      // A relative link: another bundled document, or a repo file the viewer
      // does not carry (code, diagram sources) -- shown as plain text, never as
      // a link that would 404.
      // `docs` is only what this user may open, so a link to a document they
      // cannot read is shown as plain text.
      const target = findDocBySourceLink(href, docs)
      if (target) {
        const hash = href.includes('#') ? `#${href.split('#')[1]}` : ''
        return <Link to={`${basePath}/${target.slug}${hash}`}>{children}</Link>
      }
      return (
        <span className="brd-unlinked" title="Not available in the in-app viewer">
          {children}
        </span>
      )
    },
    img({ src, alt }: ComponentProps<'img'>) {
      if (typeof src === 'string' && /^(https?:|data:image\/)/i.test(src)) {
        return <img src={src} alt={alt ?? ''} loading="lazy" />
      }
      return <span className="brd-unlinked">{alt ? `[${alt}]` : '[image]'}</span>
    },
  }

  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
      {source}
    </ReactMarkdown>
  )
}
