import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import {
  ENCARGADA,
  ESTUDIANTE,
  ESTUDIANTE_CON_DEUDA,
  anonimo,
  cerrar,
  como,
  dias,
  prepararApp,
} from './ayuda.js'

let app
let renzo
before(async () => {
  app = await prepararApp()
  renzo = await como(app, ESTUDIANTE)
})
after(cerrar)

const solicitud = () => ({
  equipoId: 'EQ-007',
  fechaInicio: dias(2),
  fechaFin: dias(4),
  curso: 'IN324',
  motivo: 'Grabación de la práctica de laboratorio con cámara fija.',
  aceptaCondiciones: true,
})

test('3.1 el catálogo es público y solo muestra equipos publicados', async () => {
  const r = await anonimo(app).get('/api/catalogo/equipos?porPagina=20')
  assert.equal(r.status, 200)
  const ids = r.body.equipos.map((e) => e.id)
  assert.ok(!ids.includes('EQ-009'), 'el borrador no se publica')
  assert.ok(!ids.includes('EQ-010'), 'un equipo con todas sus unidades de baja no se publica')
})

test('3.1 filtra por varias categorías a la vez', async () => {
  const r = await anonimo(app).get('/api/catalogo/equipos?categorias=medicion,audiovisual')
  assert.ok(r.body.equipos.every((e) => ['medicion', 'audiovisual'].includes(e.categoria)))
})

test('3.3 disponibilidad: el multímetro no tiene unidades libres y lo dice', async () => {
  const r = await anonimo(app).get(
    `/api/catalogo/equipos/EQ-005/disponibilidad?inicio=${dias(2)}&fin=${dias(4)}`,
  )
  assert.equal(r.body.libres, 0)
  assert.match(r.body.mensaje, /Fechas no disponibles/)
})

test('3.3 solicitar: valida en el servidor (422) y crea la solicitud pendiente (201)', async () => {
  const mal = await renzo.post('/api/catalogo/solicitudes').send({ ...solicitud(), motivo: '' })
  assert.equal(mal.status, 422)
  assert.ok(mal.body.errores.motivo)

  const r = await renzo.post('/api/catalogo/solicitudes').send(solicitud())
  assert.equal(r.status, 201, r.body.mensaje)
  assert.equal(r.body.estado, 'pendiente')
  assert.equal(r.body.estudianteId, renzo.usuario.id)
})

test('3.3 no deja repetir la misma solicitud en fechas que se cruzan (409)', async () => {
  const r = await renzo.post('/api/catalogo/solicitudes').send(solicitud())
  assert.equal(r.status, 409)
})

test('3.3 un estudiante con deuda no puede solicitar (403)', async () => {
  const lucia = await como(app, ESTUDIANTE_CON_DEUDA)
  const r = await lucia.post('/api/catalogo/solicitudes').send(solicitud())
  assert.equal(r.status, 403)
  assert.match(r.body.mensaje, /deuda/)
})

test('3.3 el encargado no solicita préstamos (403)', async () => {
  const encargada = await como(app, ENCARGADA)
  assert.equal((await encargada.post('/api/catalogo/solicitudes').send(solicitud())).status, 403)
})

test('3.4 mis solicitudes y retiro: solo una vez, y solo las propias', async () => {
  const mias = await renzo.get('/api/catalogo/solicitudes/mias')
  const nueva = mias.body.find((s) => s.equipoId === 'EQ-007' && s.estado === 'pendiente')
  assert.ok(nueva.retirable)

  const otro = await como(app, 'ahuaman@aloe.ulima.edu.pe')
  assert.equal((await otro.post(`/api/catalogo/solicitudes/${nueva.id}/retiro`)).status, 403)

  const r = await renzo.post(`/api/catalogo/solicitudes/${nueva.id}/retiro`)
  assert.equal(r.status, 200)
  assert.equal(r.body.estado, 'retirada')
  assert.equal((await renzo.post(`/api/catalogo/solicitudes/${nueva.id}/retiro`)).status, 409)
})
