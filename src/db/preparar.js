/**
 * Crea las tablas a partir de los modelos (sequelize.sync) y carga los datos de prueba de
 * la carpeta datos/ (los mismos JSON de la primera entrega). Se corre con
 * `npm run db:preparar`. Borra lo que haya: úsalo para empezar de cero o restablecer la demo.
 */
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import bcrypt from 'bcryptjs'
import { CATEGORIAS } from '../dominio/catalogos.js'
import { Categoria, Equipo, HistorialEstado, Solicitud, Unidad, Usuario } from './modelos.js'
import { sequelize } from './sequelize.js'

const DATOS = new URL('../../datos/', import.meta.url)
const leerJson = async (archivo) => JSON.parse(await readFile(new URL(archivo, DATOS), 'utf8'))

// Todas las cuentas de prueba usan esta contraseña (README del proyecto).
const CONTRASENA_DEMO = 'Clave2026'

export async function prepararBaseDatos({ silencioso = false } = {}) {
  const [usuarios, inventario, solicitudes] = await Promise.all([
    leerJson('seed-usuarios.json'),
    leerJson('seed-inventario.json'),
    leerJson('seed-solicitudes.json'),
  ])
  const hash = await bcrypt.hash(CONTRASENA_DEMO, 10)

  // force: true borra y vuelve a crear todas las tablas con sus llaves e índices.
  await sequelize.sync({ force: true })

  await sequelize.transaction(async (transaction) => {
    await Usuario.bulkCreate(
      usuarios.usuarios.map((u) => ({
        ...u,
        contrasenaHash: hash,
        deudaPendiente: u.deudaPendiente ?? 0,
        celular: u.celular ?? '',
      })),
      { transaction },
    )

    // Las categorías son las mismas del dominio (las del formulario de equipos).
    await Categoria.bulkCreate(
      CATEGORIAS.map((c) => ({ id: c.valor, nombre: c.etiqueta })),
      { transaction },
    )

    await Equipo.bulkCreate(
      inventario.equipos.map(({ condicionesPrestamo: c, ...e }) => ({
        ...e,
        esBorrador: Boolean(e.esBorrador),
        duracionMaximaDias: c.duracionMaximaDias,
        requiereAutorizacion: c.requiereAutorizacion,
        admiteRenovacion: c.admiteRenovacion,
        penalidadPorDia: c.penalidadPorDia,
      })),
      { transaction },
    )

    await Unidad.bulkCreate(
      inventario.unidades.map(({ historialEstados: _h, ...u }) => ({
        ...u,
        observaciones: u.observaciones ?? '',
      })),
      { transaction },
    )
    await HistorialEstado.bulkCreate(
      inventario.unidades.flatMap((u) =>
        (u.historialEstados ?? []).map((h) => ({ unidadId: u.id, ...h })),
      ),
      { transaction },
    )

    await Solicitud.bulkCreate(
      solicitudes.solicitudes.map(({ penalidad, renovaciones: _r, ...s }) => ({
        ...s,
        motivoRechazo: s.motivoRechazo ?? '',
        curso: s.curso ?? '',
        penalidadMonto: penalidad?.monto ?? null,
        penalidadEstado: penalidad?.estado ?? null,
        penalidadCalculadaEn: penalidad?.calculadaEn ?? null,
        penalidadPagadaEn: penalidad?.pagadaEn ?? null,
        penalidadRecibidoPor: penalidad?.recibidoPor ?? null,
      })),
      { transaction },
    )
  })

  if (!silencioso) {
    const conteo = {
      usuarios: await Usuario.count(),
      categorias: await Categoria.count(),
      equipos: await Equipo.count(),
      unidades: await Unidad.count(),
      solicitudes: await Solicitud.count(),
    }
    console.log('Base de datos lista:', conteo)
  }
}

// Si se ejecuta directamente (npm run db:preparar), prepara y cierra la conexión.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepararBaseDatos()
    .catch((error) => {
      console.error('No se pudo preparar la base de datos:', error.message)
      process.exitCode = 1
    })
    .finally(() => sequelize.close())
}
