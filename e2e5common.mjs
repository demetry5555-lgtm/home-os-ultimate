import puppeteer from 'puppeteer-core'

export const BASE = 'http://127.0.0.1:4173/'
export const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function makePage() {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage','--lang=en'] })
  const page = await browser.newPage()
  await page.setViewport({ width: 420, height: 880 })
  return { browser, page }
}

export function makeHelpers(page) {
  const results = []
  const check = (name, ok) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) process.exitCode = 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`) }
  const bodyText = () => page.evaluate(() => document.body.innerText)
  const clickButton = (text, last = false) => page.$$eval('button', (bs, txt, l) => {
    const list = bs.filter(x => x.textContent.includes(txt) && !x.disabled)
    const b = l ? list[list.length - 1] : list[0]
    if (b) { b.click(); return true }
    return false
  }, text, last)
  const go = async hash => { await page.goto(BASE + hash, { waitUntil: 'networkidle0' }); await sleep(500) }
  const signIn = async (email, pass) => {
    await go('#/login')
    await page.type('input[type=email]', email)
    await page.type('input[type=password]', pass)
    await clickButton('Sign in')
    await sleep(800)
  }
  const signOut = async () => { await page.click('button[aria-label="Menu"]'); await sleep(350); await clickButton('Sign out'); await sleep(600) }
  const selectByText = (nth, text) => page.$$eval('form select', (ss, n, txt) => {
    const s = ss[n]; if (!s) return false
    const o = [...s.options].find(o => o.textContent.includes(txt))
    if (!o) return false
    s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); return true
  }, nth, text)
  const setReactDate = (selector, index, value) => page.$$eval(selector, (els, i, v) => {
    const el = els[i]; if (!el) return
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, index, value)
  return { results, check, bodyText, clickButton, go, signIn, signOut, selectByText, setReactDate }
}

export async function setupOwner(page, h, withSara) {
  await h.go('#/')
  await page.evaluate(() => localStorage.clear())
  await h.go('#/login')
  await h.clickButton('Create account')
  await page.type('input[type=email]', 'owner@home.local')
  await page.type('input[type=password]', 'owner-pass-123')
  await h.clickButton('Create account')
  await sleep(800)
  const fi = await page.$$('input:not([type=email]):not([type=password])')
  await fi[0].type('Abdullah'); await fi[1].type('Abdullah Family')
  await h.clickButton('Start your family')
  await sleep(800)
  await h.go('#/home/finance/accounts')
  let inp = await page.$$('form input')
  await inp[0].type('Bank')
  await h.clickButton('Create')
  await sleep(500)
  await h.go('#/home/finance/transactions')
  await h.clickButton('Income')
  await sleep(250)
  inp = await page.$$('form input:not([type=file])')
  await inp[0].type('20000'); await inp[1].type('Capital')
  await h.clickButton('Add income')
  await sleep(700)
  if (!withSara) return null
  await h.go('#/home/invitations')
  inp = await page.$$('form input')
  await inp[0].type('Sara')
  await h.clickButton('Create')
  await sleep(700)
  const code = await page.evaluate(() => document.querySelector('p[dir="ltr"].font-mono')?.textContent?.trim())
  await h.signOut()
  await h.go('#/join')
  const ji = await page.$$('input')
  await ji[0].type(code); await ji[1].type('Sara'); await ji[2].type('sara@home.local'); await ji[3].type('sara-pass-123')
  await h.clickButton('Join')
  await sleep(800)
  await h.signOut()
  await h.signIn('owner@home.local', 'owner-pass-123')
  return code
}

export async function finish(browser, results) {
  console.log(`TOTALS ${results.filter(r => r.startsWith('PASS')).length}/${results.length}`)
  await browser.close()
}
