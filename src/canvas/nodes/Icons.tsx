import type { SVGProps } from 'react'
import type { MediaKind } from '../../types'

type IconProps = SVGProps<SVGSVGElement>

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="1em"
      height="1em"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M21 16l-5-5-9 9" />
    </Base>
  )
}

export function VideoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </Base>
  )
}

export function AudioIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 18V6l10-2v12" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </Base>
  )
}

export function TextIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6V4h16v2" />
      <path d="M12 4v16" />
      <path d="M8 20h8" />
    </Base>
  )
}

export function PdfIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h5" />
    </Base>
  )
}

export function FileIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </Base>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Base>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Base>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 4l14 8-14 8z" fill="currentColor" strokeWidth="0" />
    </Base>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" strokeWidth="0" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" strokeWidth="0" />
    </Base>
  )
}

export function VolumeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" strokeWidth="0" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </Base>
  )
}

export function MuteIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" strokeWidth="0" />
      <path d="M23 9l-6 6M17 9l6 6" />
    </Base>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Base>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Base>
  )
}

export function KindIcon({ kind, ...props }: IconProps & { kind: MediaKind }) {
  switch (kind) {
    case 'image':
      return <ImageIcon {...props} />
    case 'video':
      return <VideoIcon {...props} />
    case 'audio':
      return <AudioIcon {...props} />
    case 'text':
      return <TextIcon {...props} />
    case 'pdf':
      return <PdfIcon {...props} />
    default:
      return <FileIcon {...props} />
  }
}
