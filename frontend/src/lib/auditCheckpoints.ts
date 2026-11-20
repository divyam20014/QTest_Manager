import type { ChainVerificationResult, CheckpointFailureReason } from '@/api/audit'

// ADR-085: plain-language text for the signed-checkpoint part of a chain
// verification, shared by the tenant Audit Logs page and the Platform Admin
// Audit tab so both say the same thing.
export const CHECKPOINT_FAILURE_LABEL: Record<CheckpointFailureReason, string> = {
  signature_invalid: 'a checkpoint signature is invalid (the checkpoint was altered or signed with a different key)',
  anchor_missing: 'a checkpointed audit record is missing (events were deleted)',
  anchor_hash_mismatch: 'a checkpointed audit record no longer matches its signed hash (the log was rewritten)',
  count_mismatch: 'the number of audit records before a checkpoint changed',
  checkpoint_chain_broken: 'the checkpoint chain is broken (a checkpoint was removed or reordered)',
}

export function checkpointStatusText(result: ChainVerificationResult): string {
  if (result.checkpoint_failure) {
    const reason = result.checkpoint_failure.reason
    return `Checkpoint verification FAILED (${reason}): ${CHECKPOINT_FAILURE_LABEL[reason] ?? reason}.`
  }
  if (result.checkpoints_checked === 0) {
    return 'No checkpoints yet. Create one to anchor this chain against rewrites.'
  }
  const n = result.checkpoints_checked
  return `${n} checkpoint${n === 1 ? '' : 's'} verified.`
}

export function createdCheckpointText(created: boolean, recordCount: number | null): string {
  return created
    ? `Checkpoint created, anchoring ${recordCount ?? 0} event${recordCount === 1 ? '' : 's'}.`
    : 'No new events since the last checkpoint.'
}
