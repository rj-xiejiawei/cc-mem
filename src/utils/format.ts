import type { Observation } from '../db/observations.js'

const TYPE_ICONS: Record<string, string> = {
  session: '\u{1F3AF}',
  bugfix: '\u{1F534}',
  feature: '\u{1F7AE}',
  refactor: '\u{1F504}',
  change: '\u{2705}',
  discovery: '\u{1F535}',
  decision: '\u{2696}\uFE0F',
}

export function formatContext(
  observations: Observation[],
  project: string,
  totalTokens: number
): string {
  if (observations.length === 0)
    return `[cc-mem] No recent context for ${project}`

  const now = new Date()
  const header = `[cc-mem] recent context, ${now.toLocaleString('zh-CN', { timeZoneName: 'short' })}`

  const legend = `Legend: ${Object.entries(TYPE_ICONS)
    .map(([, v]) => v)
    .join(' ')}`

  const lines = observations.map((o) => {
    const icon = TYPE_ICONS[o.type] || '\u00B7'
    const time = new Date(o.created_at).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    return `${o.id.slice(0, 4)} ${time} ${icon} ${o.title}`
  })

  const stats = `Stats: ${observations.length} obs | ${totalTokens}t work`

  return [header, '', legend, '', ...lines, '', stats].join('\n')
}
