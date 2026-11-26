/**
 * HU-2 · Acceso a datos del inventario con Sequelize. Solo consultas: las reglas viven en
 * el servicio. Modelos: Categoria, Equipo, Unidad, HistorialEstado.
 *
 * El último parámetro `db` es la transacción de quien llama (la usan la HU-4 y la HU-5
 * cuando cambian el estado de una unidad dentro de su propia operación).
 */
import { Op, col, fn, where } from 'sequelize'
import { Categoria, Equipo, HistorialEstado, Unidad, Usuario, plano } from '../../db/modelos.js'
import { siguienteIdDe } from '../../comun/filas.js'

/** Equipo del modelo → equipo del contrato de datos (condiciones del préstamo anidadas). */
function aEquipo(instancia) {
  const datos = plano(instancia)
  if (!datos) return null
  const { duracionMaximaDias, requiereAutorizacion, admiteRenovacion, penalidadPorDia, ...resto } =
    datos
  return {
    ...resto,
    condicionesPrestamo: {
      duracionMaximaDias,
      requiereAutorizacion,
      admiteRenovacion,
      penalidadPorDia,
    },
  }
}

// Cada unidad con su historial de estados (asociación hasMany), del más antiguo al último.
const conHistorial = {
  include: [
    {
      model: HistorialEstado,
      as: 'historialEstados',
      attributes: ['de', 'a', 'motivo', 'fecha', 'usuarioId'],
    },
  ],
  order: [
    ['codigoInventario', 'ASC'],
    [{ model: HistorialEstado, as: 'historialEstados' }, 'fecha', 'ASC'],
    [{ model: HistorialEstado, as: 'historialEstados' }, 'id', 'ASC'],
  ],
}

// ------------------------------------------------------------------- lectura

export async function listarEquipos(db) {
  return (await Equipo.findAll({ order: [['id', 'ASC']], transaction: db })).map(aEquipo)
}

export async function buscarEquipo(id, db) {
  return aEquipo(await Equipo.findByPk(id, { transaction: db }))
}

/** Unidades sin historial (lo que necesitan las listas y las otras historias). */
export async function listarUnidades(db) {
  const filas = await Unidad.findAll({ order: [['codigoInventario', 'ASC']], transaction: db })
  return filas.map(plano)
}

export async function listarUnidadesDeEquipo(equipoId, db) {
  const filas = await Unidad.findAll({ ...conHistorial, where: { equipoId }, transaction: db })
  return filas.map(plano)
}

export async function buscarUnidad(id, db) {
  return plano(await Unidad.findByPk(id, { ...conHistorial, transaction: db }))
}

/** ¿Hay otro equipo con la misma marca y modelo? (sin distinguir mayúsculas) */
export async function existeMarcaModelo(marca, modelo, excluirId = null) {
  const total = await Equipo.count({
    where: {
      [Op.and]: [
        where(fn('lower', col('marca')), String(marca).toLowerCase()),
        where(fn('lower', col('modelo')), String(modelo).toLowerCase()),
        excluirId ? { id: { [Op.ne]: excluirId } } : {},
      ],
    },
  })
  return total > 0
}

export async function existeCodigo(codigo, excluirId = null) {
  const total = await Unidad.count({
    where: { codigoInventario: codigo, ...(excluirId ? { id: { [Op.ne]: excluirId } } : {}) },
  })
  return total > 0
}

/** Categorías con cuántos equipos tiene cada una (LEFT JOIN + GROUP BY con la asociación). */
export async function listarCategorias() {
  const filas = await Categoria.findAll({
    attributes: ['id', 'nombre', [fn('COUNT', col('equipos.id')), 'equipos']],
    include: [{ model: Equipo, as: 'equipos', attributes: [] }],
    group: ['Categoria.id'],
    order: [['nombre', 'ASC']],
    raw: true,
  })
  return filas.map((f) => ({ ...f, equipos: Number(f.equipos) }))
}

