// Auth is now handled by the browser Supabase SDK.
// This route is kept as a fallback redirect.
export default function handler(req, res) {
  res.redirect('/')
}
