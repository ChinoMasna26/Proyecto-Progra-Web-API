import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  ENCARGADA,
  ESTUDIANTE,
  ESTUDIANTE_CON_DEUDA,
  cerrar,
  como,
  dias,
  prepararApp,
} from './ayuda.js'

let app
let encargada
let renzo
let lucia
before(async () => {
  app = await prepararApp()
  encargada = await como(app, ENCARGADA)
  renzo = await como(app, ESTUDIANTE)
  lucia = await como(app, ESTUDIANTE_CON_DEUDA)
})
after(cerrar)

const reserva = (equipoId, desde, hasta) => ({
  equipoId,
  fechaInicio: dias(desde),
  fechaFin: dias(hasta),
  motivo: 'Práctica del laboratorio de circuitos.',
})

test('6.2 valida el rango: fecha pasada o motivo corto (422)', async () => {
  assert.equal((await renzo.post('/api/reservas').send(reserva('EQ-007', -1, 1))).status, 422)
  assert.equal(
    (await renzo.post('/api/reservas').send({ ...reserva('EQ-007', 3, 4), motivo: 'corto' }))
      .status,
    422,
  )
})

test('6.2 con unidad libre queda confirmada; sin unidades, entra a la lista de espera', async () => {
  const confirmada = await renzo.post('/api/reservas').send(reserva('EQ-007', 3, 5))
  assert.equal(confirmada.status, 201, confirmada.body.mensaje)
  assert.equal(confirmada.body.reserva.estado, 'confirmada')
  assert.ok(confirmada.body.reserva.unidadId)

  const primera = await renzo.post('/api/reservas').send(reserva('EQ-005', 25, 27))
  assert.equal(primera.body.reserva.estado, 'en_espera')
  assert.equal(primera.body.posicion, 1)
  const segunda = await lucia.post('/api/reservas').send(reserva('EQ-005', 26, 28))
  assert.equal(segunda.body.posicion, 2)
})

test('6.4 el estudiante ve su lista de espera; el encargado, la cola por equipo', async () => {
  const mia = await renzo.get('/api/reservas/espera/mias')
  assert.equal(mia.status, 200)
  assert.equal(mia.body[0].posicion, 1)

  assert.equal((await renzo.get('/api/reservas/espera')).status, 403)
  const cola = await encargada.get('/api/reservas/espera')
  const multimetro = cola.body.find((g) => g.equipoId === 'EQ-005')
  assert.equal(multimetro.reservas.length, 2)
  assert.equal(multimetro.enPausa, true) // ninguna unidad disponible
  assert.equal(multimetro.reservas[1].conDeuda, true) // Lucía tiene deuda
})

test('6.3 cancelar una reserva promueve a la siguiente de la cola', async () => {
  // La fuente de poder tiene 3 unidades disponibles: la cuarta reserva queda en espera.
  const ids = []
  for (let i = 0; i < 3; i++)
    ids.push((await renzo.post('/api/reservas').send(reserva('EQ-008', 20, 22))).body.reserva.id)
  const cuarta = await lucia.post('/api/reservas').send(reserva('EQ-008', 20, 22))
  assert.equal(cuarta.body.reserva.estado, 'en_espera')

  const r = await renzo.post(`/api/reservas/${ids[0]}/cancelacion`)
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.promovidas, [cuarta.body.reserva.id])
  assert.equal((await renzo.post(`/api/reservas/${ids[0]}/cancelacion`)).status, 409)
  assert.equal((await lucia.post(`/api/reservas/${ids[1]}/cancelacion`)).status, 404) // no es suya
})

test('6.5 una reserva próxima se convierte en solicitud pendiente para la bandeja', async () => {
  const convertidas = await renzo.post('/api/reservas/conversiones')
  assert.equal(convertidas.status, 200)
  const solicitud = convertidas.body.find((s) => s.equipoId === 'EQ-007')
  assert.ok(solicitud, 'la reserva del trípode (en 3 días) se convirtió')
  assert.equal(solicitud.estado, 'pendiente')

  const mias = await renzo.get('/api/reservas/mias')
  const original = mias.body.find((r) => r.solicitudId === solicitud.id)
  assert.equal(original.estado, 'convertida')
})
