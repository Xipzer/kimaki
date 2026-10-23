// `kimaki diagram`: renders Mermaid source to a PNG for Discord, which shows
// SVG attachments as code, not as images. pele (https://pele.run) lays out
// the diagram as SVG in pure JS; resvg rasterizes it with the bundled Geist fonts.
// Loaded lazily by the CLI command, so the static imports cost nothing at startup.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import * as errore from 'errore'
import { DomUtils, parseDocument } from 'htmlparser2'
import { render } from 'pele'
import postcss from 'postcss'
import valueParser, { type Node as ValueNode } from 'postcss-value-parser'

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts')
const SCALE = 2
const PADDING = 24

// Category hues for classDef / style lines in diagrams, as fill + stroke.
const DIAGRAM_COLORS = {
  blue: { fill: '#0b1f38', stroke: '#1d68c5' },
  green: { fill: '#1a2c1e', stroke: '#49a45f' },
  purple: { fill: '#251931', stroke: '#8955a7' },
  pink: { fill: '#371523', stroke: '#c14c70' },
  amber: { fill: '#4c3d20', stroke: '#f2b342' },
  red: { fill: '#3c1618', stroke: '#e5484d' },
  teal: { fill: '#0d2d2a', stroke: '#12a594' },
} as const

// pele's CSS variables (https://pele.run/theming), dark Vercel/Next.js docs palette.
const THEME: ReadonlyMap<string, string> = new Map(Object.entries({
  '--pele-bg': '#0a0a0a',
  '--pele-fg': '#ededed',
  '--pele-muted': '#8f8f8f',
  '--pele-line': '#878787',
  '--pele-surface': '#171717',
  '--pele-surface-alt': '#232323',
  '--pele-border': '#3d3d3d',
  '--pele-accent': '#4a8fe7',
  '--pele-critical': '#c14c70',
  '--pele-error': '#e5484d',
  '--pele-radius': '6px',
  '--pele-font': 'Geist, sans-serif',
  '--pele-font-mono': 'Geist Mono, monospace',
  '--pele-series-1': DIAGRAM_COLORS.blue.stroke,
  '--pele-series-2': DIAGRAM_COLORS.amber.stroke,
  '--pele-series-3': DIAGRAM_COLORS.green.stroke,
  '--pele-series-4': DIAGRAM_COLORS.pink.stroke,
  '--pele-series-5': DIAGRAM_COLORS.purple.stroke,
  '--pele-series-6': '#4a8fe7',
  '--pele-series-7': DIAGRAM_COLORS.red.stroke,
  '--pele-series-8': DIAGRAM_COLORS.teal.stroke,
}))

export class DiagramError extends errore.createTaggedError({
  name: 'DiagramError',
  message: '$reason',
}) {}

// resvg and librsvg do not support CSS custom properties, which pele uses for
// every color. This does the browser's job on the parsed SVG: custom properties
// inherit down the element tree, and every var() and color-mix() in attributes
// and inline styles is computed to a plain value.
// TODO: drop this once resvg resolves var(). https://github.com/linebender/resvg/issues/821
export function computeCustomProperties(svg: string, theme: ReadonlyMap<string, string> = THEME): string {
  const document = parseDocument(svg, { xmlMode: true })
  for (const child of document.children) visit(child, theme)
  return DomUtils.getOuterHTML(document, { xmlMode: true })
}

type DomNode = ReturnType<typeof parseDocument>['children'][number]

function visit(node: DomNode, inherited: ReadonlyMap<string, string>) {
  if (!DomUtils.isTag(node)) return
  const vars = new Map(inherited)
  const { style, ...attributes } = node.attribs
  if (style) {
    const declarations = postcss.parse(style).nodes.filter((child) => child.type === 'decl')
    // Custom properties first: they apply to this element's own declarations too.
    for (const decl of declarations) if (decl.prop.startsWith('--')) vars.set(decl.prop, computeValue(decl.value, vars))
    const kept = declarations.filter((decl) => !decl.prop.startsWith('--')).map((decl) => `${decl.prop}:${computeValue(decl.value, vars)}`)
    if (kept.length > 0) node.attribs.style = kept.join(';')
    else delete node.attribs.style
  }
  for (const [name, value] of Object.entries(attributes)) node.attribs[name] = computeValue(value, vars)
  for (const child of node.children) visit(child, vars)
}

