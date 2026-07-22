import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Browser client (singleton)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Server client (per-request, with cookies for session)
export function createServerSupabase(req, res) {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: function() {
        return Object.entries(req.cookies || {}).map(function(entry) {
          return { name: entry[0], value: entry[1] || '' }
        })
      },
      setAll: function(cookiesToSet) {
        var existing = res.getHeader('Set-Cookie') || []
        if (typeof existing === 'string') existing = [existing]
        var newCookies = cookiesToSet.map(function(c) {
          var cookie = c.name + '=' + c.value + '; Path=/; HttpOnly; SameSite=Lax; Secure'
          if (c.options && c.options.maxAge) cookie += '; Max-Age=' + c.options.maxAge
          if (c.options && c.options.domain) cookie += '; Domain=' + c.options.domain
          return cookie
        })
        res.setHeader('Set-Cookie', existing.concat(newCookies))
      }
    }
  })
}
