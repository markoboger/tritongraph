import { expect, test, type Page } from '@playwright/test'

const NESTING_DEPTH_SWEEP = Array.from({ length: 20 }, (_, index) => index + 1)
const NESTING_DEPTH_SWEEP_FROM_TWO = NESTING_DEPTH_SWEEP.filter((depth) => depth >= 2)

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

async function rootPackageViewportFill(page: Page): Promise<{ widthRatio: number; heightRatio: number }> {
  return page.evaluate(() => {
    const wrap = document.querySelector('.flow-wrap') as HTMLElement | null
    const root = document.querySelector('[data-testid="diagram-node-package-1"]') as HTMLElement | null
    if (!wrap || !root) return { widthRatio: 0, heightRatio: 0 }
    const wrapRect = wrap.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    return {
      widthRatio: wrapRect.width > 0 ? rootRect.width / wrapRect.width : 0,
      heightRatio: wrapRect.height > 0 ? rootRect.height / wrapRect.height : 0,
    }
  })
}

async function nestedPackageContainment(page: Page, depth: number): Promise<Array<{
  childId: string
  parentId: string
  fullyContained: boolean
  childWidth: number
  childHeight: number
  childLeft: number
  childTop: number
  childRight: number
  childBottom: number
  parentLeft: number
  parentTop: number
  parentRight: number
  parentBottom: number
}>> {
  return page.evaluate((targetDepth) => {
    const out: Array<{
      childId: string
      parentId: string
      fullyContained: boolean
      childWidth: number
      childHeight: number
      childLeft: number
      childTop: number
      childRight: number
      childBottom: number
      parentLeft: number
      parentTop: number
      parentRight: number
      parentBottom: number
    }> = []
    for (let level = 2; level <= targetDepth; level++) {
      const child = document.querySelector(`[data-testid="diagram-node-package-${level}"]`) as HTMLElement | null
      const parent = document.querySelector(`[data-testid="diagram-node-package-${level - 1}"]`) as HTMLElement | null
      if (!child || !parent) continue
      const childRect = child.getBoundingClientRect()
      const parentRect = parent.getBoundingClientRect()
      const fullyContained =
        childRect.left >= parentRect.left &&
        childRect.top >= parentRect.top &&
        childRect.right <= parentRect.right &&
        childRect.bottom <= parentRect.bottom
      out.push({
        childId: `package-${level}`,
        parentId: `package-${level - 1}`,
        fullyContained,
        childWidth: childRect.width,
        childHeight: childRect.height,
        childLeft: childRect.left,
        childTop: childRect.top,
        childRight: childRect.right,
        childBottom: childRect.bottom,
        parentLeft: parentRect.left,
        parentTop: parentRect.top,
        parentRight: parentRect.right,
        parentBottom: parentRect.bottom,
      })
    }
    return out
  }, depth)
}

async function innermostPackageHeaderLayout(page: Page, depth: number): Promise<{
  nodeFound: boolean
  iconFound: boolean
  titleFound: boolean
  subtitleFound: boolean
  centeredStackClass: boolean
  iconBottom: number
  titleTop: number
  subtitleTop: number
  titleCenterOffset: number
  subtitleCenterOffset: number
}> {
  return page.evaluate((targetDepth) => {
    const node = document.querySelector(`[data-testid="diagram-node-package-${targetDepth}"]`) as HTMLElement | null
    const box = node?.querySelector('.package-box') as HTMLElement | null
    const groupHeader = node?.querySelector('.group-node__pkg-header') as HTMLElement | null
    const icon =
      (box?.querySelector('.lang-icon-slot') as HTMLElement | null) ??
      (node?.querySelector('.group-node__folder-icon') as HTMLElement | null)
    const title =
      (box?.querySelector('.title') as HTMLElement | null) ??
      (node?.querySelector('.group-node__pkg-header .banner') as HTMLElement | null)
    const subtitle =
      (box?.querySelector('.subtitle') as HTMLElement | null) ??
      (node?.querySelector('.group-node__pkg-header .banner-sub') as HTMLElement | null)
    const nodeRect = node?.getBoundingClientRect()
    const titleRect = title?.getBoundingClientRect()
    const subtitleRect = subtitle?.getBoundingClientRect()
    const iconRect = icon?.getBoundingClientRect()
    const nodeCenterX = nodeRect ? nodeRect.left + nodeRect.width / 2 : 0
    const iconCenterX = iconRect ? iconRect.left + iconRect.width / 2 : nodeCenterX
    const titleCenterX = titleRect ? titleRect.left + titleRect.width / 2 : 0
    const subtitleCenterX = subtitleRect ? subtitleRect.left + subtitleRect.width / 2 : 0
    return {
      nodeFound: !!node,
      iconFound: !!icon,
      titleFound: !!title,
      subtitleFound: !!subtitle,
      centeredStackClass:
        !!box?.classList.contains('package-box--centered-stack') ||
        !!groupHeader?.classList.contains('group-node__pkg-header--centered'),
      iconBottom: iconRect?.bottom ?? 0,
      titleTop: titleRect?.top ?? 0,
      subtitleTop: subtitleRect?.top ?? 0,
      titleCenterOffset: titleRect ? Math.abs(titleCenterX - iconCenterX) : Number.POSITIVE_INFINITY,
      subtitleCenterOffset: subtitleRect ? Math.abs(subtitleCenterX - iconCenterX) : Number.POSITIVE_INFINITY,
    }
  }, depth)
}

