/**
 * HU-5 · Devoluciones, penalidades y renovaciones, ahora en el servidor.
 *
 * Cierra los préstamos que entregó la HU-4: registra la devolución, los daños o faltantes,
 * el retraso y la penalidad, y renueva préstamos. Sobre la solicitud solo escribe el estado
 * «devuelta», la renovación y los campos de la devolución. La unidad la cambia con el
 * servicio de la HU-2 y la deuda la guarda con el de la HU-1, todo en una transacción.
 */
import { ErrorHttp } from '../../comun/errores.js'
import { ahora } from '../../comun/filas.js'
import * as solicitudes from '../../comun/solicitudes.repositorio.js'
import { enTransaccion } from '../../db/sequelize.js'
import { etiquetaCategoria } from '../../dominio/catalogos.js'
import {
  calcularPenalidad,
  deudaDe,
  diasRetraso,
  evaluarRenovacion,
  validarDevolucion,
  validarRenovacion,
} from '../../dominio/devoluciones.js'
import { vigenciaDe } from '../../dominio/prestamos.js'
import {
  cursoPorCodigo,
  duracionDias,
  hoyISO,
  seSolapan,
  sumarDias,
} from '../../dominio/solicitudes.js'
import { establecerDeuda, listarUsuariosPublicos } from '../hu1-cuentas/cuentas.servicio.js'
import {
  cambiarEstadoUnidad,
  listarEquiposConUnidades,
} from '../hu2-inventario/inventario.servicio.js'
import { listarEnEspera, listarReservasActivas } from '../hu6-reservas/reservas.servicio.js'
import * as repo from './devoluciones.repositorio.js'

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
    equipoCategoria: equipo ? etiquetaCategoria(equipo.categoria) : '',
    codigoUnidad: unidad?.codigoInventario ?? null,
    estudianteNombre: estudiante ? `${estudiante.nombres} ${estudiante.apellidos}` : s.estudianteId,
    cursoNombre: curso ? `${curso.codigo} ${curso.nombre}` : s.curso,
    accesoriosEquipo: equipo?.accesorios ?? [],
    penalidadPorDia: Number(equipo?.condicionesPrestamo?.penalidadPorDia) || 0,
  }
}

function buscarPorCodigo(codigo, todas) {
  const limpio = String(codigo ?? '')
    .trim()
    .toUpperCase()
  const solicitud = todas.find((s) => s.codigoPrestamo === limpio)
  if (!solicitud) throw new ErrorHttp(`No encontramos el préstamo ${limpio}.`.trim(), 404)
  return solicitud
}

/** Lo que pasará con otras reservas o préstamos si la unidad va a mantenimiento (5.2). */
async function efectoMantenimiento(solicitud, equipo, todas) {
  const hoy = hoyISO()
  const reservas = await listarReservasActivas()
  const comprometidas = [
    ...todas.filter(
      (o) =>
        o.id !== solicitud.id &&
        o.unidadId === solicitud.unidadId &&
        o.estado === 'aprobada' &&
        o.fechaFin >= hoy,
    ),
    ...reservas.filter((r) => r.unidadId === solicitud.unidadId && r.fechaFin >= hoy),
  ].sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio))
  return {
    comprometidas: comprometidas.map((c) => ({ fechaInicio: c.fechaInicio, fechaFin: c.fechaFin })),
    libresHoy: equipo ? equipo.unidades.filter((u) => u.estado === 'disponible').length : 0,
  }
}

// -------------------------------------------------------------------- consultas

/** Vista 5.1: préstamos por devolver, los vencidos primero. */
export async function listarPorDevolver() {
  const datos = await contexto()
  return datos.solicitudes
    .filter((s) => s.estado === 'en_prestamo')
    .map((s) => ({ ...enriquecer(s, datos), vigencia: vigenciaDe(s.fechaFin) }))
    .sort((a, b) => a.fechaFin.localeCompare(b.fechaFin))
}

/** Vista 5.1: el préstamo buscado por su código, con lo necesario para el formulario. */
export async function obtenerParaDevolucion(codigo) {
  const datos = await contexto()
  const solicitud = buscarPorCodigo(codigo, datos.solicitudes)
  if (solicitud.estado === 'devuelta')
    throw new ErrorHttp(`El préstamo ${solicitud.codigoPrestamo} ya se devolvió.`, 409)
  if (solicitud.estado !== 'en_prestamo')
    throw new ErrorHttp(`El préstamo ${solicitud.codigoPrestamo} no está entregado.`, 409)
  const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
  return {
    solicitud: enriquecer(solicitud, datos),
    accesoriosEntregados: solicitud.accesoriosEntregados ?? equipo?.accesorios ?? [],
    efecto: await efectoMantenimiento(solicitud, equipo, datos.solicitudes),
  }
}

// ------------------------------------------------------------------- devolución

