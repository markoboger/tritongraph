import { expect, test } from '@playwright/test'

/**
 * URL deep-link restore for tab keys that `openTabFromUrlKey` previously ignored:
 * `py:` (bundled Python examples) and `package-inner:` (package drill-down tabs,
 * restored by loading the parent tab first and re-drilling).
 */

test.describe('tab url restore', () => {
  test('restores a bundled Python example tab from ?tab=py:…', async ({ page }) => {
    await page.goto('/?tab=py:python-examples/bookstore-api')

    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator('[role="tablist"][aria-label="Open diagrams"] [role="tab"][aria-selected="true"]'),
    ).toContainText('Python: bookstore-api')
    await expect(page.locator('[data-testid="diagram-node-bookstore.catalog"]')).toBeVisible()
  })

  test('restores a package drill-down tab from ?tab=package-inner:…', async ({ page }) => {
    const key = 'package-inner:py:python-examples/bookstore-api#bookstore.catalog'
    await page.goto(`/?tab=${encodeURIComponent(key)}`)

    await expect(page.locator('.vue-flow__node').first()).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator('[role="tablist"][aria-label="Open diagrams"] [role="tab"][aria-selected="true"]'),
    ).toContainText('catalog')
    await expect(page.locator('[data-testid="diagram-node-bookstore.catalog.ebook"]')).toBeVisible()
    // Parent tab is restored alongside the drill tab.
    await expect(page.getByRole('tab', { name: /Python: bookstore-api/ })).toBeVisible()
  })
})
