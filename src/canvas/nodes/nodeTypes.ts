import type { NodeTypes } from '@xyflow/react'
import { AudioNode } from './AudioNode'
import { FileCardNode } from './FileCardNode'
import { HeadingNode } from './HeadingNode'
import { ImageNode } from './ImageNode'
import { MarkdownNode } from './MarkdownNode'
import { PdfNode } from './PdfNode'
import { PsdNode } from './PsdNode'
import { ShapeNode } from './ShapeNode'
import { StickyNode } from './StickyNode'
import { TextNode } from './TextNode'
import { VideoNode } from './VideoNode'

export const mediaNodeTypes: NodeTypes = {
  image: ImageNode,
  video: VideoNode,
  audio: AudioNode,
  fileCard: FileCardNode,
  text: TextNode,
  markdown: MarkdownNode,
  pdf: PdfNode,
  psd: PsdNode,
  heading: HeadingNode,
  sticky: StickyNode,
  shape: ShapeNode,
}
