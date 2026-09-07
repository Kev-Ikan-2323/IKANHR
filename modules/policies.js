// ============================================================
// modules/policies.js — Company policy documents
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

export var PoliciesModule = {

  async list(user) {
    var all = await DB.getAll(CONFIG.SHEETS.POLICIES)
    // Admin and HR see everything
    if (user.isAdmin || user.isHR) return all
    // Others see General + their own department
    var dept = user.department || null
    return all.filter(function(p) {
      return p.department === 'General' || (dept && p.department === dept)
    })
  },

  async create(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado.')
    if (!data.name)    throw new Error('El nombre es requerido.')
    if (!data.fileUrl) throw new Error('El archivo es requerido.')
    return DB.insert(CONFIG.SHEETS.POLICIES, {
      name:        data.name,
      description: data.description || '',
      department:  data.department  || 'General',
      fileUrl:     data.fileUrl,
      fileName:    data.fileName    || 'policy.pdf',
      fileSize:    data.fileSize    || 0,
      createdBy:   user.email       || user.id || ''
    })
  },

  async update(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado.')
    if (!data.id) throw new Error('ID es requerido.')
    var changes = {}
    if (data.name        !== undefined) changes.name        = data.name
    if (data.description !== undefined) changes.description = data.description
    if (data.department  !== undefined) changes.department  = data.department
    return DB.update(CONFIG.SHEETS.POLICIES, data.id, changes)
  },

  async delete(data, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado.')
    if (!data.id) throw new Error('ID es requerido.')
    return DB.hardDelete(CONFIG.SHEETS.POLICIES, data.id)
  }
}
