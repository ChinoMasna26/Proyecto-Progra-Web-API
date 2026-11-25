/**
 * Errores de la API. Cada servicio lanza un ErrorHttp con el código que corresponde
 * (enunciado §7) y este middleware lo convierte en la respuesta JSON.
 *
 *   400 petición mal formada · 401 sin sesión · 403 sin permiso · 404 no existe
 *   409 conflicto con el estado actual · 410 enlace vencido · 422 datos inválidos
 *   429 demasiados intentos · 500 error inesperado
 */
export class ErrorHttp extends Error {
  constructor(mensaje, estado = 400, extra = {}) {
    super(mensaje)
    this.name = 'ErrorHttp'
    this.estado = estado
    this.extra = extra
  }
}

/** Si el dominio devolvió errores de validación, corta con un 422 que los incluye. */
export function exigirValido(errores, mensaje) {
  const campos = Object.keys(errores ?? {})
  if (campos.length) throw new ErrorHttp(mensaje ?? errores[campos[0]], 422, { errores })
}

export function rutaNoEncontrada(req, _res, next) {
  next(new ErrorHttp(`No existe la ruta ${req.method} ${req.originalUrl}.`, 404))
}

// eslint-disable-next-line no-unused-vars
export function manejarErrores(error, _req, res, _next) {
  if (error instanceof ErrorHttp)
    return res.status(error.estado).json({ mensaje: error.message, ...error.extra })

  // Errores de Sequelize que se escaparon de la validación del servicio.
  if (error.name === 'SequelizeUniqueConstraintError')
    return res.status(409).json({ mensaje: 'Ya existe un registro con esos datos.' })
  if (
    error.name === 'SequelizeForeignKeyConstraintError' ||
    error.name === 'SequelizeValidationError' ||
    error.original?.code === '23514'
  )
    return res.status(422).json({ mensaje: 'Los datos no cumplen las reglas del sistema.' })
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ mensaje: 'El cuerpo de la petición no es un JSON válido.' })
  if (error.type === 'entity.too.large')
    return res.status(413).json({ mensaje: 'La petición es demasiado grande (fotos muy pesadas).' })

  console.error(error)
  return res.status(500).json({ mensaje: 'Ocurrió un error inesperado en el servidor.' })
}
