/**
 * HU-4 · Aprobación y entrega, ahora en el servidor.
 *
 * Resuelve las solicitudes que crea la HU-3: las aprueba asignando una unidad, las rechaza
 * con un motivo que ve el estudiante y registra la entrega con su constancia. Escribe la
 * solicitud solo en los estados que le tocan. Para marcar la unidad como prestada usa el
 * servicio de la HU-2, dentro de la misma transacción que la entrega.
 */
import { ErrorHttp } from '../../comun/errores.js'
import { ahora, normalizar } from '../../comun/filas.js'
import * as solicitudes from '../../comun/solicitudes.repositorio.js'
import { enTransaccion } from '../../db/sequelize.js'
import { etiquetaCategoria } from '../../dominio/catalogos.js'
import {
  HORA_DEVOLUCION,
  antiguedad,
  siguienteCodigoPrestamo,
  textoRechazo,
  validarAprobacion,
  validarEntrega,
  validarRechazo,
  vigenciaDe,
} from '../../dominio/prestamos.js'
import {
  cursoPorCodigo,
  etiquetaSolicitud,
  formatearFecha,
  hoyISO,
  proximoRangoLibre,
  seSolapan,
  unidadesLibresEnRango,
} from '../../dominio/solicitudes.js'
import { listarUsuariosPublicos } from '../hu1-cuentas/cuentas.servicio.js'
import {
  cambiarEstadoUnidad,
  listarEquiposConUnidades,
} from '../hu2-inventario/inventario.servicio.js'
import { listarReservasActivas } from '../hu6-reservas/reservas.servicio.js'

async function contexto(db) {
  const [equipos, usuarios, todas] = await Promise.all([
    listarEquiposConUnidades({}, db),
    listarUsuariosPublicos(),
    solicitudes.listar(db),
  ])
  return { equipos, usuarios, solicitudes: todas }
}

function enriquecer(s, { equipos, usuarios }) {
  const equipo = equipos.find((e) => e.id === s.equipoId)
  const unidad = equipo?.unidades.find((u) => u.id === s.unidadId)
  const estudiante = usuarios.find((u) => u.id === s.estudianteId)
  const curso = cursoPorCodigo(s.curso)
  return {
    ...s,
    equipoNombre: equipo?.nombre ?? 'Equipo retirado del inventario',
    equipoMarcaModelo: equipo ? `${equipo.marca} · ${equipo.modelo}` : '',
    equipoCategoria: equipo ? etiquetaCategoria(equipo.categoria) : '',
    codigoUnidad: unidad?.codigoInventario ?? null,
    ubicacionUnidad: unidad?.ubicacion ?? null,
    estudianteNombre: estudiante ? `${estudiante.nombres} ${estudiante.apellidos}` : s.estudianteId,
    estudianteDetalle: estudiante?.carrera ? `${estudiante.carrera} · ${estudiante.ciclo}.º` : '',
    estudianteCodigo: estudiante?.codigo ?? '',
    deudaEstudiante: Number(estudiante?.deudaPendiente) || 0,
    cursoNombre: curso ? `${curso.codigo} ${curso.nombre}` : s.curso,
    cursoDocente: curso?.docente ?? '',
    antiguedad: antiguedad(s.creadaEn),
  }
}

function buscar(id, todas) {
  const solicitud = todas.find((s) => s.id === id)
  if (!solicitud) throw new ErrorHttp('No encontramos la solicitud.', 404)
  return solicitud
}

/** La reserva de la que nació la solicitud no le bloquea su propia unidad (HU-6). */
async function reservasQueCompiten(solicitud, db) {
  return (await listarReservasActivas(db)).filter((r) => r.id !== solicitud.reservaId)
}

// --------------------------------------------------------------------- bandeja

