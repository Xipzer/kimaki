import { expect, test } from 'vitest'
import { formatEcho } from './queue.ts'

test('echo puts block markdown on the line below the prefix', () => {
  const texts = ['plain text', '# Title', '> quote', '- item', '1. step', '```ts\ncode\n```', '---', '| a | b |', '-# small', 'use #hashtag', '5 > 3', '**bold** start']
  expect(texts.map((text) => formatEcho({ username: 'CLI', text }))).toMatchInlineSnapshot(`
    [
      "» **CLI:** plain text",
      "» **CLI:**
    # Title",
      "» **CLI:**
    > quote",
      "» **CLI:**
    - item",
      "» **CLI:**
    1. step",
      "» **CLI:**
    \`\`\`ts
    code
    \`\`\`",
      "» **CLI:**
    ---",
      "» **CLI:**
    | a | b |",
      "» **CLI:**
    -# small",
      "» **CLI:** use #hashtag",
      "» **CLI:** 5 > 3",
      "» **CLI:** **bold** start",
    ]
  `)
})
