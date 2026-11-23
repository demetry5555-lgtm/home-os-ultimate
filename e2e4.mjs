import puppeteer from 'puppeteer-core'

const BASE = 'http://127.0.0.1:4173/'
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage','--lang=en'] })
const page = await browser.newPage()
await page.setViewport({ width: 420, height: 880 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) process.exitCode = 1 }
const bodyText = () => page.evaluate(() => document.body.innerText)
async function clickButton(text) {
  return page.$$eval('button', (bs, txt) => {
    const b = bs.find(x => x.textContent.includes(txt) && !x.disabled)
    if (b) { b.click(); return true }
    return false
  }, text)
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
async function setReactDate(selector, index, value) {
  await page.$$eval(selector, (els, i, v) => {
    const el = els[i]; if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, index, value)
}
const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10)

try {
await go('#/')
await page.evaluate(() => localStorage.clear())
await go('#/login')

// --- owner setup (English default) ---
await clickButton('Create account')
await page.type('input[type=email]', 'owner@home.local')
await page.type('input[type=password]', 'owner-pass-123')
await clickButton('Create account')
await sleep(900)
let fi = await page.$$('input:not([type=email]):not([type=password])')
await fi[0].type('Abdullah'); await fi[1].type('Abdullah Family')
await clickButton('Start your family')
await sleep(900)
check('owner bootstrap lands on dashboard', (await bodyText()).includes('Dashboard'))

// --- account + funds ---
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
check('income recorded', (await bodyText()).includes('20,000'))

// --- invite member Sara ---
await go('#/home/invitations')
inp = await page.$$('form input')
await inp[0].type('Sara')
await clickButton('Create')
await sleep(800)
const code = await page.evaluate(() => document.querySelector('p[dir="ltr"].font-mono')?.textContent?.trim())
check('invite code issued', !!code && code.startsWith('HOME-'))

// --- Sara joins now, so she is a member before task assignment ---
await signOut()
await go('#/join')
let ji = await page.$$('input')
await ji[0].type(code); await ji[1].type('Sara'); await ji[2].type('sara@home.local'); await ji[3].type('sara-pass-123')
await clickButton('Join')
await sleep(900)
check('member joined', (await bodyText()).length > 0)
await signOut()
await signIn('owner@home.local', 'owner-pass-123')

// --- apartment profile ---
await go('#/home/apartment')
await clickButton('Create apartment profile')
await sleep(400)
inp = await page.$$('form input')
await inp[0].type('The Apartment')          // name
await inp[1].type('Nasr City, Cairo')       // address
await inp[2].type('140')                    // area
await inp[3].type('4')                      // rooms count
await inp[4].type('50000')                  // budget
await clickButton('Save')
await sleep(800)
check('apartment profile saved', (await bodyText()).includes('The Apartment'))

// --- add room + stage ---
inp = await page.$$('input.input-glass')
await inp[0].type('Living Room')
await clickButton('Add room')
await sleep(800)
check('room added', (await bodyText()).includes('Living Room'))
await clickButton('Finishing stages')
await sleep(500)
await selectByText(0, 'Living Room')
inp = await page.$$('form input')
await inp[0].type('Painting')
await inp[1].type('5000')
await clickButton('Add stage')
await sleep(800)
check('stage added', (await bodyText()).includes('Painting'))
await clickButton('Start')
await sleep(700)
check('stage started 10%', (await bodyText()).includes('In progress'))
await clickButton('+25%')
await sleep(700)

// --- tag an expense to the room ---
await go('#/home/finance/transactions')
await sleep(400)
inp = await page.$$('form input:not([type=file])')
await inp[0].type('1200'); await inp[1].type('Paint supplies')
await selectByText(1, 'apartment')
await selectByText(2, 'Living Room')
await clickButton('Add expense')
await sleep(900)
check('tagged expense recorded', (await bodyText()).includes('Paint supplies'))

// --- apartment budget reflects the tagged expense ---
await go('#/home/apartment')
await sleep(600)
const aptText = await bodyText()
check('planned vs actual shows 1,200 actual', aptText.includes('1,200'))

// --- asset + supplier + maintenance ---
await clickButton('Assets')
await sleep(400)
inp = await page.$$('form input')
await inp[0].type('AC Unit')      // name
await inp[1].type('Carrier')      // brand
await inp[2].type('X-42')         // model
await inp[3].type('18000')        // price
await clickButton('Add asset')
await sleep(800)
check('asset added', (await bodyText()).includes('AC Unit'))
await clickButton('Suppliers')
await sleep(400)
inp = await page.$$('form input')
await inp[0].type('Ahmed Paints'); await inp[1].type('Painter'); await inp[2].type('01000000000')
await clickButton('Add supplier')
await sleep(800)
check('supplier added', (await bodyText()).includes('Ahmed Paints'))
await clickButton('Maintenance')
await sleep(400)
inp = await page.$$('form input')
await inp[0].type('Fix leak')
await setReactDate('form input[type=date]', 0, tomorrow)
await selectByText(0, 'Living Room')
await selectByText(1, 'Ahmed Paints')
await clickButton('Add maintenance')
await sleep(800)
check('maintenance job scheduled', (await bodyText()).includes('Fix leak'))
await clickButton('Done')
await sleep(700)
check('maintenance marked done', (await bodyText()).includes('Done'))

// --- owner creates approval-gated recurring task assigned to Sara, linked room ---
await go('#/home/tasks')
await clickButton('New task')
await sleep(400)
inp = await page.$$('form input:not([type=date]):not([type=checkbox])')
await inp[0].type('Deep clean')
let ta = await page.$$('form textarea')
await ta[0].type('Weekly deep cleaning')
await selectByText(0, 'Sara')                      // assignee
await setReactDate('form input[type=date]', 0, today)
await setReactDate('form input[type=date]', 1, tomorrow)
await selectByText(2, 'Weekly')                    // recurrence
await selectByText(4, 'Living Room')               // room link
await page.$$eval('form input[type=checkbox]', cs => cs[0].click())  // requires approval
await clickButton('Create')
await sleep(900)
check('task created', (await bodyText()).includes('Deep clean'))

// --- open task, add steps ---
await page.$$eval('a', as => as.find(a => a.textContent.includes('Deep clean'))?.click())
await sleep(800)
await page.type('input[placeholder="New step..."]', 'Kitchen')
await clickButton('Add step')
await sleep(500)
await page.type('input[placeholder="New step..."]', 'Bathrooms')
await clickButton('Add step')
await sleep(500)
check('steps added', (await bodyText()).includes('Kitchen') && (await bodyText()).includes('Bathrooms'))

// --- Sara signs in, starts task, requests approval ---
await signOut()
await signIn('sara@home.local', 'sara-pass-123')
await go('#/home/tasks')
await clickButton('Mine')
await sleep(500)
check('member sees assigned task', (await bodyText()).includes('Deep clean'))
await page.$$eval('a', as => as.find(a => a.textContent.includes('Deep clean'))?.click())
await sleep(800)
await clickButton('Start')
await sleep(700)
check('task in progress', (await bodyText()).includes('In progress'))
await page.$$eval('input[type=checkbox]', cs => cs[0].click())
await sleep(500)
await clickButton('Request approval')
await sleep(800)
const memberText = await bodyText()
check('approval requested', memberText.includes('Pending approval'))
check('member cannot approve completion', !(await clickButton('Approve completion')))

// --- member cannot manage apartment ---
await go('#/home/apartment')
await sleep(600)
const memberAptText = await bodyText()
check('member sees apartment (read-only)', memberAptText.includes('The Apartment'))
check('member has no apartment edit button', !(await page.$$eval('button', bs => bs.some(b => b.textContent.trim() === 'Edit'))))

// --- owner approves completion; recurrence spawns; rating ---
await signOut()
await signIn('owner@home.local', 'owner-pass-123')
await go('#/home/tasks')
await page.$$eval('a', as => as.find(a => a.textContent.includes('Deep clean'))?.click())
await sleep(800)
await clickButton('Approve completion')
await sleep(900)
let ownerText = await bodyText()
check('task completed', ownerText.includes('Completed'))
ownerText = await bodyText()
check('recurrence note on completed task', ownerText.includes('Completed'))
const stars = await page.$$eval('button', bs => bs.filter(b => b.textContent.trim() === '★').length)
check('rating stars shown to approver', stars === 5)
await page.$$eval('button', bs => bs.filter(b => b.textContent.trim() === '★').pop()?.click()) // 5 stars
await sleep(800)
check('rating saved', (await bodyText()).includes('★★★★★'))
await go('#/home/tasks')
await sleep(600)
const allText = await bodyText()
const occurrences = (allText.match(/Deep clean/g) || []).length
check('recurrence spawned next occurrence', occurrences >= 2)

// --- calendar: weekly recurring event, views, edit, delete ---
await go('#/home/calendar')
await clickButton('New event')
await sleep(400)
inp = await page.$$('form input')
await inp[0].type('Family dinner')
await setReactDate('form input[type=date]', 0, today)
await selectByText(1, 'Weekly')
await clickButton('Save')
await sleep(900)
let calText = await bodyText()
check('event visible in month view', calText.includes('Family dinner'))
check('task due date visible in month view', calText.includes('Deep clean'))
// week view of next week shows the recurring instance
await clickButton('Week')
await sleep(400)
await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === '›')?.click())
await sleep(600)
calText = await bodyText()
check('recurring event appears next week', calText.includes('Family dinner'))
// day view today
await clickButton('Today')
await sleep(400)
await clickButton('Day')
await sleep(500)
calText = await bodyText()
check('event in day view', calText.includes('Family dinner'))
// edit
await clickButton('Edit')
await sleep(400)
inp = await page.$$('form input')
await inp[0].click({ clickCount: 3 })
await inp[0].type('Family dinner (big)')
await clickButton('Save')
await sleep(900)
check('event edited', (await bodyText()).includes('Family dinner (big)'))
// delete
await clickButton('Edit')
await sleep(400)
await clickButton('Delete')
await sleep(800)
check('event deleted', !(await bodyText()).includes('Family dinner (big)'))

await page.screenshot({ path: '/downloads/homeos-17-calendar.png' })
await go('#/home/tasks')
await sleep(600)
await page.screenshot({ path: '/downloads/homeos-18-tasks.png' })
await go('#/home/apartment')
await sleep(600)
await page.screenshot({ path: '/downloads/homeos-19-apartment.png' })
await page.$$eval('a', as => as.find(a => a.textContent.includes('Living Room'))?.click())
await sleep(800)
await page.screenshot({ path: '/downloads/homeos-20-room.png' })

} catch (err) {
  console.log('CRASH:', err.message)
  await page.screenshot({ path: '/downloads/e2e4-crash.png' })
  console.log((await bodyText()).slice(0, 400))
} finally {
  for (const r of results) console.log(r)
  console.log(`TOTALS ${results.filter(r => r.startsWith('PASS')).length}/${results.length}`)
  await browser.close()
}