async function nonInnermostPackageHeaderLayout(page: Page, level: number): Promise<{
  nodeFound: boolean
  headerFound: boolean
  iconFound: boolean
  titleFound: boolean
  subtitleFound: boolean
  headerLeftInset: number
  headerTopInset: number
  titleLeftOffsetFromIcon: number
  subtitleLeftOffsetFromIcon: number
  titleTopOffsetFromNode: number
  subtitleTopOffsetFromTitle: number
}> {
  return page.evaluate((targetLevel) => {
    const node = document.querySelector(`[data-testid="diagram-node-package-${targetLevel}"]`) as HTMLElement | null
    const header = node?.querySelector('.group-node__pkg-header') as HTMLElement | null
    const icon = header?.querySelector('.group-node__folder-icon') as HTMLElement | null
    const title = header?.querySelector('.banner') as HTMLElement | null
    const subtitle = header?.querySelector('.banner-sub') as HTMLElement | null
    const nodeRect = node?.getBoundingClientRect()
    const headerRect = header?.getBoundingClientRect()
    const iconRect = icon?.getBoundingClientRect()
    const titleRect = title?.getBoundingClientRect()
    const subtitleRect = subtitle?.getBoundingClientRect()
    return {
      nodeFound: !!node,
      headerFound: !!header,
      iconFound: !!icon,
      titleFound: !!title,
      subtitleFound: !!subtitle,
      headerLeftInset: nodeRect && headerRect ? headerRect.left - nodeRect.left : Number.POSITIVE_INFINITY,
      headerTopInset: nodeRect && headerRect ? headerRect.top - nodeRect.top : Number.POSITIVE_INFINITY,
      titleLeftOffsetFromIcon:
        iconRect && titleRect ? titleRect.left - iconRect.right : Number.POSITIVE_INFINITY,
      subtitleLeftOffsetFromIcon:
        iconRect && subtitleRect ? subtitleRect.left - iconRect.right : Number.POSITIVE_INFINITY,
      titleTopOffsetFromNode:
        nodeRect && titleRect ? titleRect.top - nodeRect.top : Number.POSITIVE_INFINITY,
      subtitleTopOffsetFromTitle:
        titleRect && subtitleRect ? subtitleRect.top - titleRect.bottom : Number.POSITIVE_INFINITY,
    }
  }, level)
}

