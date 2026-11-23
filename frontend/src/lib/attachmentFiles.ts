import { validateAttachmentFile } from '@/api/attachments'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Splits files into the ones the attachment rules accept and a message per refused file. */
export function screenFiles(files: File[], existing: File[] = []): { accepted: File[]; rejected: string[] } {
  const accepted: File[] = []
  const rejected: string[] = []
  for (const file of files) {
    const duplicate = [...existing, ...accepted].some((f) => f.name === file.name && f.size === file.size)
    if (duplicate) {
      rejected.push(`${file.name}: already added`)
      continue
    }
    const problem = validateAttachmentFile(file)
    if (problem) rejected.push(`${file.name}: ${problem}`)
    else accepted.push(file)
  }
  return { accepted, rejected }
}
