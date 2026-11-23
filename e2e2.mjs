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
const bodyText = () => page.evaluate(() => document.body.innerText)
async function clickButton(text) {
  return page.$$eval('button', (bs, txt) => {
    const b = bs.find(x => x.textContent.includes(txt) && !x.disabled)
    if (b) { b.click(); return true }
    return false
  }, text)
}
async function fillForm(values) {
  const inputs = await page.$$('form input:not([type=file])')
  for (let i = 0; i < values.length && i < inputs.length; i++) {
    await inputs[i].click({ clickCount: 3 })
    await inputs[i].type(values[i])
  }
}
async function pickSelect(index, value) {
  await page.$$eval('form select', (ss, i, v) => { ss[i].value = v; ss[i].dispatchEvent(new Event('change', { bubbles: true })) }, index, value)
  await sleep(150)
}
async function go(hash) { await page.goto(BASE + hash, { waitUntil: 'networkidle0' }); await sleep(500) }

await go('#/')
await page.evaluate(() => localStorage.clear())
await page.$$eval('button', bs => bs.find(b => b.textContent.trim() === 'ع')?.click())
await sleep(400)

// --- setup owner ---
await go('#/login')
await clickButton('إنشاء حساب')
await page.type('input[type=email]', 'owner@home.local')
await page.type('input[type=password]', 'owner-pass-123')
await clickButton('إنشاء حساب')
await sleep(900)
await fillForm(['عبدالله', 'عائلة عبدالله'])
await clickButton('ابدأ عائلتك')
await sleep(900)
check('dashboard after setup', page.url().includes('#/home'))

// --- accounts ---
await go('#/home/finance/accounts')
await fillForm(['الخزنة'])
await pickSelect(0, 'vault')
await clickButton('إنشاء')
await sleep(600)
await fillForm(['البنك'])
await pickSelect(0, 'bank')
await clickButton('إنشاء')
await sleep(600)
let txt = await bodyText()
check('two accounts created', txt.includes('الخزنة') && txt.includes('البنك'))

// --- income 10000 to البنك (second account) ---
await go('#/home/finance/transactions')
await clickButton('دخل')
await sleep(200)
const bankId = await page.$$eval('form select option', os => os[1].value)
await pickSelect(0, bankId)
let inputs = await page.$$('form input:not([type=file])')
await inputs[0].type('10000')
await inputs[1].type('مرتب الشهر')
await clickButton('إضافة دخل')
await sleep(700)

// --- expense 1500 groceries from البنك ---
await clickButton('مصروف')
await sleep(200)
inputs = await page.$$('form input:not([type=file])')
await inputs[0].type('1500')
await inputs[1].type('مشتريات البيت')
await clickButton('إضافة مصروف')
await sleep(700)
txt = await bodyText()
check('income and expense recorded', txt.includes('مرتب الشهر') && txt.includes('مشتريات البيت'))

// --- insufficient funds rejected ---
inputs = await page.$$('form input:not([type=file])')
await inputs[0].click({ clickCount: 3 }); await inputs[0].type('999999')
await clickButton('إضافة مصروف')
await sleep(700)
txt = await bodyText()
check('insufficient funds blocked', txt.includes('الرصيد غير كاف'))
inputs = await page.$$('form input:not([type=file])')
await inputs[0].click({ clickCount: 3 })
for (let i = 0; i < 10; i++) await page.keyboard.press('Backspace')

// --- transfer 2000 البنك -> الخزنة ---
await clickButton('تحويل')
await sleep(300)
const fromOptions = await page.$$eval('form select', ss => Array.from(ss[0].querySelectorAll('option')).map(o => o.value))
await pickSelect(0, fromOptions[1]) // from البنك
await sleep(300)
inputs = await page.$$('form input:not([type=file])')
await inputs[0].type('2000')
await page.$$eval('form button', bs => bs[0].click())
await sleep(700)
const txCount = await page.evaluate(() => JSON.parse(localStorage.getItem('homeos.demo.v1')).transactions.length)
check('transfer recorded (4 txs: income, expense, 2x transfer legs)', txCount === 4)

