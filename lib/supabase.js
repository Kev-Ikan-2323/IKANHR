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
      get: function(name) {
        return req.cookies[name]
      },
      set: function(name, value, options) {
        var cookie = name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax'
        if (options && options.maxAge) cookie += '; Max-Age=' + options.maxAge
        if (options && options.domain) cookie += '; Domain=' + options.domain
        res.setHeader('Set-Cookie', cookie)
      },
      remove: function(name) {
        res.setHeader('Set-Cookie', name + '=; Path=/; Max-Age=0')
      }
    }
  })
}
