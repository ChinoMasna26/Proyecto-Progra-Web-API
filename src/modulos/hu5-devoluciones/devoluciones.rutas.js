/** HU-5 · Rutas REST de devoluciones (prefijo /api/devoluciones). */
import { Router } from 'express'
import { requiereEncargadoActivo, requiereRol, requiereSesion } from '../../comun/sesion.js'
import * as c from './devoluciones.controlador.js'

export const router = Router()

const encargado = requiereRol('encargado')
const activo = requiereEncargadoActivo

router.get('/por-devolver', encargado, c.porDevolver) //                    5.1 vencidos y por devolver
router.get('/prestamos/:codigo', encargado, c.paraDevolucion) //            5.1 buscar por código
router.post('/prestamos/:codigo/devolucion', activo, c.devolver) //         5.1 y 5.2 registrar
router.get('/prestamos/:codigo/renovacion', encargado, c.consultarRenovacion) // 5.3
router.post('/prestamos/:codigo/renovacion', activo, c.renovar) //          5.3 renovar
router.get('/estudiantes/:id/historial', requiereSesion, c.historial) //    5.4 historial y deuda
router.post('/estudiantes/:id/pago', activo, c.pagar) //                    5.4 registrar pago
