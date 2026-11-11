import { useMutation } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { useState } from 'react'

import { queryAssistant } from '@/api/ai'
import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

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
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])

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

  function handleAsk() {
    const trimmed = question.trim()
    if (!trimmed) return
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }])
    setQuestion('')
    queryMutation.mutate(trimmed)
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Open AI Assistant"
      >
        <Bot className="size-4" />
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="AI Assistant" className="max-w-md">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[var(--muted-foreground)]">
            Ask about your test cases, requirements, or defects. AI-generated — verify independently
            before relying on it.
          </p>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {messages.length === 0 && (
              <p className="text-xs text-[var(--muted-foreground)]">
                e.g. "What's our requirement coverage for the Apex Motor Claims project?"
              </p>
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
