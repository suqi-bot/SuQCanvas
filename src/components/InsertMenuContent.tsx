import { STICKY_COLORS } from '../types'
import { TextIcon, HeadingIcon, StickyIcon, ShapeIcon } from '../canvas/nodes/Icons'
type InsertKind = 'ai' | 'text' | 'heading' | 'sticky' | 'shape'

interface InsertItem {
  kind: InsertKind
  label: string
  level?: 1 | 2 | 3
  shape?: 'rect' | 'ellipse'
  icon: (props: React.SVGProps<SVGSVGElement>) => React.ReactNode
}

const INSERT_ITEMS: InsertItem[] = [
  { kind: 'ai', label: 'AI 图片', icon: () => <span>✦</span> },
  { kind: 'text', label: '文本', icon: TextIcon },
  { kind: 'heading', level: 1, label: '标题 1', icon: HeadingIcon },
  { kind: 'heading', level: 2, label: '标题 2', icon: HeadingIcon },
  { kind: 'heading', level: 3, label: '标题 3', icon: HeadingIcon },
  { kind: 'sticky', label: '便签', icon: StickyIcon },
  { kind: 'shape', shape: 'rect', label: '矩形', icon: ShapeIcon },
  { kind: 'shape', shape: 'ellipse', label: '椭圆', icon: ShapeIcon },
]

export function InsertMenuContent({ onInsert }: { onInsert: (item: Record<string, unknown>) => void }) {
  return <>
    {INSERT_ITEMS.map((item) => (
      <div key={`${item.kind}-${item.level ?? item.shape ?? ''}`}>
        <button
          type="button"
          autoFocus={item.kind === 'ai'}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-soft hover:bg-hover hover:text-main"
          onClick={() => {
            onInsert({
              kind: item.kind,
              level: item.level,
              shape: item.shape,
            })
          }}
        >
          <span className="text-mid">
            <item.icon />
          </span>
          {item.label}
        </button>
        {item.kind === 'sticky' && (
          <div className="flex items-center gap-1.5 pl-8 pb-1.5">
            {(Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[]).map((key) => (
              <button
                key={key}
                type="button"
                title={`${key}便签`}
                className="h-3.5 w-3.5 rounded-full border"
                style={{
                  backgroundColor: STICKY_COLORS[key].bg,
                  borderColor: STICKY_COLORS[key].border,
                }}
                onClick={() => {
                  onInsert({ kind: 'sticky', color: key })
                }}
              />
            ))}
          </div>
        )}
      </div>
    ))}</>
}
