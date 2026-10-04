// Compacts OpenCode server log lines before they reach kimaki.log and the
// terminal. Provider warnings like "thinking blocks dropped by provider"
// carry a transformations="[...]" JSON array with one entry per dropped
// block, producing 10-35k character lines on every assistant step.

const MAX_LINE_LENGTH = 400
const JSON_ATTRIBUTE_REGEX = /(\w+)="(\[(?:[^"\\]|\\.)*\])"/g

function summarizeJsonAttribute(key: string, escapedJson: string): string {
  const parsed = (() => {
    try {
      return JSON.parse(escapedJson.replace(/\\"/g, '"')) as unknown
    } catch {
      return undefined
    }
  })()
  if (!Array.isArray(parsed)) return `${key}=[${escapedJson.length} chars]`
  const reasons = new Map<string, number>()
  for (const item of parsed) {
    const reason =
      item && typeof item === 'object' && 'reason' in item && typeof item.reason === 'string'
        ? item.reason
        : 'item'
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }
  const summary = [...reasons].map(([reason, count]) => `${reason}x${count}`).join(',')
  return `${key}=[${parsed.length}: ${summary}]`
}

export function compactOpencodeLogLine(line: string): string {
  const compacted = line.replace(JSON_ATTRIBUTE_REGEX, (_match, key: string, json: string) =>
    summarizeJsonAttribute(key, json),
  )
  if (compacted.length <= MAX_LINE_LENGTH) return compacted
  return `${compacted.slice(0, MAX_LINE_LENGTH)}… [+${compacted.length - MAX_LINE_LENGTH} chars]`
}
