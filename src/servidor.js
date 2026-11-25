import { config } from './config.js'
import app from './app.js'

app.listen(config.puerto, () => {
  console.log(`API del Almacén de Equipos en http://localhost:${config.puerto}/api`)
  console.log(`Módulos cargados: ${app.locals.modulos.join(', ') || 'ninguno'}`)
})
