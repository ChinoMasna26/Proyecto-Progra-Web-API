/** HU-3 · Controlador del catálogo y las solicitudes: HTTP de entrada y salida, sin SQL. */
import * as servicio from './solicitudes.servicio.js'

export const catalogo = async (req, res) => res.json(await servicio.listarCatalogo(req.query))
export const detalle = async (req, res) =>
  res.json(await servicio.obtenerDetalleEquipo(req.params.id))
export const disponibilidad = async (req, res) =>
  res.json(await servicio.consultarDisponibilidad(req.params.id, req.query.inicio, req.query.fin))
export const misSolicitudes = async (req, res) =>
  res.json(await servicio.listarMisSolicitudes(req.usuario.id))
export const crear = async (req, res) =>
  res.status(201).json(await servicio.crearSolicitud(req.body ?? {}, req.usuario))
export const retirar = async (req, res) =>
  res.json(await servicio.retirarSolicitud(req.params.id, req.usuario.id))
