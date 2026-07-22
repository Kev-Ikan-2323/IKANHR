// GET /api/me — return the currently authenticated user
import { getCurrentUser } from '../../lib/auth.js'

export default async function handler(req, res) {
  try {
    var user = await getCurrentUser(req, res)
    if (!user) return res.json({ ok: false, notRegistered: true })
    return res.json({ ok: true, user: user })
  } catch (e) {
    console.error('GET /api/me error:', e.message)
    return res.json({ ok: false, error: e.message })
  }
}
