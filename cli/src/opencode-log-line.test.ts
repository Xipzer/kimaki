import { describe, expect, test } from 'vitest'
import { compactOpencodeLogLine } from './opencode-log-line.js'

describe('compactOpencodeLogLine', () => {
  test('summarizes thinking_dropped transformations', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({
      type: 'thinking_dropped',
      path: `messages.${i}.content.0`,
      reason: 'prefix_binding_mismatch',
    }))
    const escaped = JSON.stringify(entries).replace(/"/g, '\\"')
    const line = `timestamp=2026-10-02T08:37:08.541Z level=WARN run=8d3950fa message="thinking blocks dropped by provider" sessionID=ses_1 model=claude-opus-5-5 transformations="${escaped}"`
    expect(compactOpencodeLogLine(line)).toMatchInlineSnapshot(
      `"timestamp=2026-10-02T08:37:08.541Z level=WARN run=8d3950fa message="thinking blocks dropped by provider" sessionID=ses_1 model=claude-opus-5-5 transformations=[40: prefix_binding_mismatchx40]"`,
    )
  })

  test('leaves short lines alone', () => {
    const line = 'level=WARN message="slow request" ms=1200'
    expect(compactOpencodeLogLine(line)).toBe(line)
  })

  test('truncates very long lines', () => {
    const result = compactOpencodeLogLine(`level=ERROR message="${'x'.repeat(1000)}"`)
    expect(result.length).toBeLessThan(450)
    expect(result).toContain('chars]')
  })
})
