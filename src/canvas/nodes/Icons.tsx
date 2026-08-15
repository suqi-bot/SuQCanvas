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

export function HeadingIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 4v16M19 4v16" />
      <path d="M5 12h14" />
    </Base>
  )
}

export function StickyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 4h16v13l-4 3H4z" />
      <path d="M20 17h-4v4" />
      <path d="M8 8h8M8 12h5" />
    </Base>
  )
}

export function ShapeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3" y="3" width="12" height="9" rx="1.5" />
      <ellipse cx="15.5" cy="15.5" rx="5.5" ry="5.5" />
    </Base>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  )
}

export function HomeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </Base>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h11a5 5 0 0 1 5 5" />
    </Base>
  )
}

export function RedoIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M15 7l5 5-5 5" />
      <path d="M20 12H9a5 5 0 0 0-5 5" />
    </Base>
  )
}

export function ZoomInIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
    </Base>
  )
}

export function ZoomOutIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35M8 11h6" />
    </Base>
  )
}

export function FitIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Base>
  )
}

export function AlignLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6" y="4" width="12" height="6" rx="2" />
      <rect x="6" y="14" width="9" height="6" rx="2" />
    </Base>
  )
}

export function AlignCenterHIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6" y="4" width="12" height="6" rx="2" />
      <rect x="2" y="14" width="16" height="6" rx="2" />
    </Base>
  )
}

export function AlignRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="6" y="4" width="12" height="6" rx="2" />
      <rect x="9" y="14" width="12" height="6" rx="2" />
    </Base>
  )
}

export function AlignTopIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="6" width="6" height="12" rx="2" />
      <rect x="14" y="6" width="6" height="9" rx="2" />
    </Base>
  )
}

export function AlignCenterVIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="6" width="6" height="12" rx="2" />
      <rect x="14" y="2" width="6" height="16" rx="2" />
    </Base>
  )
}

export function AlignBottomIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="9" width="6" height="12" rx="2" />
      <rect x="14" y="6" width="6" height="12" rx="2" />
    </Base>
  )
}

export function DistributeHIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 9v6M20 9v6M8 7l-4 5 4 5M16 7l4 5-4 5" />
    </Base>
  )
}

export function DistributeVIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M9 4h6M9 20h6M7 8l5-4 5 4M7 16l5 4 5-4" />
    </Base>
  )
}

export function TextAlignLeftIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h12M4 12h16M4 18h10" />
    </Base>
  )
}

export function TextAlignCenterIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6h12M4 12h16M6 18h12" />
    </Base>
  )
}

export function TextAlignRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 6h12M4 12h16M10 18h10" />
    </Base>
  )
}

export function TextAlignJustifyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Base>
  )
}

export function TextAlignTopIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 4h16M6 8h12M8 12h8" />
    </Base>
  )
}

export function TextAlignMiddleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 8h12M4 12h16M6 16h12" />
    </Base>
  )
}

export function TextAlignBottomIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 8h8M6 12h12M4 16h16" />
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
    case 'heading':
      return <HeadingIcon {...props} />
    case 'sticky':
      return <StickyIcon {...props} />
    case 'shape':
      return <ShapeIcon {...props} />
    default:
      return <FileIcon {...props} />
  }
}
