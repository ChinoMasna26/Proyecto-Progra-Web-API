/** HU-4 · Controlador de aprobación y entrega: HTTP de entrada y salida, sin SQL. */
import * as servicio from './prestamos.servicio.js'

export const bandeja = async (req, res) => res.json(await servicio.listarBandeja(req.query))
export const contadores = async (_req, res) => res.json(await servicio.obtenerContadores())
export const opcionesAprobacion = async (req, res) =>
  res.json(await servicio.obtenerOpcionesAprobacion(req.params.id))
export const aprobar = async (req, res) =>
  res.json(await servicio.aprobarSolicitud(req.params.id, req.body ?? {}, req.usuario))
export const rechazar = async (req, res) =>
  res.json(await servicio.rechazarSolicitud(req.params.id, req.body ?? {}, req.usuario))
export const paraEntrega = async (req, res) =>
  res.json(await servicio.obtenerParaEntrega(req.params.id))
export const entregar = async (req, res) =>
  res.status(201).json(await servicio.registrarEntrega(req.params.id, req.body ?? {}, req.usuario))
export const constancia = async (req, res) =>
  res.json(await servicio.obtenerConstancia(req.params.codigo, req.usuario))
export const vigentes = async (_req, res) => res.json(await servicio.listarVigentes())
