import puppeteer from 'puppeteer-core'

const BASE = 'http://127.0.0.1:4173/'
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage','--lang=en'] })
const page = await browser.newPage()
await page.setViewport({ width: 420, height: 880 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) process.exitCode = 1 }
const bodyText = () => page.evaluate(() => document.body.innerText)
async function clickButton(text, last = false) {
  return page.$$eval('button', (bs, txt, l) => {
    const list = bs.filter(x => x.textContent.includes(txt) && !x.disabled)
    const b = l ? list[list.length - 1] : list[0]
    if (b) { b.click(); return true }
    return false
  }, text, last)
}
async function go(hash) { await page.goto(BASE + hash, { waitUntil: 'networkidle0' }); await sleep(600) }
async function signIn(email, pass) {
  await go('#/login')
  await page.type('input[type=email]', email)
  await page.type('input[type=password]', pass)
  await clickButton('Sign in')
  await sleep(900)
}
async function signOut() { await clickButton('Sign out'); await sleep(700) }
async function selectByText(nth, text) {
  return page.$$eval('form select', (ss, n, txt) => {
    const s = ss[n]; if (!s) return false
    const o = [...s.options].find(o => o.textContent.includes(txt))
    if (!o) return false
    s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true
  }, nth, text)
}
const today = new Date().toISOString().slice(0, 10)
async function setReactDate(selector, index, value) {
  await page.$$eval(selector, (els, i, v) => {
    const el = els[i]; if (!el) return
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, index, value)
}

try {
await go('#/')
await page.evaluate(() => localStorage.clear())
await go('#/login')

// --- owner + funds + member Sara ---
await clickButton('Create account')
await page.type('input[type=email]', 'owner@home.local')
await page.type('input[type=password]', 'owner-pass-123')
await clickButton('Create account')
await sleep(900)
let fi = await page.$$('input:not([type=email]):not([type=password])')
await fi[0].type('Abdullah'); await fi[1].type('Abdullah Family')
await clickButton('Start your family')
await sleep(900)
await go('#/home/finance/accounts')
let inp = await page.$$('form input')
await inp[0].type('Bank')
await clickButton('Create')
await sleep(600)
await go('#/home/finance/transactions')
await clickButton('Income')
await sleep(300)
inp = await page.$$('form input:not([type=file])')
await inp[0].type('20000'); await inp[1].type('Capital')
await clickButton('Add income')
await sleep(800)
await go('#/home/invitations')
inp = await page.$$('form input')
await inp[0].type('Sara')
await clickButton('Create')
await sleep(800)
const code = await page.evaluate(() => document.querySelector('p[dir="ltr"].font-mono')?.textContent?.trim())
check('invite code issued', !!code)

// --- owner documents: family photo + owner-only contract ---
await go('#/home/documents')
await clickButton('Upload file')
await sleep(400)
let fileInput = await page.$('form input[type=file]')
await fileInput.uploadFile('/tmp/tiny.png')
inp = await page.$$('form input:not([type=file])')
await inp[0].type('Family photo')
await selectByText(0, 'Photo')
await clickButton('Upload file', true)
await sleep(1000)
check('family document uploaded', (await bodyText()).includes('Family photo'))
await clickButton('Upload file')
await sleep(400)
fileInput = await page.$('form input[type=file]')
await fileInput.uploadFile('/tmp/lease.pdf')
inp = await page.$$('form input:not([type=file])')
await inp[0].type('Lease contract')
await selectByText(0, 'Contract')
await selectByText(1, 'Owner only')
await clickButton('Upload file', true)
await sleep(1000)
check('owner-only document uploaded', (await bodyText()).includes('Lease contract'))
// preview modal for image
await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'Preview')?.click())
await sleep(800)
check('image preview modal opens', !!(await page.$('img[alt="Family photo"]')))
await page.keyboard.press('Escape')
await page.evaluate(() => document.querySelector('.fixed.inset-0')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
await sleep(400)

// --- owner expense with real receipt upload ---
await go('#/home/finance/transactions')
await sleep(400)
inp = await page.$$('form input:not([type=file])')
await inp[0].type('45'); await inp[1].type('Tools')
fileInput = await page.$('form input[type=file]')
await fileInput.uploadFile('/tmp/tiny.png')
await clickButton('Add expense')
await sleep(1200)
check('receipt marked on transaction', (await bodyText()).includes('Receipt'))
await go('#/home/documents')
await sleep(600)
check('receipt appears in documents', (await bodyText()).includes('tiny.png'))

// --- Sara joins (owner gets invitation notification) ---
await signOut()
await go('#/join')
let ji = await page.$$('input')
await ji[0].type(code); await ji[1].type('Sara'); await ji[2].type('sara@home.local'); await ji[3].type('sara-pass-123')
await clickButton('Join')
await sleep(900)

// --- Sara: member cannot see owner-only doc ---
await go('#/home/documents')
await sleep(600)
let memberDocs = await bodyText()
check('member sees family document', memberDocs.includes('Family photo'))
check('member cannot see owner-only document', !memberDocs.includes('Lease contract'))

// --- Sara creates a request; owner will approve -> notification ---
await go('#/home/requests')
await clickButton('New request')
await sleep(400)
inp = await page.$$('form input:not([type=file])')
await inp[0].type('New phone')
await inp[1].type('My phone broke')
await inp[2].type('300')
await clickButton('Submit request')
await sleep(800)
check('member request created', (await bodyText()).includes('New phone'))
await signOut()

// --- owner: notification from invitation, approve request, assign task due today ---
await signIn('owner@home.local', 'owner-pass-123')
await go('#/home/notifications')
await sleep(600)
check('owner notified of invitation acceptance', (await bodyText()).includes('Invitation accepted'))
await go('#/home/requests')
await page.$$eval('a', as => as.find(a => a.textContent.includes('New phone'))?.click())
await sleep(800)
await clickButton('Approve')
await sleep(900)
check('request approved', (await bodyText()).includes('Approved'))
await go('#/home/tasks')
await clickButton('New task')
await sleep(400)
inp = await page.$$('form input:not([type=date]):not([type=checkbox])')
await inp[0].type('Homework check')
await selectByText(0, 'Sara')
await setReactDate('form input[type=date]', 1, today)   // due today
await clickButton('Create')
await sleep(900)
check('task assigned', (await bodyText()).includes('Homework check'))
await signOut()

// --- Sara: badge, notifications, reminder, mark all read ---
await signIn('sara@home.local', 'sara-pass-123')
await sleep(300)
const badge = await page.evaluate(() => document.querySelector('a[href*="notifications"] span')?.textContent ?? '')
check('unread badge shows count', badge === '2')
await go('#/home/notifications')
await sleep(700)
let notifText = await bodyText()
check('request decision notification', notifText.includes('Request approved'))
check('task assignment notification', notifText.includes('New task assigned'))
check('due-today reminder shown', notifText.includes('Due today'))
await clickButton('Mark all read')
await sleep(800)
const badgeAfter = await page.evaluate(() => document.querySelector('a[href*="notifications"] span')?.textContent ?? '')
check('badge clears after mark all read', badgeAfter === '')

// --- settings: Sara disables task notifications ---
await clickButton('⚙')
await sleep(400)
const boxes = await page.$$('input[type=checkbox]')
// order: request, task, comment, invitation, salary, reminder -> task is index 1
await boxes[1].click()
await sleep(600)
await signOut()
await signIn('owner@home.local', 'owner-pass-123')
await go('#/home/tasks')
await clickButton('New task')
await sleep(400)
inp = await page.$$('form input:not([type=date]):not([type=checkbox])')
await inp[0].type('Second task')
await selectByText(0, 'Sara')
await clickButton('Create')
await sleep(900)
await signOut()
await signIn('sara@home.local', 'sara-pass-123')
await go('#/home/notifications')
await sleep(700)
check('disabled kind produces no notification', !(await bodyText()).includes('Second task'))
await clickButton('⚙')
await sleep(400)
await (await page.$$('input[type=checkbox]'))[1].click()  // re-enable
await sleep(500)

// --- global search ---
await go('#/home/search')
await page.type('input', 'Family photo')
await sleep(900)
let searchText = await bodyText()
check('search finds document', searchText.includes('Family photo'))
await page.$eval('input', el => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'Homework'); el.dispatchEvent(new Event('input', { bubbles: true })) })
await sleep(900)
searchText = await bodyText()
check('search finds task', searchText.includes('Homework check'))
await page.$eval('input', el => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'Lease'); el.dispatchEvent(new Event('input', { bubbles: true })) })
await sleep(900)
searchText = await bodyText()
check('member search cannot find owner-only document', !searchText.includes('Lease contract'))
await signOut()
await signIn('owner@home.local', 'owner-pass-123')
await go('#/home/search')
await page.type('input', 'Lease')
await sleep(900)
searchText = await bodyText()
check('owner search finds owner-only document', searchText.includes('Lease contract'))
await page.$eval('input', el => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'Sara'); el.dispatchEvent(new Event('input', { bubbles: true })) })
await sleep(900)
check('search finds member', (await bodyText()).includes('Sara'))
await page.$eval('input', el => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, 'Tools'); el.dispatchEvent(new Event('input', { bubbles: true })) })
await sleep(900)
check('search finds transaction', (await bodyText()).includes('Tools'))

// --- screenshots ---
await go('#/home/documents')
await sleep(600)
await page.screenshot({ path: '/downloads/homeos-21-documents.png' })
await go('#/home/notifications')
await sleep(600)
await page.screenshot({ path: '/downloads/homeos-22-notifications.png' })
await go('#/home/search')
await page.type('input', 'phone')
await sleep(900)
await page.screenshot({ path: '/downloads/homeos-23-search.png' })
} catch (err) {
  console.log('CRASH:', err.message)
  await page.screenshot({ path: '/downloads/e2e5-crash.png' })
  console.log((await bodyText()).slice(0, 400))
} finally {
  for (const r of results) console.log(r)
  console.log(`TOTALS ${results.filter(r => r.startsWith('PASS')).length}/${results.length}`)
  await browser.close()
}
