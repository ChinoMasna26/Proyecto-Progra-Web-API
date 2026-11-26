/** HU-1 · Rutas REST de cuenta y acceso (prefijo /api/cuentas). */
import { Router } from 'express'
import { requiereRol, requiereSesion } from '../../comun/sesion.js'
import * as c from './cuentas.controlador.js'

export const router = Router()

router.post('/sesion', c.iniciarSesion) //                    1.2 iniciar sesión
router.post('/estudiantes', c.registrarEstudiante) //          1.3 registro de estudiante
router.post('/encargados', c.registrarEncargado) //            1.4 alta de encargado
router.post('/verificacion', c.verificarCuenta) //             enlace de verificación
router.post('/recuperacion', c.solicitarRecuperacion) //       1.5 paso 1
router.get('/recuperacion/:token', c.revisarEnlace) //         1.5 paso 2
router.post('/recuperacion/:token', c.restablecerContrasena) // 1.5 paso 3

router.get('/yo', requiereSesion, c.obtenerYo) //               1.6 mi cuenta
router.patch('/yo', requiereSesion, c.actualizarPerfil)
router.put('/yo/contrasena', requiereSesion, c.cambiarContrasena)
router.get('/yo/resumen-prestamos', requiereSesion, c.resumenPrestamos)

router.get('/usuarios', requiereRol('encargado'), c.listarUsuarios)
