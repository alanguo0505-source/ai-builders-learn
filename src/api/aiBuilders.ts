const DEFAULT_BASE = 'https://space.ai-builders.com/backend/v1'

export function usesPlatformProxy(): boolean {
  return import.meta.env.PROD
}

export function getApiBase(): string {
  if (usesPlatformProxy()) return '/api'
  const raw = import.meta.env.VITE_AI_BUILDERS_API_BASE?.trim()
  return raw && raw.length > 0 ? raw.replace(/\/$/, '') : DEFAULT_BASE
}

export async function fetchPlatformHealth(): Promise<{
  ok: boolean
  hasPlatformToken: boolean
}> {
  if (!usesPlatformProxy()) {
    return { ok: true, hasPlatformToken: false }
  }
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return { ok: false, hasPlatformToken: false }
    const json = (await res.json()) as { hasPlatformToken?: boolean }
    return { ok: true, hasPlatformToken: Boolean(json.hasPlatformToken) }
  } catch {
    return { ok: false, hasPlatformToken: false }
  }
}

function authHeaders(token: string): HeadersInit {
  if (usesPlatformProxy()) return {}
  return { Authorization: `Bearer ${token}` }
}

export async function fetchModelIds(token: string): Promise<string[]> {
  const base = getApiBase()
  const res = await fetch(`${base}/models`, {
    headers: authHeaders(token),
  })
  if (!res.ok) {
    throw new Error((await res.text()) || `Models request failed (${res.status})`)
  }
  const json: unknown = await res.json()
  if (
    typeof json === 'object' &&
    json !== null &&
    'data' in json &&
    Array.isArray((json as { data: unknown }).data)
  ) {
    return (json as { data: { id: string }[] }).data.map((m) => m.id)
  }
  return []
}

export interface ChatCompletionArgs {
  model: string
  messages: { role: string; content: string }[]
  temperature?: number
  max_tokens?: number
}

export async function streamChatCompletion(
  token: string,
  args: ChatCompletionArgs,
  onDelta: (text: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const base = getApiBase()
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      ...authHeaders(token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...args,
      stream: true,
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error((await res.text()) || `Chat request failed (${res.status})`)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('Response had no body to stream')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl < 0) break
      const line = buffer.slice(0, nl).trimEnd()
      buffer = buffer.slice(nl + 1)

      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return

      try {
        const json = JSON.parse(payload) as {
          choices?: { delta?: { content?: string | null } }[]
        }
        const delta = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) {
          onDelta(delta)
        }
      } catch {
        /* ignore malformed SSE fragments */
      }
    }
  }
}