export async function existeCategoria(id) {
  return (await Categoria.count({ where: { id: String(id ?? '') } })) > 0
}

export async function listarClaves() {
  return Equipo.findAll({
    attributes: ['id', 'marca', 'modelo'],
    order: [['id', 'ASC']],
    raw: true,
  })
}

export async function listarCodigos() {
  const filas = await Unidad.findAll({
    attributes: ['codigoInventario'],
    order: [['codigoInventario', 'ASC']],
  })
  return filas.map((f) => f.codigoInventario)
}

export async function contarPorEstado() {
  const filas = await Unidad.count({ group: ['estado'] }) // [{ estado, count }]
  return Object.fromEntries(filas.map((f) => [f.estado, Number(f.count)]))
}

export const contarEquipos = () => Equipo.count()

export async function nombresDeUsuarios(ids) {
  if (ids.length === 0) return []
  return Usuario.findAll({
    attributes: ['id', 'nombres', 'apellidos'],
    where: { id: ids },
    raw: true,
  })
}

// ------------------------------------------------------------------ escritura

export async function siguienteIdEquipo() {
  const filas = await Equipo.findAll({ attributes: ['id'] })
  return siguienteIdDe(
    filas.map((f) => f.id),
    'EQ',
    3,
  )
}

export async function siguienteIdUnidad() {
  const filas = await Unidad.findAll({ attributes: ['id'] })
  return siguienteIdDe(
    filas.map((f) => f.id),
    'UN',
    4,
  )
}

export async function insertarEquipo({ condicionesPrestamo: c, ...e }) {
  const equipo = await Equipo.create({
    ...e,
    duracionMaximaDias: c.duracionMaximaDias,
    requiereAutorizacion: c.requiereAutorizacion,
    admiteRenovacion: c.admiteRenovacion,
    penalidadPorDia: c.penalidadPorDia,
    actualizadoEn: e.creadoEn,
  })
  return aEquipo(equipo)
}

export async function actualizarEquipo(id, e) {
  await Equipo.update(
    {
      nombre: e.nombre,
      marca: e.marca,
      modelo: e.modelo,
      categoria: e.categoria,
      descripcion: e.descripcion,
      fotografias: e.fotografias,
      accesorios: e.accesorios,
      esBorrador: e.esBorrador,
      actualizadoEn: new Date(),
    },
    { where: { id } },
  )
  return buscarEquipo(id)
}

export async function actualizarCondiciones(id, c) {
  await Equipo.update(
    {
      duracionMaximaDias: c.duracionMaximaDias,
      requiereAutorizacion: c.requiereAutorizacion,
      admiteRenovacion: c.admiteRenovacion,
      penalidadPorDia: c.penalidadPorDia,
      actualizadoEn: new Date(),
    },
    { where: { id } },
  )
  return buscarEquipo(id)
}

export async function tocarEquipo(id, db) {
  await Equipo.update({ actualizadoEn: new Date() }, { where: { id }, transaction: db })
}

/** Las unidades y su historial se borran en cascada (onDelete: 'CASCADE'). */
export async function eliminarEquipo(id) {
  await Equipo.destroy({ where: { id } })
}

export async function insertarUnidad(u) {
  await Unidad.create({ ...u, estado: 'disponible' })
}

export async function actualizarUnidad(id, u) {
  await Unidad.update(
    {
      codigoInventario: u.codigoInventario,
      ubicacion: u.ubicacion,
      observaciones: u.observaciones,
    },
    { where: { id } },
  )
}

export async function cambiarEstado(id, { estado, prestamoVigente }, db) {
  await Unidad.update({ estado, prestamoVigente }, { where: { id }, transaction: db })
}

export async function eliminarUnidad(id) {
  await Unidad.destroy({ where: { id } })
}

export async function registrarHistorial({ unidadId, de, a, motivo, usuarioId }, db) {
  await HistorialEstado.create({ unidadId, de, a, motivo, usuarioId }, { transaction: db })
}