/** Vista 5.1 y 5.2: devolución con retraso, penalidad, daños y deuda, en una transacción. */
export async function registrarDevolucion(codigo, datosDevolucion, encargado) {
  return enTransaccion(async (db) => {
    const datos = await contexto(db)
    const solicitud = buscarPorCodigo(codigo, datos.solicitudes)
    if (solicitud.estado !== 'en_prestamo')
      throw new ErrorHttp('Solo se registra la devolución de un préstamo entregado.', 409)

    const fechaEntrega = solicitud.fechaEntregaReal
      ? hoyISO(new Date(solicitud.fechaEntregaReal))
      : solicitud.fechaInicio
    const errores = validarDevolucion(datosDevolucion, { fechaEntrega })
    if (Object.keys(errores).length)
      throw new ErrorHttp(Object.values(errores)[0], 422, { errores })

    const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
    const { fechaRetorno, estadoRetorno } = datosDevolucion
    const dias = diasRetraso(solicitud.fechaFin, fechaRetorno)
    const monto = calcularPenalidad(dias, equipo?.condicionesPrestamo?.penalidadPorDia)
    const conNovedad = estadoRetorno !== 'sin_novedades'
    const aMantenimiento = conNovedad && Boolean(datosDevolucion.derivarMantenimiento)

    // Primero el inventario (HU-2): si la unidad no puede cambiar, no se cierra el préstamo.
    if (solicitud.unidadId)
      await cambiarEstadoUnidad(
        solicitud.unidadId,
        {
          estadoNuevo: aMantenimiento ? 'mantenimiento' : 'disponible',
          motivo: aMantenimiento
            ? `Devolución de ${solicitud.codigoPrestamo} con ${estadoRetorno === 'con_danos' ? 'daños' : 'faltantes'}: ${String(datosDevolucion.descripcionDano || 'accesorios faltantes').trim()}`
            : `Devolución del préstamo ${solicitud.codigoPrestamo}.`,
          usuarioId: encargado.id,
        },
        db,
      )

    const accesorios = (datosDevolucion.accesorios ?? []).map((a) => ({
      nombre: a.nombre,
      devuelto: Boolean(a.devuelto),
    }))
    await solicitudes.actualizar(
      solicitud.id,
      {
        estado: 'devuelta',
        fechaDevolucionReal: fechaRetorno,
        estadoRetorno,
        accesoriosDevueltos: accesorios.filter((a) => a.devuelto).map((a) => a.nombre),
        accesoriosFaltantes: conNovedad ? [...(datosDevolucion.faltantes ?? [])] : [],
        descripcionDano: conNovedad ? String(datosDevolucion.descripcionDano ?? '').trim() : '',
        fotoDano: conNovedad ? (datosDevolucion.fotoDano ?? null) : null,
        derivadaMantenimiento: aMantenimiento,
        observacionesDevolucion: String(datosDevolucion.observaciones ?? '').trim(),
        diasRetraso: dias,
        penalidad: monto > 0 ? { monto, estado: 'pendiente', calculadaEn: ahora() } : null,
        recibidaPor: encargado.id,
        devueltaEn: ahora(),
      },
      db,
    )

    // La deuda es la suma de penalidades pendientes; el dato vive en el usuario (HU-1).
    const deuda = deudaDe(await solicitudes.listarDeEstudiante(solicitud.estudianteId, db))
    await establecerDeuda(solicitud.estudianteId, deuda, db)

    return {
      codigoPrestamo: solicitud.codigoPrestamo,
      diasRetraso: dias,
      penalidad: monto,
      deuda,
      estadoUnidad: aMantenimiento ? 'mantenimiento' : 'disponible',
      codigoUnidad:
        equipo?.unidades.find((u) => u.id === solicitud.unidadId)?.codigoInventario ?? '',
    }
  })
}

// ------------------------------------------------------------------- renovación

async function analizarRenovacion(solicitud, datos) {
  const equipo = datos.equipos.find((e) => e.id === solicitud.equipoId)
  const hoy = hoyISO()
  const [espera, reservas] = await Promise.all([listarEnEspera(), listarReservasActivas()])
  const enEspera = espera.filter(
    (r) => r.equipoId === solicitud.equipoId && r.fechaFin >= hoy,
  ).length

  // ¿La misma unidad está comprometida en los días siguientes a la devolución pactada?
  const maximos = Number(equipo?.condicionesPrestamo?.duracionMaximaDias) || 0
  const desde = sumarDias(solicitud.fechaFin, 1)
  const hasta = sumarDias(solicitud.fechaFin, maximos)
  const choques = [
    ...datos.solicitudes.filter(
      (o) =>
        o.id !== solicitud.id &&
        o.unidadId === solicitud.unidadId &&
        ['aprobada', 'en_prestamo'].includes(o.estado),
    ),
    ...reservas.filter((r) => r.unidadId === solicitud.unidadId),
  ]
    .filter((o) => seSolapan(desde, hasta, o.fechaInicio, o.fechaFin))
    .map((o) => o.fechaInicio)
    .sort()
  const primerChoque = choques[0] ?? null
  const diasLibres = primerChoque
    ? Math.min(maximos, duracionDias(solicitud.fechaFin, primerChoque) - 1)
    : maximos

  const resultado = evaluarRenovacion({
    solicitud,
    equipo,
    enEspera,
    unidadOcupadaHasta: primerChoque && diasLibres < 1 ? primerChoque : null,
    hoy,
  })
  const diasMaximos = Math.min(resultado.diasMaximos, diasLibres)
  return {
    ...resultado,
    diasMaximos,
    nuevaFechaFin: sumarDias(solicitud.fechaFin, diasMaximos),
    enEspera,
  }
}

