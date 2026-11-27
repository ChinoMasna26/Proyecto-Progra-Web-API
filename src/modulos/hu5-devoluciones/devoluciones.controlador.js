/** HU-5 · Controlador de devoluciones: HTTP de entrada y salida, sin SQL. */
import * as servicio from './devoluciones.servicio.js'

export const porDevolver = async (_req, res) => res.json(await servicio.listarPorDevolver())
export const paraDevolucion = async (req, res) =>
  res.json(await servicio.obtenerParaDevolucion(req.params.codigo))
export const devolver = async (req, res) =>
  res
    .status(201)
    .json(await servicio.registrarDevolucion(req.params.codigo, req.body ?? {}, req.usuario))
export const consultarRenovacion = async (req, res) =>
  res.json(await servicio.consultarRenovacion(req.params.codigo))
export const renovar = async (req, res) =>
  res.json(await servicio.renovarPrestamo(req.params.codigo, req.body ?? {}, req.usuario))
export const historial = async (req, res) =>
  res.json(await servicio.obtenerHistorial(req.params.id, req.usuario))
export const pagar = async (req, res) =>
  res.json(await servicio.registrarPago(req.params.id, req.usuario))
