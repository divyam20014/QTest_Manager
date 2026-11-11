import { useMutation, useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { queryAssistant } from '@/api/ai'
import { ApiError } from '@/api/client'
import { getSettings } from '@/api/settings'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const EXAMPLE_PROMPTS = [
  'What is our requirement coverage for this project?',
  'Which test cases are still in draft?',
  'Summarize open critical defects',
]

// Post-gap-closure pass / ADR-060: AI QA Assistant -- conversational Q&A
// over this tenant's own data. Session-scoped history only (not persisted
// server-side or across browser sessions) -- a first version, not a full
// chat-history product. Read-only: the assistant answers questions, it
// never creates/edits/deletes anything.
interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
}

export function AIAssistantPanel() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])

  // UX review bug #18: availability was unclear -- a tenant with AI
  // disabled got a silent/confusing failure on the first question instead
  // of being told up front. `getSettings` 403s for non-admins (same
  // pattern as every other Settings card); that's fine here -- a non-admin
  // just doesn't see the disabled-state banner and finds out on first ask,
  // same as before this change, not worse.
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings, enabled: open })
  const aiDisabled = settingsQuery.data?.ai_enabled === false

  const queryMutation = useMutation({
    mutationFn: queryAssistant,
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer }])
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.message : 'The assistant is unavailable.'
      setMessages((prev) => [...prev, { role: 'error', text: message }])
    },
  })

  function handleAsk(text?: string) {
    const trimmed = (text ?? question).trim()
    if (!trimmed) return
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }])
    setQuestion('')
    queryMutation.mutate(trimmed)
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Bot className="size-4" />
        Ask AI
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="AI Assistant" className="max-w-md">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            Ask about your test cases, requirements, or defects. AI-generated — verify independently
            before relying on it.
          </p>
          {aiDisabled && (
            <div className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-xs text-[var(--muted-foreground)]">
              AI features are disabled for your organization.
              {user?.permissions.includes('tenant.settings.manage') && (
                <>
                  {' '}
                  <Link to="/settings" className="text-[var(--link)] hover:underline">
                    Enable it in Settings →
                  </Link>
                </>
              )}
            </div>
          )}
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {messages.length === 0 && !aiDisabled && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-[var(--muted-foreground)]">Try asking:</p>
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => handleAsk(prompt)}
                    className="self-start rounded-full border border-[var(--border)] px-3 py-1 text-left text-xs text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'user'
                    ? 'self-end rounded-md bg-[var(--primary)] px-3 py-2 text-xs text-[var(--primary-foreground)]'
                    : m.role === 'error'
                      ? 'self-start rounded-md bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]'
                      : 'self-start rounded-md bg-[var(--muted)] px-3 py-2 text-xs text-[var(--foreground)]'
                }
              >
                {m.text}
              </div>
            ))}
            {queryMutation.isPending && (
              <div className="self-start rounded-md bg-[var(--muted)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                Thinking…
              </div>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              handleAsk()
            }}
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question…"
              disabled={queryMutation.isPending}
            />
            <Button type="submit" size="sm" disabled={queryMutation.isPending || !question.trim()}>
              Ask
            </Button>
          </form>
        </div>
      </Dialog>
    </>
  )
}
