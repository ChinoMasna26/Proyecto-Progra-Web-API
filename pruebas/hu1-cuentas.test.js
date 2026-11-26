import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { CLAVE, ENCARGADA, anonimo, cerrar, como, prepararApp } from './ayuda.js'

let app
before(async () => {
  app = await prepararApp()
})
after(cerrar)

test('1.2 inicia sesión con la contraseña cifrada con bcrypt y no expone el hash', async () => {
  const r = await anonimo(app)
    .post('/api/cuentas/sesion')
    .send({ correo: ENCARGADA, contrasena: CLAVE })
  assert.equal(r.status, 200)
  assert.ok(r.body.token)
  assert.equal(r.body.usuario.rol, 'encargado')
  assert.equal(r.body.usuario.contrasenaHash, undefined)
})

test('1.2 contraseña incorrecta: 401 con los intentos que quedan', async () => {
  const r = await anonimo(app)
    .post('/api/cuentas/sesion')
    .send({ correo: 'mquiroga@ulima.edu.pe', contrasena: 'Otra2026!' })
  assert.equal(r.status, 401)
  assert.equal(r.body.intentosRestantes, 4)
})

test('1.2 cinco intentos fallidos bloquean el correo (429)', async () => {
  const correo = 'dsalcedo@aloe.ulima.edu.pe'
  for (let i = 0; i < 5; i++)
    await anonimo(app).post('/api/cuentas/sesion').send({ correo, contrasena: 'Mala2026!' })
  const r = await anonimo(app).post('/api/cuentas/sesion').send({ correo, contrasena: CLAVE })
  assert.equal(r.status, 429)
})

test('1.2 una cuenta bloqueada no puede ingresar (403)', async () => {
  const r = await anonimo(app)
    .post('/api/cuentas/sesion')
    .send({ correo: 'atorres@aloe.ulima.edu.pe', contrasena: CLAVE })
  assert.equal(r.status, 403)
  assert.equal(r.body.tipo, 'bloqueada')
})

test('1.3 registro de estudiante: valida en el servidor (422) y no repite correos (409)', async () => {
  const invalido = await anonimo(app).post('/api/cuentas/estudiantes').send({ nombres: 'A' })
  assert.equal(invalido.status, 422)
  assert.ok(invalido.body.errores.correo)

  const datos = {
    nombres: 'Valeria',
    apellidos: 'Gómez Ruiz',
    correo: 'vgomez@aloe.ulima.edu.pe',
    carrera: 'Ingeniería de Sistemas',
    ciclo: 4,
    contrasena: 'Segura2026!',
    confirmarContrasena: 'Segura2026!',
    aceptaReglamento: true,
  }
  const r = await anonimo(app).post('/api/cuentas/estudiantes').send(datos)
  assert.equal(r.status, 201, r.body.mensaje)
  assert.equal(r.body.usuario.estado, 'por_verificar')

  const repetido = await anonimo(app).post('/api/cuentas/estudiantes').send(datos)
  assert.equal(repetido.status, 409)

  // Sin verificar no entra; con el enlace sí.
  const antes = await anonimo(app)
    .post('/api/cuentas/sesion')
    .send({ correo: datos.correo, contrasena: datos.contrasena })
  assert.equal(antes.status, 403)
  const token = new URL(r.body.enlacePrueba, 'http://x').searchParams.get('token')
  const verificado = await anonimo(app).post('/api/cuentas/verificacion').send({ token })
  assert.equal(verificado.body.estado, 'activo')
  const despues = await anonimo(app)
    .post('/api/cuentas/sesion')
    .send({ correo: datos.correo, contrasena: datos.contrasena })
  assert.equal(despues.status, 200)
})

test('1.5 recuperación: el enlace sirve una sola vez', async () => {
  const r = await anonimo(app)
    .post('/api/cuentas/recuperacion')
    .send({ correo: 'srojas@aloe.ulima.edu.pe' })
  const token = new URL(r.body.enlacePrueba, 'http://x').searchParams.get('token')
  const cambio = await anonimo(app)
    .post(`/api/cuentas/recuperacion/${token}`)
    .send({ nueva: 'Nueva2026!', confirmar: 'Nueva2026!' })
  assert.equal(cambio.status, 200, cambio.body.mensaje)
  const otraVez = await anonimo(app)
    .post(`/api/cuentas/recuperacion/${token}`)
    .send({ nueva: 'Otra2026!', confirmar: 'Otra2026!' })
  assert.equal(otraVez.status, 410)
})

test('1.6 mi cuenta: sin sesión 401; con sesión se edita el perfil', async () => {
  assert.equal((await anonimo(app).get('/api/cuentas/yo')).status, 401)
  const yo = await como(app, 'mchavez@aloe.ulima.edu.pe')
  const r = await yo.patch('/api/cuentas/yo').send({
    nombres: 'María José',
    apellidos: 'Chávez Ríos',
    celular: '987 654 321',
    carrera: yo.usuario.carrera,
    ciclo: yo.usuario.ciclo,
  })
  assert.equal(r.status, 200, r.body.mensaje)
  assert.equal(r.body.celular, '987654321')
})

test('un estudiante no puede listar usuarios (403)', async () => {
  const estudiante = await como(app, 'floayza@aloe.ulima.edu.pe')
  assert.equal((await estudiante.get('/api/cuentas/usuarios')).status, 403)
})
