export function gridCells(width: number, height: number, rows: number, columns: number, gap = 0, margin = 0) {
  if (![width, height, rows, columns, gap, margin].every(Number.isInteger) || width < 1 || height < 1 || rows < 1 || columns < 1 || rows * columns > 100 || gap < 0 || margin < 0) throw new Error('行列须为正整数，最多 100 张；间距和边距须为非负整数')
  const availableWidth = width - 2 * margin - (columns - 1) * gap
  const availableHeight = height - 2 * margin - (rows - 1) * gap
  if (availableWidth < columns || availableHeight < rows) throw new Error('图片尺寸不足，请减少行列数、间距或边距')
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns), column = index % columns
    const x = Math.floor(column * availableWidth / columns), y = Math.floor(row * availableHeight / rows)
    return { row, column, x: margin + x + column * gap, y: margin + y + row * gap,
      width: Math.floor((column + 1) * availableWidth / columns) - x,
      height: Math.floor((row + 1) * availableHeight / rows) - y }
  })
}

export async function splitGrid(blob: Blob, rows: number, columns: number, gap: number, margin: number, signal?: AbortSignal): Promise<Blob[]> {
  signal?.throwIfAborted()
  const image = await createImageBitmap(blob)
  try {
    if (image.width * image.height > 64_000_000) throw new Error('图片过大，请先缩小到 6400 万像素以内')
    const cells = gridCells(image.width, image.height, rows, columns, gap, margin)
    const canvas = document.createElement('canvas')
    const results: Blob[] = []
    for (const cell of cells) {
      signal?.throwIfAborted()
      canvas.width = cell.width; canvas.height = cell.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('无法创建拆图画布')
      context.drawImage(image, cell.x, cell.y, cell.width, cell.height, 0, 0, cell.width, cell.height)
      results.push(await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('图片编码失败')), 'image/png')))
    }
    canvas.width = 0; canvas.height = 0
    return results
  } finally { image.close() }
}
