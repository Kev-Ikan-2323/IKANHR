// POST /api/auth/logout — sign out
import { createServerSupabase } from '../../../lib/supabase.js'

export default async function handler(req, res) {
  var supabase = createServerSupabase(req, res)
  await supabase.auth.signOut()
  res.redirect('/')
}
