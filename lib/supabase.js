import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Admin client — bypasses RLS, used only in server-side API routes
export const adminSupabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Verify a JWT from the browser and return the Supabase user
export async function getUserFromToken(token) {
  if (!token) return null
  var { data: { user }, error } = await adminSupabase.auth.getUser(token)
  if (error || !user) return null
  return user
}
