/** HU-4 · Rutas REST de aprobación y entrega (prefijo /api/prestamos). */
import { Router } from 'express'
import { requiereEncargadoActivo, requiereRol, requiereSesion } from '../../comun/sesion.js'
import * as c from './prestamos.controlador.js'

export const router = Router()

const encargado = requiereRol('encargado') //       puede consultar
const activo = requiereEncargadoActivo //           puede resolver y entregar

router.get('/bandeja', encargado, c.bandeja) //                          4.1 bandeja
router.get('/contadores', encargado, c.contadores)
router.get('/solicitudes/:id/aprobacion', encargado, c.opcionesAprobacion) // 4.2
router.post('/solicitudes/:id/aprobacion', activo, c.aprobar) //          4.2 aprobar
router.post('/solicitudes/:id/rechazo', activo, c.rechazar) //            4.3 rechazar
router.get('/solicitudes/:id/entrega', encargado, c.paraEntrega) //       4.4
router.post('/solicitudes/:id/entrega', activo, c.entregar) //            4.4 registrar entrega
router.get('/constancias/:codigo', requiereSesion, c.constancia) //       4.5 constancia
router.get('/vigentes', encargado, c.vigentes) //                         4.6 vigentes
