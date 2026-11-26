/** HU-6 · Rutas REST de reservas y lista de espera (prefijo /api/reservas). */
import { Router } from 'express'
import { requiereRol, requiereSesion } from '../../comun/sesion.js'
import * as c from './reservas.controlador.js'

export const router = Router()

router.get('/equipos', requiereSesion, c.equiposReservables) //        6.1 calendario
router.get('/ocupacion', requiereSesion, c.ocupacion)
router.get('/mias', requiereSesion, c.misReservas) //        6.3 mis reservas
router.get('/espera/mias', requiereRol('estudiante'), c.miListaEspera) // 6.4 estudiante
router.get('/espera', requiereRol('encargado'), c.esperaPorEquipo) //   6.4 encargado
router.post('/', requiereRol('estudiante'), c.crear) //                 6.2 reservar
router.post('/:id/cancelacion', requiereRol('estudiante'), c.cancelar)
router.post('/conversiones', requiereSesion, c.convertir) //            6.5 reserva → solicitud
