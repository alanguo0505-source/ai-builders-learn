/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_BUILDERS_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
