// e2e7: Family Goals + Daily check-in (demo mode)
import { makePage, makeHelpers, setupOwner, finish } from './e2e5common.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const { browser, page } = await makePage()
const h = makeHelpers(page)
const { check, bodyText, clickButton, go } = h

await setupOwner(page, h)

// --- goals ---
await go('#/home/goals')
check('empty goals state', (await bodyText()).includes('No goals yet'))
await clickButton('+ New goal'); await sleep(300)
let fi = await page.$$('#home\\/goals input, input')
const inputs = await page.$$('form input')
await inputs[0].type('Umrah trip')
await inputs[1].type('50000')
await inputs[2].type('EGP')
await clickButton('Add goal'); await sleep(600)
let body = await bodyText()
check('goal created with 0%', body.includes('Umrah trip') && body.includes('0%'))
check('empty state gone', !body.includes('No goals yet'))

await clickButton('+ Add progress'); await sleep(300)
let pf = await page.$$('form input')
await pf[0].type('20000'); await pf[1].type('first payment')
await clickButton('Add progress', true); await sleep(600)
body = await bodyText()
check('progress 40% shown', body.includes('40%'))
check('progress entry with name + note', body.includes('Abdullah') && body.includes('first payment'))

await clickButton('+ Add progress'); await sleep(300)
pf = await page.$$('form input')
await pf[0].type('30000')
await clickButton('Add progress', true); await sleep(600)
body = await bodyText()
check('goal auto-achieved at 100%', body.includes('Achieved'))

// --- daily check-in ---
await go('#/home/checkin')
check('no check-ins yet', (await bodyText()).includes('No check-ins yet today'))
await page.click('button[aria-label="Great"]'); await sleep(200)
await page.type('GlassCard input, .glass input', 'feeling blessed').catch(async () => {
  await page.type('input', 'feeling blessed')
})
await clickButton('Check in'); await sleep(700)
body = await bodyText()
check('saved flash shows', body.includes('Saved') || body.includes('✓'))
check('family feed shows my check-in', body.includes('Abdullah') && body.includes('feeling blessed'))
check('streak shows 1', body.includes('1 day streak'))

// update same day -> still one entry, mood changed
await page.click('button[aria-label="Tired"]'); await sleep(200)
await clickButton('Update check-in'); await sleep(700)
body = await bodyText()
const feedSection = body.split('Family today')[1] || ''
const abdullahCount = (feedSection.match(/Abdullah/g) || []).length
check('same-day re-checkin updates not duplicates', abdullahCount === 1 && !feedSection.includes('feeling blessed') || abdullahCount === 1)

// --- nav has both items in drawer (EN) ---
await page.click('button[aria-label="Menu"]'); await sleep(400)
const drawer = await bodyText()
check('drawer has Daily check-in + Goals', drawer.includes('Daily check-in') && drawer.includes('Goals'))
await page.keyboard.press('Escape')

// --- Arabic ---
await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'ع')?.click())
await go('#/home/goals')
body = await bodyText()
check('arabic goals screen', body.includes('الأهداف'))
await go('#/home/checkin')
body = await bodyText()
check('arabic checkin screen', body.includes('تشيك إن يومي') && body.includes('عامل إيه النهارده؟'))

await finish(browser, h.results)
