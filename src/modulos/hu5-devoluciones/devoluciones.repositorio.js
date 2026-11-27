/** HU-5 · Acceso a datos propio de la HU-5 con Sequelize. Modelo: Renovacion. */
import { Renovacion } from '../../db/modelos.js'

export async function agregarRenovacion(r, db) {
  await Renovacion.create(
    {
      solicitudId: r.solicitudId,
      fechaFinAnterior: r.fechaFinAnterior,
      fechaFinNueva: r.fechaFinNueva,
      dias: r.dias,
      por: r.por,
    },
    { transaction: db },
  )
}
