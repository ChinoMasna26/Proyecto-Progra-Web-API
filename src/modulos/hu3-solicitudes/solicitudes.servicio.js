/**
 * HU-3 · Catálogo y solicitud de préstamo, ahora en el servidor.
 *
 * La HU-3 es dueña de la solicitud: la crea y la retira. Equipos y unidades se leen con el
 * servicio de la HU-2 y las reservas con el de la HU-6; aquí no se escribe sobre sus datos.
 * Las validaciones del formulario (dominio compartido) se repiten antes de guardar.
 */
import { ErrorHttp } from '../../comun/errores.js'
import { ahora, normalizar } from '../../comun/filas.js'
import * as solicitudes from '../../comun/solicitudes.repositorio.js'
import { etiquetaCategoria, formatearSoles } from '../../dominio/catalogos.js'
import {
  ESTADOS_ABIERTOS,
  ESTADOS_QUE_OCUPAN,
  cursoPorCodigo,
  duracionDias,
  etiquetaSolicitud,
  formatearFecha,
  formatearFechaCorta,
  hoyISO,
  proximoRangoLibre,
  puedeRetirarse,
  seSolapan,
  sumarDias,
  unidadesLibresEnRango,
  validarSolicitud,
} from '../../dominio/solicitudes.js'
import { listarEquiposConUnidades } from '../hu2-inventario/inventario.servicio.js'
import { listarReservasActivas } from '../hu6-reservas/reservas.servicio.js'

function mensajeSinUnidades(inicio, fin, proximo) {
  const base = `Fechas no disponibles: no hay unidades libres entre el ${formatearFechaCorta(inicio)} y el ${formatearFechaCorta(fin)}.`
  return proximo
    ? `${base} Próximo rango libre del ${formatearFechaCorta(proximo.inicio)} al ${formatearFecha(proximo.fin)}.`
    : `${base} Por ahora no hay unidades que puedan prestarse; puedes reservarlo para más adelante.`
}

// ------------------------------------------------------------------- catálogo

function coincideTexto(equipo, consulta) {
  if (!consulta) return true
  return (
    normalizar(equipo.nombre).includes(consulta) ||
    normalizar(equipo.marca).includes(consulta) ||
    normalizar(equipo.modelo).includes(consulta) ||
    normalizar(etiquetaCategoria(equipo.categoria)).includes(consulta) ||
    equipo.unidades.some((u) => normalizar(u.codigoInventario).includes(consulta))
  )
}

