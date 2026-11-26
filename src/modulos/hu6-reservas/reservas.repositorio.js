/** HU-6 · Acceso a datos de reservas y lista de espera con Sequelize. Modelo: Reserva. */
import { Reserva, plano } from '../../db/modelos.js'
import { siguienteIdDe, soloCampos } from '../../comun/filas.js'

const enOrdenDeLlegada = [
  ['creadaEn', 'ASC'],
  ['id', 'ASC'],
]

export async function listar(db) {
  return (await Reserva.findAll({ order: enOrdenDeLlegada, transaction: db })).map(plano)
}

export async function listarPorEstado(estados, db) {
  const filas = await Reserva.findAll({
    where: { estado: estados }, //                       WHERE estado IN (…)
    order: enOrdenDeLlegada,
    transaction: db,
  })
  return filas.map(plano)
}

export async function listarDeUsuario(usuarioId) {
  const filas = await Reserva.findAll({ where: { usuarioId }, order: [['creadaEn', 'DESC']] })
  return filas.map(plano)
}

export async function buscar(id, db) {
  return plano(await Reserva.findByPk(id, { transaction: db }))
}

export async function siguienteId(db) {
  const filas = await Reserva.findAll({ attributes: ['id'], transaction: db })
  return siguienteIdDe(
    filas.map((f) => f.id),
    'RES',
    4,
  )
}

export async function insertar(r, db) {
  return plano(await Reserva.create(r, { transaction: db }))
}

export async function actualizar(id, cambios, db) {
  await Reserva.update(
    { ...soloCampos(cambios, ['estado', 'unidadId', 'solicitudId']), actualizadaEn: new Date() },
    { where: { id }, transaction: db },
  )
  return buscar(id, db)
}
