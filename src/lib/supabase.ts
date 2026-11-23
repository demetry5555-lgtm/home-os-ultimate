import { createClient, SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

const forceDemo = import.meta.env.VITE_DEMO_MODE === '1'
export const isCloud = Boolean(url && anon && !url.includes('YOUR-PROJECT') && !forceDemo)

export const supabase: SupabaseClient | null = isCloud
  ? createClient(url!, anon!)
  : null
