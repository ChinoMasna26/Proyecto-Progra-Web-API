import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { anonimo, cerrar, prepararApp } from './ayuda.js'

let app
before(async () => {
  app = await prepararApp()
})
after(cerrar)

test('la API responde y carga los módulos de las historias', async () => {
  const r = await anonimo(app).get('/api/salud')
  assert.equal(r.status, 200)
  assert.equal(r.body.estado, 'ok')
})

test('una ruta que no existe responde 404 en JSON', async () => {
  const r = await anonimo(app).get('/api/no-existe')
  assert.equal(r.status, 404)
  assert.match(r.body.mensaje, /No existe la ruta/)
})
