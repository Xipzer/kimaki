// long voice transcripts and first inputs are echoed in full across
// several Discord messages instead of being cut at 1,900 chars with "…".
// The first chunk carries the `» **user:**` prefix of formatEcho().

const CHUNK_LIMIT = 1_900

function splitPoint(text: string, limit: number): number {
  const newline = text.lastIndexOf('\n', limit)
  if (newline >= limit / 2) return newline
  const space = text.lastIndexOf(' ', limit)
  if (space >= limit / 2) return space
  return limit
}

export function echoChunks({ username, text, limit = CHUNK_LIMIT }: { username: string | null; text: string; limit?: number }): string[] {
  const parts: string[] = []
  let rest = text
  while (rest.length > limit) {
    const cut = splitPoint(rest, limit)
    parts.push(rest.slice(0, cut).trimEnd())
    rest = rest.slice(cut).trimStart()
  }
  parts.push(rest)
  return parts.map((body, index) => (index === 0 ? `» **${username ?? 'queued'}:** ${body}` : body))
}
