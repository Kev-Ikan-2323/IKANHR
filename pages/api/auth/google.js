// GET /api/auth/google — initiate Google OAuth sign-in
import { createServerSupabase } from '../../../lib/supabase.js'

export default async function handler(req, res) {
  var supabase = createServerSupabase(req, res)
  var proto = req.headers['x-forwarded-proto'] || 'http'
  var host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000'
  var redirectTo = proto + '://' + host + '/api/auth/callback'

  var { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo,
      scopes: 'email profile',
      queryParams: { access_type: 'offline', prompt: 'consent' }
    }
  })

  if (error || !data.url) {
    var msg = error ? error.message : 'No se pudo iniciar sesión'
    return res.status(500).send(
      '<html><body style="font-family:sans-serif;text-align:center;padding:60px">' +
      '<h2>Error al iniciar sesión</h2><p>' + msg + '</p>' +
      '<a href="/">← Volver</a></body></html>'
    )
  }

  res.redirect(data.url)
}
