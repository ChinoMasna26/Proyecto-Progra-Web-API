/** HU-2 · Controlador del inventario: HTTP de entrada y salida, sin SQL. */
import * as servicio from './inventario.servicio.js'

export const listarEquipos = async (req, res) => res.json(await servicio.listarEquipos(req.query))
export const resumen = async (_req, res) => res.json(await servicio.obtenerResumen())
export const categorias = async (_req, res) => res.json(await servicio.listarCategorias())
export const claves = async (_req, res) => res.json(await servicio.listarClavesEquipos())
export const codigos = async (_req, res) => res.json(await servicio.listarCodigosOcupados())
export const obtenerEquipo = async (req, res) =>
  res.json(await servicio.obtenerEquipo(req.params.id))
export const equiposConUnidades = async (req, res) =>
  res.json(
    await servicio.listarEquiposConUnidades({
      soloPublicados: req.query.soloPublicados === 'true',
    }),
  )
export const fichaPublica = async (req, res) =>
  res.json(await servicio.obtenerFichaPublica(req.params.id))

export const crearEquipo = async (req, res) => {
  const { esBorrador, ...datos } = req.body ?? {}
  res.status(201).json(await servicio.crearEquipo(datos, { esBorrador }))
}

export const actualizarEquipo = async (req, res) => {
  const { esBorrador, ...datos } = req.body ?? {}
  res.json(await servicio.actualizarEquipo(req.params.id, datos, { esBorrador }))
}

export const guardarCondiciones = async (req, res) =>
  res.json(await servicio.guardarCondiciones(req.params.id, req.body))

export const eliminarEquipo = async (req, res) =>
  res.json(await servicio.eliminarEquipo(req.params.id))

export const crearUnidad = async (req, res) =>
  res.status(201).json(await servicio.crearUnidad(req.params.id, req.body ?? {}, req.usuario.id))

export const actualizarUnidad = async (req, res) =>
  res.json(await servicio.actualizarUnidad(req.params.id, req.body ?? {}))

export const eliminarUnidad = async (req, res) =>
  res.json(await servicio.eliminarUnidad(req.params.id))

export const cambiarEstado = async (req, res) =>
  res.json(await servicio.cambiarEstadoManual(req.params.id, req.body ?? {}, req.usuario.id))
