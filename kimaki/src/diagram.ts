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
import { detectType, render } from 'pele'
import postcss from 'postcss'
import valueParser, { type Node as ValueNode } from 'postcss-value-parser'

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts')
const SCALE = 2
const PADDING = 24
// Discord shrinks long images until labels are unreadable; a square one reads best.
// The compact candidate asks pele for the narrowest layout: wrapped labels and `LR`
// turned into `TB` (https://pele.run/api#narrow-screens).
const SQUARE_CANDIDATES = [{ autoDirection: false }, { maxWidth: 1, autoDirection: true, directionBreakpoint: Infinity }]

type ColorName = 'blue' | 'green' | 'purple' | 'pink' | 'amber' | 'red' | 'teal'
type Palette = { readonly [name in ColorName]: { fill: string; stroke: string } }

// Category hues, built in as classDefs so diagrams only write `node:::blue`.
// Light: the claude-style palette of the diagrams-and-charts skill. Dark: Vercel/Next.js docs.
const LIGHT_COLORS: Palette = {
  blue: { fill: '#edf5fb', stroke: '#5290c8' },
  green: { fill: '#eef6f0', stroke: '#5f9a6d' },
  purple: { fill: '#f3effa', stroke: '#8a72c2' },
  pink: { fill: '#fbeef3', stroke: '#c4688a' },
  amber: { fill: '#fbf5e8', stroke: '#c99a3e' },
  red: { fill: '#fbeeee', stroke: '#c8524f' },
  teal: { fill: '#ebf6f4', stroke: '#3f9a8f' },
}

const DARK_COLORS: Palette = {
  blue: { fill: '#0b1f38', stroke: '#1d68c5' },
  green: { fill: '#1a2c1e', stroke: '#49a45f' },
  purple: { fill: '#251931', stroke: '#8955a7' },
  pink: { fill: '#371523', stroke: '#c14c70' },
  amber: { fill: '#4c3d20', stroke: '#f2b342' },
  red: { fill: '#3c1618', stroke: '#e5484d' },
  teal: { fill: '#0d2d2a', stroke: '#12a594' },
}

export type DiagramTheme = 'light' | 'dark'

type Theme = { colors: Palette; vars: ReadonlyMap<string, string> }

// pele's CSS variables (https://pele.run/theming).
function theme({ colors, base }: { colors: Palette; base: Record<string, string> }): Theme {
  const vars = new Map(Object.entries({
    ...base,
    '--pele-radius': '6px',
    '--pele-font': 'Geist, sans-serif',
    '--pele-font-mono': 'Geist Mono, monospace',
    '--pele-series-1': colors.blue.stroke,
    '--pele-series-2': colors.amber.stroke,
    '--pele-series-3': colors.green.stroke,
    '--pele-series-4': colors.pink.stroke,
    '--pele-series-5': colors.purple.stroke,
    '--pele-series-6': base['--pele-accent']!,
    '--pele-series-7': colors.red.stroke,
    '--pele-series-8': colors.teal.stroke,
  }))
  return { colors, vars }
}

const THEMES: { readonly [name in DiagramTheme]: Theme } = {
  light: theme({
    colors: LIGHT_COLORS,
    base: {
      '--pele-bg': '#fafbf8',
      '--pele-fg': '#141413',
      '--pele-muted': '#72736e',
      '--pele-line': '#72736e',
      '--pele-surface': '#ffffff',
      '--pele-surface-alt': '#efeee5',
      '--pele-border': '#72736e',
      '--pele-accent': '#d97757',
      '--pele-critical': LIGHT_COLORS.pink.stroke,
      '--pele-error': LIGHT_COLORS.red.stroke,
    },
  }),
  dark: theme({
    colors: DARK_COLORS,
    base: {
      '--pele-bg': '#0a0a0a',
      '--pele-fg': '#ededed',
      '--pele-muted': '#8f8f8f',
      '--pele-line': '#878787',
      '--pele-surface': '#171717',
      '--pele-surface-alt': '#232323',
      '--pele-border': '#3d3d3d',
      '--pele-accent': '#4a8fe7',
      '--pele-critical': DARK_COLORS.pink.stroke,
      '--pele-error': DARK_COLORS.red.stroke,
    },
  }),
}

export class DiagramError extends errore.createTaggedError({
  name: 'DiagramError',
  message: '$reason',
}) {}

// resvg and librsvg do not support CSS custom properties, which pele uses for
// every color. This does the browser's job on the parsed SVG: custom properties
// inherit down the element tree, and every var() and color-mix() in attributes
// and inline styles is computed to a plain value.
// TODO: drop this once resvg resolves var(). https://github.com/linebender/resvg/issues/821
export function computeCustomProperties(svg: string, vars: ReadonlyMap<string, string> = THEMES.light.vars): string {
  const document = parseDocument(svg, { xmlMode: true })
  for (const child of document.children) visit(child, vars)
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
// Diagram types whose grammar accepts classDef lines.
const CLASS_DEF_TYPES = new Set(['flowchart', 'swimlane', 'state', 'class', 'er', 'requirement'])

// Appends a classDef per color the source does not define itself.
export function withColorClasses(source: string, theme: DiagramTheme = 'light'): string {
  const type = detectType(source)
  if (!type || !CLASS_DEF_TYPES.has(type)) return source
  const { colors, vars } = THEMES[theme]
  const defined = new Set(source.split('\n').flatMap((line) => line.trim().match(/^classDef\s+(\S+)/)?.[1]?.split(',') ?? []))
  const lines = Object.entries(colors)
    .filter(([name]) => !defined.has(name))
    .map(([name, { fill, stroke }]) => `  classDef ${name} fill:${fill},stroke:${stroke},color:${vars.get('--pele-fg')}`)
  return [source.trimEnd(), ...lines].join('\n')
}

export function renderDiagram(source: string, { theme = 'light' }: { theme?: DiagramTheme } = {}): DiagramError | Buffer {
  const { vars } = THEMES[theme]
  const colored = withColorClasses(source, theme)
  const renders = errore.try(
    () => SQUARE_CANDIDATES.map((layout) => render(colored, { fontFamily: 'Geist', fontFamilyMono: 'Geist Mono', padding: PADDING, responsive: false, links: false, images: false, ...layout })),
    (error) => new DiagramError({ reason: error instanceof Error ? error.message : String(error) }),
  )
  if (renders instanceof Error) return renders
  const squareness = ({ width, height }: { width: number; height: number }) => Math.abs(Math.log(width / height))
  const result = renders.reduce((best, candidate) => (squareness(candidate) < squareness(best) ? candidate : best))
  const fontFiles = fs.readdirSync(FONTS_DIR).filter((file) => file.endsWith('.ttf')).map((file) => path.join(FONTS_DIR, file))
  return errore.try(
    () => {
      const resvg = new Resvg(computeCustomProperties(result.svg, vars), {
        background: vars.get('--pele-bg'),
        fitTo: { mode: 'zoom', value: SCALE },
        font: { loadSystemFonts: false, fontFiles, defaultFontFamily: 'Geist', sansSerifFamily: 'Geist', monospaceFamily: 'Geist Mono' },
      })
      return resvg.render().asPng()
    },
    (error) => new DiagramError({ reason: `Rasterizing failed: ${error instanceof Error ? error.message : String(error)}`, cause: error }),
  )
}
