/**
 * HU-1 · Reglas de cuenta y acceso. Es la misma lógica de la primera entrega, ahora en el
 * servidor: las validaciones se repiten aquí (no se confía en el cliente) y la contraseña
 * se guarda con bcrypt. La HU-1 es dueña del usuario: las demás historias lo leen con
 * `listarUsuariosPublicos` y la HU-5 guarda la deuda con `establecerDeuda`.
 */
import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { ErrorHttp, exigirValido } from '../../comun/errores.js'
import { ahora } from '../../comun/filas.js'
import { firmarToken, usuarioPublico } from '../../comun/sesion.js'
import * as solicitudes from '../../comun/solicitudes.repositorio.js'
import { formatearSoles } from '../../dominio/catalogos.js'
import {
  HORAS_ENLACE_VERIFICACION,
  INTENTOS_MAXIMOS,
  MINUTOS_BLOQUEO_TEMPORAL,
  MINUTOS_ENLACE_RECUPERACION,
  normalizarCorreo,
  validarCambioContrasena,
  validarCorreoInstitucional,
  validarInicioSesion,
  validarPerfil,
  validarRegistroEncargado,
  validarRegistroEstudiante,
  validarRestablecer,
} from '../../dominio/cuentas.js'
import { hoyISO } from '../../dominio/solicitudes.js'
import * as repo from './cuentas.repositorio.js'

const RONDAS_BCRYPT = 10
const cifrar = (contrasena) => bcrypt.hash(contrasena, RONDAS_BCRYPT)

async function siguienteId(rol) {
  const base = rol === 'encargado' ? 100 : 200
  const numeros = (await repo.idsPorRol(rol))
    .map((id) => Number(String(id).split('-')[1]))
    .filter(Number.isFinite)
  return `US-${(numeros.length ? Math.max(...numeros) : base) + 1}`
}

async function crearEnlace(usuarioId, tipo, minutos) {
  const token = randomBytes(12).toString('hex')
  await repo.guardarToken({
    token,
    tipo,
    usuarioId,
    expira: new Date(Date.now() + minutos * 60000).toISOString(),
  })
  return token
}

async function tomarEnlace(token, tipo) {
  const registro = await repo.buscarToken(String(token ?? ''), tipo)
  if (!registro || Date.parse(registro.expira) < Date.now())
    throw new ErrorHttp('El enlace no es válido o ya expiró. Solicita uno nuevo.', 410)
  return registro
}

function avisoDeCuenta(usuario) {
  if (usuario.rol === 'estudiante' && Number(usuario.deudaPendiente) > 0)
    return `Tienes una penalidad pendiente de ${formatearSoles(usuario.deudaPendiente)}. Puedes ingresar para ver tu historial, pero no solicitar equipos hasta regularizar en Tesorería.`
  if (usuario.estado === 'pendiente_aprobacion')
    return 'Tu alta de encargado está pendiente de aprobación. Hasta entonces no podrás aprobar solicitudes ni registrar entregas.'
  return null
}

// --------------------------------------------------------------------- sesión

/** Vista 1.2. Cinco intentos fallidos bloquean el correo por 15 minutos. */
export async function iniciarSesion({ correo, contrasena }) {
  exigirValido(validarInicioSesion({ correo, contrasena }))

  const clave = normalizarCorreo(correo)
  const registro = await repo.leerIntentos(clave)
  if (registro.bloqueadoHasta && Date.parse(registro.bloqueadoHasta) > Date.now()) {
    const minutos = Math.ceil((Date.parse(registro.bloqueadoHasta) - Date.now()) / 60000)
    throw new ErrorHttp(
      `Superaste los ${INTENTOS_MAXIMOS} intentos. Vuelve a intentarlo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} o recupera tu contraseña.`,
      429,
      { tipo: 'bloqueo-temporal' },
    )
  }

  const usuario = await repo.buscarPorCorreo(clave)
  const coincide = usuario && (await bcrypt.compare(String(contrasena), usuario.contrasenaHash))
  if (!coincide) {
    const fallidos = registro.fallidos + 1
    const restantes = Math.max(0, INTENTOS_MAXIMOS - fallidos)
    await repo.guardarIntentos(
      clave,
      restantes === 0
        ? {
            fallidos: 0,
            bloqueadoHasta: new Date(Date.now() + MINUTOS_BLOQUEO_TEMPORAL * 60000).toISOString(),
          }
        : { fallidos, bloqueadoHasta: null },
    )
    throw new ErrorHttp(
      restantes === 0
        ? `Correo o contraseña incorrectos. Bloqueamos el acceso por ${MINUTOS_BLOQUEO_TEMPORAL} minutos.`
        : `Correo o contraseña incorrectos. Te ${restantes === 1 ? 'queda 1 intento' : `quedan ${restantes} intentos`}.`,
      401,
      { tipo: 'credenciales', intentosRestantes: restantes },
    )
  }

  await repo.borrarIntentos(clave)

  if (usuario.estado === 'bloqueado')
    throw new ErrorHttp(
      `Tu cuenta está bloqueada${usuario.motivoBloqueo ? `: ${usuario.motivoBloqueo.replace(/\.$/, '')}` : ''}. Escribe a almacen.equipos@ulima.edu.pe para regularizarla.`,
      403,
      { tipo: 'bloqueada' },
    )
  if (usuario.estado === 'por_verificar')
    throw new ErrorHttp(
      'Tu cuenta aún no está activa. Abre el enlace de verificación que enviamos a tu correo.',
      403,
      { tipo: 'por-verificar' },
    )

  return {
    usuario: usuarioPublico(usuario),
    aviso: avisoDeCuenta(usuario),
    token: firmarToken(usuario),
  }
}

