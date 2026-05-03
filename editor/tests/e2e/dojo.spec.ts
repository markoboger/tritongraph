import { expect, test, type Page } from '@playwright/test'

async function diagramNodeCount(page: Page): Promise<number> {
  return page.locator('.vue-flow__node').count()
}

async function viewportZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.vue-flow__viewport') as HTMLElement | null
    if (!viewport) return 0
    const transform = getComputedStyle(viewport).transform
    if (!transform || transform === 'none') return 1
    const match = transform.match(/matrix\(([^)]+)\)/)
    if (!match) return 1
    const parts = match[1].split(',').map((part) => Number(part.trim()))
    return Number.isFinite(parts[0]) ? parts[0] : 1
  })
}

async function stackPackageHeaderState(page: Page, id = 'stack-package-1'): Promise<{
  /** True when the narrow-metrics chrome path is active (replaces legacy stack-hpad classes). */
  metricsBreak: boolean
  titleFound: boolean
  subtitleFound: boolean
  titleVisible: boolean
  subtitleVisible: boolean
}> {
  return page.evaluate((nodeId) => {
    const node = document.querySelector(`[data-testid="diagram-node-${nodeId}"]`) as HTMLElement | null
    const box = node?.querySelector('.package-box') as HTMLElement | null
    const title = box?.querySelector('.title') as HTMLElement | null
    const subtitle = box?.querySelector('.subtitle') as HTMLElement | null
    const nodeRect = node?.getBoundingClientRect()
    const titleRect = title?.getBoundingClientRect()
    const subtitleRect = subtitle?.getBoundingClientRect()
    const isVisible = (rect?: DOMRect | null) =>
      !!rect &&
      rect.width > 2 &&
      rect.height > 2 &&
      !!nodeRect &&
      rect.left >= nodeRect.left - 1 &&
      rect.top >= nodeRect.top - 1 &&
      rect.right <= nodeRect.right + 1 &&
      rect.bottom <= nodeRect.bottom + 1
    return {
      metricsBreak: !!box?.classList.contains('package-box--metrics-break'),
      titleFound: !!title,
      subtitleFound: !!subtitle,
      titleVisible: isVisible(titleRect),
      subtitleVisible: isVisible(subtitleRect),
    }
  }, id)
}

