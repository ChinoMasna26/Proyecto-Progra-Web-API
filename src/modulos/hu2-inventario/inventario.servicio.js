/**
 * HU-2 · Reglas del inventario. Es la lógica de la primera entrega, ahora en el servidor.
 * Las validaciones son las mismas funciones del formulario (dominio compartido) y se
 * repiten aquí porque el servidor no confía en lo que manda el cliente.
 *
 * Otras historias usan este servicio, nunca la tabla directamente:
 *   - listarEquiposConUnidades → HU-3, HU-4, HU-5 y HU-6 (lectura)
 *   - cambiarEstadoUnidad      → HU-4 (prestada) y HU-5 (disponible o mantenimiento)
 */
import { ErrorHttp, exigirValido } from '../../comun/errores.js'
import { ahora, normalizar } from '../../comun/filas.js'
import { derivarEquipo, esTransicionValida } from '../../dominio/catalogos.js'
import {
  validarCambioEstado,
  validarCondiciones,
  validarEquipo,
  validarUnidad,
} from '../../dominio/validaciones.js'
import * as repo from './inventario.repositorio.js'

const porCodigo = (a, b) => a.codigoInventario.localeCompare(b.codigoInventario, 'es')

function limpiarCondiciones(c = {}) {
  return {
    duracionMaximaDias: Number(c.duracionMaximaDias),
    requiereAutorizacion: Boolean(c.requiereAutorizacion),
    admiteRenovacion: Boolean(c.admiteRenovacion),
    penalidadPorDia: Number(c.penalidadPorDia),
  }
}

function limpiarEquipo(datos) {
  return {
    nombre: String(datos.nombre ?? '').trim(),
    marca: String(datos.marca ?? '').trim(),
    modelo: String(datos.modelo ?? '').trim(),
    categoria: datos.categoria,
    descripcion: String(datos.descripcion ?? '').trim(),
    fotografias: (datos.fotografias ?? []).map((f) => ({
      url: f.url,
      alt: String(f.alt ?? '').trim(),
    })),
    accesorios: (datos.accesorios ?? []).map((a) => String(a).trim()).filter(Boolean),
  }
}

async function exigirEquipo(id) {
  const equipo = await repo.buscarEquipo(id)
  if (!equipo) throw new ErrorHttp('No encontramos el equipo que buscas.', 404)
  return equipo
}

async function exigirUnidad(id, db) {
  const unidad = await repo.buscarUnidad(id, db)
  if (!unidad) throw new ErrorHttp('No encontramos la unidad que buscas.', 404)
  return unidad
}

// ------------------------------------------------------------------ consultas

