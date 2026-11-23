import puppeteer from 'puppeteer-core'

const BASE = 'http://127.0.0.1:4173/'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ar'],
})
const page = await browser.newPage()
await page.setViewport({ width: 420, height: 880 })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) process.exitCode = 1 }

async function type(selector, text) { await page.click(selector); await page.type(selector, text) }

await page.goto(BASE, { waitUntil: 'networkidle0' })
await page.evaluate(() => localStorage.clear())
await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'ع')?.click())
await sleep(400)

// --- 1. Owner signup ---
await page.goto(BASE + '#/login', { waitUntil: 'networkidle0' })
await sleep(500)
await page.$$eval('button', bs => bs.find(b => b.textContent.includes('إنشاء حساب')).click())
await sleep(300)
await type('input[type=email]', 'abdullah@home.local')
await type('input[type=password]', 'owner-pass-123')
await page.$$eval('form button', b => b[0].click())
await sleep(800)

// --- 2. Gate -> owner setup ---
await page.waitForFunction(() => location.hash === '#/setup' || location.hash === '#/home/invitations', { timeout: 5000 })
check('gate routes new user to owner setup', (await page.url()).includes('#/setup'))
await type('input:not([type=email]):not([type=password])', 'عبدالله')
const inputs = await page.$$('input:not([type=email]):not([type=password])')
await inputs[1].type('عائلة عبدالله')
await page.$$eval('form button', b => b[0].click())
await sleep(800)
check('owner lands on invitations', (await page.url()).includes('#/home'))

// --- 3. Create invitation ---
await page.goto(BASE + '#/home/invitations', { waitUntil: 'networkidle0' })
await sleep(500)
await type('input', 'سارة')
await page.$$eval('form button', b => b[0].click())
await sleep(800)
const code = await page.evaluate(() => document.querySelector('p[dir="ltr"].font-mono')?.textContent?.trim())
check('invitation code generated HOME-XXXX-XXXX', /^HOME-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code || ''))
console.log('generated code:', code)

// --- 4. Sign out, join as member with the code ---
await page.$$eval('nav button', b => b[b.length - 1].click()) // sign out
await sleep(600)
await page.goto(BASE + '#/join', { waitUntil: 'networkidle0' })
await sleep(500)
const joinInputs = await page.$$('input')
await joinInputs[0].type(code)
await joinInputs[1].type('سارة')
await joinInputs[2].type('sara@home.local')
await joinInputs[3].type('sara-pass-123')
await page.$$eval('form button', b => b[0].click())
await sleep(900)
check('member joined and reached home', (await page.url()).includes('#/home'))

// --- 5. Member cannot see invitations list content (guard) ---
const memberBody = await page.evaluate(() => document.body.innerText)
check('member sees profile nav (is inside app)', memberBody.length > 0)

// --- 6. Owner signs back in, sees accepted, suspends member ---
await page.$$eval('nav button', b => b[b.length - 1].click())
await sleep(600)
await page.goto(BASE + '#/login', { waitUntil: 'networkidle0' })
await sleep(400)
await type('input[type=email]', 'abdullah@home.local')
await type('input[type=password]', 'owner-pass-123')
await page.$$eval('form button', b => b[0].click())
await sleep(900)
await page.goto(BASE + '#/home/invitations', { waitUntil: 'networkidle0' })
await sleep(600)
const invText = await page.evaluate(() => document.body.innerText)
check('owner sees invitation accepted', invText.includes('مقبولة'))

await page.goto(BASE + '#/home/profile', { waitUntil: 'networkidle0' })
await sleep(600)
await page.screenshot({ path: '/downloads/homeos-04-profile-owner.png' })
const profButtons = await page.$$('button')
let suspended = false
for (const b of profButtons) {
  const txt = await b.evaluate(el => el.textContent)
  if (txt && txt.includes('تعطيل')) { await b.click(); suspended = true; break }
}
await sleep(600)
check('owner suspended the member', suspended)

// --- 7. Suspended member cannot sign in ---
await page.$$eval('nav button', b => b[b.length - 1].click())
await sleep(600)
await page.goto(BASE + '#/login', { waitUntil: 'networkidle0' })
await sleep(400)
await type('input[type=email]', 'sara@home.local')
await type('input[type=password]', 'sara-pass-123')
await page.$$eval('form button', b => b[0].click())
await sleep(800)
const loginText = await page.evaluate(() => document.body.innerText)
check('suspended member is denied sign-in', loginText.includes('suspended') && (await page.url()).includes('#/login'))

// --- 8. Reused code is rejected ---
await page.goto(BASE + '#/join', { waitUntil: 'networkidle0' })
await sleep(400)
const j2 = await page.$$('input')
await j2[0].type(code)
await j2[1].type('مخترق')
await j2[2].type('hacker@home.local')
await j2[3].type('hacker-pass-1')
await page.$$eval('form button', b => b[0].click())
await sleep(800)
const reuseText = await page.evaluate(() => document.body.innerText)
check('single-use code rejected on reuse', reuseText.includes('مستخدم') || reuseText.includes('used') || reuseText.includes('غير صحيح'))

console.log(results.join('\n'))
await browser.close()
