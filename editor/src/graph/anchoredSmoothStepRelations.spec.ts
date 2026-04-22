import { describe, expect, it } from 'vitest'
import { buildAnchoredSmoothStepRelationDraws } from './anchoredSmoothStepRelations'

type RectInit = { left: number; top: number; width: number; height: number }

function mockRect(el: HTMLElement, rect: RectInit): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    }),
    configurable: true,
  })
}

function mockClientSize(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true })
}

function pathStart(path: string): { x: number; y: number } {
  const match = path.match(/^M\s*([0-9.-]+)[,\s]+([0-9.-]+)/)
  if (!match) throw new Error(`Could not parse path start: ${path}`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

describe('buildAnchoredSmoothStepRelationDraws', () => {
  it('starts the path at the real source anchor when routing left-to-right', () => {
    const root = document.createElement('div')
    const from = document.createElement('div')
    const fromOut = document.createElement('span')
    fromOut.className = 'package-box__artefact-anchor--out'
    from.appendChild(fromOut)
    const to = document.createElement('div')
    const toIn = document.createElement('span')
    toIn.className = 'package-box__artefact-anchor--in'
    to.appendChild(toIn)

    mockRect(root, { left: 100, top: 50, width: 500, height: 300 })
    mockClientSize(root, 500, 300)
    mockRect(from, { left: 160, top: 120, width: 60, height: 40 })
    mockRect(fromOut, { left: 218, top: 136, width: 8, height: 8 })
    mockRect(to, { left: 340, top: 120, width: 60, height: 40 })
    mockRect(toIn, { left: 340, top: 136, width: 8, height: 8 })

    const draws = buildAnchoredSmoothStepRelationDraws({
      rootEl: root,
      relations: [{ id: 'r1', from: 'from', to: 'to' }],
      slotEls: new Map([
        ['from', from],
        ['to', to],
      ]),
    })

    expect(draws).toHaveLength(1)
    const start = pathStart(draws[0]!.path)
    expect(draws[0]!.from).toBe('from')
    expect(draws[0]!.to).toBe('to')
    expect(start).toEqual({ x: 122, y: 90 })
  })

  it('still starts from the real source anchor when the source sits to the right of the target', () => {
    const root = document.createElement('div')
    const from = document.createElement('div')
    const fromOut = document.createElement('span')
    fromOut.className = 'package-box__artefact-anchor--out'
    from.appendChild(fromOut)
    const to = document.createElement('div')
    const toIn = document.createElement('span')
    toIn.className = 'package-box__artefact-anchor--in'
    to.appendChild(toIn)

    mockRect(root, { left: 100, top: 50, width: 500, height: 300 })
    mockClientSize(root, 500, 300)
    mockRect(from, { left: 420, top: 120, width: 60, height: 40 })
    mockRect(fromOut, { left: 478, top: 136, width: 8, height: 8 })
    mockRect(to, { left: 220, top: 120, width: 60, height: 40 })
    mockRect(toIn, { left: 220, top: 136, width: 8, height: 8 })

    const draws = buildAnchoredSmoothStepRelationDraws({
      rootEl: root,
      relations: [{ id: 'r2', from: 'from', to: 'to' }],
      slotEls: new Map([
        ['from', from],
        ['to', to],
      ]),
    })

    expect(draws).toHaveLength(1)
    const start = pathStart(draws[0]!.path)
    expect(draws[0]!.from).toBe('from')
    expect(draws[0]!.to).toBe('to')
    expect(start).toEqual({ x: 382, y: 90 })
  })
})
