/** HU-2 · Rutas REST del inventario (prefijo /api/inventario). */
import { Router } from 'express'
import { requiereRol } from '../../comun/sesion.js'
import * as c from './inventario.controlador.js'

export const router = Router()

// Ficha pública (vista 2.6): la ve cualquiera, incluso sin sesión.
router.get('/publico/equipos/:id', c.fichaPublica)

// Lectura para otras historias: equipos con sus unidades, sin datos internos (código,
// estado y ubicación de cada unidad). Es lo mismo que muestra el catálogo público.
router.get('/con-unidades', c.equiposConUnidades)
router.get('/categorias', c.categorias) //                          categorías con cuántos equipos tiene

// Todo lo demás es del encargado.
const encargado = requiereRol('encargado')
router.get('/equipos', encargado, c.listarEquipos) //                2.1 listado
router.get('/resumen', encargado, c.resumen)
router.get('/claves', encargado, c.claves) //                       marca + modelo usados
router.get('/codigos', encargado, c.codigos) //                     códigos de inventario usados
router.get('/equipos/:id', encargado, c.obtenerEquipo) //            2.3 detalle
router.post('/equipos', encargado, c.crearEquipo) //                 2.2 registrar
router.put('/equipos/:id', encargado, c.actualizarEquipo) //         2.2 editar
router.put('/equipos/:id/condiciones', encargado, c.guardarCondiciones) // 2.5
router.delete('/equipos/:id', encargado, c.eliminarEquipo)
router.post('/equipos/:id/unidades', encargado, c.crearUnidad) //    2.3 alta de unidad
router.put('/unidades/:id', encargado, c.actualizarUnidad)
router.delete('/unidades/:id', encargado, c.eliminarUnidad)
router.patch('/unidades/:id/estado', encargado, c.cambiarEstado) //  2.4 cambio de estado
