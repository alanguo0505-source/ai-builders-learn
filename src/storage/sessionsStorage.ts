import type { ChatSession } from '../types'

const SESSIONS_KEY = 'ai-builder-chat-sessions-v1'
const ACTIVE_KEY = 'ai-builder-chat-active-session'
const TOKEN_KEY = 'ai-builder-token'
const LAST_MODEL_KEY = 'ai-builder-last-model'

export const FALLBACK_MODELS = [
  'grok-4-fast',
  'supermind-agent-v1',
  'deepseek',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'kimi-k2.5',
  'gpt-5',
] as const

export function loadToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveToken(token: string): void {
  try {
    if (token.trim()) {
      localStorage.setItem(TOKEN_KEY, token.trim())
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    /* ignore quota */
  }
}

export function loadLastModel(): string | null {
  try {
    return localStorage.getItem(LAST_MODEL_KEY)
  } catch {
    return null
  }
}

export function saveLastModel(model: string): void {
  try {
    localStorage.setItem(LAST_MODEL_KEY, model)
  } catch {
    /* ignore */
  }
}

export function createSession(model: string): ChatSession {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    model,
    messages: [],
  }
}

export function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isChatSession)
  } catch {
    return []
  }
}

export function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  } catch {
    /* ignore */
  }
}

export function loadActiveSessionId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function saveActiveSessionId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    /* ignore */
  }
}

function isChatSession(v: unknown): v is ChatSession {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    typeof o.createdAt === 'number' &&
    typeof o.updatedAt === 'number' &&
    typeof o.model === 'string' &&
    Array.isArray(o.messages)
  )
}
