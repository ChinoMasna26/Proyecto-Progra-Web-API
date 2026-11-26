/**
 * HU-6 · Reglas de reservas y lista de espera, ahora en el servidor.
 *
 * Equipos y unidades se leen con el servicio de la HU-2 y los estudiantes con el de la
 * HU-1; la HU-6 no los modifica. Al convertir una reserva próxima, la solicitud se crea en
 * la tabla compartida de solicitudes, para que el encargado la vea en su bandeja (HU-4).
 *
 * Para otras historias: listarReservasActivas (HU-3, HU-4, HU-5 la usan para saber qué
 * unidad está comprometida) y listarEnEspera (HU-5, al decidir una renovación).
 */
import { ErrorHttp } from '../../comun/errores.js'
import { ahora } from '../../comun/filas.js'
import * as solicitudes from '../../comun/solicitudes.repositorio.js'
import { enTransaccion } from '../../db/sequelize.js'
import { duracionDias, hoyISO, seSolapan, sumarDias } from '../../dominio/solicitudes.js'
import { listarUsuariosPublicos } from '../hu1-cuentas/cuentas.servicio.js'
import { listarEquiposConUnidades } from '../hu2-inventario/inventario.servicio.js'
import * as repo from './reservas.repositorio.js'

const ESTADOS_ACTIVOS = ['confirmada', 'convertida']
const DIAS_PARA_CONVERTIR = 7

const compararReservas = (a, b) => a.creadaEn.localeCompare(b.creadaEn) || a.id.localeCompare(b.id)

function esFechaISO(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valor ?? ''))) return false
  const fecha = new Date(`${valor}T12:00:00`)
  return !Number.isNaN(fecha.getTime()) && hoyISO(fecha) === valor
}

function unidadLibreEnFechas(unidad, fechas, reservas) {
  if (unidad.estado !== 'disponible') return false
  return !reservas.some(
    (r) =>
      ESTADOS_ACTIVOS.includes(r.estado) &&
      r.unidadId === unidad.id &&
      seSolapan(fechas.fechaInicio, fechas.fechaFin, r.fechaInicio, r.fechaFin),
  )
}

function posicionEnCola(reserva, enEspera) {
  return enEspera.filter(
    (otra) =>
      otra.equipoId === reserva.equipoId &&
      seSolapan(otra.fechaInicio, otra.fechaFin, reserva.fechaInicio, reserva.fechaFin) &&
      compararReservas(otra, reserva) <= 0,
  ).length
}

// ------------------------------------------------------------------- consultas

