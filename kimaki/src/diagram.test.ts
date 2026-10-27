import { render } from 'pele'
import { expect, test } from 'vitest'

import { computeCustomProperties, renderDiagram, withColorClasses } from './diagram.ts'

const NESTED = `flowchart LR
  subgraph outer[Outer]
    subgraph inner[Inner]
      a[A]:::blue --> b[(B)]
    end
  end
  b -->|label| c{C}
  classDef blue fill:#0b1f38,stroke:#1d68c5`

test('computes inherited custom properties, fallbacks and color-mix', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="--_a:var(--theme-a,#ffffff);--_b:var(--missing,#000000);width:10px"><g style="--_a:#ff0000"><rect fill="var(--_a)" stroke="color-mix(in srgb,var(--_a) 50%,var(--_b))"/></g><rect fill="var(--_a)" style="rx:var(--_r, 4px)"/></svg>`
  expect(computeCustomProperties(svg, new Map([['--theme-a', '#00ff00']]))).toMatchInlineSnapshot(`"<svg xmlns="http://www.w3.org/2000/svg" style="width:10px"><g><rect fill="#ff0000" stroke="#800000"/></g><rect fill="#00ff00" rx="4px"/></svg>"`)
})

test('leaves no var() or color-mix() in pele output', () => {
  const svg = computeCustomProperties(render(NESTED, { padding: 24 }).svg)
  expect(svg).not.toContain('var(')
  expect(svg).not.toContain('color-mix')
  expect(svg).toContain('fill="#ffffff"')
})

test('renders a png and reports syntax errors with position', () => {
  const png = renderDiagram(NESTED)
  if (png instanceof Error) throw png
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  const dark = renderDiagram(NESTED, { theme: 'dark' })
  if (dark instanceof Error) throw dark
  expect(dark.equals(png)).toBe(false)

  const error = renderDiagram('flowchart LR\n  a --> \n  b[unclosed')
  expect(error instanceof Error ? error.message : 'no error').toMatchInlineSnapshot(`
    "Parse error on line 11:

    ^
    Expecting 'SQE', 'UNICODE_TEXT', 'TEXT', 'TAGSTART', got '$end'"
  `)
})

test('adds built-in color classes the source does not define', () => {
  expect(withColorClasses('flowchart LR\n  a:::blue --> b:::teal\n  classDef teal,red fill:#000')).toMatchInlineSnapshot(`
    "flowchart LR
      a:::blue --> b:::teal
      classDef teal,red fill:#000
      classDef blue fill:#edf5fb,stroke:#a0c3e2,color:#141413
      classDef green fill:#eef6f0,stroke:#a7c8af,color:#141413
      classDef purple fill:#f3effa,stroke:#bfb1de,color:#141413
      classDef pink fill:#fbeef3,stroke:#e0abbf,color:#141413
      classDef amber fill:#fbf5e8,stroke:#e2c893,color:#141413"
  `)
  expect(withColorClasses('sequenceDiagram\n  A->>B: hi')).toBe('sequenceDiagram\n  A->>B: hi')
})