const COMPARADORES = {
  disponibles: (a, b) =>
    b.unidadesDisponibles - a.unidadesDisponibles || a.nombre.localeCompare(b.nombre, 'es'),
  'nombre-asc': (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
  'nombre-desc': (a, b) => b.nombre.localeCompare(a.nombre, 'es'),
  categoria: (a, b) =>
    etiquetaCategoria(a.categoria).localeCompare(etiquetaCategoria(b.categoria), 'es') ||
    a.nombre.localeCompare(b.nombre, 'es'),
}

/** Vista 3.1: solo equipos publicados (con al menos una unidad activa y fuera de borrador). */
export async function listarCatalogo(filtros = {}) {
  const {
    disponibilidad = 'todas',
    duracion = 'todas',
    texto = '',
    orden = 'disponibles',
    pagina = 1,
    porPagina = 8,
  } = filtros
  // En la URL las categorías llegan como «medicion,robotica».
  const categorias = Array.isArray(filtros.categorias)
    ? filtros.categorias
    : String(filtros.categorias ?? '')
        .split(',')
        .filter(Boolean)

  const publicados = await listarEquiposConUnidades({ soloPublicados: true })
  const consulta = normalizar(texto).trim()
  const limiteDias = duracion === 'todas' ? null : Number(duracion)

  // Primero los filtros que no son de categoría, para contar cuántos hay por categoría.
  const base = publicados.filter(
    (e) =>
      coincideTexto(e, consulta) &&
      (disponibilidad !== 'libres' || e.unidadesDisponibles > 0) &&
      (limiteDias === null || e.condicionesPrestamo.duracionMaximaDias <= limiteDias),
  )
  const conteoCategorias = {}
  for (const e of base) conteoCategorias[e.categoria] = (conteoCategorias[e.categoria] ?? 0) + 1

  const resultado = base
    .filter((e) => categorias.length === 0 || categorias.includes(e.categoria))
    .sort(COMPARADORES[orden] ?? COMPARADORES.disponibles)

  const tamano = Math.max(1, Number(porPagina) || 8)
  const total = resultado.length
  const totalPaginas = Math.max(1, Math.ceil(total / tamano))
  const paginaSegura = Math.min(Math.max(1, Number(pagina) || 1), totalPaginas)
  const desde = (paginaSegura - 1) * tamano

  return {
    equipos: resultado.slice(desde, desde + tamano).map(({ unidades, ...equipo }) => ({
      ...equipo,
      fotografia: equipo.fotografias?.[0] ?? null,
      totalUnidades: unidades.length,
    })),
    total,
    totalPublicados: publicados.length,
    conteoCategorias,
    pagina: paginaSegura,
    totalPaginas,
    porPagina: tamano,
    desde: total === 0 ? 0 : desde + 1,
    hasta: Math.min(desde + tamano, total),
  }
}

/** Vista 3.2: ficha del equipo para el estudiante, con su disponibilidad. */
export async function obtenerDetalleEquipo(id) {
  const equipo = (await listarEquiposConUnidades()).find((e) => e.id === id)
  if (!equipo) throw new ErrorHttp('No encontramos el equipo que buscas.', 404)
  if (!equipo.esPublicable)
    throw new ErrorHttp('Este equipo todavía no está publicado en el catálogo.', 404)

  let proximaLiberacion = null
  if (equipo.unidadesDisponibles === 0) {
    const hoy = hoyISO()
    const fines = (await solicitudes.listar())
      .filter(
        (s) => s.equipoId === id && ESTADOS_QUE_OCUPAN.includes(s.estado) && s.fechaFin >= hoy,
      )
      .map((s) => s.fechaFin)
      .sort()
    if (fines.length) proximaLiberacion = sumarDias(fines[0], 1)
  }
  return {
    equipo: { ...equipo, unidades: equipo.unidades.filter((u) => u.estado !== 'baja') },
    proximaLiberacion,
  }
}

/** Unidades libres para un rango (vista 3.3, mientras el estudiante elige las fechas). */
export async function consultarDisponibilidad(equipoId, inicio, fin) {
  const [equipos, reservas, todas] = await Promise.all([
    listarEquiposConUnidades(),
    listarReservasActivas(),
    solicitudes.listar(),
  ])
  const equipo = equipos.find((e) => e.id === equipoId)
  if (!equipo) throw new ErrorHttp('No encontramos el equipo que buscas.', 404)
  if (!inicio || !fin || duracionDias(inicio, fin) === null || fin < inicio)
    return { libres: null, proximoRango: null, mensaje: null }

  const libres = unidadesLibresEnRango(equipo, inicio, fin, todas, reservas).length
  const proximoRango = libres === 0 ? proximoRangoLibre(equipo, inicio, fin, todas, reservas) : null
  return {
    libres,
    proximoRango,
    mensaje: libres === 0 ? mensajeSinUnidades(inicio, fin, proximoRango) : null,
  }
}

// ---------------------------------------------------------------- solicitudes

function enriquecer(solicitud, equipos) {
  const equipo = equipos.find((e) => e.id === solicitud.equipoId)
  const unidad = equipo?.unidades.find((u) => u.id === solicitud.unidadId)
  const curso = cursoPorCodigo(solicitud.curso)
  return {
    ...solicitud,
    equipoNombre: equipo?.nombre ?? 'Equipo retirado del inventario',
    equipoMarcaModelo: equipo ? `${equipo.marca} · ${equipo.modelo}` : '',
    fotografia: equipo?.fotografias?.[0] ?? null,
    codigoUnidad: unidad?.codigoInventario ?? null,
    cursoNombre: curso ? `${curso.codigo} ${curso.nombre}` : solicitud.curso,
    cursoDocente: curso?.docente ?? '',
    duracion: duracionDias(solicitud.fechaInicio, solicitud.fechaFin),
    retirable: puedeRetirarse(solicitud),
  }
}

const PRIORIDAD = { pendiente: 0, aprobada: 1, en_prestamo: 2 }

/** Vista 3.4: solicitudes del estudiante en sesión. */
export async function listarMisSolicitudes(estudianteId) {
  const [equipos, suyas] = await Promise.all([
    listarEquiposConUnidades(),
    solicitudes.listarDeEstudiante(estudianteId),
  ])
  return suyas
    .sort(
      (a, b) =>
        (PRIORIDAD[a.estado] ?? 3) - (PRIORIDAD[b.estado] ?? 3) ||
        b.fechaInicio.localeCompare(a.fechaInicio),
    )
    .map((s) => enriquecer(s, equipos))
}

/** Vista 3.3: registra la solicitud tras repetir todas las validaciones del formulario. */
export async function crearSolicitud(datos, estudiante) {
  if (Number(estudiante.deudaPendiente) > 0)
    throw new ErrorHttp(
      `Tienes una deuda pendiente de ${formatearSoles(estudiante.deudaPendiente)}. Regularízala en el almacén para volver a solicitar.`,
      403,
    )

  const [equipos, reservas, todas] = await Promise.all([
    listarEquiposConUnidades(),
    listarReservasActivas(),
    solicitudes.listar(),
  ])
  const equipo = equipos.find((e) => e.id === datos.equipoId)
  if (!equipo || !equipo.esPublicable)
    throw new ErrorHttp('Este equipo no está disponible en el catálogo.', 404)

  const errores = validarSolicitud(datos, {
    duracionMaxima: equipo.condicionesPrestamo.duracionMaximaDias,
  })
  const campos = Object.keys(errores)
  if (campos.length) throw new ErrorHttp(errores[campos[0]], 422, { errores })

  const repetida = todas.find(
    (s) =>
      s.estudianteId === estudiante.id &&
      s.equipoId === equipo.id &&
      ESTADOS_ABIERTOS.includes(s.estado) &&
      seSolapan(datos.fechaInicio, datos.fechaFin, s.fechaInicio, s.fechaFin),
  )
  if (repetida)
    throw new ErrorHttp(
      `Ya tienes una solicitud ${etiquetaSolicitud(repetida.estado).toLowerCase()} de este equipo del ${formatearFecha(repetida.fechaInicio)} al ${formatearFecha(repetida.fechaFin)}.`,
      409,
    )

  if (
    unidadesLibresEnRango(equipo, datos.fechaInicio, datos.fechaFin, todas, reservas).length === 0
  ) {
    const proximo = proximoRangoLibre(equipo, datos.fechaInicio, datos.fechaFin, todas, reservas)
    throw new ErrorHttp(mensajeSinUnidades(datos.fechaInicio, datos.fechaFin, proximo), 409)
  }

  const nueva = await solicitudes.insertar({
    id: await solicitudes.siguienteId(),
    estudianteId: estudiante.id,
    equipoId: equipo.id,
    unidadId: null, // la asigna el encargado al aprobar (HU-4)
    fechaInicio: datos.fechaInicio,
    fechaFin: datos.fechaFin,
    curso: datos.curso,
    motivo: String(datos.motivo).trim(),
    estado: 'pendiente',
    creadaEn: ahora(),
  })
  return enriquecer(nueva, equipos)
}

/** Retira una solicitud mientras el encargado no la haya resuelto. */
export async function retirarSolicitud(id, estudianteId) {
  const solicitud = await solicitudes.buscarPorId(id)
  if (!solicitud) throw new ErrorHttp('No encontramos la solicitud.', 404)
  if (solicitud.estudianteId !== estudianteId)
    throw new ErrorHttp('Solo puedes retirar tus propias solicitudes.', 403)
  if (!puedeRetirarse(solicitud))
    throw new ErrorHttp(
      `No pudimos retirar la solicitud porque ya fue ${etiquetaSolicitud(solicitud.estado).toLowerCase()}. Contacta al encargado del almacén.`,
      409,
    )
  return solicitudes.actualizar(id, { estado: 'retirada', resueltaEn: ahora() })
}
