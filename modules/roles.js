// ============================================================
// modules/roles.js — Role administration (port of GAS Roles.js)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

export var RolesModule = {

  async list(user) {
    return DB.getAll(CONFIG.SHEETS.ROLES)
  },

  async create(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    if (!data.name || !data.name.trim()) throw new Error('El nombre del rol es obligatorio')

    // Generate correlative ID
    var existing = await DB.getAll(CONFIG.SHEETS.ROLES)
    var maxNum = existing.reduce(function(m, r) {
      var n = parseInt((r.id || '').replace('role-', '')) || 0
      return Math.max(m, n)
    }, 0)
    var id = 'role-' + String(maxNum + 1).padStart(3, '0')

    var permissions = data.permissions || ['employee']
    if (typeof permissions === 'string') {
      try { permissions = JSON.parse(permissions) } catch (e) { permissions = ['employee'] }
    }

    return DB.insert(CONFIG.SHEETS.ROLES, {
      id:          id,
      name:        data.name.trim(),
      level:       data.level || 3,
      department:  data.department || '',
      description: data.description || '',
      permissions: JSON.stringify(permissions)
    })
  },

  async update(id, data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var changes = {}
    if (data.name)                     changes.name        = data.name.trim()
    if (data.level)                    changes.level       = data.level
    if (data.department !== undefined) changes.department  = data.department
    if (data.description !== undefined) changes.description = data.description
    if (data.permissions) {
      var perms = data.permissions
      if (typeof perms !== 'string') perms = JSON.stringify(perms)
      changes.permissions = perms
    }
    return DB.update(CONFIG.SHEETS.ROLES, id, changes)
  },

  async remove(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')

    var employees = await DB.getBy(CONFIG.SHEETS.EMPLOYEES, 'roleId', id)
    var active    = employees.filter(function(e) { return e.status !== 'inactivo' })
    if (active.length > 0) {
      throw new Error('No se puede eliminar: ' + active.length + ' empleado(s) activo(s) usan este rol.')
    }

    var record = await DB.getById(CONFIG.SHEETS.ROLES, id)
    if (!record) throw new Error('Rol no encontrado')

    // Soft-delete via status field (roles table doesn't have status, use a workaround)
    // We mark it inactive by updating name to signal deletion, or just return ok
    // In Supabase we can do a real delete since we control the schema
    var { createClient } = await import('@supabase/supabase-js')
    var client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    var { error } = await client.from('roles').delete().eq('id', id)
    if (error) throw new Error('Error eliminando rol: ' + error.message)

    return { ok: true }
  }
}
