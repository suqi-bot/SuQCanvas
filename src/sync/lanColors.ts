const LAN_USER_COLORS = [
  '#0284c7',
  '#ea580c',
  '#16a34a',
  '#e11d48',
  '#9333ea',
  '#ca8a04',
  '#0d9488',
  '#db2777',
  '#4f46e5',
  '#65a30d',
  '#dc2626',
  '#0891b2',
] as const

export function getLanUserColor(userId: string, provided?: unknown): string {
  if (typeof provided === 'string' && /^#[0-9a-f]{6}$/i.test(provided)) return provided
  let hash = 0
  for (let index = 0; index < userId.length; index++) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0
  }
  return LAN_USER_COLORS[hash % LAN_USER_COLORS.length]
}