// --- balances: البنك 6500, الخزنة 2000 ---
await go('#/home/finance/accounts')
txt = await bodyText()
check('bank balance 6500 after income/expense/transfer', txt.includes('6,500'))
check('vault balance 2000 after transfer', txt.includes('2,000'))

// --- loan: borrowed 5000 from عم أحمد; partial 2000; then full ---
await go('#/home/finance/loans')
await fillForm(['عم أحمد', '5000'])
await clickButton('إنشاء')
await sleep(700)
txt = await bodyText()
check('loan created with remaining 5000', txt.includes('عم أحمد') && txt.includes('5,000'))
await clickButton('سداد')
await sleep(300)
let repayInputs = await page.$$('input[inputmode=decimal]')
await repayInputs[repayInputs.length - 1].type('2000')
await page.$$eval('button', bs => { const list = bs.filter(b => b.textContent === 'سداد' && !b.disabled); list[list.length - 1].click() })
await sleep(700)
txt = await bodyText()
check('partial repayment: remaining 3000', txt.includes('3,000'))
await clickButton('سداد')
await sleep(300)
await page.$$eval('select', ss => { const s = ss[ss.length - 1]; const o = Array.from(s.options).find(x => x.textContent === 'البنك'); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })) })
await sleep(200)
await clickButton('سداد كامل')
await sleep(700)
txt = await bodyText()
check('loan fully repaid', txt.includes('تم السداد بالكامل'))

// --- member joins via invitation ---
await go('#/home/invitations')
await fillForm(['سارة'])
await clickButton('إنشاء')
await sleep(700)
const code = await page.evaluate(() => document.querySelector('p[dir="ltr"].font-mono')?.textContent?.trim())
await page.click('button[aria-label="القايمة"]'); await sleep(350); await clickButton('تسجيل الخروج')
await sleep(600)
await go('#/join')
let ji = await page.$$('input')
await ji[0].type(code); await ji[1].type('سارة'); await ji[2].type('sara@home.local'); await ji[3].type('sara-pass-123')
await clickButton('انضمام')
await sleep(900)
check('member joined', page.url().includes('#/home'))

// member read-only
await go('#/home/finance/accounts')
txt = await bodyText()
check('member sees accounts read-only (no create form)', txt.includes('الخزنة') && !txt.includes('حساب جديد'))
await page.click('button[aria-label="القايمة"]'); await sleep(350); await clickButton('تسجيل الخروج')
await sleep(600)

// back as owner
await go('#/login')
await page.type('input[type=email]', 'owner@home.local')
await page.type('input[type=password]', 'owner-pass-123')
await clickButton('تسجيل الدخول')
await sleep(900)

// income 5000 so البنك can cover salary
await go('#/home/finance/transactions')
await clickButton('دخل')
await sleep(200)
await pickSelect(0, bankId)
inputs = await page.$$('form input:not([type=file])')
await inputs[0].type('5000')
await inputs[1].type('دخل إضافي')
await clickButton('إضافة دخل')
await sleep(700)

// salary for سارة: 3000 + 500 bonus - 200 deduction = 3300 net
await go('#/home/finance/salaries')
const memberOpt = await page.$$eval('form select option', os => os.map(o => [o.value, o.textContent]))
const saraOpt = memberOpt.find(([, name]) => name === 'سارة')
await pickSelect(0, saraOpt[0])
inputs = await page.$$('form input:not([type=file])')
await inputs[0].type('3000')
await clickButton('إنشاء')
await sleep(700)
txt = await bodyText()
check('salary created for سارة', txt.includes('سارة') && txt.includes('3,000'))
await clickButton('صرف الراتب')
await sleep(300)
inputs = await page.$$('input[inputmode=decimal]')
await inputs[inputs.length - 2].type('500')
await inputs[inputs.length - 1].type('200')
txt = await bodyText()
check('net preview shows 3300', txt.includes('3,300'))
await page.$$eval('select', ss => { const s = ss[ss.length - 1]; const opts = s.querySelectorAll('option'); s.value = opts[opts.length - 1].value; s.dispatchEvent(new Event('change', { bubbles: true })) })
await sleep(200)
await page.$$eval('button', bs => { const list = bs.filter(b => b.textContent.includes('صرف الراتب') && !b.disabled); list[list.length - 1].click() })
await sleep(800)
txt = await bodyText()
check('payslip with net 3300 recorded', (txt.match(/3,300/g) || []).length >= 1)
// double pay rejected
await clickButton('صرف الراتب')
await sleep(300)
await page.$$eval('button', bs => { const list = bs.filter(b => b.textContent.includes('صرف الراتب') && !b.disabled); list[list.length - 1].click() })
await sleep(700)
txt = await bodyText()
check('double pay for same period rejected', txt.includes('already paid'))

