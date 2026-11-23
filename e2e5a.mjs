import { makePage, makeHelpers, setupOwner, finish, sleep } from './e2e5common.mjs'

const { browser, page } = await makePage()
const h = makeHelpers(page)
try {
  await setupOwner(page, h, false)

  // --- documents: family photo + owner-only contract ---
  await h.go('#/home/documents')
  await h.clickButton('Upload file')
  await sleep(400)
  let fileInput = await page.$('form input[type=file]')
  await fileInput.uploadFile('/tmp/tiny.png')
  let inp = await page.$$('form input:not([type=file])')
  await inp[0].type('Family photo')
  await h.selectByText(0, 'Photo')
  await h.clickButton('Upload file', true)
  await sleep(1000)
  h.check('family document uploaded', (await h.bodyText()).includes('Family photo'))

  await h.clickButton('Upload file')
  await sleep(400)
  fileInput = await page.$('form input[type=file]')
  await fileInput.uploadFile('/tmp/lease.pdf')
  inp = await page.$$('form input:not([type=file])')
  await inp[0].type('Lease contract')
  await h.selectByText(0, 'Contract')
  await h.selectByText(1, 'Owner only')
  await h.clickButton('Upload file', true)
  await sleep(1000)
  h.check('owner-only document uploaded', (await h.bodyText()).includes('Lease contract'))

  // search + category filter
  await page.type('input[placeholder*="Search"]', 'lease')
  await sleep(700)
  let txt = await h.bodyText()
  h.check('document search filters', txt.includes('Lease contract') && !txt.includes('Family photo'))
  await page.$eval('input[placeholder*="Search"]', el => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(700)

  // preview modal
  await page.$$eval('button', bs => {
    const list = bs.filter(x => x.textContent.trim() === 'Preview')
    list[list.length - 1]?.click()
  })
  await sleep(800)
  h.check('image preview modal opens', !!(await page.$('img[alt="Family photo"]')))
  await page.evaluate(() => document.querySelector('.fixed.inset-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await sleep(400)

  // --- expense with real receipt upload ---
  await h.go('#/home/finance/transactions')
  await sleep(400)
  inp = await page.$$('form input:not([type=file])')
  await inp[0].type('45'); await inp[1].type('Tools')
  fileInput = await page.$('form input[type=file]')
  await fileInput.uploadFile('/tmp/tiny.png')
  await h.clickButton('Add expense')
  await sleep(1200)
  h.check('receipt marked on transaction', (await h.bodyText()).includes('Receipt'))
  await h.go('#/home/documents')
  await sleep(600)
  h.check('receipt appears in documents', (await h.bodyText()).includes('tiny.png'))
  await page.screenshot({ path: '/downloads/homeos-21-documents.png' })
} catch (err) {
  console.log('CRASH:', err.message)
  await page.screenshot({ path: '/downloads/e2e5a-crash.png' })
  console.log((await h.bodyText()).slice(0, 300))
} finally {
  await finish(browser, h.results)
}
