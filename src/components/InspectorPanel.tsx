import { useReactFlow } from '@xyflow/react'
import { useCanvasStore } from '../store/canvasStore'
import type { ArrowPos, EdgeStyle, LineStyle, PathType } from '../types'
import { CopyIcon, TrashIcon } from '../canvas/nodes/Icons'

const PRESET_COLORS = ['#64748b', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#f87171', '#a78bfa', '#0f172a']

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-edge px-3 py-3 last:border-b-0">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-dim">
        {title}
      </div>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-1 text-xs transition-colors ${
            value === o.value
              ? 'bg-sky-600 text-white'
              : 'bg-panel2 text-soft hover:bg-hover'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ColorField({
  value,
  onChange,
}: {
  value: string
  onChange: (c: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-10 cursor-pointer rounded border border-edge2 bg-transparent p-0.5"
      />
      <div className="flex flex-wrap gap-1">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => onChange(c)}
            className={`h-5 w-5 rounded-full border border-edge2 ${value === c ? 'ring-2 ring-sky-400' : ''}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  )
}

export function InspectorPanel() {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const updateEdgeData = useCanvasStore((s) => s.updateEdgeData)
  const duplicateNode = useCanvasStore((s) => s.duplicateNode)
  const { deleteElements } = useReactFlow()

  const selectedNodes = nodes.filter((n) => n.selected)
  const selectedEdges = edges.filter((e) => e.selected)

  if (selectedNodes.length === 0 && selectedEdges.length === 0) return null

  const applyEdgeStyle = (patch: Partial<EdgeStyle>) => {
    for (const e of selectedEdges) {
      updateEdgeData(e.id, { style: { ...e.data.style, ...patch } })
    }
  }

  const setLineStyle = (lineStyle: LineStyle) => applyEdgeStyle({ lineStyle })
  const setPathType = (pathType: PathType) => applyEdgeStyle({ pathType })
  const setArrow = (arrow: ArrowPos) => applyEdgeStyle({ arrow })
  const setStroke = (stroke: string) => applyEdgeStyle({ stroke })
  const setStrokeWidth = (strokeWidth: number) => applyEdgeStyle({ strokeWidth })

  const firstEdge = selectedEdges[0]
  const firstNode = selectedNodes[0]

  return (
    <aside className="absolute right-3 top-3 z-30 w-64 select-none overflow-hidden rounded-xl border border-edge bg-panel/95 text-main shadow-2xl">
      {selectedEdges.length > 0 && firstEdge && (
        <>
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-sm font-medium">
              连线 {selectedEdges.length > 1 ? `(${selectedEdges.length} 条)` : ''}
            </span>
            <button
              type="button"
              onClick={() => deleteElements({ edges: selectedEdges.map((e) => ({ id: e.id })) })}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-500 hover:bg-hover"
            >
              <TrashIcon /> 删除
            </button>
          </div>
          <Section title="线型">
            <Segmented
              value={firstEdge.data.style.lineStyle}
              onChange={setLineStyle}
              options={[
                { value: 'solid', label: '实线' },
                { value: 'dashed', label: '虚线' },
                { value: 'dotted', label: '点线' },
              ]}
            />
          </Section>
          <Section title="路径">
            <Segmented
              value={firstEdge.data.style.pathType}
              onChange={setPathType}
              options={[
                { value: 'bezier', label: '曲线' },
                { value: 'straight', label: '直线' },
                { value: 'step', label: '阶梯' },
                { value: 'smoothstep', label: '平滑阶梯' },
              ]}
            />
          </Section>
          <Section title="箭头">
            <Segmented
              value={firstEdge.data.style.arrow}
              onChange={setArrow}
              options={[
                { value: 'none', label: '无' },
                { value: 'start', label: '起点' },
                { value: 'end', label: '终点' },
                { value: 'both', label: '双向' },
              ]}
            />
          </Section>
          <Section title="颜色">
            <ColorField value={firstEdge.data.style.stroke} onChange={setStroke} />
          </Section>
          <Section title="粗细">
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={firstEdge.data.style.strokeWidth}
              onChange={(e) => setStrokeWidth(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
            <span className="text-xs text-mid">{firstEdge.data.style.strokeWidth}px</span>
          </Section>
        </>
      )}

      {selectedNodes.length > 0 && firstNode && (
        <>
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-sm font-medium">
              元素 {selectedNodes.length > 1 ? `(${selectedNodes.length} 个)` : ''}
            </span>
            <button
              type="button"
              onClick={() => deleteElements({ nodes: selectedNodes.map((n) => ({ id: n.id })) })}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-500 hover:bg-hover"
            >
              <TrashIcon /> 删除
            </button>
          </div>
          <Section title="名称">
            <input
              value={firstNode.data.label ?? ''}
              onChange={(e) => updateNodeData(firstNode.id, { label: e.target.value })}
              className="w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-main outline-none focus:border-sky-500"
            />
          </Section>
          <Section title="边框颜色">
            <ColorField
              value={firstNode.data.borderColor ?? '#64748b'}
              onChange={(c) => updateNodeData(firstNode.id, { borderColor: c })}
            />
          </Section>
          {selectedNodes.length === 1 && (
            <Section title="操作">
              <button
                type="button"
                onClick={() => duplicateNode(firstNode.id)}
                className="flex items-center gap-1.5 rounded-md border border-edge2 px-2.5 py-1.5 text-xs text-soft hover:bg-hover"
              >
                <CopyIcon /> 复制元素
              </button>
            </Section>
          )}
        </>
      )}
    </aside>
  )
}
