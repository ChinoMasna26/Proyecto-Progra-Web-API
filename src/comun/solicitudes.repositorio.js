/**
 * Repositorio compartido de solicitudes de préstamo (modelo Solicitud de Sequelize).
 *
 * La solicitud tiene una sola tabla, pero la escriben tres historias, cada una en su
 * momento (CONTRATO-DATOS.md): la HU-3 la crea y la retira, la HU-4 la aprueba, la
 * rechaza y la entrega, y la HU-5 registra la devolución y la penalidad. Este archivo solo
 * lee y guarda: las reglas viven en el servicio de cada historia.
 *
 * El parámetro `db` es la transacción de quien llama (o nada, fuera de una transacción).
 */
import { Renovacion, Solicitud, plano } from '../db/modelos.js'
import { siguienteIdDe, soloCampos } from './filas.js'

// Cada solicitud se lee con sus renovaciones (asociación hasMany), en orden.
const conRenovaciones = {
  include: [
    { model: Renovacion, as: 'renovaciones', attributes: { exclude: ['id', 'solicitudId'] } },
  ],
  order: [
    ['creadaEn', 'ASC'],
    [{ model: Renovacion, as: 'renovaciones' }, 'id', 'ASC'],
  ],
}

/** La penalidad se guarda en columnas y se devuelve agrupada, como en la primera entrega. */
function aSolicitud(instancia) {
  const datos = plano(instancia)
  if (!datos) return null
  const {
    penalidadMonto,
    penalidadEstado,
    penalidadCalculadaEn,
    penalidadPagadaEn,
    penalidadRecibidoPor,
    ...resto
  } = datos
  return {
    ...resto,
    renovaciones: resto.renovaciones ?? [],
    penalidad:
      penalidadMonto === null || penalidadMonto === undefined
        ? null
        : {
            monto: penalidadMonto,
            estado: penalidadEstado,
            calculadaEn: penalidadCalculadaEn,
            pagadaEn: penalidadPagadaEn,
            recibidoPor: penalidadRecibidoPor,
          },
  }
}

export async function listar(db) {
  const filas = await Solicitud.findAll({ ...conRenovaciones, transaction: db })
  return filas.map(aSolicitud)
}

export async function listarDeEstudiante(estudianteId, db) {
  const filas = await Solicitud.findAll({
    ...conRenovaciones,
    where: { estudianteId },
    transaction: db,
  })
  return filas.map(aSolicitud)
}

export async function buscarPorId(id, db) {
  return aSolicitud(await Solicitud.findByPk(id, { ...conRenovaciones, transaction: db }))
}

export async function buscarPorCodigo(codigo, db) {
  return aSolicitud(
    await Solicitud.findOne({
      ...conRenovaciones,
      where: { codigoPrestamo: codigo },
      transaction: db,
    }),
  )
}

export async function siguienteId(db) {
  const filas = await Solicitud.findAll({ attributes: ['id'], transaction: db })
  return siguienteIdDe(
    filas.map((f) => f.id),
    'SOL',
    4,
  )
}

export async function listarCodigosPrestamo(db) {
  const filas = await Solicitud.findAll({ attributes: ['codigoPrestamo'], transaction: db })
  return filas.map((f) => f.codigoPrestamo).filter(Boolean)
}

export async function insertar(s, db) {
  await Solicitud.create(
    {
      id: s.id,
      estudianteId: s.estudianteId,
      equipoId: s.equipoId,
      unidadId: s.unidadId ?? null,
      reservaId: s.reservaId ?? null,
      fechaInicio: s.fechaInicio,
      fechaFin: s.fechaFin,
      curso: s.curso ?? '',
      motivo: s.motivo,
      estado: s.estado,
      motivoRechazo: s.motivoRechazo ?? '',
      codigoPrestamo: s.codigoPrestamo ?? null,
      creadaEn: s.creadaEn,
      resueltaEn: s.resueltaEn ?? null,
    },
    { transaction: db },
  )
  return buscarPorId(s.id, db)
}

// Campos que los servicios pueden cambiar después de creada la solicitud.
const CAMPOS = [
  'estado',
  'unidadId',
  'fechaFin',
  'motivoRechazo',
  'resueltaEn',
  'resueltaPor',
  'codigoPrestamo',
  'fechaEntregaReal',
  'accesoriosEntregados',
  'detalleAccesorios',
  'observacionesEntrega',
  'entregadaPor',
  'fechaDevolucionReal',
  'estadoRetorno',
  'accesoriosDevueltos',
  'accesoriosFaltantes',
  'descripcionDano',
  'fotoDano',
  'derivadaMantenimiento',
  'observacionesDevolucion',
  'diasRetraso',
  'recibidaPor',
  'devueltaEn',
  'penalidadMonto',
  'penalidadEstado',
  'penalidadCalculadaEn',
  'penalidadPagadaEn',
  'penalidadRecibidoPor',
]

/** Actualiza solo los campos de la lista blanca. `penalidad` se guarda en sus columnas. */
export async function actualizar(id, cambios, db) {
  const { penalidad, ...resto } = cambios
  const columnas = { ...resto }
  if (penalidad !== undefined) {
    columnas.penalidadMonto = penalidad?.monto ?? null
    columnas.penalidadEstado = penalidad?.estado ?? null
    columnas.penalidadCalculadaEn = penalidad?.calculadaEn ?? null
    columnas.penalidadPagadaEn = penalidad?.pagadaEn ?? null
    columnas.penalidadRecibidoPor = penalidad?.recibidoPor ?? null
  }
  const valores = soloCampos(columnas, CAMPOS)
  if (Object.keys(valores).length)
    await Solicitud.update(valores, { where: { id }, transaction: db })
  return buscarPorId(id, db)
}
