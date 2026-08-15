import type { CSSProperties } from 'react'
import type { SuqNodeData, TextAlignV } from '../../types'

export const V_JUSTIFY: Record<TextAlignV, string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
}

export function buildTextStyle(data: SuqNodeData): CSSProperties {
  return {
    textAlign: data.textAlign ?? 'left',
    fontSize: data.fontSize,
    fontFamily: data.fontFamily,
    color: data.textColor,
    fontWeight: data.bold ? 700 : undefined,
    fontStyle: data.italic ? 'italic' : undefined,
    textDecoration: data.underline ? 'underline' : undefined,
    lineHeight: data.lineHeight,
  }
}
