/**
 * Sesión con tokens (JWT). Al iniciar sesión, la HU-1 firma un token con el id del usuario;
 * el frontend lo manda en cada petición en la cabecera `Authorization: Bearer <token>`.
 *
 * `leerSesion` corre en todas las rutas: si hay token válido, deja al usuario en
 * `req.usuario` (releído de la base, para que un bloqueo o una deuda se noten al instante).
 * Las rutas declaran lo que exigen con `requiereSesion`, `requiereRol` o
 * `requiereEncargadoActivo`. Así el servidor no confía en el rol que diga el cliente.
 */
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { Usuario, plano } from '../db/modelos.js'
import { ErrorHttp } from './errores.js'

export function firmarToken(usuario) {
  return jwt.sign({ rol: usuario.rol }, config.secretoToken, {
    subject: usuario.id,
    expiresIn: config.duracionToken,
  })
}

/** El usuario sin datos de acceso: lo que puede ver el frontend. */
export function usuarioPublico(usuario) {
  if (!usuario) return null
  const { contrasenaHash: _omitido, ...resto } = usuario
  return resto
}

export async function leerSesion(req, _res, next) {
  const cabecera = req.get('authorization') ?? ''
  const [tipo, token] = cabecera.split(' ')
  if (tipo !== 'Bearer' || !token) return next()
  try {
    const { sub } = jwt.verify(token, config.secretoToken)
    const usuario = plano(await Usuario.findByPk(sub))
    if (usuario && !['bloqueado', 'por_verificar'].includes(usuario.estado))
      req.usuario = usuarioPublico(usuario)
    else req.sesionInvalida = true
  } catch {
    req.sesionInvalida = true // token vencido o alterado
  }
  next()
}

export function requiereSesion(req, _res, next) {
  if (req.usuario) return next()
  next(
    new ErrorHttp(
      req.sesionInvalida
        ? 'Tu sesión expiró. Vuelve a iniciar sesión.'
        : 'Inicia sesión para continuar.',
      401,
      { tipo: 'sin-sesion' },
    ),
  )
}

export const requiereRol =
  (...roles) =>
  (req, res, next) =>
    requiereSesion(req, res, (error) => {
      if (error) return next(error)
      if (!roles.includes(req.usuario.rol))
        return next(new ErrorHttp('No tienes permiso para hacer esto.', 403))
      next()
    })

/** Solo un encargado con el alta aprobada resuelve solicitudes, entrega o recibe. */
export const requiereEncargadoActivo = (req, res, next) =>
  requiereRol('encargado')(req, res, (error) => {
    if (error) return next(error)
    if (req.usuario.estado !== 'activo')
      return next(
        new ErrorHttp(
          'Tu alta de encargado está pendiente de aprobación: todavía no puedes hacer esto.',
          403,
        ),
      )
    next()
  })