// --- budget: groceries 2000, expense 1500 -> 75% ---
await go('#/home/finance/budgets')
inputs = await page.$$('form input:not([type=file])')
await inputs[0].type('2000')
await clickButton('إنشاء')
await sleep(700)
txt = await bodyText()
check('budget shows 75% used', txt.includes('75%') && txt.includes('1,500') && txt.includes('2,000'))

// --- supervisor: owner promotes سارة ---
await go('#/home/profile')
await sleep(400)
txt = await bodyText()
check('سارة listed as member before promotion', txt.includes('سارة'))
await clickButton('تعيين مشرف')
await sleep(700)
txt = await bodyText()
check('سارة promoted to supervisor', txt.includes('مشرف'))
await page.click('button[aria-label="القايمة"]'); await sleep(350); await clickButton('تسجيل الخروج')
await sleep(600)

// supervisor signs in: can add expense, cannot add accounts
await go('#/login')
await page.type('input[type=email]', 'sara@home.local')
await page.type('input[type=password]', 'sara-pass-123')
await clickButton('تسجيل الدخول')
await sleep(900)
await go('#/home/finance/transactions')
txt = await bodyText()
check('supervisor sees expense form', txt.includes('إضافة مصروف'))
await page.$$eval('select', ss => { const s = ss[0]; const o = Array.from(s.options).find(x => x.textContent === 'البنك'); s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })) })
await sleep(200)
inputs = await page.$$('form input:not([type=file])')
await inputs[0].type('100')
await inputs[1].type('مصروف من المشرفة')
await clickButton('إضافة مصروف')
await sleep(700)
txt = await bodyText()
check('supervisor expense recorded', txt.includes('مصروف من المشرفة'))
await go('#/home/finance/accounts')
txt = await bodyText()
check('supervisor cannot add accounts (owner only)', !txt.includes('حساب جديد') && txt.includes('الخزنة'))
await page.click('button[aria-label="القايمة"]'); await sleep(350); await clickButton('تسجيل الخروج')
await sleep(600)

// back as owner: supervisor expense rolls into owner totals
await go('#/login')
await page.type('input[type=email]', 'owner@home.local')
await page.type('input[type=password]', 'owner-pass-123')
await clickButton('تسجيل الدخول')
await sleep(900)

// --- dashboard totals: income 15000, expense 9900, balance 5100 ---
await go('#/home')
txt = await bodyText()
check('dashboard total balance 5100 (incl supervisor expense)', txt.includes('5,100'))
check('dashboard month income 15000', txt.includes('15,000'))
check('dashboard month expense 9900 (supervisor expense included)', txt.includes('9,900'))

// --- reports ---
await go('#/home/finance/reports')
txt = await bodyText()
check('reports render net and categories', txt.includes('رواتب') || txt.includes('سداد قرض'))

// --- screenshots ---
await page.screenshot({ path: '/downloads/homeos-11-reports.png' })
await go('#/home')
await page.screenshot({ path: '/downloads/homeos-05-dashboard.png' })
await go('#/home/finance')
await page.screenshot({ path: '/downloads/homeos-06-finance.png' })
await go('#/home/finance/accounts')
await page.screenshot({ path: '/downloads/homeos-07-accounts.png' })
await go('#/home/finance/loans')
await page.screenshot({ path: '/downloads/homeos-08-loans.png' })
await go('#/home/finance/salaries')
await page.screenshot({ path: '/downloads/homeos-09-salaries.png' })
await go('#/home/finance/budgets')
await page.screenshot({ path: '/downloads/homeos-10-budgets.png' })

console.log(results.join('\n'))
await browser.close()
