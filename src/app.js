/**
 * Aplicación Express. Arma la cadena de middlewares y registra los módulos de cada
 * historia. No abre el puerto: eso lo hace servidor.js en local, y en Vercel la usa
 * api/index.js como función. Así las pruebas también usan la app sin levantar el servidor.
 */
import cors from 'cors'
import express from 'express'
import { config } from './config.js'
import { manejarErrores, rutaNoEncontrada } from './comun/errores.js'
import { leerSesion } from './comun/sesion.js'
import { modulos } from './modulos/index.js'

const app = express()

app.use(cors({ origin: config.origenes }))
// Las fotos viajan como data URL (sin carga de archivos): por eso hasta 4 MB por petición
// (Vercel acepta como máximo 4,5 MB).
app.use(express.json({ limit: '4mb' }))
app.use(leerSesion)

app.get('/api/salud', (_req, res) => res.json({ estado: 'ok' }))
for (const modulo of modulos) app.use(modulo.prefijo, modulo.router)
app.locals.modulos = modulos.map((m) => m.nombre)

app.use('/api', rutaNoEncontrada)
app.use(manejarErrores)

export default app
