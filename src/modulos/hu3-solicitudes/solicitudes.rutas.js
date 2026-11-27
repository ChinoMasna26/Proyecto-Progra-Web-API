/** HU-3 · Rutas REST del catálogo y la solicitud de préstamo (prefijo /api/catalogo). */
import { Router } from 'express'
import { requiereRol } from '../../comun/sesion.js'
import * as c from './solicitudes.controlador.js'

export const router = Router()

// El catálogo lo puede ver cualquiera (también un visitante sin sesión).
router.get('/equipos', c.catalogo) //                              3.1 catálogo
router.get('/equipos/:id', c.detalle) //                           3.2 ficha
router.get('/equipos/:id/disponibilidad', c.disponibilidad) //     3.3 fechas libres

const estudiante = requiereRol('estudiante')
router.get('/solicitudes/mias', estudiante, c.misSolicitudes) //   3.4 mis solicitudes
router.post('/solicitudes', estudiante, c.crear) //                3.3 solicitar
router.post('/solicitudes/:id/retiro', estudiante, c.retirar) //   3.4 retirar
