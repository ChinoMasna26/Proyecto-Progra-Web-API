/** Utilidades compartidas por los servicios. */

/** Siguiente id con prefijo, p. ej. EQ-011 o SOL-0402, a partir del mayor que existe. */
export function siguienteIdDe(ids, prefijo, ancho) {
  const numeros = ids.map((id) => Number(String(id).split('-').at(-1))).filter(Number.isFinite)
  const siguiente = (numeros.length ? Math.max(...numeros) : 0) + 1
  return `${prefijo}-${String(siguiente).padStart(ancho, '0')}`
}

/** Solo los campos permitidos de un objeto (lista blanca para las actualizaciones). */
export function soloCampos(objeto, permitidos) {
  return Object.fromEntries(Object.entries(objeto).filter(([campo]) => permitidos.includes(campo)))
}

export const ahora = () => new Date().toISOString()

export const normalizar = (texto) =>
  String(texto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
