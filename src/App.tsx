import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  streamChatCompletion,
  fetchModelIds,
  fetchPlatformHealth,
} from './api/aiBuilders'
import type { ChatMessage, ChatSession } from './types'
import {
  createSession,
  FALLBACK_MODELS,
  loadActiveSessionId,
  loadLastModel,
  loadSessions,
  loadToken,
  saveActiveSessionId,
  saveLastModel,
  saveSessions,
  saveToken,
} from './storage/sessionsStorage'
import './App.css'

function initialWorkspace(): { sessions: ChatSession[]; activeId: string } {
  const loaded = loadSessions()
  const model = loadLastModel() ?? FALLBACK_MODELS[0]
  if (loaded.length > 0) {
    let aid = loadActiveSessionId()
    if (!aid || !loaded.some((s) => s.id === aid)) {
      aid = loaded[0].id
    }
    return { sessions: loaded, activeId: aid }
  }
  const s = createSession(model)
  return { sessions: [s], activeId: s.id }
}

function sliceTitle(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= 56) return t || 'New chat'
  return `${t.slice(0, 56)}…`
}

export default function App() {
  const init = useMemo(() => initialWorkspace(), [])
  const [sessions, setSessions] = useState<ChatSession[]>(init.sessions)
  const [activeId, setActiveId] = useState<string>(init.activeId)
  const [tokenInput, setTokenInput] = useState(loadToken)
  const [savedToken, setSavedToken] = useState(loadToken)
  const [models, setModels] = useState<string[]>(() => [...FALLBACK_MODELS])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [platformAuth, setPlatformAuth] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0]

  useEffect(() => {
    saveSessions(sessions)
  }, [sessions])

  useEffect(() => {
    saveActiveSessionId(activeId)
  }, [activeId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeSession?.messages, streaming])

  const canChat = platformAuth || savedToken.trim().length > 0

  const refreshModels = useCallback(async (token: string) => {
    if (!platformAuth && !token.trim()) {
      setModels([...FALLBACK_MODELS])
      setModelsError(null)
      return
    }
    try {
      const ids = await fetchModelIds(token.trim())
      if (ids.length > 0) {
        setModels(ids)
      }
      setModelsError(null)
    } catch (e) {
      setModelsError(e instanceof Error ? e.message : 'Could not load models')
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const health = await fetchPlatformHealth()
      if (health.hasPlatformToken) {
        setPlatformAuth(true)
        void refreshModels('')
        return
      }
      void refreshModels(savedToken)
    })()
  }, [savedToken, refreshModels])

  useEffect(() => {
    if (platformAuth) void refreshModels('')
  }, [platformAuth, refreshModels])

  useEffect(() => {
    if (models.length === 0) return
    setSessions((prev) => {
      const cur = prev.find((s) => s.id === activeId)
      if (!cur || models.includes(cur.model)) return prev
      const fallback = models[0]
      saveLastModel(fallback)
      return prev.map((s) =>
        s.id === activeId ? { ...s, model: fallback, updatedAt: Date.now() } : s
      )
    })
  }, [models, activeId])

  const handleSaveToken = () => {
    const next = tokenInput.trim()
    saveToken(next)
    setSavedToken(next)
    void refreshModels(next)
  }

  const handleNewChat = () => {
    const model = activeSession?.model ?? loadLastModel() ?? models[0] ?? FALLBACK_MODELS[0]
    const s = createSession(model)
    setSessions((prev) => [s, ...prev])
    setActiveId(s.id)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      const next = prev.filter((s) => s.id !== id)
      if (next.length === 0) {
        const m = loadLastModel() ?? models[0] ?? FALLBACK_MODELS[0]
        const fresh = createSession(m)
        queueMicrotask(() => setActiveId(fresh.id))
        return [fresh]
      }
      if (id === activeId) {
        const neighbor = prev[idx + 1] ?? prev[idx - 1]
        if (neighbor) queueMicrotask(() => setActiveId(neighbor.id))
      }
      return next
    })
  }

  const handleModelChange = (model: string) => {
    saveLastModel(model)
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, model, updatedAt: Date.now() } : s))
    )
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleSend = async (raw: string) => {
    const text = raw.trim()
    const token = savedToken.trim()
    if (!text || streaming || !activeSession) return
    if (!platformAuth && !token) return

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    }
    const assistantId = crypto.randomUUID()
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    }

    const sid = activeSession.id
    const priorMessages = activeSession.messages

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sid) return s
        const nextTitle =
          s.messages.length === 0 && s.title === 'New chat'
            ? sliceTitle(userMsg.content)
            : s.title
        return {
          ...s,
          title: nextTitle,
          updatedAt: Date.now(),
          messages: [...s.messages, userMsg, assistantPlaceholder],
        }
      })
    )

    const apiMessages = [...priorMessages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }))

    setStreaming(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      await streamChatCompletion(
        token,
        {
          model: activeSession.model,
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 4096,
        },
        (delta) => {
          setSessions((p) =>
            p.map((session) => {
              if (session.id !== sid) return session
              return {
                ...session,
                messages: session.messages.map((m) =>
                  m.id === assistantId ? { ...m, content: m.content + delta } : m
                ),
              }
            })
          )
        },
        ctrl.signal
      )
    } catch (e) {
      const aborted =
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError')
      if (!aborted) {
        const msg = e instanceof Error ? e.message : 'Request failed'
        setSessions((p) =>
          p.map((session) => {
            if (session.id !== sid) return session
            return {
              ...session,
              messages: session.messages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content:
                        m.content +
                        (m.content ? '\n\n' : '') +
                        `[Error] ${msg}`,
                    }
                  : m
              ),
            }
          })
        )
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  )

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <p className="brand">Chat with Alan</p>
          <button type="button" className="new-chat-btn" onClick={handleNewChat}>
            + New chat
          </button>
        </div>
        <div className="session-list" role="list">
          {sortedSessions.map((s) => (
            <div
              key={s.id}
              className={`session-row${s.id === activeId ? ' active' : ''}`}
              role="listitem"
            >
              <button
                type="button"
                className="session-item"
                onClick={() => setActiveId(s.id)}
              >
                <span className="session-title">{s.title}</span>
              </button>
              <button
                type="button"
                className="session-delete"
                aria-label="Delete chat"
                title="Delete"
                onClick={(e) => handleDeleteSession(s.id, e)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-footer">
          <label className="token-label" htmlFor="api-token">
            AI Builders API token
          </label>
          <input
            id="api-token"
            className="token-input"
            type="password"
            autoComplete="off"
            placeholder="Paste token (stored locally)"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button
            type="button"
            className="save-token-btn"
            onClick={handleSaveToken}
            disabled={!tokenInput.trim()}
          >
            Save token & load models
          </button>
          <p className="hint">
            Local dev only. On ai-builders.space the platform token is injected automatically.
          </p>
        </div>
      </aside>

      <main className="main">
        <header className="toolbar">
          <select
            className="model-select"
            aria-label="Model"
            value={activeSession?.model ?? models[0]}
            onChange={(e) => handleModelChange(e.target.value)}
          >
            {models.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <div className="toolbar-spacer" />
          {streaming ? (
            <button type="button" className="stop-btn" onClick={handleStop}>
              Stop
            </button>
          ) : null}
        </header>

        {modelsError ? (
          <div className="api-banner" role="status">
            Models API: {modelsError} (using fallback list — chats still work if your token is valid).
          </div>
        ) : null}

        <div className="messages">
          {activeSession && activeSession.messages.length === 0 ? (
            <div className="welcome">
              <p>
                <strong>How can I help you today?</strong>
              </p>
              <p>
                Choose a model above and send a message. On ai-builders.space you are signed in
                automatically; locally, paste your token in the sidebar first.
              </p>
            </div>
          ) : null}

          {activeSession?.messages.map((m, i, arr) => {
            const last = i === arr.length - 1
            const streamingThis = Boolean(streaming && m.role === 'assistant' && last)
            return (
              <MessageBubble key={m.id} message={m} streamingThis={streamingThis} />
            )
          })}
          <div ref={messagesEndRef} />
        </div>

        <Composer
          ref={textareaRef}
          disabled={!canChat || streaming}
          onSend={(t) => {
            void handleSend(t)
          }}
        />
      </main>
    </div>
  )
}

function MessageBubble({
  message,
  streamingThis,
}: {
  message: ChatMessage
  streamingThis: boolean
}) {
  const isUser = message.role === 'user'
  return (
    <div className="msg-row">
      <div className="msg-inner">
        <div className={`msg-avatar ${isUser ? 'user' : 'assistant'}`}>{isUser ? 'You' : 'AI'}</div>
        <div className="msg-body">
          <div className="msg-role-label">{isUser ? 'You' : 'Assistant'}</div>
          <div
            className={`msg-text${streamingThis ? ' streaming' : ''}`}
          >
            {message.content || (streamingThis ? '' : '\u00a0')}
          </div>
        </div>
      </div>
    </div>
  )
}

const Composer = forwardRef<
  HTMLTextAreaElement,
  { disabled: boolean; onSend: (text: string) => void }
>(function Composer({ disabled, onSend }, ref) {
  const [value, setValue] = useState('')

  const submit = () => {
    if (!value.trim() || disabled) return
    onSend(value)
    setValue('')
    requestAnimationFrame(() => {
      const el = typeof ref === 'function' ? null : ref?.current
      if (el) {
        el.style.height = 'auto'
      }
    })
  }

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={ref}
          rows={1}
          placeholder={
            disabled ? 'Save your API token in the sidebar to chat…' : 'Message AI Builders…'
          }
          value={value}
          disabled={disabled}
          onChange={(e) => {
            setValue(e.target.value)
            const el = e.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          type="button"
          className="send-btn"
          disabled={disabled || !value.trim()}
          aria-label="Send"
          onClick={submit}
        >
          ↑
        </button>
      </div>
    </div>
  )
})
