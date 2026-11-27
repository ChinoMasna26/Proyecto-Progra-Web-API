import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  ENCARGADA,
  ENCARGADO_PENDIENTE,
  ESTUDIANTE,
  cerrar,
  como,
  dias,
  prepararApp,
} from './ayuda.js'

let app
let encargada
let renzo
let solicitudId
let codigo
before(async () => {
  app = await prepararApp()
  encargada = await como(app, ENCARGADA)
  renzo = await como(app, ESTUDIANTE)
  const r = await renzo.post('/api/catalogo/solicitudes').send({
    equipoId: 'EQ-007',
    fechaInicio: dias(0),
    fechaFin: dias(3),
    curso: 'IN324',
    motivo: 'Grabación de la práctica de laboratorio con cámara fija.',
    aceptaCondiciones: true,
  })
  solicitudId = r.body.id
})
after(cerrar)

test('4.1 bandeja con filtros y contadores; solo el encargado (403 estudiante)', async () => {
  assert.equal((await renzo.get('/api/prestamos/bandeja')).status, 403)
  const r = await encargada.get('/api/prestamos/bandeja?estado=pendiente&equipoId=EQ-007')
  assert.equal(r.status, 200)
  assert.ok(r.body.solicitudes.some((s) => s.id === solicitudId))
  assert.ok(r.body.contadores.pendiente >= 1)
})

test('4.2 un encargado con el alta pendiente no puede aprobar (403)', async () => {
  const pendiente = await como(app, ENCARGADO_PENDIENTE)
  const r = await pendiente
    .post(`/api/prestamos/solicitudes/${solicitudId}/aprobacion`)
    .send({ unidadId: 'UN-0025' })
  assert.equal(r.status, 403)
})

test('4.2 aprobar asigna una unidad libre en todo el rango', async () => {
  const opciones = await encargada.get(`/api/prestamos/solicitudes/${solicitudId}/aprobacion`)
  assert.equal(opciones.status, 200)
  const unidad = opciones.body.unidadesLibres[0]
  assert.ok(unidad)

  const sinUnidad = await encargada
    .post(`/api/prestamos/solicitudes/${solicitudId}/aprobacion`)
    .send({})
  assert.equal(sinUnidad.status, 422)

  const r = await encargada
    .post(`/api/prestamos/solicitudes/${solicitudId}/aprobacion`)
    .send({ unidadId: unidad.id })
  assert.equal(r.status, 200, r.body.mensaje)
  assert.equal(r.body.estado, 'aprobada')
  assert.equal(r.body.unidadId, unidad.id)

  const otraVez = await encargada
    .post(`/api/prestamos/solicitudes/${solicitudId}/aprobacion`)
    .send({ unidadId: unidad.id })
  assert.equal(otraVez.status, 409)
})

test('4.3 rechazar exige motivo de la lista y detalle', async () => {
  const mal = await encargada
    .post('/api/prestamos/solicitudes/SOL-0304/rechazo')
    .send({ motivo: 'Otro' })
  assert.equal(mal.status, 422)
  const r = await encargada.post('/api/prestamos/solicitudes/SOL-0304/rechazo').send({
    motivo: 'Fechas no disponibles',
    detalle: 'Las fechas ya pasaron, vuelve a solicitar.',
  })
  assert.equal(r.status, 200, r.body.mensaje)
  assert.match(r.body.motivoRechazo, /^Fechas no disponibles: /)
})

test('4.4 entrega: la unidad pasa a prestada (HU-2) y se genera el código del préstamo', async () => {
  const datos = await encargada.get(`/api/prestamos/solicitudes/${solicitudId}/entrega`)
  assert.equal(datos.status, 200)
  const r = await encargada.post(`/api/prestamos/solicitudes/${solicitudId}/entrega`).send({
    fechaEntrega: new Date().toISOString(),
    observaciones: 'Trípode completo y sin rayones.',
    accesorios: datos.body.accesorios.map((nombre) => ({ nombre, entregado: true })),
  })
  assert.equal(r.status, 201, r.body.mensaje)
  codigo = r.body.codigoPrestamo
  assert.match(codigo, /^PRE-\d{4}-\d{4}$/)

  const equipo = await encargada.get('/api/inventario/equipos/EQ-007')
  const unidad = equipo.body.unidades.find((u) => u.prestamoVigente === codigo)
  assert.equal(unidad.estado, 'prestada')
  assert.equal(unidad.historialEstados.at(-1).motivo, `Entrega del préstamo ${codigo}.`)
})

test('4.5 constancia: la ve su dueño y el encargado; otro estudiante no (403)', async () => {
  assert.equal((await renzo.get(`/api/prestamos/constancias/${codigo}`)).status, 200)
  assert.equal((await encargada.get(`/api/prestamos/constancias/${codigo}`)).status, 200)
  const otro = await como(app, 'ahuaman@aloe.ulima.edu.pe')
  assert.equal((await otro.get(`/api/prestamos/constancias/${codigo}`)).status, 403)
})

test('4.6 vigentes incluye el préstamo recién entregado', async () => {
  const r = await encargada.get('/api/prestamos/vigentes')
  assert.ok(r.body.some((s) => s.codigoPrestamo === codigo))
})

test('4.2 una solicitud que viene de una reserva (HU-6) puede usar la unidad reservada', async () => {
  const reserva = await renzo.post('/api/reservas').send({
    equipoId: 'EQ-008',
    fechaInicio: dias(2),
    fechaFin: dias(3),
    motivo: 'Práctica del laboratorio de circuitos.',
  })
  const unidadReservada = reserva.body.reserva.unidadId
  const convertidas = await renzo.post('/api/reservas/conversiones')
  const solicitud = convertidas.body.find((s) => s.reservaId === reserva.body.reserva.id)
  assert.ok(solicitud, 'la reserva próxima se convirtió en solicitud')

  const opciones = await encargada.get(`/api/prestamos/solicitudes/${solicitud.id}/aprobacion`)
  assert.ok(opciones.body.unidadesLibres.some((u) => u.id === unidadReservada))
  const r = await encargada
    .post(`/api/prestamos/solicitudes/${solicitud.id}/aprobacion`)
    .send({ unidadId: unidadReservada })
  assert.equal(r.status, 200, r.body.mensaje)
})