/** Vista 4.1: solicitudes con filtros por estado, equipo y fecha, búsqueda y contadores. */
export async function listarBandeja(filtros = {}) {
  const {
    estado = 'pendiente',
    equipoId = 'todos',
    desde = '',
    hasta = '',
    texto = '',
    pagina = 1,
    porPagina = 8,
  } = filtros
  const datos = await contexto()
  const todas = datos.solicitudes.map((s) => enriquecer(s, datos))

  const contadores = {
    total: todas.length,
    pendiente: todas.filter((s) => s.estado === 'pendiente').length,
    aprobada: todas.filter((s) => s.estado === 'aprobada').length,
    rechazada: todas.filter((s) => s.estado === 'rechazada').length,
    en_prestamo: todas.filter((s) => s.estado === 'en_prestamo').length,
  }

  const consulta = normalizar(texto).trim()
  const resultado = todas
    .filter((s) => estado === 'todos' || s.estado === estado)
    .filter((s) => equipoId === 'todos' || s.equipoId === equipoId)
    .filter((s) =>
      seSolapan(desde || '0000-01-01', hasta || '9999-12-31', s.fechaInicio, s.fechaFin),
    )
    .filter(
      (s) =>
        !consulta ||
        [s.estudianteNombre, s.cursoNombre, s.equipoNombre, s.codigoPrestamo ?? '', s.id].some(
          (v) => normalizar(v).includes(consulta),
        ),
    )
    .sort((a, b) => b.creadaEn.localeCompare(a.creadaEn))

  // Aviso de deuda (5.5): estudiantes de esta bandeja con penalidades pendientes.
  const conDeuda = new Map()
  for (const s of resultado)
    if (s.deudaEstudiante > 0) conDeuda.set(s.estudianteId, s.deudaEstudiante)

  const tamano = Math.max(1, Number(porPagina) || 8)
  const total = resultado.length
  const totalPaginas = Math.max(1, Math.ceil(total / tamano))
  const paginaSegura = Math.min(Math.max(1, Number(pagina) || 1), totalPaginas)
  const inicio = (paginaSegura - 1) * tamano

  return {
    solicitudes: resultado.slice(inicio, inicio + tamano),
    total,
    contadores,
    deuda: { estudiantes: conDeuda.size, monto: [...conDeuda.values()].reduce((a, b) => a + b, 0) },
    equipos: datos.equipos
      .map((e) => ({ id: e.id, nombre: e.nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    pagina: paginaSegura,
    totalPaginas,
    desde: total === 0 ? 0 : inicio + 1,
    hasta: Math.min(inicio + tamano, total),
  }
}

/** Contadores del menú lateral y de la barra superior del panel. */
export async function obtenerContadores() {
  const hoy = hoyISO()
  const todas = await solicitudes.listar()
  const vigentes = todas.filter((s) => s.estado === 'en_prestamo')
  return {
    pendientes: todas.filter((s) => s.estado === 'pendiente').length,
    vigentes: vigentes.length,
    vencidos: vigentes.filter((s) => vigenciaDe(s.fechaFin, hoy).tipo === 'vencido').length,
    vencenHoy: vigentes.filter((s) => vigenciaDe(s.fechaFin, hoy).tipo === 'hoy').length,
  }
}

// ------------------------------------------------------------------ aprobación

/** Vista 4.2: unidades libres en el rango, deuda del solicitante y próximo rango libre. */
export async function obtenerOpcionesAprobacion(id) {
  const datos = await contexto()
  const solicitud = buscar(id, datos.solicitudes)
  const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
  if (!equipo) throw new ErrorHttp('El equipo de esta solicitud ya no está en el inventario.', 409)

  const reservas = await reservasQueCompiten(solicitud)
  const opciones = { excluirSolicitudId: solicitud.id }
  const libres = unidadesLibresEnRango(
    equipo,
    solicitud.fechaInicio,
    solicitud.fechaFin,
    datos.solicitudes,
    reservas,
    opciones,
  )
  return {
    solicitud: enriquecer(solicitud, datos),
    unidadesLibres: libres.map((u) => ({
      id: u.id,
      codigoInventario: u.codigoInventario,
      ubicacion: u.ubicacion,
    })),
    proximoRango:
      libres.length === 0
        ? proximoRangoLibre(
            equipo,
            solicitud.fechaInicio,
            solicitud.fechaFin,
            datos.solicitudes,
            reservas,
            opciones,
          )
        : null,
    requiereAutorizacion: Boolean(equipo.condicionesPrestamo?.requiereAutorizacion),
  }
}

export async function aprobarSolicitud(id, datosAprobacion, encargado) {
  const datos = await contexto()
  const solicitud = buscar(id, datos.solicitudes)
  if (solicitud.estado !== 'pendiente')
    throw new ErrorHttp(
      `Esta solicitud ya está ${etiquetaSolicitud(solicitud.estado).toLowerCase()}: no se puede aprobar.`,
      409,
    )
  const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
  if (!equipo) throw new ErrorHttp('El equipo de esta solicitud ya no está en el inventario.', 409)

  const errores = validarAprobacion(datosAprobacion, {
    requiereAutorizacion: equipo.condicionesPrestamo?.requiereAutorizacion,
  })
  if (Object.keys(errores).length) throw new ErrorHttp(Object.values(errores)[0], 422, { errores })

  const libres = unidadesLibresEnRango(
    equipo,
    solicitud.fechaInicio,
    solicitud.fechaFin,
    datos.solicitudes,
    await reservasQueCompiten(solicitud),
    { excluirSolicitudId: solicitud.id },
  )
  const unidad = libres.find((u) => u.id === datosAprobacion.unidadId)
  if (!unidad)
    throw new ErrorHttp(
      'Esa unidad ya no está libre en todo el rango solicitado. Elige otra o rechaza la solicitud.',
      409,
    )

  const aprobada = await solicitudes.actualizar(id, {
    estado: 'aprobada',
    unidadId: unidad.id,
    resueltaEn: ahora(),
    resueltaPor: encargado.id,
  })
  return enriquecer(aprobada, datos)
}

/** Vista 4.3: el motivo queda guardado y lo ve el estudiante en «Mis solicitudes». */
export async function rechazarSolicitud(id, datosRechazo, encargado) {
  const errores = validarRechazo(datosRechazo)
  if (Object.keys(errores).length) throw new ErrorHttp(Object.values(errores)[0], 422, { errores })
  const datos = await contexto()
  const solicitud = buscar(id, datos.solicitudes)
  if (solicitud.estado !== 'pendiente')
    throw new ErrorHttp(
      `Esta solicitud ya está ${etiquetaSolicitud(solicitud.estado).toLowerCase()}: no se puede rechazar.`,
      409,
    )
  const rechazada = await solicitudes.actualizar(id, {
    estado: 'rechazada',
    motivoRechazo: textoRechazo(datosRechazo),
    resueltaEn: ahora(),
    resueltaPor: encargado.id,
  })
  return enriquecer(rechazada, datos)
}

// ---------------------------------------------------------------------- entrega

/** Vista 4.4: lo necesario para registrar la entrega de una solicitud aprobada. */
export async function obtenerParaEntrega(id) {
  const datos = await contexto()
  const solicitud = buscar(id, datos.solicitudes)
  if (solicitud.estado !== 'aprobada')
    throw new ErrorHttp(
      solicitud.estado === 'en_prestamo'
        ? `Esta solicitud ya se entregó con el código ${solicitud.codigoPrestamo}.`
        : `Solo se entrega una solicitud aprobada (esta está ${etiquetaSolicitud(solicitud.estado).toLowerCase()}).`,
      409,
    )
  const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
  return {
    solicitud: enriquecer(solicitud, datos),
    accesorios: equipo?.accesorios ?? [],
    penalidadPorDia: Number(equipo?.condicionesPrestamo?.penalidadPorDia) || 0,
    codigoPropuesto: siguienteCodigoPrestamo(datos.solicitudes.map((s) => s.codigoPrestamo)),
  }
}

/**
 * Entrega: la unidad pasa a «prestada» (HU-2) y la solicitud a «en_prestamo», en una sola
 * transacción. Si la unidad no puede cambiar, no se guarda nada.
 */
export async function registrarEntrega(id, datosEntrega, encargado) {
  return enTransaccion(async (db) => {
    const datos = await contexto(db)
    const solicitud = buscar(id, datos.solicitudes)
    if (solicitud.estado !== 'aprobada')
      throw new ErrorHttp('Solo se puede entregar una solicitud aprobada.', 409)

    const errores = validarEntrega(datosEntrega, { fechaFin: solicitud.fechaFin })
    if (Object.keys(errores).length)
      throw new ErrorHttp(Object.values(errores)[0], 422, { errores })

    const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
    const unidad = equipo?.unidades.find((u) => u.id === solicitud.unidadId)
    if (!unidad || unidad.estado !== 'disponible')
      throw new ErrorHttp(
        `La unidad asignada${unidad ? ` (${unidad.codigoInventario})` : ''} ya no está disponible en el inventario. Rechaza la solicitud o pide que la reasignen.`,
        409,
      )

    const codigo = siguienteCodigoPrestamo(datos.solicitudes.map((s) => s.codigoPrestamo))
    const accesorios = (datosEntrega.accesorios ?? []).map((a) => ({
      nombre: a.nombre,
      entregado: Boolean(a.entregado),
      nota: String(a.nota ?? '').trim(),
    }))

    await cambiarEstadoUnidad(
      unidad.id,
      {
        estadoNuevo: 'prestada',
        motivo: `Entrega del préstamo ${codigo}.`,
        usuarioId: encargado.id,
        prestamoVigente: codigo,
      },
      db,
    )
    await solicitudes.actualizar(
      id,
      {
        estado: 'en_prestamo',
        codigoPrestamo: codigo,
        fechaEntregaReal: new Date(datosEntrega.fechaEntrega).toISOString(),
        accesoriosEntregados: accesorios.filter((a) => a.entregado).map((a) => a.nombre),
        detalleAccesorios: accesorios,
        observacionesEntrega: String(datosEntrega.observaciones ?? '').trim(),
        entregadaPor: encargado.id,
      },
      db,
    )
    return { codigoPrestamo: codigo }
  })
}

/** Vista 4.5: el estudiante solo ve sus constancias; el encargado, todas. */
export async function obtenerConstancia(codigo, usuario) {
  const datos = await contexto()
  const solicitud = datos.solicitudes.find((s) => s.codigoPrestamo === codigo)
  if (!solicitud) throw new ErrorHttp('No encontramos una constancia con ese código.', 404)
  if (usuario.rol === 'estudiante' && solicitud.estudianteId !== usuario.id)
    throw new ErrorHttp('Esta constancia es de otro estudiante.', 403)

  const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
  const encargado = datos.usuarios.find((u) => u.id === solicitud.entregadaPor)
  const detalle =
    solicitud.detalleAccesorios ??
    (equipo?.accesorios ?? []).map((nombre) => ({
      nombre,
      entregado: (solicitud.accesoriosEntregados ?? []).includes(nombre),
      nota: '',
    }))
  return {
    ...enriquecer(solicitud, datos),
    equipoNombreCompleto: equipo
      ? `${equipo.nombre} (${equipo.marca} ${equipo.modelo})`
      : solicitud.equipoId,
    detalleAccesorios: detalle,
    penalidadPorDia: Number(equipo?.condicionesPrestamo?.penalidadPorDia) || 0,
    encargadoNombre: encargado ? `${encargado.nombres} ${encargado.apellidos}` : '',
    almacen: encargado?.almacenAsignado ?? 'Almacén H-102',
    devolucionTexto: `${formatearFecha(solicitud.fechaFin)} · ${HORA_DEVOLUCION}`,
  }
}

/** Vista 4.6: préstamos entregados que todavía no se devuelven. */
export async function listarVigentes() {
  const datos = await contexto()
  return datos.solicitudes
    .filter((s) => s.estado === 'en_prestamo')
    .map((s) => ({ ...enriquecer(s, datos), vigencia: vigenciaDe(s.fechaFin) }))
    .sort((a, b) => a.fechaFin.localeCompare(b.fechaFin))
}
