/**
 * Utilidades de las pruebas de la API (node:test + supertest).
 *
 * OJO: cada archivo de prueba vuelve a crear las tablas y cargar los datos semilla. Si
 * defines DATABASE_URL_PRUEBAS en el .env, se usa esa base y la tuya queda intacta.
 */
import 'dotenv/config'
import request from 'supertest'

if (process.env.DATABASE_URL_PRUEBAS) process.env.DATABASE_URL = process.env.DATABASE_URL_PRUEBAS

const { default: app } = await import('../src/app.js')
const { prepararBaseDatos } = await import('../src/db/preparar.js')
const { sequelize } = await import('../src/db/sequelize.js')
const { hoyISO, sumarDias } = await import('../src/dominio/solicitudes.js')

export const CLAVE = 'Clave2026'
export const ENCARGADA = 'erivas@ulima.edu.pe' // Elena Rivas, activa
export const ENCARGADO_PENDIENTE = 'jsalinas@ulima.edu.pe' // alta pendiente de aprobación
export const ESTUDIANTE = 'rmendoza@aloe.ulima.edu.pe' // Renzo Mendoza, sin deuda
export const ESTUDIANTE_CON_DEUDA = 'lparedes@aloe.ulima.edu.pe' // Lucía Paredes, S/ 45

/** Fecha relativa a hoy: dias(3) = dentro de tres días. */
export const dias = (n) => sumarDias(hoyISO(), n)

export async function prepararApp() {
  await prepararBaseDatos({ silencioso: true })
  return app
}

/** Inicia sesión y devuelve un cliente que manda el token en cada petición. */
export async function como(app, correo) {
  const r = await request(app).post('/api/cuentas/sesion').send({ correo, contrasena: CLAVE })
  if (r.status !== 200) throw new Error(`No se pudo ingresar como ${correo}: ${r.body.mensaje}`)
  const token = r.body.token
  const conToken = (metodo) => (ruta) =>
    request(app)[metodo](ruta).set('Authorization', `Bearer ${token}`)
  return {
    usuario: r.body.usuario,
    get: conToken('get'),
    post: conToken('post'),
    put: conToken('put'),
    patch: conToken('patch'),
    delete: conToken('delete'),
  }
}

export const anonimo = (app) => request(app)

export const cerrar = () => sequelize.close()