function computeValue(value: string, vars: ReadonlyMap<string, string>): string {
  if (!value.includes('var(') && !value.includes('color-mix(')) return value
  const parsed = valueParser(value)
  computeNodes(parsed.nodes, vars)
  return parsed.toString()
}

// Replaces var() and color-mix() function nodes in place with word nodes.
function computeNodes(nodes: ValueNode[], vars: ReadonlyMap<string, string>) {
  for (const node of nodes) {
    if (node.type !== 'function') continue
    computeNodes(node.nodes, vars)
    if (node.value === 'var') {
      const [name, ...rest] = splitArgs(node.nodes)
      const fallback = rest.length > 0 ? rest.join(',') : undefined
      replaceWithWord(node, vars.get(name ?? '') ?? fallback ?? 'initial')
    } else if (node.value === 'color-mix') {
      const mixed = colorMix(splitArgs(node.nodes))
      if (mixed) replaceWithWord(node, mixed)
    }
  }
}

function splitArgs(nodes: ValueNode[]): string[] {
  const args: ValueNode[][] = [[]]
  for (const node of nodes) {
    if (node.type === 'div' && node.value === ',') args.push([])
    else args.at(-1)!.push(node)
  }
  return args.map((arg) => valueParser.stringify(arg).trim())
}

function replaceWithWord(node: ValueNode, value: string) {
  Object.assign(node, { type: 'word', value, nodes: undefined })
}

// color-mix(in srgb, <hex> [<pct>], <hex> [<pct>]): the only form pele emits.
function colorMix([space, first, second]: string[]): string | undefined {
  if (space !== 'in srgb' || !first || !second) return undefined
  const [colorA, percentA] = first.split(/\s+/)
  const [colorB, percentB] = second.split(/\s+/)
  const a = hexChannels(colorA)
  const b = hexChannels(colorB)
  if (!a || !b) return undefined
  const weightA = percentA ? parseFloat(percentA) / 100 : percentB ? 1 - parseFloat(percentB) / 100 : 0.5
  return `#${a.map((channel, i) => Math.round(channel * weightA + b[i]! * (1 - weightA)).toString(16).padStart(2, '0')).join('')}`
}

function hexChannels(color: string | undefined): number[] | undefined {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return undefined
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16))
}

// Renders Mermaid source to PNG bytes. pele syntax errors already include the line and a pointer.
export function renderDiagram(source: string): DiagramError | Buffer {
  const result = errore.try(
    () => render(source, { fontFamily: 'Geist', fontFamilyMono: 'Geist Mono', padding: PADDING, responsive: false, autoDirection: false, links: false, images: false }),
    (error) => new DiagramError({ reason: error instanceof Error ? error.message : String(error) }),
  )
  if (result instanceof Error) return result
  const fontFiles = fs.readdirSync(FONTS_DIR).filter((file) => file.endsWith('.ttf')).map((file) => path.join(FONTS_DIR, file))
  return errore.try(
    () => {
      const resvg = new Resvg(computeCustomProperties(result.svg), {
        background: THEME.get('--pele-bg'),
        fitTo: { mode: 'zoom', value: SCALE },
        font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'Geist', sansSerifFamily: 'Geist', monospaceFamily: 'Geist Mono' },
      })
      return resvg.render().asPng()
    },
    (error) => new DiagramError({ reason: `Rasterizing failed: ${error instanceof Error ? error.message : String(error)}`, cause: error }),
  )
}
