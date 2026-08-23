/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MARKETING_CAPTURE_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __PLETHORA_APP_VERSION__: string;
declare const __PLETHORA_GIT_SHA__: string;
declare const __PLETHORA_BUILD_ID__: string;
