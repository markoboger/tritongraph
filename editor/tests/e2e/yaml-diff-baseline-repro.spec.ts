import { expect, test, type Page } from '@playwright/test'

/**
 * Regression test for: switching away from a package-inner tab and back shows a non-empty
 * Monaco diff (baseline vs preview) although the user changed nothing.
 *
 * Root cause was: `ilographDocumentToFlow` numbered edges `e-0, e-1, …` per document, so edge ids
 * collided across tabs. Vue Flow's store is keyed by edge id; on tab re-activation the previous
 * tab's same-id edges were reconciled against the new tab's nodes, failed endpoint validation
 * ("Edge source or target is missing") and were dropped from the v-model — so the regenerated
 * YAML preview silently lost those relations and the diff showed phantom deletions.
 *
 * Fixed by endpoint-derived edge ids (ilographToFlow.ts) and by flushing the shared Vue Flow
 * store before restoring a tab snapshot (`activateTabById` in App.vue).
 */

async function diffDecorationCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.querySelector('.yaml-diff-host')
    if (!host) return -1
    return host.querySelectorAll(
      '.line-insert, .line-delete, .char-insert, .char-delete, .inline-deleted-margin-view-zone',
    ).length
  })
}

test('package-inner tab YAML diff stays empty after a tab round-trip', async ({ page }) => {
  await page.goto('/')
  await page.locator('summary', { hasText: 'Python Examples' }).click()
  const card = page.locator('.starter-card', { hasText: 'bookstore-api' }).first()
  await card.locator('button', { hasText: 'Open' }).click()
  await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 15_000 })

  // Open the YAML side panel so the diff editor mounts.
  await page.locator('button[aria-label="Show YAML and tools panel"]').click()
  await expect(page.locator('.yaml-diff-host')).toBeVisible()
  await page.waitForTimeout(1000)
  expect(await diffDecorationCount(page), 'diff should be empty right after load').toBe(0)

  // Drill into a package whose modules import each other (catalog: base/book/ebook/audiobook).
  await page
    .locator('.subtitle-link[title="triton://diagram/package?node=bookstore.catalog"]')
    .first()
    .click()
  await page.waitForTimeout(1500)
  await expect(page.locator('.vue-flow__node').first()).toBeVisible()
  expect(await diffDecorationCount(page), 'diff should be empty after drill-in').toBe(0)

  // Round-trip: parent tab → inner tab.
  await page.getByRole('tab', { name: /Python: bookstore-api/ }).click()
  await page.waitForTimeout(1000)
  await page.getByRole('tab', { name: 'catalog Close tab' }).click()
  await page.waitForTimeout(1500)

  expect(await diffDecorationCount(page), 'diff should still be empty after tab round-trip').toBe(0)
})
