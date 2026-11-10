import { apiFetch } from '@/api/client'

export type CommentOwnerType = 'test_case' | 'defect' | 'execution_step'

export interface MentionedUser {
  id: string
  name: string
}

export interface Comment {
  id: string
  owner_type: CommentOwnerType
  owner_id: string
  body: string
  author_id: string
  author_name: string | null
  mentioned_users: MentionedUser[]
  created_at: string
}

const OWNER_PATH_SEGMENT: Record<CommentOwnerType, string> = {
  test_case: 'test-cases',
  defect: 'defects',
  execution_step: 'execution-steps',
}

export function listComments(ownerType: CommentOwnerType, ownerId: string): Promise<Comment[]> {
  return apiFetch<Comment[]>(`/${OWNER_PATH_SEGMENT[ownerType]}/${ownerId}/comments`)
}

export function createComment(
  ownerType: CommentOwnerType,
  ownerId: string,
  body: string,
  mentionedUserIds: string[] = [],
): Promise<Comment> {
  return apiFetch<Comment>(`/${OWNER_PATH_SEGMENT[ownerType]}/${ownerId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body, mentioned_user_ids: mentionedUserIds }),
  })
}

export function deleteComment(commentId: string): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(`/comments/${commentId}`, { method: 'DELETE' })
}
