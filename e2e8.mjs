// e2e8: profile editing (demo mode) - name, phone, avatar
import { makePage, makeHelpers, setupOwner, finish } from './e2e5common.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const { browser, page } = await makePage()
const h = makeHelpers(page)
const { check, bodyText, clickButton, go } = h

await setupOwner(page, h)
await go('#/home/profile')
check('profile shows owner name', (await bodyText()).includes('Abdullah'))

// avatar upload (small generated png)
const fileInput = await page.$('input[type=file]')
check('avatar file input present', !!fileInput)
await fileInput.uploadFile('/tmp/e2e-avatar.png')
await sleep(1200)
check('avatar image rendered after upload', !!(await page.$('img')))

// edit name + phone
await h.setReactDate('form input:not([type=file])', 0, 'Abdullah Mohamed')
await h.setReactDate('form input:not([type=file])', 1, '01001234567')
await clickButton('Save changes'); await sleep(800)
let body = await bodyText()
check('saved flash', body.includes('Saved') || body.includes('✓'))
check('new name shown', body.includes('Abdullah Mohamed'))
check('phone saved to store', await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('homeos.demo.v1'))
  return s.profiles[0].phone === '01001234567' && s.profiles[0].full_name === 'Abdullah Mohamed'
}))

// persists across reload
await go('#/home/profile')
body = await bodyText()
check('name persists after reload', body.includes('Abdullah Mohamed'))
check('avatar persists after reload', !!(await page.$('img')))

// Arabic labels
await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'ع')?.click()); await sleep(500)
await go('#/home/profile')
body = await bodyText()
check('arabic profile labels', body.includes('رقم الموبايل') && body.includes('احفظ التغييرات'))

await finish(browser, h.results)
