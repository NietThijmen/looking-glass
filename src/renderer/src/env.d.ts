/// <reference types="vite/client" />
import type { LookingglassApi } from '../../shared/ipc'

declare global {
  interface Window {
    lookingglass: LookingglassApi
  }
}
