/**
 * Módulos de cada historia. Cada carpeta `modulos/huN-*` exporta en su `index.js` el
 * prefijo y el router: export default { nombre, prefijo: '/api/inventario', router }.
 *
 * Los imports son estáticos para que Vercel incluya todo al empaquetar la API. Cada
 * integrante agrega aquí la línea de su historia en su pull request.
 */
import cuentas from './hu1-cuentas/index.js'
import inventario from './hu2-inventario/index.js'

export const modulos = [cuentas, inventario]
