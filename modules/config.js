// ============================================================
// modules/config.js — System configuration (port of GAS ConfigModule)
// ============================================================

import { DB } from '../lib/db.js'
import { CONFIG } from '../lib/auth.js'

export var ConfigModule = {

  async get(key, user) {
    var rows = await DB.getBy(CONFIG.SHEETS.CONFIG, 'key', key)
    return rows.length > 0 ? rows[0].value : null
  },

  async set(key, value, user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    var rows = await DB.getBy(CONFIG.SHEETS.CONFIG, 'key', key)
    if (rows.length > 0) {
      return DB.update(CONFIG.SHEETS.CONFIG, rows[0].id, { value: value })
    }
    return DB.insert(CONFIG.SHEETS.CONFIG, { key: key, value: value })
  },

  async getAll(user) {
    if (!user.isAdmin && !user.isHR) throw new Error('Acceso denegado. Se requiere rol admin o hr.')
    return DB.getAll(CONFIG.SHEETS.CONFIG)
  }
}
