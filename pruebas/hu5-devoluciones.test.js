import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { ENCARGADA, ESTUDIANTE, cerrar, como, dias, prepararApp } from './ayuda.js'

let app
let encargada
let renzo
before(async () => {
  app = await prepararApp()
  encargada = await como(app, ENCARGADA)
  renzo = await como(app, ESTUDIANTE)
})
after(cerrar)

test('5.1 por devolver: solo el encargado, los vencidos primero', async () => {
  assert.equal((await renzo.get('/api/devoluciones/por-devolver')).status, 403)
  const r = await encargada.get('/api/devoluciones/por-devolver')
  assert.equal(r.status, 200)
  assert.ok(r.body.length > 0)
  assert.equal(r.body[0].vigencia.tipo, 'vencido')
})

test('5.1 devolución con retraso: calcula la penalidad, libera la unidad y guarda la deuda', async () => {
  // PRE-2026-0330: multímetro de Renzo, devolución pactada el 20/10/2026 (S/ 10 por día).
  const datos = await encargada.get('/api/devoluciones/prestamos/pre-2026-0330')
  assert.equal(datos.status, 200)

  const r = await encargada.post('/api/devoluciones/prestamos/PRE-2026-0330/devolucion').send({
    fechaRetorno: dias(0),
    estadoRetorno: 'sin_novedades',
    accesorios: datos.body.accesoriosEntregados.map((nombre) => ({ nombre, devuelto: true })),
  })
  assert.equal(r.status, 201, r.body.mensaje)
  assert.ok(r.body.diasRetraso > 0)
  assert.equal(r.body.penalidad, r.body.diasRetraso * 10)
  assert.equal(r.body.estadoUnidad, 'disponible')

  const yo = await renzo.get('/api/cuentas/yo')
  assert.equal(yo.body.deudaPendiente, r.body.deuda) // la deuda quedó en el usuario (HU-1)

  const otraVez = await encargada
    .post('/api/devoluciones/prestamos/PRE-2026-0330/devolucion')
    .send({
      fechaRetorno: dias(0),
      estadoRetorno: 'sin_novedades',
    })
  assert.equal(otraVez.status, 409)
})

test('5.2 devolución con daños: exige descripción y puede mandar la unidad a mantenimiento', async () => {
  const mal = await encargada.post('/api/devoluciones/prestamos/PRE-2026-0317/devolucion').send({
    fechaRetorno: dias(0),
    estadoRetorno: 'con_danos',
  })
  assert.equal(mal.status, 422)

  const r = await encargada.post('/api/devoluciones/prestamos/PRE-2026-0317/devolucion').send({
    fechaRetorno: dias(0),
    estadoRetorno: 'con_danos',
    descripcionDano: 'La rótula de bola llegó floja.',
    derivarMantenimiento: true,
  })
  assert.equal(r.status, 201, r.body.mensaje)
  assert.equal(r.body.estadoUnidad, 'mantenimiento')
})

test('5.4 historial: el estudiante ve el suyo, no el de otro (403)', async () => {
  assert.equal((await renzo.get('/api/devoluciones/estudiantes/US-201/historial')).status, 200)
  assert.equal((await renzo.get('/api/devoluciones/estudiantes/US-202/historial')).status, 403)
})

test('5.4 registrar pago deja la deuda en cero', async () => {
  const r = await encargada.post('/api/devoluciones/estudiantes/US-201/pago')
  assert.equal(r.status, 200, r.body.mensaje)
  assert.ok(r.body.monto > 0)
  assert.equal((await renzo.get('/api/cuentas/yo')).body.deudaPendiente, 0)
  assert.equal((await encargada.post('/api/devoluciones/estudiantes/US-201/pago')).status, 409)
})

test('5.3 renovación de un préstamo al día', async () => {
  // Préstamo nuevo del trípode (admite renovación): solicitud → aprobación → entrega.
  const s = await renzo.post('/api/catalogo/solicitudes').send({
    equipoId: 'EQ-007',
    fechaInicio: dias(0),
    fechaFin: dias(2),
    curso: 'IN324',
    motivo: 'Grabación de la práctica de laboratorio con cámara fija.',
    aceptaCondiciones: true,
  })
  const opciones = await encargada.get(`/api/prestamos/solicitudes/${s.body.id}/aprobacion`)
  await encargada
    .post(`/api/prestamos/solicitudes/${s.body.id}/aprobacion`)
    .send({ unidadId: opciones.body.unidadesLibres[0].id })
  const entrega = await encargada.post(`/api/prestamos/solicitudes/${s.body.id}/entrega`).send({
    fechaEntrega: new Date().toISOString(),
    observaciones: 'Trípode completo.',
    accesorios: [],
  })
  const codigo = entrega.body.codigoPrestamo

  const consulta = await encargada.get(`/api/devoluciones/prestamos/${codigo}/renovacion`)
  assert.equal(consulta.status, 200)
  assert.equal(consulta.body.posible, true, consulta.body.motivo)

  const demasiado = await encargada
    .post(`/api/devoluciones/prestamos/${codigo}/renovacion`)
    .send({ dias: 99 })
  assert.equal(demasiado.status, 422)

  const r = await encargada
    .post(`/api/devoluciones/prestamos/${codigo}/renovacion`)
    .send({ dias: 2 })
  assert.equal(r.status, 200, r.body.mensaje)
  assert.equal(r.body.nuevaFechaFin, dias(4))
})
