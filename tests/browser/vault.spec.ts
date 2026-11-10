import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

async function subject(page: Page, name: string, create = 'New subject') {
  await page.getByRole('button', { name: create, exact: true }).click()
  await page.getByRole('textbox', { name: 'Subject name' }).fill(name)
  await page.getByRole('button', { name: 'Save subject' }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

async function card(page: Page, question: string, answer: string) {
  await page.getByRole('button', { name: 'Add card' }).click()
  await page.getByRole('textbox', { name: 'Question' }).fill(question)
  await page.getByRole('textbox', { name: 'Answer' }).fill(answer)
  await page.getByRole('button', { name: 'Save card' }).click()
  await expect(page.getByText(question, { exact: true })).toBeVisible()
}

test('library CRUD @library', async ({ page }) => {
  await page.goto('/')
  await subject(page, 'Biology', 'Create your first subject')
  await page.getByRole('button', { name: 'Edit subject' }).click()
  await page.getByRole('textbox', { name: 'Subject name' }).fill('Chemistry')
  await page.getByRole('button', { name: 'Save subject' }).click()
  await expect(page.getByRole('heading', { name: 'Chemistry' })).toBeVisible()
  await card(page, 'What is water?', 'H₂O')
  await page.getByRole('button', { name: 'Edit card: What is water?' }).click()
  await page.getByRole('textbox', { name: 'Question' }).fill('What is H₂O?')
  await page.getByRole('button', { name: 'Save card' }).click()
  await page.getByRole('button', { name: 'Delete card: What is H₂O?' }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await expect(page.getByText('Start this deck')).toBeVisible()
  await page.getByRole('button', { name: 'Delete subject' }).click()
  await page.getByRole('button', { name: 'Confirm delete' }).click()
  await page.reload()
  await expect(page.getByText('Your library is empty')).toBeVisible()
})

test('review and durable schedule @review', async ({ page }) => {
  await page.goto('/library')
  await subject(page, 'Biology')
  await card(page, 'What do plants absorb?', 'Carbon dioxide')
  await page.getByRole('link', { name: /Review/ }).click()
  const reveal = page.getByRole('button', { name: 'Reveal answer' })
  await expect(page.getByText('Carbon dioxide')).toHaveCount(0)
  await reveal.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'ANSWER' })).toBeFocused()
  await expect(page.getByText('Carbon dioxide')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: /^Again/ })).toBeFocused()
  await page.getByRole('button', { name: /^Good/ }).click()
  await expect(page.getByText('You’re all caught up')).toBeVisible()
  await page.reload()
  await expect(page.getByText('You’re all caught up')).toBeVisible()
})

test('controlled offline shell and writes survive reload @offline', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await context.setOffline(true)
  await page.goto('/library')
  await expect(page.getByText('Working offline')).toBeVisible()
  await subject(page, 'Offline deck')
  await card(page, 'Offline prompt', 'Offline answer')
  await page.reload()
  await expect(page.getByText('Offline prompt')).toBeVisible()
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Privacy policy' }).click()
  await expect(page.getByRole('heading', { name: 'StudyVault privacy policy' })).toBeVisible()
  await context.setOffline(false)
  await page.goto('/library')
  await expect(page.getByText('Offline prompt')).toBeVisible()
})

test('mobile and desktop layout, keyboard and axe checks @accessibility', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Make it stick.' })).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  for (const [path, heading] of [['/', 'Make it stick.'], ['/library', 'Library'], ['/review', 'Review'], ['/settings', 'Settings']]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 860 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    }
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  }
})

test('static manifest, headers, and no third-party startup requests @shell', async ({ page, context, request, baseURL }) => {
  const external: string[] = []
  context.on('request', req => { if (new URL(req.url()).origin !== baseURL) external.push(req.url()) })
  const deepLink = await page.goto('/settings')
  expect(deepLink?.status()).toBe(200)
  expect(await deepLink?.headerValue('content-security-policy')).toContain("default-src 'self'")
  expect(await deepLink?.headerValue('x-content-type-options')).toBe('nosniff')
  const config = await (await request.get('/build-info.json')).json()
  await expect(page.getByText(config.driveClient ? 'Set up Google Drive' : 'Google Drive sync is unavailable', { exact: false })).toBeVisible()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  expect(external).toEqual([])
  const response = await request.get('/manifest.webmanifest')
  expect(response.ok()).toBeTruthy()
  const manifest = await response.json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBe('/')
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(['192x192', '512x512'])
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src)
    expect(image.ok()).toBeTruthy()
    const png = await image.body()
    const [width, height] = icon.sizes.split('x').map(Number)
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height])
  }
})

test('local backup export, merge and invalid input @backup', async ({ page }) => {
  await page.goto('/settings')
  const importControl = page.getByLabel('Import backup')
  await importControl.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByRole('alert')).toContainText('format is invalid')
  await importControl.setInputFiles({ name: 'example.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, subjects: [{ id: 's', updatedAt: 1, name: 'Imported', color: 'fern' }], cards: [] })) })
  await expect(page.getByText('Backup merged into your library.')).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup' }).click()
  expect((await download).suggestedFilename()).toBe('studyvault-backup.json')
  await page.getByRole('link', { name: 'Library' }).click()
  await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible()
})
