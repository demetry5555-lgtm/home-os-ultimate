import { supabase, isCloud } from './supabase'
import { demo } from './db'

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv', bom = true): void {
  const blob = new Blob([(bom ? '﻿' : '') + content], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Full family data backup as JSON. Owner only (the caller's screen gates it).
export async function exportBackup(): Promise<void> {
  let payload: unknown
  if (isCloud && supabase) {
    const tables = [
      'families', 'profiles', 'accounts', 'transactions', 'budgets', 'loans', 'payments',
      'salaries', 'salary_payments', 'requests', 'request_comments', 'request_events',
      'tasks', 'task_steps', 'task_comments', 'task_events', 'task_attachments', 'calendar_events',
      'apartments', 'rooms', 'finishing_stages', 'assets', 'maintenance', 'suppliers',
      'chat_threads', 'chat_messages', 'invitations',
      'documents', 'bills', 'notifications', 'notification_settings',
    ]
    const out: Record<string, unknown[]> = {}
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select('*')
      if (!error) out[table] = data ?? []
      // missing tables (older setups) are skipped, not fatal
    }
    payload = { app: 'HOME OS ULTIMATE', exportedAt: new Date().toISOString(), data: out }
  } else {
    payload = { app: 'HOME OS ULTIMATE', exportedAt: new Date().toISOString(), data: demo.load() }
  }
  downloadTextFile(`homeos-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json', false)
}
