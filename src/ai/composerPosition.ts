export function composerPosition(node: { x: number; y: number; width: number; height: number },
  panel: { width: number; height: number }, viewport: { width: number; height: number }, gap: number) {
  const margin = 12, ceiling = 64
  const width = Math.min(panel.width, Math.max(1, viewport.width - margin * 2))
  const height = Math.min(panel.height, Math.max(1, viewport.height - ceiling - margin))
  const below = node.y + node.height + gap
  const above = node.y - height - 12
  const preferred = below + height <= viewport.height - margin ? below : above
  return { left: Math.max(margin, Math.min(node.x + node.width / 2 - width / 2, viewport.width - width - margin)),
    top: Math.max(ceiling, Math.min(preferred, viewport.height - height - margin)), width,
    maxHeight: Math.max(1, viewport.height - ceiling - margin) }
}
