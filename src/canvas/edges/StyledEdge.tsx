import {
  BaseEdge,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
} from '@xyflow/react'
import type { SuqEdge } from '../../types'

export function StyledEdge(props: EdgeProps<SuqEdge>) {
  const {
    id,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    data,
    selected,
  } = props

  const style = data.style
  const stroke = selected ? '#38bdf8' : style.stroke
  const sw = style.strokeWidth
  const isDotted = style.lineStyle === 'dotted'
  const dasharray =
    style.lineStyle === 'solid'
      ? undefined
      : style.lineStyle === 'dashed'
        ? `${sw * 3.5} ${sw * 2.5}`
        : `${sw * 1.4} ${sw * 2.4}`

  let edgePath: string
  switch (style.pathType) {
    case 'straight': {
      ;[edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY })
      break
    }
    case 'step': {
      ;[edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 0,
      })
      break
    }
    case 'smoothstep': {
      ;[edgePath] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 8,
      })
      break
    }
    default: {
      ;[edgePath] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })
    }
  }

  const markerId = `sq-arrow-${id}`
  const markerEnd =
    style.arrow === 'end' || style.arrow === 'both' ? `url(#${markerId})` : undefined
  const markerStart =
    style.arrow === 'start' || style.arrow === 'both' ? `url(#${markerId})` : undefined

  return (
    <>
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 10 10"
          refX="7"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: sw,
          strokeDasharray: dasharray,
          strokeLinecap: isDotted ? 'round' : 'butt',
          opacity: selected ? 1 : 0.9,
        }}
        markerStart={markerStart}
        markerEnd={markerEnd}
        interactionWidth={24}
      />
    </>
  )
}
