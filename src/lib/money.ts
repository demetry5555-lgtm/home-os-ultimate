// Decimal-safe money: all amounts are integer piasters (cents) internally.
// 1 EGP = 100 piasters. No floats ever touch arithmetic.

export type Cents = number

export function parseAmount(input: string): Cents {
  const cleaned = input.trim().replace(/[, ]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('invalid amount')
  const [whole, frac = ''] = cleaned.split('.')
  const cents = parseInt(whole, 10) * 100 + parseInt((frac + '00').slice(0, 2), 10)
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('invalid amount')
  return cents
}

export function formatAmount(cents: Cents): string {
  const whole = Math.floor(cents / 100)
  const frac = Math.abs(cents % 100)
  return `${whole.toLocaleString('en-US')}${frac ? '.' + String(frac).padStart(2, '0') : ''}`
}

// Supabase numeric comes back as string or number; normalize to cents.
export function dbToCents(value: string | number): Cents {
  return parseAmount(String(value))
}

export function centsToDb(cents: Cents): string {
  return (cents / 100).toFixed(2)
}