// ------------------------------------------------------------------- registro

async function crearCuenta(datos, rol, estado, extra) {
  const correo = normalizarCorreo(datos.correo)
  if (await repo.buscarPorCorreo(correo))
    throw new ErrorHttp(`Ya existe una cuenta con el correo ${correo}.`, 409, { tipo: 'duplicado' })

  return repo.insertar({
    id: await siguienteId(rol),
    rol,
    nombres: datos.nombres.trim(),
    apellidos: datos.apellidos.trim(),
    correo,
    estado,
    contrasenaHash: await cifrar(datos.contrasena),
    ...extra,
  })
}

/** Vista 1.3: la cuenta queda «por verificar» hasta abrir el enlace del correo. */
export async function registrarEstudiante(datos) {
  exigirValido(validarRegistroEstudiante(datos), 'Revisa los campos marcados.')
  const usuario = await crearCuenta(datos, 'estudiante', 'por_verificar', {
    codigo: datos.codigo ? String(datos.codigo).trim() : null,
    carrera: datos.carrera,
    ciclo: Number(datos.ciclo),
    celular: '',
    deudaPendiente: 0,
  })
  // No hay servidor de correo en el alcance: se devuelve el enlace que llegaría por correo.
  const token = await crearEnlace(usuario.id, 'verificacion', HORAS_ENLACE_VERIFICACION * 60)
  return { usuario: usuarioPublico(usuario), enlacePrueba: `/verificar?token=${token}` }
}

/** Vista 1.4: el alta queda pendiente hasta que la apruebe el jefe de laboratorio. */
export async function registrarEncargado(datos) {
  exigirValido(validarRegistroEncargado(datos), 'Revisa los campos marcados.')
  const usuario = await crearCuenta(datos, 'encargado', 'pendiente_aprobacion', {
    almacenAsignado: datos.almacenAsignado,
    anexo: String(datos.anexo).trim(),
  })
  return { usuario: usuarioPublico(usuario) }
}

/** Abrir el enlace dos veces no es un error: la segunda vez la cuenta ya está activa. */
export async function verificarCuenta(token) {
  const registro = await tomarEnlace(token, 'verificacion')
  let usuario = await repo.buscarPorId(registro.usuarioId)
  if (!usuario) throw new ErrorHttp('La cuenta ya no existe.', 404)
  if (usuario.estado === 'por_verificar')
    usuario = await repo.actualizar(usuario.id, { estado: 'activo' })
  return usuarioPublico(usuario)
}

// --------------------------------------------------------------- recuperación

/** Vista 1.5, paso 1. Responde igual exista o no la cuenta (no revela qué correos hay). */
export async function solicitarRecuperacion(correo) {
  const error = validarCorreoInstitucional(correo)
  if (error) throw new ErrorHttp(error, 422, { errores: { correo: error } })
  const usuario = await repo.buscarPorCorreo(normalizarCorreo(correo))
  if (!usuario) return { enviado: true, enlacePrueba: null }
  const token = await crearEnlace(usuario.id, 'recuperacion', MINUTOS_ENLACE_RECUPERACION)
  return { enviado: true, enlacePrueba: `/restablecer?token=${token}` }
}