async function immediateChildHeaderVisibility(page: Page, depth: number): Promise<Array<{
  childId: string
  parentId: string
  childHeight: number
  iconVisibleInsideChild: boolean
  titleVisibleInsideChild: boolean
  subtitleVisibleInsideChild: boolean
  iconVisibleInsideParent: boolean
  titleVisibleInsideParent: boolean
  subtitleVisibleInsideParent: boolean
  childHeaderClearsParentHeader: boolean
  iconTopOffset: number
  subtitleBottomGap: number
}>> {
  return page.evaluate((targetDepth) => {
    const out: Array<{
      childId: string
      parentId: string
      childHeight: number
      iconVisibleInsideChild: boolean
      titleVisibleInsideChild: boolean
      subtitleVisibleInsideChild: boolean
      iconVisibleInsideParent: boolean
      titleVisibleInsideParent: boolean
      subtitleVisibleInsideParent: boolean
      childHeaderClearsParentHeader: boolean
      iconTopOffset: number
      subtitleBottomGap: number
    }> = []
    for (let level = 2; level <= targetDepth; level++) {
      const parent = document.querySelector(`[data-testid="diagram-node-package-${level - 1}"]`) as HTMLElement | null
      const child = document.querySelector(`[data-testid="diagram-node-package-${level}"]`) as HTMLElement | null
      if (!child || !parent) continue
      const parentRect = parent.getBoundingClientRect()
      const childRect = child.getBoundingClientRect()
      const parentHeader = parent.querySelector('.group-node__pkg-header, .package-box .lang-icon-slot') as HTMLElement | null
      const box = child.querySelector('.package-box') as HTMLElement | null
      const icon =
        (box?.querySelector('.lang-icon-slot') as HTMLElement | null) ??
        (child.querySelector('.group-node__folder-icon') as HTMLElement | null)
      const title =
        (box?.querySelector('.title') as HTMLElement | null) ??
        (child.querySelector('.group-node__pkg-header .banner') as HTMLElement | null)
      const subtitle =
        (box?.querySelector('.subtitle') as HTMLElement | null) ??
        (child.querySelector('.group-node__pkg-header .banner-sub') as HTMLElement | null)
      const iconRect = icon?.getBoundingClientRect()
      const titleRect = title?.getBoundingClientRect()
      const subtitleRect = subtitle?.getBoundingClientRect()
      const parentHeaderRect = parentHeader?.getBoundingClientRect()
      const contains = (rect?: DOMRect) =>
        !!rect &&
        rect.left >= childRect.left &&
        rect.top >= childRect.top &&
        rect.right <= childRect.right &&
        rect.bottom <= childRect.bottom
      const insideParent = (rect?: DOMRect) =>
        !!rect &&
        rect.left >= parentRect.left &&
        rect.top >= parentRect.top &&
        rect.right <= parentRect.right &&
        rect.bottom <= parentRect.bottom
      out.push({
        childId: `package-${level}`,
        parentId: `package-${level - 1}`,
        childHeight: childRect.height,
        iconVisibleInsideChild: contains(iconRect),
        titleVisibleInsideChild: contains(titleRect),
        subtitleVisibleInsideChild: contains(subtitleRect),
        iconVisibleInsideParent: insideParent(iconRect),
        titleVisibleInsideParent: insideParent(titleRect),
        subtitleVisibleInsideParent: insideParent(subtitleRect),
        childHeaderClearsParentHeader:
          !!iconRect && !!parentHeaderRect ? iconRect.top >= parentHeaderRect.bottom - 1 : false,
        iconTopOffset: iconRect ? iconRect.top - childRect.top : Number.POSITIVE_INFINITY,
        subtitleBottomGap: subtitleRect ? childRect.bottom - subtitleRect.bottom : Number.NEGATIVE_INFINITY,
      })
    }
    return out
  }, depth)
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
    await page.goto('/?tab=dojo:relations&perspective=dependencies')

    await expect(page.locator('.diagram-top-bar__path-text')).toContainText('dojo/relations.ilograph.yaml')
    await expect(page.getByRole('tab', { name: /relations\.ilograph\.yaml/i })).toBeVisible()
    await expect(page).toHaveURL(/tab=dojo%3Arelations/)
    await expect(page).toHaveURL(/perspective=dependencies/)
  })

  test('honors an explicitly requested perspective from the url', async ({ page }) => {
    await page.goto('/?tab=dojo:perspectives&perspective=Runtime%20View')

    await expect(page.locator('.diagram-top-bar__path-text')).toContainText('dojo/perspectives.ilograph.yaml')
    await expect(page).toHaveURL(/tab=dojo%3Aperspectives/)
    await expect(page).toHaveURL(/perspective=Runtime(\+|%20)View/)

    const edgePaths = page.locator('.vue-flow__edge-path')
    await expect(edgePaths).toHaveCount(2)
    await expect(page.getByRole('checkbox', { name: 'Show creates relations' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Show calls relations' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Show depends on relations' })).toHaveCount(0)
  })

  test('package nesting dojo exposes a depth slider and regenerates the diagram', async ({ page }) => {
    await page.goto('/?tab=dojo:package-nesting&dojoDepth=3')

    await expect(page.getByRole('tab', { name: /package-nesting\.ilograph\.yaml/i })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Dojo' })).toBeVisible()
    await expect(page.getByLabel('Package nesting depth')).toHaveValue('3')
    await expect(page.getByText('package-3', { exact: true })).toBeVisible()

    await page.getByLabel('Package nesting depth').fill('6')

    await expect(page.getByLabel('Package nesting depth')).toHaveValue('6')
    await expect(page.getByText('package-6', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/dojoDepth=6/)
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

  test('package stacking dojo switches short package cards into compact top-left headers', async ({ page }) => {
    await page.goto('/?tab=dojo:package-stacking&dojoDepth=1')

    await expect(page.getByLabel('Package stacking count')).toHaveValue('1')
    await expect(page.locator('.package-box--compact-header')).toHaveCount(0)

    await page.getByLabel('Package stacking count').fill('8')

    await expect(page.getByLabel('Package stacking count')).toHaveValue('8')
    await expect
      .poll(async () => page.locator('.package-box--compact-header').count())
      .toBeGreaterThan(0)
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

  test('outermost nesting package keeps filling the viewport across depths and resizes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.goto('/?tab=dojo:package-nesting&dojoDepth=1')

    await expect
      .poll(() => rootPackageViewportFill(page))
      .toMatchObject({ widthRatio: expect.any(Number), heightRatio: expect.any(Number) })

    for (const depth of NESTING_DEPTH_SWEEP) {
      await page.getByLabel('Package nesting depth').fill(String(depth))
      await expect(page.getByLabel('Package nesting depth')).toHaveValue(String(depth))
      await expect(page.getByText(`package-${depth}`, { exact: true })).toBeVisible()

      const initial = await rootPackageViewportFill(page)
      expect(initial.widthRatio).toBeGreaterThan(0.88)
      expect(initial.heightRatio).toBeGreaterThan(0.84)

      await page.setViewportSize({ width: 1180, height: 820 })
      const smaller = await rootPackageViewportFill(page)
      expect(smaller.widthRatio).toBeGreaterThan(0.88)
      expect(smaller.heightRatio).toBeGreaterThan(0.84)

      await page.setViewportSize({ width: 1560, height: 1040 })
      const larger = await rootPackageViewportFill(page)
      expect(larger.widthRatio).toBeGreaterThan(0.88)
      expect(larger.heightRatio).toBeGreaterThan(0.84)
    }
  })

  test('nested packages remain fully contained inside their parent across depths and resizes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.goto('/?tab=dojo:package-nesting&dojoDepth=4')

    for (const depth of NESTING_DEPTH_SWEEP_FROM_TWO) {
      await page.getByLabel('Package nesting depth').fill(String(depth))
      await expect(page.getByLabel('Package nesting depth')).toHaveValue(String(depth))
      await expect(page.getByText(`package-${depth}`, { exact: true })).toBeVisible()

      for (const viewport of [
        { width: 1440, height: 980 },
        { width: 1180, height: 820 },
        { width: 1560, height: 1040 },
      ]) {
        await page.setViewportSize(viewport)
        await expect
          .poll(async () => (await nestedPackageContainment(page, depth)).length)
          .toBe(Math.max(0, depth - 1))
        const containment = await nestedPackageContainment(page, depth)
        for (const row of containment) {
          expect(row.childWidth).toBeGreaterThan(24)
          expect(row.childHeight).toBeGreaterThan(24)
          expect(
            row.fullyContained,
            `${row.childId} should stay inside ${row.parentId} ` +
              `${JSON.stringify({
                child: {
                  left: row.childLeft,
                  top: row.childTop,
                  right: row.childRight,
                  bottom: row.childBottom,
                },
                parent: {
                  left: row.parentLeft,
                  top: row.parentTop,
                  right: row.parentRight,
                  bottom: row.parentBottom,
                },
              })}`,
          ).toBe(true)
        }
      }
    }
  })

  test('innermost unfocused package keeps title and subtitle centered under the logo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.goto('/?tab=dojo:package-nesting&dojoDepth=4')

    for (const depth of NESTING_DEPTH_SWEEP_FROM_TWO) {
      await page.getByLabel('Package nesting depth').fill(String(depth))
      await expect(page.getByLabel('Package nesting depth')).toHaveValue(String(depth))
      await expect(page.getByText(`package-${depth}`, { exact: true })).toBeVisible()

      const layout = await innermostPackageHeaderLayout(page, depth)
      expect(layout.nodeFound).toBe(true)
      expect(layout.iconFound).toBe(true)
      expect(layout.titleFound).toBe(true)
      expect(layout.subtitleFound).toBe(true)
      expect(layout.centeredStackClass).toBe(true)
      expect(layout.titleTop).toBeGreaterThan(layout.iconBottom - 1)
      expect(layout.subtitleTop).toBeGreaterThan(layout.titleTop)
      expect(layout.titleCenterOffset).toBeLessThan(18)
      expect(layout.subtitleCenterOffset).toBeLessThan(18)
    }
  })

  test('non-innermost packages keep icon, title, and subtitle in the top-left corner', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.goto('/?tab=dojo:package-nesting&dojoDepth=4')

    for (const depth of NESTING_DEPTH_SWEEP_FROM_TWO) {
      await page.getByLabel('Package nesting depth').fill(String(depth))
      await expect(page.getByLabel('Package nesting depth')).toHaveValue(String(depth))
      await expect(page.getByText(`package-${depth}`, { exact: true })).toBeVisible()

      const levelsToCheck = Array.from(new Set([1, Math.max(1, depth - 1)])).filter((level) => level < depth)
      for (const level of levelsToCheck) {
        const layout = await nonInnermostPackageHeaderLayout(page, level)
        expect(layout.nodeFound).toBe(true)
        expect(layout.headerFound).toBe(true)
        expect(layout.iconFound).toBe(true)
        expect(layout.titleFound).toBe(true)
        expect(layout.subtitleFound).toBe(true)
        expect(layout.headerLeftInset).toBeLessThan(28)
        expect(layout.headerTopInset).toBeLessThan(56)
        expect(layout.titleLeftOffsetFromIcon).toBeGreaterThan(4)
        expect(layout.subtitleLeftOffsetFromIcon).toBeGreaterThan(4)
        expect(layout.titleTopOffsetFromNode).toBeLessThan(80)
        expect(layout.subtitleTopOffsetFromTitle).toBeGreaterThanOrEqual(-2)
      }
    }
  })

  test('nesting keeps the next package header visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 980 })
    await page.goto('/?tab=dojo:package-nesting&dojoDepth=4')

    for (const depth of NESTING_DEPTH_SWEEP_FROM_TWO) {
      await page.getByLabel('Package nesting depth').fill(String(depth))
      await expect(page.getByLabel('Package nesting depth')).toHaveValue(String(depth))
      await expect(page.getByText(`package-${depth}`, { exact: true })).toBeVisible()

      const visibility = await immediateChildHeaderVisibility(page, depth)
      expect(visibility.length).toBe(depth - 1)
      for (const row of visibility) {
        expect(row.iconVisibleInsideChild, `${row.childId} icon should stay visible inside the child box`).toBe(true)
        expect(row.titleVisibleInsideChild, `${row.childId} title should stay visible inside the child box`).toBe(true)
        if (row.childHeight >= 92) {
          expect(row.subtitleVisibleInsideChild, `${row.childId} subtitle should stay visible inside the child box`).toBe(true)
        }
        expect(
          row.iconVisibleInsideParent,
          `${row.childId} icon should remain visible within ${row.parentId}`,
        ).toBe(true)
        expect(
          row.titleVisibleInsideParent,
          `${row.childId} title should remain visible within ${row.parentId}`,
        ).toBe(true)
        if (row.childHeight >= 92) {
          expect(
            row.subtitleVisibleInsideParent,
            `${row.childId} subtitle should remain visible within ${row.parentId}`,
          ).toBe(true)
        }
        expect(
          row.childHeaderClearsParentHeader,
          `${row.childId} header should stay below the visible header band of ${row.parentId}`,
        ).toBe(true)
        expect(row.iconTopOffset).toBeGreaterThanOrEqual(0)
        expect(row.subtitleBottomGap).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('relation checkboxes affect dojo edge rendering', async ({ page }) => {
    await page.goto('/?dojo=relations')

    const edgePaths = page.locator('.vue-flow__edge-path')
    const nodeCount = await diagramNodeCount(page)
    await expect(edgePaths).toHaveCount(4)

    await page.getByRole('checkbox', { name: 'Show has trait relations' }).uncheck()
    await expect(edgePaths).toHaveCount(3)
    await expect.poll(() => diagramNodeCount(page)).toBe(nodeCount)

    await page.getByRole('checkbox', { name: 'Show gets relations' }).uncheck()
    await expect(edgePaths).toHaveCount(2)
    await expect.poll(() => diagramNodeCount(page)).toBe(nodeCount)
  })

  test('focus clicks through nested dojo nodes without page errors', async ({ page }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))

    await page.goto('/?dojo=folding')

    await page.getByTestId('diagram-node-system').click({ force: true })
    await page.getByTestId('diagram-node-domain').click({ force: true })
    await page.getByTestId('diagram-node-aggregate-users').click({ force: true })

    await expect(pageErrors).toEqual([])
    await expect(page.getByRole('tab', { name: /folding\.ilograph\.yaml/i })).toBeVisible()
  })
})
