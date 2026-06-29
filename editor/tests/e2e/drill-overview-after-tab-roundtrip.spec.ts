import { expect, test, type Page } from '@playwright/test'

/**
 * Returning to a tab must restore the layer drill the user left it in (their selected box stays
 * focused), AND it must still be possible to drill back out to the *complete* overview without any
 * nodes going missing.
 *
 * The bug this guards against: the GraphDrillIn component is shared across all diagram tabs, and its
 * `layerDrillId` / `layerSnapshot` refs describe the drill on the current tab. Opening the inner
 * diagram snapshotted the parent tab while it was still drilled (siblings `hidden: true`), then the
 * inner document's load ran `resetNavigationAfterDocReplace`, nulling those refs. On return the
 * parent's saved nodes kept the hidden flags but no snapshot remained, so `showFullGraph` saw
 * `layerDrillId === null`, skipped the restore, and left the siblings hidden forever.
 *
 * Fix (App.vue): `recordAndClearOutgoingTabDrillState` persists the drilled node id per tab and
 * saves the un-drilled nodes; `reapplyTabLayerDrill` re-applies the drill on re-activation, which
 * re-captures a fresh snapshot so drilling back out restores every hidden sibling.
 */

function visibleTopPackages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.vue-flow__node')) as HTMLElement[]
    return nodes
      .filter((n) => /bookstore\.[a-z]+$/.test(n.dataset.id || ''))
      .filter((n) => n.offsetParent !== null && n.style.display !== 'none')
      .map((n) => n.dataset.id || '')
      .sort()
  })
}

test('returning to a tab restores the drill, then overview restores every node', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('summary', { hasText: 'Python Examples' }).click()
  await page
    .locator('.starter-card', { hasText: 'bookstore-api' })
    .first()
    .locator('button', { hasText: 'Open' })
    .click()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)

  const allPackages = await visibleTopPackages(page)
  expect(allPackages, 'all four top-level packages visible at load').toEqual([
    'bookstore.catalog',
    'bookstore.inventory',
    'bookstore.orders',
    'bookstore.utils',
  ])

  // Layer-drill catalog: its same-depth sibling (inventory, no import link) is hidden.
  await page
    .locator('.vue-flow__node[data-id="bookstore.catalog"]')
    .click({ position: { x: 12, y: 8 } })
  await page.waitForTimeout(1200)
  expect(await visibleTopPackages(page), 'drill hides the unconnected sibling').not.toContain(
    'bookstore.inventory',
  )

  // Drill into catalog's inner package diagram (opens a new tab).
  await page
    .locator('.subtitle-link[title="triton://diagram/package?node=bookstore.catalog"]')
    .first()
    .click()
  await page.waitForTimeout(1500)
  await expect(page.getByRole('tab', { name: /catalog/ })).toBeVisible()

  // Return to the parent diagram tab: the drill the user left it in is restored.
  await page.getByRole('tab', { name: /Python: bookstore-api/ }).click()
  await page.waitForTimeout(1500)
  expect(
    await visibleTopPackages(page),
    'returning to the tab restores the prior drill (sibling still hidden)',
  ).not.toContain('bookstore.inventory')

  // Drill back out to the full overview (Escape): no nodes are lost.
  await page.locator('.vue-flow').first().click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)
  expect(
    await visibleTopPackages(page),
    'every top-level package is visible again in the overview',
  ).toEqual(['bookstore.catalog', 'bookstore.inventory', 'bookstore.orders', 'bookstore.utils'])
})
