import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && publishableKey && !url.includes('SEU-PROJETO'))

export const supabase = createClient(
  url || 'https://SEU-PROJETO.supabase.co',
  publishableKey || 'sb_publishable_placeholder',
  {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }
)