/** Vista 5.3: si el préstamo se puede renovar y hasta cuándo. */
export async function consultarRenovacion(codigo) {
  const datos = await contexto()
  const solicitud = buscarPorCodigo(codigo, datos.solicitudes)
  if (solicitud.estado !== 'en_prestamo')
    throw new ErrorHttp('Solo se renueva un préstamo vigente.', 409)
  return {
    solicitud: enriquecer(solicitud, datos),
    ...(await analizarRenovacion(solicitud, datos)),
  }
}

export async function renovarPrestamo(codigo, { dias } = {}, encargado) {
  const datos = await contexto()
  const solicitud = buscarPorCodigo(codigo, datos.solicitudes)
  if (solicitud.estado !== 'en_prestamo')
    throw new ErrorHttp('Solo se renueva un préstamo vigente.', 409)
  const analisis = await analizarRenovacion(solicitud, datos)
  if (!analisis.posible) throw new ErrorHttp(analisis.motivo, 409)
  const errores = validarRenovacion({ dias }, analisis)
  if (Object.keys(errores).length) throw new ErrorHttp(errores.dias, 422, { errores })

  const nuevaFechaFin = sumarDias(solicitud.fechaFin, Number(dias))
  await enTransaccion(async (db) => {
    await solicitudes.actualizar(solicitud.id, { fechaFin: nuevaFechaFin }, db)
    await repo.agregarRenovacion(
      {
        solicitudId: solicitud.id,
        fechaFinAnterior: solicitud.fechaFin,
        fechaFinNueva: nuevaFechaFin,
        dias: Number(dias),
        por: encargado.id,
      },
      db,
    )
  })
  return { codigoPrestamo: solicitud.codigoPrestamo, nuevaFechaFin }
}

// -------------------------------------------------------------------- historial

/** Vista 5.4 (y «Mi deuda» del estudiante): préstamos, retrasos y penalidades. */
export async function obtenerHistorial(estudianteId, usuario) {
  if (usuario.rol === 'estudiante' && usuario.id !== estudianteId)
    throw new ErrorHttp('Solo puedes ver tu propio historial.', 403)
  const datos = await contexto()
  const estudiante = datos.usuarios.find((u) => u.id === estudianteId && u.rol === 'estudiante')
  if (!estudiante) throw new ErrorHttp('No encontramos al estudiante.', 404)

  const suyas = datos.solicitudes.filter((s) => s.estudianteId === estudianteId)
  const prestamos = suyas
    .filter((s) => ['en_prestamo', 'devuelta'].includes(s.estado))
    .map((s) => {
      const retraso =
        s.estado === 'devuelta'
          ? (s.diasRetraso ?? diasRetraso(s.fechaFin, s.fechaDevolucionReal ?? s.fechaFin))
          : diasRetraso(s.fechaFin, hoyISO())
      return { ...enriquecer(s, datos), retraso }
    })
    .sort((a, b) =>
      (b.fechaEntregaReal ?? b.fechaInicio).localeCompare(a.fechaEntregaReal ?? a.fechaInicio),
    )

  const pendientes = suyas.filter((s) => s.penalidad?.estado === 'pendiente')
  return {
    estudiante,
    prestamos,
    resumen: {
      prestamos: prestamos.length,
      retrasos: prestamos.filter((p) => p.retraso > 0).length,
      diasRetraso: prestamos.reduce((t, p) => t + p.retraso, 0),
      deuda: deudaDe(suyas),
      faltantesPorValorizar: suyas.reduce((t, s) => t + (s.accesoriosFaltantes?.length ?? 0), 0),
    },
    detalleDeuda: pendientes.map((s) => ({
      codigoPrestamo: s.codigoPrestamo,
      dias: s.diasRetraso ?? 0,
      monto: s.penalidad.monto,
    })),
  }
}

/** «Registrar pago» (5.4): las penalidades pendientes quedan pagadas y la deuda en 0. */
export async function registrarPago(estudianteId, encargado) {
  return enTransaccion(async (db) => {
    const suyas = await solicitudes.listarDeEstudiante(estudianteId, db)
    const pendientes = suyas.filter((s) => s.penalidad?.estado === 'pendiente')
    if (pendientes.length === 0)
      throw new ErrorHttp('El estudiante no tiene penalidades pendientes.', 409)
    const monto = deudaDe(pendientes)
    const cuando = ahora()
    for (const s of pendientes)
      await solicitudes.actualizar(
        s.id,
        {
          penalidad: {
            ...s.penalidad,
            estado: 'pagada',
            pagadaEn: cuando,
            recibidoPor: encargado.id,
          },
        },
        db,
      )
    await establecerDeuda(
      estudianteId,
      deudaDe(await solicitudes.listarDeEstudiante(estudianteId, db)),
      db,
    )
    return { monto, penalidades: pendientes.length }
  })
}
