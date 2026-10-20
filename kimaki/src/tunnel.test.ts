import { expect, test } from 'vitest'
import { detectPortFromText, routeName } from './tunnel.ts'

test('detects the dev server port and skips noise lines', () => {
  const vite = '\u001b[33mPort 5173 is in use, trying another one...\u001b[39m\n  ➜  Local:   \u001b[36mhttp://localhost:\u001b[1m5174\u001b[22m/\u001b[39m\n'
  expect({
    vite: detectPortFromText(vite),
    next: detectPortFromText('   - Local:        http://127.0.0.1:3000'),
    bare: detectPortFromText('Server running at 0.0.0.0:4321'),
    inspector: detectPortFromText('Debugger listening on ws://127.0.0.1:9229/abc\nready on http://localhost:4173'),
    outOfRange: detectPortFromText('listening on localhost:70000'),
    portOnly: detectPortFromText('Port 5173 is in use'),
  }).toMatchInlineSnapshot(`
    {
      "bare": 4321,
      "inspector": 4173,
      "next": 3000,
      "outOfRange": null,
      "portOnly": null,
      "vite": 5174,
    }
  `)
})

test('route name: explicit, then tuistory session, then random', () => {
  expect({
    explicit: routeName({ name: 'docs', tuistorySessionId: 'abc123' }),
    invalid: String(routeName({ name: 'Bad_Name' })),
    tuistory: routeName({ tuistorySessionId: 'ABC123' }),
    random: String(routeName({})).length,
  }).toMatchInlineSnapshot(`
    {
      "explicit": "docs",
      "invalid": "Error: Invalid tunnel ID "Bad_Name": use lowercase letters, digits and dashes",
      "random": 16,
      "tuistory": "abc123",
    }
  `)
})
