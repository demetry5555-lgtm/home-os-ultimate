import { makePage, makeHelpers, setupOwner, sleep } from './e2e5common.mjs'

const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const now = new Date()
const today = iso(now)
const in3 = iso(new Date(now.getTime() + 3 * 864e5))

const { browser, page } = await makePage()
const h = makeHelpers(page)
await setupOwner(page, h, true)

// bills
await h.go('#/home/finance/bills')
const addBill = async (title, amount, due) => {
  await h.clickButton('Add bill'); await sleep(300)
  await page.$$eval('form input', (els, v) => { const el = els[0]; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }, title)
  await page.$$eval('form input', (els, v) => { const el = els[1]; Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }, amount)
  await h.setReactDate('form input[type=date]', 0, due)
  await page.$$eval('form button', bs => { const b = [...bs].find(x => !x.disabled); b.click() })
  await sleep(700)
}
await addBill('Internet', '500', in3)
await addBill('Electricity', '850', today)
await addBill('Rent', '8000', today)

// apartment + room + stage
await h.go('#/home/apartment')
await h.clickButton('Create apartment profile'); await sleep(400)
let inp = await page.$$('form input')
await inp[0].type('The Apartment'); await inp[1].type('Nasr City, Cairo'); await inp[2].type('140'); await inp[3].type('4'); await inp[4].type('50000')
await h.clickButton('Save'); await sleep(800)
inp = await page.$$('input.input-glass')
await inp[0].type('Living Room'); await h.clickButton('Add room'); await sleep(800)
await h.clickButton('Finishing stages'); await sleep(500)
await h.selectByText(0, 'Living Room')
inp = await page.$$('form input')
await inp[0].type('Painting'); await inp[1].type('5000')
await h.clickButton('Add stage'); await sleep(800)

// screenshots
await h.go('#/home/finance/bills'); await sleep(900)
await page.screenshot({ path: '/downloads/homeos-24-bills.png' })
await h.go('#/home/finance/reports'); await sleep(1200)
await page.screenshot({ path: '/downloads/homeos-25-reports.png', fullPage: true })
await h.go('#/home/settings'); await sleep(900)
await page.screenshot({ path: '/downloads/homeos-26-settings.png', fullPage: true })
await h.go('#/home/calendar'); await sleep(900)
await page.screenshot({ path: '/downloads/homeos-27-calendar.png' })
await browser.close()
console.log('shots done')
