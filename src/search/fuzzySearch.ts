import type { SuqNode } from '../types'

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim()
}

export function fuzzyScore(value: string, query: string): number | null {
  const target = normalize(value)
  const needle = normalize(query)
  if (!needle) return 0
  if (!target) return null
  if (target === needle) return 1_000
  if (target.startsWith(needle)) return 800 - Math.min(200, target.length - needle.length)
  const containedAt = target.indexOf(needle)
  if (containedAt >= 0) return 600 - Math.min(200, containedAt * 4)

  let targetIndex = 0
  let previousMatch = -2
  let score = 200
  for (const character of needle) {
    const foundAt = target.indexOf(character, targetIndex)
    if (foundAt < 0) return null
    score += foundAt === previousMatch + 1 ? 18 : 4
    score -= Math.min(12, foundAt - targetIndex)
    previousMatch = foundAt
    targetIndex = foundAt + 1
  }
  return score - Math.min(100, target.length - needle.length)
}

function searchableFields(node: SuqNode): string[] {
  return [
    node.data.label,
    node.data.text,
    node.data.kind,
    node.data.mime,
    node.data.createdByName,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)
}

export function searchCanvasNodes(nodes: SuqNode[], query: string): SuqNode[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return nodes

  return nodes
    .map((node, index) => {
      const fields = searchableFields(node)
      let score = 0
      for (const token of tokens) {
        let tokenScore: number | null = null
        for (const field of fields) {
          const nextScore = fuzzyScore(field, token)
          if (nextScore !== null && (tokenScore === null || nextScore > tokenScore)) {
            tokenScore = nextScore
          }
        }
        if (tokenScore === null) return null
        score += tokenScore
      }
      return { node, score, index }
    })
    .filter((result): result is { node: SuqNode; score: number; index: number } => result !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((result) => result.node)
}

