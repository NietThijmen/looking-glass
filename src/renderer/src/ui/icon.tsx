import type { LucideIcon } from 'lucide-react'
import type { PlanEntry, ToolKind } from '@agentclientprotocol/sdk'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  AtSign,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Crosshair,
  Diff,
  FileInput,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Image,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  X,
  XCircle,
  type LucideProps,
} from 'lucide-react'
import type { MentionOption } from '../agent/mentions'

/** Default Tailwind sizes for inline icons. */
export const iconSize = {
  xs: 'size-3 shrink-0',
  sm: 'size-3.5 shrink-0',
  md: 'size-4 shrink-0',
  lg: 'size-5 shrink-0',
} as const

export function Icon({
  icon: I,
  className,
  ...props
}: { icon: LucideIcon } & LucideProps) {
  return <I className={className ?? iconSize.sm} aria-hidden {...props} />
}

export function Chevron({ open, className }: { open: boolean; className?: string }) {
  const I = open ? ChevronDown : ChevronRight
  return <I className={className ?? iconSize.xs} aria-hidden />
}

/** Small status / busy indicator dot. */
export function StatusDot({ className }: { className?: string }) {
  return <Circle className={`${iconSize.xs} fill-current ${className ?? ''}`} aria-hidden />
}

export function PlanStatusIcon({ status }: { status: PlanEntry['status'] }) {
  switch (status) {
    case 'pending':
      return <Icon icon={Circle} className={iconSize.xs} />
    case 'in_progress':
      return <Icon icon={Loader2} className={`${iconSize.xs} animate-spin text-accent`} />
    case 'completed':
      return <Icon icon={Check} className={iconSize.xs} />
    default: {
      const _exhaustive: never = status
      return _exhaustive
    }
  }
}

export const mentionOptionIcon: Record<MentionOption['kind'], LucideIcon> = {
  file: FileText,
  folder: Folder,
  selection: Square,
  terminal: Terminal,
  'git-diff': Diff,
  browser: Globe,
  'browser-console': AlertTriangle,
}

export const toolKindIcon: Record<ToolKind, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: FileInput,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  switch_mode: ArrowLeftRight,
  other: Settings,
}

export {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AtSign,
  Check,
  Crosshair,
  Diff,
  GitBranch,
  Globe,
  Image,
  Paperclip,
  Plus,
  RotateCcw,
  RotateCw,
  Settings,
  Sparkles,
  Terminal,
  X,
  XCircle,
}
