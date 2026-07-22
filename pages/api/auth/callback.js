// Auth is now handled by the browser Supabase SDK (PKCE auto-exchange).
// This route is kept as a fallback redirect.
export default function handler(req, res) {
  res.redirect('/')
}