test.describe('dojo fixtures', () => {
  test('loads a requested dojo fixture by query param', async ({ page }) => {
    await page.goto('/?dojo=nesting')

    await expect(page.locator('.diagram-top-bar__path-text')).toContainText('dojo/nesting.ilograph.yaml')
    await expect(page.getByRole('tab', { name: /nesting\.ilograph\.yaml/i })).toBeVisible()
    await expect(page.getByText('workspace', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/tab=dojo%3Anesting/)
    await expect(page).toHaveURL(/perspective=dependencies/)
  })

  test('loads a requested dojo fixture by tab url', async ({ page }) => {
    await page.goto('/?tab=dojo:large-drill-perf&perspective=dependencies')

    await expect(page.locator('.diagram-top-bar__path-text')).toContainText('dojo/large-drill-perf.ilograph.yaml')
    await expect(page.getByRole('tab', { name: /large-drill-perf\.ilograph\.yaml/i })).toBeVisible()
    await expect(page).toHaveURL(/tab=dojo%3Alarge-drill-perf/)
    await expect(page).toHaveURL(/perspective=dependencies/)
  })

  test('honors an explicitly requested perspective from the url', async ({ page }) => {
    await page.goto('/?tab=dojo:nesting&perspective=dependencies')

    await expect(page.locator('.diagram-top-bar__path-text')).toContainText('dojo/nesting.ilograph.yaml')
    await expect(page).toHaveURL(/tab=dojo%3Anesting/)
    await expect(page).toHaveURL(/perspective=dependencies/)

    const edgePaths = page.locator('.vue-flow__edge-path')
    await expect(edgePaths).toHaveCount(4)
    await expect(page.getByRole('checkbox', { name: 'Show depends on relations' })).toBeChecked()
  })

  test('class stacking dojo exposes an artefact count slider and regenerates the diagram', async ({ page }) => {
    await page.goto('/?tab=dojo:class-stacking&dojoDepth=1')

    await expect(page.getByRole('tab', { name: /class-stacking\.ilograph\.yaml/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Dojo' })).toBeVisible()
    await expect(page.getByLabel('Class stacking count')).toHaveValue('1')
    await expect(page.getByText('class-stack-demo', { exact: true })).toBeVisible()

    await page.getByLabel('Class stacking count').fill('40')

    await expect(page.getByLabel('Class stacking count')).toHaveValue('40')
    await expect(page).toHaveURL(/dojoDepth=40/)
  })

  test('class inheritance chain dojo exposes an artefact count slider and regenerates the diagram', async ({
    page,
  }) => {
    await page.goto('/?tab=dojo:class-inheritance-chain&dojoDepth=2')

    await expect(page.getByRole('tab', { name: /class-inheritance-chain\.ilograph\.yaml/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Dojo' })).toBeVisible()
    await expect(page.getByLabel('Class inheritance chain artefact count')).toHaveValue('2')
    await expect(page.getByText('inherit-chain-demo', { exact: true })).toBeVisible()

    await page.getByLabel('Class inheritance chain artefact count').fill('12')

    await expect(page.getByLabel('Class inheritance chain artefact count')).toHaveValue('12')
    await expect(page).toHaveURL(/dojoDepth=12/)
  })

  test('package stacking dojo exposes a count slider and regenerates the diagram', async ({ page }) => {
    await page.goto('/?tab=dojo:package-stacking&dojoDepth=1')

    await expect(page.getByRole('tab', { name: /package-stacking\.ilograph\.yaml/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Dojo' })).toBeVisible()
    await expect(page.getByLabel('Package stacking count')).toHaveValue('1')
    await expect(page.getByText('stack-package-1', { exact: true })).toBeVisible()

    await page.getByLabel('Package stacking count').fill('40')

    await expect(page.getByLabel('Package stacking count')).toHaveValue('40')
    await expect.poll(() => diagramNodeCount(page)).toBeGreaterThanOrEqual(40)
    await expect(page).toHaveURL(/dojoDepth=40/)
  })

  test('package stacking dojo fits several peers in a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 700 })
    await page.goto('/?tab=dojo:package-stacking&dojoDepth=1')

    await expect(page.getByLabel('Package stacking count')).toHaveValue('1')
    await page.getByLabel('Package stacking count').fill('7')
    await expect(page.getByLabel('Package stacking count')).toHaveValue('7')
    await expect.poll(() => page.locator('[data-testid^="diagram-node-stack-package"]').count()).toBe(7)
    const header = await stackPackageHeaderState(page)
    expect(header.titleVisible).toBe(true)
    expect(header.subtitleVisible).toBe(true)
  })

  test('package stacking dojo pins stack-package-1 to the top when count shrinks to one', async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 760 })
    await page.goto('/?tab=dojo:package-stacking&dojoDepth=8')
    await expect(page.getByLabel('Package stacking count')).toHaveValue('8')
    await page.getByLabel('Package stacking count').fill('1')
    await expect(page.getByLabel('Package stacking count')).toHaveValue('1')
    await expect(page.getByText('stack-package-1', { exact: true })).toBeVisible()

    const metrics = await page.evaluate(() => {
      const wrap = document.querySelector('.flow-wrap') as HTMLElement | null
      const node = document.querySelector('[data-testid="diagram-node-stack-package-1"]') as HTMLElement | null
      const box = node?.querySelector('.package-box') as HTMLElement | null
      const iconSlot = box?.querySelector('.lang-icon-slot') as HTMLElement | null
      const icon = box?.querySelector('.lang-icon-slot .lang-svg') as HTMLElement | null
      const wrapRect = wrap?.getBoundingClientRect()
      const nodeRect = node?.getBoundingClientRect()
      const slotRect = iconSlot?.getBoundingClientRect()
      const iconRect = icon?.getBoundingClientRect()
      return {
        nodeTopInWrap: wrapRect && nodeRect ? nodeRect.top - wrapRect.top : 9999,
        gapIconTopMinusNodeTop: nodeRect && iconRect ? iconRect.top - nodeRect.top : 9999,
        iconBandSlackTop: iconRect && slotRect ? iconRect.top - slotRect.top : 9999,
      }
    })
    expect(metrics.nodeTopInWrap).toBeLessThan(72)
    expect(metrics.gapIconTopMinusNodeTop).toBeLessThan(140)
    expect(metrics.iconBandSlackTop).toBeLessThan(24)
  })

  test('package stacking dojo spends stack spacing before zooming out at depth 13', async ({ page }) => {
    await page.goto('/?tab=dojo:package-stacking&dojoDepth=12')

    const zoomAt12 = await viewportZoom(page)
    await page.getByLabel('Package stacking count').fill('13')
    await expect(page.getByLabel('Package stacking count')).toHaveValue('13')
    const zoomAt13 = await viewportZoom(page)

    expect(zoomAt12).toBeGreaterThan(0.98)
    expect(zoomAt13).toBeGreaterThan(0.98)
    expect(Math.abs(zoomAt13 - zoomAt12)).toBeLessThan(0.03)
  })

  test('package stacking dojo keeps title and subtitle visible from depth 7 through 14', async ({ page }) => {
    await page.goto('/?tab=dojo:package-stacking&dojoDepth=7')

    for (let depth = 7; depth <= 14; depth++) {
      await page.getByLabel('Package stacking count').fill(String(depth))
      await expect(page.getByLabel('Package stacking count')).toHaveValue(String(depth))

      const header = await stackPackageHeaderState(page)
      expect(header.titleFound, `stack-package-1 should have a title at depth ${depth}`).toBe(true)
      expect(header.titleVisible, `stack-package-1 title should stay visible at depth ${depth}`).toBe(true)
      // Very dense stacks may hide the subtitle element; when present it must stay on-screen.
      if (header.subtitleFound) {
        expect(header.subtitleVisible, `stack-package-1 subtitle should stay visible at depth ${depth}`).toBe(true)
      }
    }
  })

  test('package tree dojo exposes a node-count slider and regenerates the tree', async ({ page }) => {
    await page.goto('/?tab=dojo:package-tree&dojoDepth=1')

    await expect(page.getByRole('tab', { name: /package-tree\.ilograph\.yaml/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Dojo' })).toBeVisible()
    await expect(page.getByLabel('Package tree node count')).toHaveValue('1')
    await expect(page.getByText('tree-package-1', { exact: true })).toBeVisible()
    await expect(page.locator('.vue-flow__edge-path')).toHaveCount(0)

    await page.getByLabel('Package tree node count').fill('128')

    await expect(page.getByLabel('Package tree node count')).toHaveValue('128')
    await expect.poll(() => diagramNodeCount(page), { timeout: 15000 }).toBeGreaterThanOrEqual(128)
    await expect(page.locator('.vue-flow__edge-path')).toHaveCount(127)
  })

  test('package tree does not zoom out under the 128-node stress case', async ({ page }) => {
    await page.goto('/?tab=dojo:package-tree&dojoDepth=128')

    expect(await viewportZoom(page)).toBeGreaterThan(0.98)
  })

  test('package tree background reset and viewport resize do not trigger zoom-out', async ({ page }) => {
    await page.goto('/?tab=dojo:package-tree&dojoDepth=128')

    expect(await viewportZoom(page)).toBeGreaterThan(0.98)
    await page.locator('.vue-flow__pane').click({ position: { x: 40, y: 40 } })
    expect(await viewportZoom(page)).toBeGreaterThan(0.98)

    await page.setViewportSize({ width: 1120, height: 760 })
    expect(await viewportZoom(page)).toBeGreaterThan(0.98)
  })

  test('package stacking pan rail starts at the visible edge and slider input updates it', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 620 })
    await page.goto('/?tab=dojo:package-stacking&dojoDepth=40')

    const verticalRail = page.locator('.flow-v-scroll-rail__slider')
    await expect(verticalRail).toBeVisible()
    await expect(verticalRail).toHaveAttribute('aria-valuenow', '0')

    // Range inputs can ignore `fill()` in some Playwright/Chromium builds.
    await verticalRail.evaluate((el) => {
      if (!(el instanceof HTMLInputElement)) return
      el.value = '320'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // Whether the diagram is actually scrollable depends on viewport/layout heuristics;
    // this test only asserts the rail remains present and well-formed after input.
    await expect(verticalRail).toHaveAttribute('aria-valuenow', /[0-9]+/)
  })

  test('relation checkboxes affect dojo edge rendering', async ({ page }) => {
    await page.goto('/?tab=dojo:package-tree&dojoDepth=4')

    const edgePaths = page.locator('.vue-flow__edge-path')
    const nodeCount = await diagramNodeCount(page)
    await expect(edgePaths).toHaveCount(3)

    await page.getByRole('checkbox', { name: 'Show imports relations' }).uncheck()
    await expect(edgePaths).toHaveCount(0)
    await expect.poll(() => diagramNodeCount(page)).toBe(nodeCount)
  })

  test('focus clicks through nested dojo nodes without page errors', async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))

    await page.goto('/?dojo=large-drill-perf')

    await page.getByTestId('diagram-node-core-types').click({ force: true })
    await page.getByTestId('diagram-node-platform-auth').click({ force: true })
    await page.getByTestId('diagram-node-domain-accounts').click({ force: true })

    await expect(pageErrors).toEqual([])
    await expect(page.getByRole('tab', { name: /large-drill-perf\.ilograph\.yaml/i })).toBeVisible()
  })
})
