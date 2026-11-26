/** HU-6 · Controlador de reservas: HTTP de entrada y salida, sin SQL. */
import * as servicio from './reservas.servicio.js'

export const equiposReservables = async (_req, res) =>
  res.json(await servicio.listarEquiposReservables())
export const misReservas = async (req, res) =>
  res.json(await servicio.listarReservas(req.usuario.id))
export const ocupacion = async (_req, res) => res.json(await servicio.listarReservasActivas())
export const miListaEspera = async (req, res) =>
  res.json(await servicio.listarListaEspera(req.usuario.id))
export const esperaPorEquipo = async (_req, res) => res.json(await servicio.listarEsperaPorEquipo())
export const crear = async (req, res) =>
  res.status(201).json(await servicio.crearReserva(req.body, req.usuario.id))
export const cancelar = async (req, res) =>
  res.json(await servicio.cancelarReserva(req.params.id, req.usuario.id))
export const convertir = async (_req, res) => res.json(await servicio.convertirReservasProximas())
