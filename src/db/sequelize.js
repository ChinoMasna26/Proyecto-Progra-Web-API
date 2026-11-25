/**
 * Conexión a PostgreSQL con Sequelize (ORM). Es el único lugar que crea la conexión;
 * los modelos están en modelos.js y los repositorios de cada historia los usan.
 */
import pg from 'pg'
import { Sequelize } from 'sequelize'
import { config } from '../config.js'

export const sequelize = new Sequelize(config.baseDatos, {
  dialect: 'postgres',
  // Se pasa el driver explícitamente para que Vercel lo incluya al empaquetar la API.
  dialectModule: pg,
  logging: false,
  dialectOptions: config.ssl ? { ssl: { require: true, rejectUnauthorized: false } } : {},
  pool: { max: 5, min: 0, idle: 10000 },
})

/**
 * Corre `trabajo(t)` dentro de una transacción: si algo falla, Sequelize hace ROLLBACK y no
 * se guarda nada. Se usa, por ejemplo, al entregar un préstamo (la unidad y la solicitud
 * cambian juntas). Los repositorios reciben `t` en su último parámetro (db).
 */
export function enTransaccion(trabajo) {
  return sequelize.transaction((t) => trabajo(t))
}
