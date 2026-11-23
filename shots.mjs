import puppeteer from 'puppeteer-core'

const BASE = 'http://127.0.0.1:4173/'
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--lang=ar'],
})
const page = await browser.newPage()
await page.setViewport({ width: 420, height: 880, deviceScaleFactor: 2 })

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// 1. Login screen (fresh state)
await page.goto(BASE + '#/login', { waitUntil: 'networkidle0', timeout: 30000 })
await page.evaluate(() => localStorage.clear())
await page.goto(BASE + '#/login', { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 1200))
await page.screenshot({ path: '/downloads/homeos-01-login.png' })

// 2. Invite registration screen
await page.goto(BASE + '#/join', { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 800))
await page.screenshot({ path: '/downloads/homeos-02-join.png' })

// 3. Invitations screen as the owner: seed demo store with an owner + invites
const now = Date.now()
const seed = {
  users: [{ id: 'owner-1', email: 'abdullah@home.local', passHash: 'x' }],
  profiles: [
    { id: 'owner-1', family_id: 'family-1', full_name: 'عبدالله', role: 'owner', status: 'active' },
    { id: 'member-1', family_id: 'family-1', full_name: 'سارة', role: 'member', status: 'active' },
  ],
  invitations: [
    { id: 'i1', code_hash: await sha256hex('HOME-7K2P-9QXZ'), code_hint: '9QXZ', intended_name: 'سارة', status: 'accepted', expires_at: new Date(now + 5 * 864e5).toISOString(), accepted_by: 'member-1', created_at: new Date(now - 2 * 864e5).toISOString() },
    { id: 'i2', code_hash: 'pending-hash', code_hint: 'M4T8', intended_name: 'يوسف', status: 'pending', expires_at: new Date(now + 6 * 864e5).toISOString(), accepted_by: null, created_at: new Date(now - 864e5).toISOString() },
    { id: 'i3', code_hash: 'revoked-hash', code_hint: 'B2C7', intended_name: 'خالد', status: 'revoked', expires_at: new Date(now + 864e5).toISOString(), accepted_by: null, created_at: new Date(now - 3 * 864e5).toISOString() },
  ],
  familyName: 'عائلة عبدالله',
  session: { userId: 'owner-1', email: 'abdullah@home.local' },
}
await page.evaluate(s => localStorage.setItem('homeos.demo.v1', JSON.stringify(s)), seed)
await page.goto(BASE + '#/home/invitations', { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 1000))
await page.screenshot({ path: '/downloads/homeos-03-invitations.png' })

// 4. Bonus: splash
await page.goto(BASE + '#/', { waitUntil: 'networkidle0' })
await new Promise(r => setTimeout(r, 1000))
await page.screenshot({ path: '/downloads/homeos-00-splash.png' })

await browser.close()
console.log('screenshots done')