export async function listarEquiposReservables() {
  const equipos = await listarEquiposConUnidades()
  return equipos
    .filter((e) => e.esPublicable)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

export const listarReservas = (usuarioId) => repo.listarDeUsuario(usuarioId)

/** Reservas que comprometen una unidad (las leen la HU-3, la HU-4 y la HU-5). */
export const listarReservasActivas = (db) => repo.listarPorEstado(ESTADOS_ACTIVOS, db)

/** Todas las reservas en espera (la HU-5 las lee para decidir una renovación). */
export const listarEnEspera = (db) => repo.listarPorEstado(['en_espera'], db)

/** Vista 6.4 del estudiante: sus reservas en espera y su puesto en la cola. */
export async function listarListaEspera(usuarioId) {
  const enEspera = (await listarEnEspera()).sort(compararReservas)
  return enEspera
    .filter((r) => r.usuarioId === usuarioId)
    .map((r) => ({ ...r, posicion: posicionEnCola(r, enEspera) }))
}

/**
 * Vista 6.4 del encargado: la cola de cada equipo en orden de llegada. Una cola está
 * «en pausa» si el equipo no tiene ninguna unidad disponible.
 */
export async function listarEsperaPorEquipo() {
  const [equipos, usuarios, espera] = await Promise.all([
    listarEquiposConUnidades(),
    listarUsuariosPublicos(),
    listarEnEspera(),
  ])
  espera.sort(compararReservas)
  return equipos
    .map((equipo) => ({
      equipoId: equipo.id,
      equipoNombre: equipo.nombre,
      enPausa: equipo.unidades.every((u) => u.estado !== 'disponible'),
      enMantenimiento: equipo.unidades
        .filter((u) => u.estado === 'mantenimiento')
        .map((u) => u.codigoInventario),
      reservas: espera
        .filter((r) => r.equipoId === equipo.id)
        .map((r, i) => {
          const estudiante = usuarios.find((u) => u.id === r.usuarioId)
          return {
            ...r,
            posicion: i + 1,
            estudianteNombre: estudiante
              ? `${estudiante.nombres} ${estudiante.apellidos}`
              : r.usuarioId,
            conDeuda: Number(estudiante?.deudaPendiente) > 0,
          }
        }),
    }))
    .filter((grupo) => grupo.reservas.length > 0)
}

// ------------------------------------------------------------------- escritura

/** Vista 6.2: si hay una unidad libre en el rango, queda confirmada; si no, en espera. */
export async function crearReserva(datos, usuarioId) {
  const { equipoId, fechaInicio, fechaFin } = datos ?? {}
  if (!equipoId)
    throw new ErrorHttp('Selecciona un equipo.', 422, {
      errores: { equipoId: 'Selecciona un equipo.' },
    })
  if (!esFechaISO(fechaInicio) || !esFechaISO(fechaFin))
    throw new ErrorHttp('Ingresa un rango de fechas válido.', 422)
  if (fechaInicio <= hoyISO()) throw new ErrorHttp('La fecha de inicio debe ser futura.', 422)
  if (fechaFin < fechaInicio)
    throw new ErrorHttp('La fecha de fin debe ser igual o posterior a la fecha de inicio.', 422)
  const motivo = String(datos.motivo ?? '').trim()
  if (motivo.length < 10 || motivo.length > 300)
    throw new ErrorHttp('El motivo debe tener entre 10 y 300 caracteres.', 422)

  const equipos = await listarEquiposConUnidades()
  const equipo = equipos.find((e) => e.id === equipoId)
  if (!equipo || equipo.esBorrador)
    throw new ErrorHttp('El equipo ya no está disponible para reservar.', 404)
  if (!equipo.unidades.some((u) => ['disponible', 'prestada'].includes(u.estado)))
    throw new ErrorHttp('Este equipo no tiene unidades disponibles para reservar.', 409)
  const maximo = equipo.condicionesPrestamo.duracionMaximaDias
  // días calendario contando el primero y el último
  if (duracionDias(fechaInicio, fechaFin) + 1 > maximo)
    throw new ErrorHttp(`El rango supera la duración máxima de ${maximo} días.`, 422)

  return enTransaccion(async (db) => {
    const todas = await repo.listar(db)
    const unidad = equipo.unidades.find((u) =>
      unidadLibreEnFechas(u, { fechaInicio, fechaFin }, todas),
    )
    const reserva = await repo.insertar(
      {
        id: await repo.siguienteId(db),
        equipoId,
        unidadId: unidad?.id ?? null,
        usuarioId,
        fechaInicio,
        fechaFin,
        motivo,
        estado: unidad ? 'confirmada' : 'en_espera',
      },
      db,
    )
    const enEspera = [...todas, reserva].filter((r) => r.estado === 'en_espera')
    return {
      reserva,
      equipoNombre: equipo.nombre,
      posicion: unidad ? null : posicionEnCola(reserva, enEspera),
    }
  })
}

/** Al cancelar, la primera reserva en espera que tenga unidad libre pasa a confirmada. */
export async function cancelarReserva(id, usuarioId) {
  const reserva = await repo.buscar(id)
  if (!reserva || reserva.usuarioId !== usuarioId)
    throw new ErrorHttp('No encontramos esta reserva.', 404)
  if (!['confirmada', 'en_espera'].includes(reserva.estado))
    throw new ErrorHttp('Esta reserva ya no se puede cancelar.', 409)

  return enTransaccion(async (db) => {
    const cancelada = await repo.actualizar(id, { estado: 'cancelada' }, db)
    const promovidas = await promoverEspera(reserva.equipoId, db)
    return { reserva: cancelada, promovidas }
  })
}

async function promoverEspera(equipoId, db) {
  const [equipos, todas] = await Promise.all([listarEquiposConUnidades({}, db), repo.listar(db)])
  const unidades = equipos.find((e) => e.id === equipoId)?.unidades ?? []
  const promovidas = []
  for (const reserva of todas.filter((r) => r.estado === 'en_espera' && r.equipoId === equipoId)) {
    const unidad = unidades.find((u) => unidadLibreEnFechas(u, reserva, todas))
    if (!unidad) continue
    reserva.estado = 'confirmada' // así la siguiente de la cola ya ve esta unidad ocupada
    reserva.unidadId = unidad.id
    await repo.actualizar(reserva.id, { estado: 'confirmada', unidadId: unidad.id }, db)
    promovidas.push(reserva.id)
  }
  return promovidas
}

/**
 * Las reservas confirmadas que empiezan en los próximos 7 días se convierten en una
 * solicitud pendiente (la ve el encargado en la HU-4). La reserva queda «convertida» y
 * sigue comprometiendo su unidad hasta que la solicitud se resuelva.
 */
export async function convertirReservasProximas() {
  const hoy = hoyISO()
  const hasta = sumarDias(hoy, DIAS_PARA_CONVERTIR)
  return enTransaccion(async (db) => {
    const proximas = (await repo.listarPorEstado(['confirmada'], db)).filter(
      (r) => r.fechaInicio >= hoy && r.fechaInicio <= hasta,
    )
    const convertidas = []
    for (const reserva of proximas) {
      const solicitud = await solicitudes.insertar(
        {
          id: await solicitudes.siguienteId(db),
          reservaId: reserva.id,
          estudianteId: reserva.usuarioId,
          equipoId: reserva.equipoId,
          unidadId: null, // la asigna el encargado al aprobar (HU-4)
          fechaInicio: reserva.fechaInicio,
          fechaFin: reserva.fechaFin,
          curso: '',
          motivo: `Reserva ${reserva.id}: ${reserva.motivo}`,
          estado: 'pendiente',
          creadaEn: ahora(),
        },
        db,
      )
      await repo.actualizar(reserva.id, { estado: 'convertida', solicitudId: solicitud.id }, db)
      convertidas.push(solicitud)
    }
    return convertidas
  })
}
