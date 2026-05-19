export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  model: string
  messages: ChatMessage[]
}
