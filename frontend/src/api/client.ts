const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })

  const body = (await response.json()) as ApiEnvelope<T>

  if (!response.ok || body.error) {
    throw new ApiError(body.error?.message ?? 'Request failed', body.error?.code ?? 'unknown')
  }

  return body.data as T
}
