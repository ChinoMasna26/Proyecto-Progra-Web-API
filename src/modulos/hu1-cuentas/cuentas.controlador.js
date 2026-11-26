/**
 * HU-1 · Controlador: traduce la petición HTTP a una llamada al servicio y devuelve la
 * respuesta con su código. No accede a la base de datos (enunciado §7).
 */
import * as servicio from './cuentas.servicio.js'

export const iniciarSesion = async (req, res) =>
  res.json(await servicio.iniciarSesion(req.body ?? {}))

export const obtenerYo = async (req, res) => res.json(await servicio.obtenerUsuario(req.usuario.id))

export const registrarEstudiante = async (req, res) =>
  res.status(201).json(await servicio.registrarEstudiante(req.body ?? {}))

export const registrarEncargado = async (req, res) =>
  res.status(201).json(await servicio.registrarEncargado(req.body ?? {}))

export const verificarCuenta = async (req, res) =>
  res.json(await servicio.verificarCuenta(req.body?.token))

export const solicitarRecuperacion = async (req, res) =>
  res.json(await servicio.solicitarRecuperacion(req.body?.correo))

export const revisarEnlace = async (req, res) =>
  res.json(await servicio.revisarEnlaceRecuperacion(req.params.token))

export const restablecerContrasena = async (req, res) =>
  res.json(await servicio.restablecerContrasena(req.params.token, req.body ?? {}))

export const actualizarPerfil = async (req, res) =>
  res.json(await servicio.actualizarPerfil(req.usuario.id, req.body ?? {}))

export const cambiarContrasena = async (req, res) =>
  res.json(await servicio.cambiarContrasena(req.usuario.id, req.body ?? {}))

export const resumenPrestamos = async (req, res) =>
  res.json(await servicio.obtenerResumenPrestamos(req.usuario.id))

export const listarUsuarios = async (_req, res) => res.json(await servicio.listarUsuariosPublicos())
