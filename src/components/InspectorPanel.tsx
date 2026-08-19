import { useReactFlow } from '@xyflow/react'
import { useCanvasStore, type LayerMode } from '../store/canvasStore'
import { useLanStore } from '../store/lanStore'
import type {
  ArrowPos,
  EdgeStyle,
  HeadingLevelOrNone,
  LineStyle,
  PathType,
  ShapeType,
  StickyColor,
  TextAlign,
  TextAlignV,
} from '../types'
import { STICKY_COLORS } from '../types'
import {
  CopyIcon,
  TextAlignBottomIcon,
  TextAlignCenterIcon,
  TextAlignJustifyIcon,
  TextAlignLeftIcon,
  TextAlignMiddleIcon,
  TextAlignRightIcon,
  TextAlignTopIcon,
  TrashIcon,
} from '../canvas/nodes/Icons'

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

function Segmented<T extends string | number>({
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

function IconSegmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: React.ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md p-1.5 transition-colors ${
            value === o.value ? 'bg-sky-600 text-white' : 'bg-panel2 text-soft hover:bg-hover'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const H_ALIGN_ICONS: Record<string, React.ReactNode> = {
  left: <TextAlignLeftIcon />,
  center: <TextAlignCenterIcon />,
  right: <TextAlignRightIcon />,
  justify: <TextAlignJustifyIcon />,
}

const V_ALIGN_ICONS: Record<string, React.ReactNode> = {
  top: <TextAlignTopIcon />,
  middle: <TextAlignMiddleIcon />,
  bottom: <TextAlignBottomIcon />,
}

const FONT_OPTIONS = [
  { value: '', label: '默认字体' },
  { value: '"Microsoft YaHei", sans-serif', label: '微软雅黑' },
  { value: '"SimSun", serif', label: '宋体' },
  { value: '"SimHei", sans-serif', label: '黑体' },
  { value: '"KaiTi", serif', label: '楷体' },
  { value: '"FangSong", serif', label: '仿宋' },
  { value: '"Arial", sans-serif', label: 'Arial' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: '"Georgia", serif', label: 'Georgia' },
  { value: '"Courier New", monospace', label: 'Courier New' },
  { value: 'monospace', label: '等宽字体' },
]

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
  const changeNodeLayer = useCanvasStore((s) => s.changeNodeLayer)
  const setNodeZIndex = useCanvasStore((s) => s.setNodeZIndex)
  const { deleteElements } = useReactFlow()

  const selectedNodes = nodes.filter((n) => n.selected)
  const editing = useLanStore((s) => s.editing)
  const selfId = useLanStore((s) => s.selfId)
  const selectedEditableNodes = selectedNodes.filter(
    (node) => !Object.values(editing).some((item) => item.nodeId === node.id && item.userId !== selfId),
  )
  const selectedEdges = edges.filter((e) => e.selected)

  if (selectedEditableNodes.length === 0 && selectedEdges.length === 0) return null

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
  const firstNode = selectedEditableNodes[0]

  return (
    <aside className="absolute bottom-3 right-3 top-3 z-30 w-64 select-none overflow-y-auto rounded-xl border border-edge bg-panel/95 text-main shadow-2xl">
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

      {selectedEditableNodes.length > 0 && firstNode && (
        <>
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-sm font-medium">
              元素 {selectedEditableNodes.length > 1 ? `(${selectedEditableNodes.length} 个)` : ''}
            </span>
            <button
              type="button"
              onClick={() => deleteElements({ nodes: selectedEditableNodes.map((n) => ({ id: n.id })) })}
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
          {selectedEditableNodes.length === 1 && (
            <Section title="插入者">
              <div className="truncate text-xs text-soft" title={firstNode.data.createdByName}>
                {firstNode.data.createdByName ?? '历史元素（未记录）'}
              </div>
            </Section>
          )}
          {selectedEditableNodes.length === 1 &&
            (firstNode.data.kind === 'text' ||
              firstNode.data.kind === 'heading' ||
              firstNode.data.kind === 'sticky' ||
              firstNode.data.kind === 'shape') && (
              <>
                <Section title="文字对齐">
                  <IconSegmented<TextAlign>
                    value={firstNode.data.textAlign ?? 'left'}
                    onChange={(textAlign) => updateNodeData(firstNode.id, { textAlign })}
                    options={[
                      { value: 'left', label: H_ALIGN_ICONS.left, title: '左对齐' },
                      { value: 'center', label: H_ALIGN_ICONS.center, title: '居中' },
                      { value: 'right', label: H_ALIGN_ICONS.right, title: '右对齐' },
                      { value: 'justify', label: H_ALIGN_ICONS.justify, title: '两端对齐' },
                    ]}
                  />
                  <div className="mt-1.5">
                    <IconSegmented<TextAlignV>
                      value={firstNode.data.textAlignV ?? 'top'}
                      onChange={(textAlignV) => updateNodeData(firstNode.id, { textAlignV })}
                      options={[
                        { value: 'top', label: V_ALIGN_ICONS.top, title: '顶端对齐' },
                        { value: 'middle', label: V_ALIGN_ICONS.middle, title: '垂直居中' },
                        { value: 'bottom', label: V_ALIGN_ICONS.bottom, title: '底端对齐' },
                      ]}
                    />
                  </div>
                </Section>
                <Section title="字体">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      title="加粗"
                      className={`h-7 w-8 rounded-md text-xs transition-colors ${
                        firstNode.data.bold ? 'bg-sky-600 text-white' : 'bg-panel2 text-soft hover:bg-hover'
                      }`}
                      onClick={() => updateNodeData(firstNode.id, { bold: !firstNode.data.bold })}
                    >
                      <span className="font-bold">B</span>
                    </button>
                    <button
                      type="button"
                      title="斜体"
                      className={`h-7 w-8 rounded-md text-xs transition-colors ${
                        firstNode.data.italic ? 'bg-sky-600 text-white' : 'bg-panel2 text-soft hover:bg-hover'
                      }`}
                      onClick={() => updateNodeData(firstNode.id, { italic: !firstNode.data.italic })}
                    >
                      <span className="italic">I</span>
                    </button>
                    <button
                      type="button"
                      title="下划线"
                      className={`h-7 w-8 rounded-md text-xs transition-colors ${
                        firstNode.data.underline ? 'bg-sky-600 text-white' : 'bg-panel2 text-soft hover:bg-hover'
                      }`}
                      onClick={() =>
                        updateNodeData(firstNode.id, { underline: !firstNode.data.underline })
                      }
                    >
                      <span className="underline">U</span>
                    </button>
                  </div>

                  <div className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-dim">
                    文字大小
                  </div>
                  <input
                    type="number"
                    min={8}
                    max={200}
                    value={firstNode.data.fontSize ?? ''}
                    placeholder="输入字号 (px)"
                    onChange={(e) => {
                      const v = e.target.value
                      updateNodeData(firstNode.id, {
                        fontSize: v === '' ? undefined : Math.min(200, Math.max(8, Number(v))),
                      })
                    }}
                    className="mt-1 w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-main outline-none focus:border-sky-500"
                  />

                  <div className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-dim">
                    文字颜色
                  </div>
                  <div className="mt-1">
                    <ColorField
                      value={firstNode.data.textColor ?? '#94a3b8'}
                      onChange={(textColor) => updateNodeData(firstNode.id, { textColor })}
                    />
                  </div>

                  <div className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-dim">
                    字体
                  </div>
                  <select
                    value={firstNode.data.fontFamily ?? ''}
                    onChange={(e) =>
                      updateNodeData(firstNode.id, { fontFamily: e.target.value || undefined })
                    }
                    style={{ fontFamily: firstNode.data.fontFamily }}
                    className="mt-1 w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-main outline-none focus:border-sky-500"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                        {f.label}
                      </option>
                    ))}
                  </select>

                  <div className="mt-2.5 text-[11px] font-medium uppercase tracking-wider text-dim">
                    行距
                  </div>
                  <input
                    type="number"
                    min={0.5}
                    max={5}
                    step={0.1}
                    value={firstNode.data.lineHeight ?? ''}
                    placeholder="输入行距 (倍)"
                    onChange={(e) => {
                      const v = e.target.value
                      updateNodeData(firstNode.id, {
                        lineHeight:
                          v === '' ? undefined : Math.min(5, Math.max(0.5, Number(v))),
                      })
                    }}
                    className="mt-1 w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs text-main outline-none focus:border-sky-500"
                  />
                </Section>
              </>
            )}

          {selectedEditableNodes.length === 1 && firstNode.data.kind === 'heading' && (
            <Section title="标题级别">
              <Segmented<HeadingLevelOrNone>
                value={(firstNode.data.level ?? 1) as HeadingLevelOrNone}
                onChange={(level) =>
                  updateNodeData(firstNode.id, {
                    level,
                    label: level === 0 ? '文本' : `标题 ${level}`,
                  })
                }
                options={[
                  { value: 0, label: '默认' },
                  { value: 1, label: 'H1' },
                  { value: 2, label: 'H2' },
                  { value: 3, label: 'H3' },
                ]}
              />
            </Section>
          )}

          {selectedEditableNodes.length === 1 && firstNode.data.kind === 'sticky' && (
            <Section title="便签颜色">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(STICKY_COLORS) as StickyColor[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    title={key}
                    onClick={() =>
                      updateNodeData(firstNode.id, {
                        color: key,
                        borderColor: STICKY_COLORS[key].border,
                      })
                    }
                    className={`h-6 w-6 rounded-md border ${
                      (firstNode.data.color ?? 'yellow') === key
                        ? 'ring-2 ring-sky-400'
                        : 'border-edge2'
                    }`}
                    style={{ backgroundColor: STICKY_COLORS[key].bg }}
                  />
                ))}
              </div>
            </Section>
          )}

          {selectedEditableNodes.length === 1 && firstNode.data.kind === 'shape' && (
            <>
              <Section title="形状">
                <Segmented<ShapeType>
                  value={firstNode.data.shape ?? 'rect'}
                  onChange={(shape) =>
                    updateNodeData(firstNode.id, {
                      shape,
                      label: shape === 'rect' ? '矩形' : '椭圆',
                    })
                  }
                  options={[
                    { value: 'rect', label: '矩形' },
                    { value: 'ellipse', label: '椭圆' },
                  ]}
                />
              </Section>
              <Section title="填充颜色">
                <ColorField
                  value={firstNode.data.fill ?? '#38bdf8'}
                  onChange={(fill) => updateNodeData(firstNode.id, { fill })}
                />
              </Section>
            </>
          )}

          {selectedEditableNodes.length === 1 && (
            <>
              <Section title="层级">
                <input
                  type="number"
                  min={0}
                  max={9999}
                  step={1}
                  value={firstNode.zIndex ?? nodes.indexOf(firstNode)}
                  title="层级数值，数值越大越靠上"
                  aria-label="层级数值"
                  onChange={(event) => {
                    if (event.target.value === '') return
                    setNodeZIndex(firstNode.id, Number(event.target.value))
                  }}
                  className="mb-2 w-full rounded-md border border-edge2 bg-panel2 px-2 py-1.5 text-xs tabular-nums text-main outline-none focus:border-sky-500"
                />
                <div className="grid grid-cols-2 gap-1.5">
                  {([
                    ['front', '置于顶层'],
                    ['forward', '上移一层'],
                    ['backward', '下移一层'],
                    ['back', '置于底层'],
                  ] as Array<[LayerMode, string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => changeNodeLayer(firstNode.id, mode)}
                      className="rounded-md border border-edge2 px-2 py-1.5 text-xs text-soft hover:bg-hover"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </Section>
              <Section title="操作">
                <button
                  type="button"
                  onClick={() => duplicateNode(firstNode.id)}
                  className="flex items-center gap-1.5 rounded-md border border-edge2 px-2.5 py-1.5 text-xs text-soft hover:bg-hover"
                >
                  <CopyIcon /> 复制元素
                </button>
              </Section>
            </>
          )}
        </>
      )}
    </aside>
  )
}
