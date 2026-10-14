/// <reference types="vite/client" />
import type { LookingglassApi } from '@lookingglass/shared/ipc'

declare global {
  interface Window {
    lookingglass: LookingglassApi
  }
}
