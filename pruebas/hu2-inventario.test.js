import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { ENCARGADA, ESTUDIANTE, anonimo, cerrar, como, prepararApp } from './ayuda.js'

let app
let encargada
before(async () => {
  app = await prepararApp()
  encargada = await como(app, ENCARGADA)
})
after(cerrar)

const condiciones = {
  duracionMaximaDias: 5,
  requiereAutorizacion: false,
  admiteRenovacion: true,
  penalidadPorDia: 8,
}

test('2.1 lista con filtros: Medición + «INV-OSC» deja solo el osciloscopio', async () => {
  const r = await encargada.get('/api/inventario/equipos?categoria=medicion&texto=INV-OSC')
  assert.equal(r.status, 200)
  assert.deepEqual(
    r.body.equipos.map((e) => e.nombre),
    ['Osciloscopio TBS1052B'],
  )
  assert.deepEqual(r.body.equipos[0].unidadesPorEstado, {
    disponible: 3,
    prestada: 1,
    mantenimiento: 1,
    baja: 0,
  })
})

test('2.1 el inventario es solo del encargado (401 sin sesión, 403 estudiante)', async () => {
  assert.equal((await anonimo(app).get('/api/inventario/equipos')).status, 401)
  const estudiante = await como(app, ESTUDIANTE)
  assert.equal((await estudiante.get('/api/inventario/equipos')).status, 403)
})

test('2.2 registrar equipo: 422 con errores por campo y 409 si marca + modelo se repite', async () => {
  const vacio = await encargada.post('/api/inventario/equipos').send({})
  assert.equal(vacio.status, 422)
  assert.ok(vacio.body.errores.nombre)

  const datos = {
    nombre: 'Cámara térmica',
    marca: 'FLIR',
    modelo: 'C5',
    categoria: 'medicion',
    accesorios: ['Cable USB-C'],
    condicionesPrestamo: condiciones,
  }
  const r = await encargada.post('/api/inventario/equipos').send(datos)
  assert.equal(r.status, 201, r.body.mensaje)
  assert.equal(r.body.id, 'EQ-011')
  assert.equal(r.body.esPublicable, false) // sin unidades todavía

  const repetido = await encargada.post('/api/inventario/equipos').send({ ...datos, marca: 'flir' })
  assert.equal(repetido.status, 409)
})

test('2.3 alta de unidad: formato INV-XXX-0000 y código único', async () => {
  const mal = await encargada.post('/api/inventario/equipos/EQ-011/unidades').send({
    codigoInventario: 'ABC',
    ubicacion: 'Almacén H-102 · anaquel 1',
  })
  assert.equal(mal.status, 422)

  const repetido = await encargada.post('/api/inventario/equipos/EQ-011/unidades').send({
    codigoInventario: 'INV-OSC-0042',
    ubicacion: 'Almacén H-102 · anaquel 1',
  })
  assert.equal(repetido.status, 409)

  const r = await encargada.post('/api/inventario/equipos/EQ-011/unidades').send({
    codigoInventario: 'inv-ter-0001',
    ubicacion: 'Almacén H-102 · anaquel 1',
  })
  assert.equal(r.status, 201, r.body.mensaje)
  assert.equal(r.body.codigoInventario, 'INV-TER-0001')
  assert.equal(r.body.historialEstados.length, 1)
})

test('2.4 cambio de estado: exige motivo, no deja poner «prestada» a mano y guarda historial', async () => {
  const { body } = await encargada.get('/api/inventario/equipos/EQ-011')
  const unidad = body.unidades[0]

  const sinMotivo = await encargada
    .patch(`/api/inventario/unidades/${unidad.id}/estado`)
    .send({ estadoNuevo: 'mantenimiento' })
  assert.equal(sinMotivo.status, 422)

  const prestada = await encargada
    .patch(`/api/inventario/unidades/${unidad.id}/estado`)
    .send({ estadoNuevo: 'prestada', motivo: 'Préstamo a mano' })
  assert.equal(prestada.status, 422)

  const r = await encargada
    .patch(`/api/inventario/unidades/${unidad.id}/estado`)
    .send({ estadoNuevo: 'mantenimiento', motivo: 'Calibración anual' })
  assert.equal(r.status, 200, r.body.mensaje)
  assert.equal(r.body.estado, 'mantenimiento')
  assert.equal(r.body.historialEstados.at(-1).usuarioId, encargada.usuario.id)
})

test('2.5 condiciones: valida límites y la ficha pública muestra lo guardado', async () => {
  const mal = await encargada
    .put('/api/inventario/equipos/EQ-001/condiciones')
    .send({ ...condiciones, duracionMaximaDias: 200 })
  assert.equal(mal.status, 422)
  const r = await encargada.put('/api/inventario/equipos/EQ-001/condiciones').send(condiciones)
  assert.equal(r.status, 200)
  const ficha = await anonimo(app).get('/api/inventario/publico/equipos/EQ-001')
  assert.equal(ficha.status, 200)
  assert.equal(ficha.body.equipo.condicionesPrestamo.penalidadPorDia, 8)
})

test('2.6 ficha pública: la ve cualquiera, pero no la de un borrador (404)', async () => {
  const publicada = await anonimo(app).get('/api/inventario/publico/equipos/EQ-011')
  assert.equal(publicada.status, 200) // ya tiene una unidad activa
  const borrador = await anonimo(app).get('/api/inventario/publico/equipos/EQ-009')
  assert.equal(borrador.status, 404)
})

test('no se elimina un equipo con unidades prestadas (409)', async () => {
  const r = await encargada.delete('/api/inventario/equipos/EQ-005')
  assert.equal(r.status, 409)
  assert.match(r.body.mensaje, /prestada/)
})

test('categorías: tabla propia, relacionada con equipos por llave foránea', async () => {
  const r = await anonimo(app).get('/api/inventario/categorias')
  assert.equal(r.status, 200)
  assert.equal(r.body.length, 6)
  const medicion = r.body.find((c) => c.id === 'medicion')
  assert.equal(medicion.nombre, 'Medición')
  assert.ok(medicion.equipos >= 2) // osciloscopio, multímetro…

  const mala = await encargada.post('/api/inventario/equipos').send({
    nombre: 'Equipo sin categoría',
    marca: 'Genérica',
    modelo: 'X1',
    categoria: 'cocina',
    condicionesPrestamo: condiciones,
  })
  assert.equal(mala.status, 422)
  assert.ok(mala.body.errores.categoria)
})