/** Vista 2.1: filtros por categoría y estado, búsqueda, orden y paginación. */
export async function listarEquipos(filtros = {}) {
  const {
    categoria = 'todas',
    estado = 'todos',
    texto = '',
    orden = 'nombre-asc',
    pagina = 1,
    porPagina = 8,
  } = filtros
  const [equipos, unidades] = await Promise.all([repo.listarEquipos(), repo.listarUnidades()])

  let resultado = equipos.map((e) =>
    derivarEquipo(
      e,
      unidades.filter((u) => u.equipoId === e.id),
    ),
  )
  if (categoria !== 'todas') resultado = resultado.filter((e) => e.categoria === categoria)
  if (estado !== 'todos') resultado = resultado.filter((e) => e.unidadesPorEstado[estado] > 0)

  const consulta = normalizar(texto).trim()
  if (consulta) {
    const conCodigo = new Set(
      unidades
        .filter((u) => normalizar(u.codigoInventario).includes(consulta))
        .map((u) => u.equipoId),
    )
    resultado = resultado.filter(
      (e) =>
        normalizar(e.nombre).includes(consulta) ||
        normalizar(e.marca).includes(consulta) ||
        normalizar(e.modelo).includes(consulta) ||
        conCodigo.has(e.id),
    )
  }

  const comparadores = {
    'nombre-asc': (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    'nombre-desc': (a, b) => b.nombre.localeCompare(a.nombre, 'es'),
    'categoria-asc': (a, b) =>
      a.categoria.localeCompare(b.categoria, 'es') || a.nombre.localeCompare(b.nombre, 'es'),
    'disponibles-desc': (a, b) =>
      b.unidadesDisponibles - a.unidadesDisponibles || a.nombre.localeCompare(b.nombre, 'es'),
    'disponibles-asc': (a, b) =>
      a.unidadesDisponibles - b.unidadesDisponibles || a.nombre.localeCompare(b.nombre, 'es'),
  }
  resultado.sort(comparadores[orden] ?? comparadores['nombre-asc'])

  const tamano = Math.max(1, Number(porPagina) || 8)
  const total = resultado.length
  const totalPaginas = Math.max(1, Math.ceil(total / tamano))
  const paginaSegura = Math.min(Math.max(1, Number(pagina) || 1), totalPaginas)
  const desde = (paginaSegura - 1) * tamano

  return {
    equipos: resultado.slice(desde, desde + tamano),
    total,
    totalEquipos: equipos.length,
    pagina: paginaSegura,
    totalPaginas,
    porPagina: tamano,
    desde: total === 0 ? 0 : desde + 1,
    hasta: Math.min(desde + tamano, total),
  }
}

export async function obtenerResumen() {
  const [equipos, porEstado] = await Promise.all([repo.contarEquipos(), repo.contarPorEstado()])
  const disponibles = porEstado.disponible ?? 0
  const prestadas = porEstado.prestada ?? 0
  const mantenimiento = porEstado.mantenimiento ?? 0
  const baja = porEstado.baja ?? 0
  return {
    equipos,
    unidades: disponibles + prestadas + mantenimiento + baja,
    disponibles,
    prestadas,
    mantenimiento,
    baja,
  }
}

/** Vistas 2.3 a 2.5: el equipo, sus unidades con historial y quién hizo cada cambio. */
export async function obtenerEquipo(id) {
  const equipo = await exigirEquipo(id)
  const unidades = (await repo.listarUnidadesDeEquipo(id)).sort(porCodigo)
  const ids = [...new Set(unidades.flatMap((u) => u.historialEstados.map((h) => h.usuarioId)))]
  const usuarios = await repo.nombresDeUsuarios(ids.filter(Boolean))
  return { equipo: derivarEquipo(equipo, unidades), unidades, usuarios }
}

/**
 * Lectura para otras historias: cada equipo con sus derivados y sus unidades, sin datos
 * internos (observaciones, historial). Acepta el cliente de una transacción.
 */
export async function listarEquiposConUnidades({ soloPublicados = false } = {}, db) {
  const [equipos, unidades] = await Promise.all([repo.listarEquipos(db), repo.listarUnidades(db)])
  return equipos
    .map((base) => {
      const suyas = unidades.filter((u) => u.equipoId === base.id)
      return {
        ...derivarEquipo(base, suyas),
        unidades: suyas
          .map((u) => ({
            id: u.id,
            codigoInventario: u.codigoInventario,
            estado: u.estado,
            ubicacion: u.ubicacion,
          }))
          .sort(porCodigo),
      }
    })
    .filter((equipo) => !soloPublicados || equipo.esPublicable)
}

/** Vista 2.6: ficha pública, solo de equipos publicables y sin datos internos. */
export async function obtenerFichaPublica(id) {
  const base = await exigirEquipo(id)
  const unidades = await repo.listarUnidadesDeEquipo(id)
  const equipo = derivarEquipo(base, unidades)
  if (!equipo.esPublicable)
    throw new ErrorHttp('Este equipo todavía no está publicado en el catálogo.', 404)
  return {
    equipo,
    unidades: unidades
      .filter((u) => u.estado !== 'baja')
      .map((u) => ({ codigoInventario: u.codigoInventario, estado: u.estado }))
      .sort(porCodigo),
  }
}

export const listarCategorias = () => repo.listarCategorias()
export const listarClavesEquipos = () => repo.listarClaves()
export const listarCodigosOcupados = () => repo.listarCodigos()

// --------------------------------------------------------- escritura: equipos

async function validarDatosEquipo(datos, { conCondiciones }) {
  const errores = { ...validarEquipo(datos) }
  if (conCondiciones) Object.assign(errores, validarCondiciones(datos.condicionesPrestamo ?? {}))
  // La categoría tiene que existir en su tabla (llave foránea de equipos.categoria).
  if (!errores.categoria && !(await repo.existeCategoria(datos.categoria)))
    errores.categoria = 'Selecciona una categoría válida.'
  exigirValido(errores)
}

export async function crearEquipo(datos, { esBorrador = false } = {}) {
  await validarDatosEquipo(datos, { conCondiciones: true })
  const limpio = limpiarEquipo(datos)
  if (await repo.existeMarcaModelo(limpio.marca, limpio.modelo))
    throw new ErrorHttp('Ya existe un equipo con esta marca y modelo.', 409)

  const equipo = await repo.insertarEquipo({
    id: await repo.siguienteIdEquipo(),
    ...limpio,
    condicionesPrestamo: limpiarCondiciones(datos.condicionesPrestamo),
    esBorrador: Boolean(esBorrador),
    creadoEn: ahora(),
  })
  return derivarEquipo(equipo, [])
}

export async function actualizarEquipo(id, datos, { esBorrador } = {}) {
  const actual = await exigirEquipo(id)
  await validarDatosEquipo(datos, { conCondiciones: false })
  const limpio = limpiarEquipo(datos)
  if (await repo.existeMarcaModelo(limpio.marca, limpio.modelo, id))
    throw new ErrorHttp('Ya existe un equipo con esta marca y modelo.', 409)

  const equipo = await repo.actualizarEquipo(id, {
    ...limpio,
    esBorrador: esBorrador ?? actual.esBorrador,
  })
  return derivarEquipo(equipo, await repo.listarUnidadesDeEquipo(id))
}

/** Vista 2.5: solo la pestaña de condiciones del préstamo. */
export async function guardarCondiciones(id, condiciones) {
  await exigirEquipo(id)
  exigirValido(validarCondiciones(condiciones ?? {}))
  return repo.actualizarCondiciones(id, limpiarCondiciones(condiciones))
}

export async function eliminarEquipo(id) {
  await exigirEquipo(id)
  const suyas = await repo.listarUnidadesDeEquipo(id)
  const prestadas = suyas.filter((u) => u.estado === 'prestada').length
  if (prestadas > 0)
    throw new ErrorHttp(
      `No se puede eliminar: ${prestadas} ${prestadas === 1 ? 'unidad está prestada' : 'unidades están prestadas'}. Registra primero la devolución.`,
      409,
    )
  await repo.eliminarEquipo(id)
  return { id, unidadesEliminadas: suyas.length }
}

// --------------------------------------------------------- escritura: unidades

export async function crearUnidad(equipoId, datos, usuarioId) {
  await exigirEquipo(equipoId)
  exigirValido(validarUnidad(datos))
  const codigo = String(datos.codigoInventario).trim().toUpperCase()
  if (await repo.existeCodigo(codigo))
    throw new ErrorHttp(`El código ${codigo} ya está registrado en el almacén.`, 409)

  const id = await repo.siguienteIdUnidad()
  await repo.insertarUnidad({
    id,
    equipoId,
    codigoInventario: codigo,
    ubicacion: datos.ubicacion,
    observaciones: String(datos.observaciones ?? '').trim(),
  })
  await repo.registrarHistorial({
    unidadId: id,
    de: null,
    a: 'disponible',
    motivo: 'Alta de la unidad en el inventario.',
    usuarioId,
  })
  await repo.tocarEquipo(equipoId)
  return repo.buscarUnidad(id)
}

export async function actualizarUnidad(id, datos) {
  await exigirUnidad(id)
  exigirValido(validarUnidad(datos))
  const codigo = String(datos.codigoInventario).trim().toUpperCase()
  if (await repo.existeCodigo(codigo, id))
    throw new ErrorHttp(`El código ${codigo} ya está registrado en el almacén.`, 409)
  await repo.actualizarUnidad(id, {
    codigoInventario: codigo,
    ubicacion: datos.ubicacion,
    observaciones: String(datos.observaciones ?? '').trim(),
  })
  return repo.buscarUnidad(id)
}

export async function eliminarUnidad(id) {
  const unidad = await exigirUnidad(id)
  if (unidad.estado === 'prestada')
    throw new ErrorHttp(
      'No se puede eliminar una unidad prestada. Registra primero la devolución.',
      409,
    )
  await repo.eliminarUnidad(id)
  return { id, codigoInventario: unidad.codigoInventario }
}

/** Vista 2.4: cambio manual del encargado (sin «prestada»: eso lo hace la HU-4). */
export async function cambiarEstadoManual(id, { estadoNuevo, motivo }, usuarioId) {
  const unidad = await exigirUnidad(id)
  exigirValido(validarCambioEstado({ estadoActual: unidad.estado, estadoNuevo, motivo }))
  return cambiarEstadoUnidad(id, { estadoNuevo, motivo, usuarioId })
}

/**
 * Cambia el estado de una unidad y lo deja en su historial. La usan el encargado desde el
 * inventario, la HU-4 al entregar (pasa a «prestada» con el código del préstamo) y la HU-5
 * al recibir la devolución. Con `db` se guarda dentro de la transacción de quien llama.
 */
export async function cambiarEstadoUnidad(
  id,
  { estadoNuevo, motivo, usuarioId, prestamoVigente },
  db,
) {
  const unidad = await exigirUnidad(id, db)
  if (!esTransicionValida(unidad.estado, estadoNuevo, { manuales: false }))
    throw new ErrorHttp(`No se admite pasar de "${unidad.estado}" a "${estadoNuevo}".`, 422)

  await repo.cambiarEstado(
    id,
    {
      estado: estadoNuevo,
      // al salir de «prestada» el préstamo deja de estar vigente para el inventario
      prestamoVigente:
        estadoNuevo === 'prestada' ? (prestamoVigente ?? unidad.prestamoVigente) : null,
    },
    db,
  )
  await repo.registrarHistorial(
    { unidadId: id, de: unidad.estado, a: estadoNuevo, motivo: String(motivo).trim(), usuarioId },
    db,
  )
  await repo.tocarEquipo(unidad.equipoId, db)
  return repo.buscarUnidad(id, db)
}
