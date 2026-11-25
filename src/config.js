/**
 * Configuración del servidor. Todo lo sensible (cadena de conexión, secreto de los tokens)
 * llega por variables de entorno: el repositorio no guarda credenciales (enunciado §7).
 */
import 'dotenv/config'

// Las fechas del negocio («hoy», «vence mañana») se calculan en hora de Lima.
process.env.TZ = process.env.TZ || 'America/Lima'

function requerida(nombre) {
  const valor = process.env[nombre]
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}. Revisa tu archivo .env.`)
  return valor
}

/**
 * Neon entrega la cadena con «&channel_binding=require», que el driver pg no necesita.
 * Se quita aquí para que funcione tal cual se copia del panel.
 */
function limpiarCadena(cadena) {
  try {
    const url = new URL(cadena)
    url.searchParams.delete('channel_binding')
    return url.toString()
  } catch {
    return cadena
  }
}

export const config = {
  puerto: Number(process.env.PUERTO) || 3000,
  baseDatos: limpiarCadena(requerida('DATABASE_URL')),
  secretoToken: requerida('JWT_SECRETO'),
  duracionToken: process.env.JWT_DURACION || '8h',
  // Orígenes del frontend que pueden llamar a la API (separados por coma).
  origenes: (process.env.ORIGEN_FRONT || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Neon y otras nubes exigen SSL; en local normalmente no.
  ssl: process.env.DB_SSL === 'true' || /sslmode=require/.test(process.env.DATABASE_URL ?? ''),
}
