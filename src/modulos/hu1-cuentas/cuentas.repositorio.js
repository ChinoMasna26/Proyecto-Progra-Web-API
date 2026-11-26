/**
 * HU-1 · Acceso a datos de cuentas con Sequelize. Solo consultas: ninguna regla del
 * negocio vive aquí. Modelos: Usuario, TokenCuenta, IntentoAcceso.
 */
import { Op, fn, col, where } from 'sequelize'
import { IntentoAcceso, TokenCuenta, Usuario, plano } from '../../db/modelos.js'
import { soloCampos } from '../../comun/filas.js'

// ------------------------------------------------------------------- usuarios

export async function buscarPorCorreo(correo) {
  // Sin distinguir mayúsculas: WHERE lower(correo) = lower($1)
  return plano(
    await Usuario.findOne({
      where: where(fn('lower', col('correo')), String(correo).toLowerCase()),
    }),
  )
}

export async function buscarPorId(id, db) {
  return plano(await Usuario.findByPk(id, { transaction: db }))
}

export async function listar() {
  return (await Usuario.findAll({ order: [['id', 'ASC']] })).map(plano)
}

export async function idsPorRol(rol) {
  const filas = await Usuario.findAll({ attributes: ['id'], where: { rol } })
  return filas.map((f) => f.id)
}

export async function insertar(u) {
  return plano(await Usuario.create(u))
}

const CAMPOS = [
  'nombres',
  'apellidos',
  'celular',
  'carrera',
  'ciclo',
  'anexo',
  'estado',
  'contrasenaHash',
  'deudaPendiente',
  'actualizadoEn',
]

export async function actualizar(id, cambios, db) {
  await Usuario.update(soloCampos(cambios, CAMPOS), { where: { id }, transaction: db })
  return buscarPorId(id, db)
}

// --------------------------------------------------------------------- tokens

/** Guarda un token nuevo y borra el anterior del mismo tipo (solo vale el último enlace). */
export async function guardarToken({ token, tipo, usuarioId, expira }) {
  await TokenCuenta.destroy({
    where: { [Op.or]: [{ usuarioId, tipo }, { expira: { [Op.lt]: new Date() } }] },
  })
  await TokenCuenta.create({ token, tipo, usuarioId, expira })
}

export async function buscarToken(token, tipo) {
  return plano(await TokenCuenta.findOne({ where: { token, tipo } }))
}

export async function borrarToken(token) {
  await TokenCuenta.destroy({ where: { token } })
}

// ------------------------------------------------------------------- intentos

export async function leerIntentos(correo) {
  return plano(await IntentoAcceso.findByPk(correo)) ?? { fallidos: 0, bloqueadoHasta: null }
}

export async function guardarIntentos(correo, { fallidos, bloqueadoHasta }) {
  await IntentoAcceso.upsert({ correo, fallidos, bloqueadoHasta })
}

export async function borrarIntentos(correo) {
  await IntentoAcceso.destroy({ where: { correo } })
}