export async function revisarEnlaceRecuperacion(token) {
  const registro = await tomarEnlace(token, 'recuperacion')
  const usuario = await repo.buscarPorId(registro.usuarioId)
  if (!usuario) throw new ErrorHttp('La cuenta ya no existe.', 404)
  return { correo: usuario.correo }
}

/** Vista 1.5, paso 3. El enlace sirve una sola vez. */
export async function restablecerContrasena(token, datos) {
  exigirValido(validarRestablecer(datos), 'Revisa los campos marcados.')
  const registro = await tomarEnlace(token, 'recuperacion')
  const usuario = await repo.buscarPorId(registro.usuarioId)
  if (!usuario) throw new ErrorHttp('La cuenta ya no existe.', 404)
  await repo.actualizar(usuario.id, { contrasenaHash: await cifrar(datos.nueva) })
  await repo.borrarToken(registro.token)
  await repo.borrarIntentos(normalizarCorreo(usuario.correo))
  return { correo: usuario.correo }
}

// ------------------------------------------------------------------ mi cuenta

export async function obtenerUsuario(id) {
  const usuario = await repo.buscarPorId(id)
  if (!usuario) throw new ErrorHttp('Tu sesión expiró. Vuelve a iniciar sesión.', 401)
  return usuarioPublico(usuario)
}

/** Vista 1.6. Solo se cambian los campos que el usuario puede editar; el correo no. */
export async function actualizarPerfil(usuarioId, datos) {
  const usuario = await repo.buscarPorId(usuarioId)
  if (!usuario) throw new ErrorHttp('Tu sesión expiró. Vuelve a iniciar sesión.', 401)
  exigirValido(validarPerfil(datos, usuario.rol), 'Revisa los campos marcados.')

  const cambios = {
    nombres: datos.nombres.trim(),
    apellidos: datos.apellidos.trim(),
    celular: String(datos.celular ?? '').replace(/\s/g, ''),
    actualizadoEn: ahora(),
  }
  if (usuario.rol === 'estudiante') {
    cambios.carrera = datos.carrera
    cambios.ciclo = Number(datos.ciclo)
  } else {
    cambios.anexo = String(datos.anexo).trim()
  }
  return usuarioPublico(await repo.actualizar(usuarioId, cambios))
}

export async function cambiarContrasena(usuarioId, datos) {
  exigirValido(validarCambioContrasena(datos), 'Revisa los campos marcados.')
  const usuario = await repo.buscarPorId(usuarioId)
  if (!usuario) throw new ErrorHttp('Tu sesión expiró. Vuelve a iniciar sesión.', 401)
  if (!(await bcrypt.compare(String(datos.actual), usuario.contrasenaHash)))
    throw new ErrorHttp('La contraseña actual no es correcta.', 401, {
      errores: { actual: 'La contraseña actual no es correcta.' },
    })
  await repo.actualizar(usuarioId, { contrasenaHash: await cifrar(datos.nueva) })
  return { ok: true }
}

/** Resumen de la vista 1.6. Lee las solicitudes (HU-3/HU-4) sin modificarlas. */
export async function obtenerResumenPrestamos(usuarioId) {
  const usuario = await repo.buscarPorId(usuarioId)
  const hoy = hoyISO()
  const suyas = await solicitudes.listarDeEstudiante(usuarioId)
  const prestamos = suyas.filter((s) => ['en_prestamo', 'devuelta'].includes(s.estado))
  const retrasos = prestamos.filter((s) =>
    s.estado === 'en_prestamo'
      ? s.fechaFin < hoy
      : s.fechaDevolucionReal && s.fechaDevolucionReal.slice(0, 10) > s.fechaFin,
  ).length
  return { prestamos: prestamos.length, retrasos, deuda: Number(usuario?.deudaPendiente) || 0 }
}

// --------------------------------------------------- lectura para otras historias

/** Datos que otras historias pueden mostrar: sin contraseña ni datos de acceso. */
export async function listarUsuariosPublicos() {
  return (await repo.listar()).map(usuarioPublico)
}

/**
 * La deuda la calcula la HU-5 (suma de penalidades pendientes) y la guarda aquí, porque el
 * usuario es de la HU-1. Acepta el cliente de una transacción para guardarse junto con ella.
 */
export async function establecerDeuda(usuarioId, monto, db) {
  const usuario = await repo.actualizar(
    usuarioId,
    { deudaPendiente: Math.max(0, Number(monto) || 0) },
    db,
  )
  if (!usuario) throw new ErrorHttp('No encontramos al estudiante.', 404)
  return usuarioPublico(usuario)
}
