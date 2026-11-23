import fs from 'node:fs'
import { makePage, makeHelpers, setupOwner, finish, sleep } from './e2e5common.mjs'

const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const now = new Date()
const today = iso(now)
const tomorrowD = new Date(now); tomorrowD.setDate(tomorrowD.getDate() + 1)
const tomorrow = iso(tomorrowD)
const nextMonthD = new Date(tomorrowD); nextMonthD.setMonth(nextMonthD.getMonth() + 1)
const nextMonth = iso(nextMonthD)

fs.mkdirSync('/tmp/dl6', { recursive: true })

const { browser, page } = await makePage()
const h = makeHelpers(page)
const { check, bodyText, go, clickButton } = h

const clickInCard = (title, btn) => page.evaluate((t, b) => {
  const p = [...document.querySelectorAll('p')].find(x => x.textContent.trim() === t)
  if (!p) return 'no-title'
  let el = p
  for (let i = 0; i < 8 && el; i++) {
    const cand = [...(el.querySelectorAll?.('button') ?? [])].find(x => x.textContent.includes(b))
    if (cand) { cand.click(); return true }
    el = el.parentElement
  }
  return 'no-button'
}, title, btn)

const setInput = (idx, value) => page.$$eval('form input', (els, i, v) => {
  const el = els[i]; if (!el) return
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}, idx, value)

await setupOwner(page, h, true)

// ---- Bills ----
await go('#/home/finance/bills')
let body = await bodyText()
check('bills page heading', body.includes('Bills & installments'))

const addBill = async (title, amount, due, kind, recurrence) => {
  await clickButton('Add bill')
  await sleep(300)
  if (kind) await h.selectByText(0, kind)
  await setInput(0, title)
  if (recurrence) await h.selectByText(2, recurrence)
  await setInput(1, amount)
  await h.setReactDate('form input[type=date]', 0, due)
  await page.$$eval('form button[type=submit], form button:last-of-type', bs => { const b = [...bs].find(x => !x.disabled); b.click() })
  await sleep(700)
}
await addBill('Internet', '500', tomorrow, null, null)
body = await bodyText()
check('monthly bill added', body.includes('Internet'))
await addBill('Fridge', '1500', tomorrow, 'Installment', 'Once')
body = await bodyText()
check('installment added', body.includes('Fridge'))
await addBill('Rent', '8000', today, null, null)
body = await bodyText()
check('rent bill added', body.includes('Rent'))

// pay the monthly Internet bill
check('open pay panel', (await clickInCard('Internet', 'Pay')) === true)
await sleep(400)
await clickButton('Confirm payment')
await sleep(900)
body = await bodyText()
check('monthly bill advanced to next month', body.includes(nextMonth))

// paying recorded an expense
await go('#/home/finance/transactions')
body = await bodyText()
check('bill payment recorded as expense', body.includes('Bill: Internet'))

// pay the one-shot installment -> deactivates
await go('#/home/finance/bills')
check('open pay panel for installment', (await clickInCard('Fridge', 'Pay')) === true)
await sleep(400)
await clickButton('Confirm payment')
await sleep(900)
body = await bodyText()
check('one-shot bill deactivated after payment', body.includes('Inactive'))

// calendar shows the unpaid rent bill this month
await go('#/home/calendar')
body = await bodyText()
check('calendar shows bill due date', body.includes('Rent'))

// notifications remind about bills due soon
await go('#/home/notifications')
body = await bodyText()
check('bill due-soon reminder shown', body.includes('Bills due soon') && body.includes('Rent'))

// ---- Apartment setup so the budget report has data ----
await go('#/home/apartment')
await clickButton('Create apartment profile')
await sleep(400)
let inp = await page.$$('form input')
await inp[0].type('The Apartment')
await inp[1].type('Nasr City, Cairo')
await inp[2].type('140')
await inp[3].type('4')
await inp[4].type('50000')
await clickButton('Save')
await sleep(800)
check('apartment profile saved', (await bodyText()).includes('The Apartment'))
inp = await page.$$('input.input-glass')
await inp[0].type('Living Room')
await clickButton('Add room')
await sleep(800)
check('room added', (await bodyText()).includes('Living Room'))
await clickButton('Finishing stages')
await sleep(500)
await h.selectByText(0, 'Living Room')
inp = await page.$$('form input')
await inp[0].type('Painting')
await inp[1].type('5000')
await clickButton('Add stage')
await sleep(800)
check('stage added', (await bodyText()).includes('Painting'))

// ---- Reports (owner) ----
await go('#/home/finance/reports')
await sleep(700)
body = await bodyText()
check('finance report section', body.includes('Monthly finance report'))
check('report shows month income', body.includes('20,000'))
check('apartment budget report section', body.includes('Apartment budget: planned vs actual') && body.includes('Living Room'))
check('task stats section', body.includes('Task completion stats'))

// CSV export downloads
const client = await page.createCDPSession()
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: '/tmp/dl6' })
await clickButton('Export CSV')
await sleep(1500)
check('finance CSV downloaded', fs.readdirSync('/tmp/dl6').some(f => f.endsWith('.csv')))

// ---- Member gating (Sara) ----
await h.signOut()
await h.signIn('sara@home.local', 'sara-pass-123')
await go('#/home/finance/reports')
await sleep(700)
body = await bodyText()
check('member sees reports gate note', body.includes('Finance reports are visible to the owner and supervisors.'))
check('member does not see finance report', !body.includes('Wallet balances'))
await go('#/home/finance/bills')
body = await bodyText()
check('member cannot add bills', !body.includes('Add bill'))

// ---- Settings (owner) ----
await h.signOut()
await h.signIn('owner@home.local', 'owner-pass-123')
await go('#/home/settings')
await sleep(600)
body = await bodyText()
check('settings page heading', body.includes('Family profile'))
const fi = await page.$$('form input')
await fi[1].click({ clickCount: 3 })
await fi[1].type('Cairo')
await clickButton('Save')
await sleep(800)
body = await bodyText()
check('family profile saved', body.includes('Saved'))
await go('#/home/settings')
await sleep(600)
const cityVal = await page.$$eval('form input', els => els[1]?.value)
check('city persisted after reload', cityVal === 'Cairo')

// language toggle
await clickButton('Switch language')
await sleep(600)
body = await bodyText()
check('arabic UI after toggle', body.includes('الإعدادات'))
await clickButton('بدّل اللغة')
await sleep(600)
body = await bodyText()
check('english UI after toggle back', body.includes('Settings'))

// backup export
await go('#/home/settings')
await sleep(500)
await clickButton('Download backup')
await sleep(1800)
const jf = fs.readdirSync('/tmp/dl6').find(f => f.endsWith('.json'))
let backupOk = false
if (jf) {
  try {
    const data = JSON.parse(fs.readFileSync('/tmp/dl6/' + jf, 'utf8'))
    const s = JSON.stringify(data)
    backupOk = s.includes('Internet') && s.includes('bills')
  } catch {}
}
check('backup JSON downloaded with data', backupOk)

await finish(browser, h.results)
