// ============================================================
// modules/positions.js — Job position administration
// Positions define KPI assignment (separate from roles which control permissions)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'
import { createClient } from '@supabase/supabase-js'

export var PositionsModule = {

  async list(user) {
    return DB.getAll(CONFIG.SHEETS.POSITIONS)
  },

  async create(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    if (!data.name || !data.name.trim()) throw new Error('El nombre del puesto es obligatorio.')
    return DB.insert(CONFIG.SHEETS.POSITIONS, {
      name:        data.name.trim(),
      department:  data.department  || '',
      description: data.description || '',
      status:      'activo'
    })
  },

  async update(id, data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var changes = {}
    if (data.name        !== undefined) changes.name        = data.name.trim()
    if (data.department  !== undefined) changes.department  = data.department
    if (data.description !== undefined) changes.description = data.description
    if (data.status      !== undefined) changes.status      = data.status
    return DB.update(CONFIG.SHEETS.POSITIONS, id, changes)
  },

  async remove(id, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')

    var employees = await DB.getBy(CONFIG.SHEETS.EMPLOYEES, 'positionId', id)
    var active    = employees.filter(function(e) { return e.status !== 'inactivo' })
    if (active.length > 0) {
      throw new Error('No se puede eliminar: ' + active.length + ' empleado(s) activo(s) tienen este puesto.')
    }

    var client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    var { error } = await client.from('positions').delete().eq('id', id)
    if (error) throw new Error('Error eliminando puesto: ' + error.message)
    return { ok: true }
  }
}
