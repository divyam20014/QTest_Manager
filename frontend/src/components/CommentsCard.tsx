import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createComment, deleteComment, listComments, type CommentOwnerType } from '@/api/comments'
import { ApiError } from '@/api/client'
import { listUsers } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'

// Phase 8 (AI/SaaS vision roadmap, GAP-74): reuses the exact same
// polymorphic owner_type pattern Phase 7's AttachmentsCard established --
// mentions are picked explicitly from a dropdown rather than parsed out of
// free-text @-tokens, which is simpler and can't misfire on duplicate names.
export function CommentsPanel({
  ownerType,
  ownerId,
}: {
  ownerType: CommentOwnerType
  ownerId: string
}) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const queryKey = ['comments', ownerType, ownerId]
  const [body, setBody] = useState('')
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([])

  const commentsQuery = useQuery({ queryKey, queryFn: () => listComments(ownerType, ownerId) })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })

  const createMutation = useMutation({
    mutationFn: () => createComment(ownerType, ownerId, body, mentionedUserIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setBody('')
      setMentionedUserIds([])
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null
  const canManage = user?.role === 'admin' || user?.role === 'manager'

  function toggleMention(userId: string) {
    setMentionedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Textarea
          aria-label="New comment"
          placeholder="Add a comment…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label="Mention a user"
            value=""
            onChange={(e) => {
              if (e.target.value) toggleMention(e.target.value)
            }}
            className="w-48"
          >
            <option value="">Mention someone…</option>
            {(usersQuery.data ?? [])
              .filter((u) => !mentionedUserIds.includes(u.id))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </Select>
          {mentionedUserIds.map((id) => {
            const name = usersQuery.data?.find((u) => u.id === id)?.name ?? id
            return (
              <span
                key={id}
                className="flex items-center gap-1 rounded-full bg-[var(--muted)] px-2 py-0.5 text-xs"
              >
                @{name}
                <button
                  type="button"
                  aria-label={`Remove mention of ${name}`}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  onClick={() => toggleMention(id)}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
        {createError && <p className="text-xs text-[var(--destructive)]">{createError}</p>}
        <div>
          <Button
            size="sm"
            disabled={!body.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Posting…' : 'Post Comment'}
          </Button>
        </div>
      </div>

      {commentsQuery.data?.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">No comments yet.</p>
      )}
      <ul className="flex flex-col gap-3 text-sm">
        {commentsQuery.data?.map((c) => {
          const canDelete = canManage || c.author_id === user?.user_id
          return (
            <li key={c.id} className="border-b border-[var(--border)] pb-2 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-[var(--muted-foreground)]">
                    <span className="font-medium text-[var(--foreground)]">
                      {c.author_name ?? 'Unknown'}
                    </span>{' '}
                    · {new Date(c.created_at).toLocaleString()}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
                  {c.mentioned_users.length > 0 && (
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Mentioned: {c.mentioned_users.map((m) => m.name).join(', ')}
                    </p>
                  )}
                </div>
                {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(c.id)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function CommentsCard({
  ownerType,
  ownerId,
  title = 'Comments',
}: {
  ownerType: CommentOwnerType
  ownerId: string
  title?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CommentsPanel ownerType={ownerType} ownerId={ownerId} />
      </CardContent>
    </Card>
  )
}
