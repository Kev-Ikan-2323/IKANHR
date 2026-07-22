// Supabase OAuth callback — exchanges code for session
import { createServerSupabase } from '../../../lib/supabase.js'

export default async function handler(req, res) {
  var code = req.query.code

  if (code) {
    var supabase = createServerSupabase(req, res)
    var { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('OAuth callback error:', error.message)
      return res.redirect('/?error=auth_failed')
    }
  }

  res.redirect('/')
}
