import { logger } from '@/lib/logger'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'

export interface ApiEnvelope<T> {
  data: T | null
  error: { code: string; message: string } | null
}

export class ApiError extends Error {
  code: string

  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Let the browser set multipart/form-data (with boundary) itself; only
  // default to JSON when the caller isn't already sending FormData.
  const isFormData = init?.body instanceof FormData
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...init?.headers },
    ...init,
  })

  const body = (await response.json()) as ApiEnvelope<T>

  if (!response.ok || body.error) {
    const code = body.error?.code ?? 'unknown'
    const message = body.error?.message ?? 'Request failed'
    logger.error(`API ${init?.method ?? 'GET'} ${path} failed (${response.status})`, {
      code,
      message,
    })
    throw new ApiError(message, code)
  }

  return body.data as T
}
