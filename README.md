# API del Almacén de Equipos

API REST del sistema de préstamo de equipos de laboratorio (Programación Web, Universidad de
Lima). Node.js + Express + Sequelize (ORM) + PostgreSQL. La interfaz web está en su propio
repositorio y consume esta API.

## Puesta en marcha (local)

```bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
npm run db:preparar         # crea las tablas (sequelize.sync) y carga los datos de prueba
npm run dev                 # http://localhost:3000/api
npm test                    # pruebas de la API (recargan los datos de prueba)
```

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Cadena de conexión de PostgreSQL en la nube (Neon) |
| `JWT_SECRETO` | Texto largo y aleatorio para firmar los tokens de sesión |
| `ORIGEN_FRONT` | Dirección de la web que puede llamar a la API (CORS), p. ej. la de Vercel |
| `DATABASE_URL_PRUEBAS` | Opcional: otra base para `npm test`, así no se borran tus datos |
| `PUERTO` | Opcional, por defecto 3000 (solo en local) |

## Despliegue en Vercel

`api/index.js` exporta la app de Express como función y `vercel.json` le manda todas las
rutas. En Vercel: importar el repositorio, Framework Preset **Other**, y en Environment
Variables `DATABASE_URL`, `JWT_SECRETO` y `ORIGEN_FRONT`. Los datos se cargan una vez desde
una computadora con `npm run db:preparar` apuntando a la misma `DATABASE_URL`.

## Organización por capas

```
api/index.js                 entrada en Vercel
src/app.js · servidor.js     Express (CORS, JSON, sesión, módulos, errores) · servidor local
src/config.js                variables de entorno
src/db/sequelize.js          conexión (Sequelize) y transacciones
src/db/modelos.js            modelos y asociaciones (hasMany / belongsTo)
src/db/preparar.js           sync + carga de los datos de prueba (datos/*.json)
src/comun/                   errores HTTP, sesión con JWT, repositorio compartido de solicitudes
src/dominio/                 reglas del negocio (las mismas funciones que valida el formulario)
src/modulos/huN-*/           una carpeta por historia:
    *.rutas.js               URL, verbo HTTP y permiso
    *.controlador.js         lee la petición y responde (sin acceso a datos)
    *.servicio.js            reglas y validaciones
    *.repositorio.js         consultas con los modelos de Sequelize
```

Cada historia es dueña de sus modelos y es la única que escribe en ellos. Si necesita datos
de otra, llama al **servicio** de esa historia (por ejemplo, la HU-4 marca la unidad como
prestada con `cambiarEstadoUnidad` de la HU-2, dentro de su transacción).

## Modelos

| Modelo (tabla) | Historia | Relaciones |
|---|---|---|
| Usuario (`usuarios`) | HU-1 | hasMany TokenCuenta, Solicitud, Reserva |
| TokenCuenta, IntentoAcceso | HU-1 | TokenCuenta belongsTo Usuario |
| Categoria (`categorias`) | HU-2 | hasMany Equipo |
| Equipo (`equipos`) | HU-2 | belongsTo Categoria · hasMany Unidad |
| Unidad (`unidades`) | HU-2 | belongsTo Equipo · hasMany HistorialEstado |
| HistorialEstado | HU-2 | belongsTo Unidad |
| Solicitud (`solicitudes`) | HU-3 / HU-4 / HU-5 | belongsTo Usuario · hasMany Renovacion |
| Renovacion | HU-5 | belongsTo Solicitud |
| Reserva (`reservas`) | HU-6 | belongsTo Usuario |

## Códigos HTTP

`200` correcto · `201` creado · `401` sin sesión · `403` sin permiso · `404` no existe ·
`409` choca con el estado actual · `410` enlace vencido · `422` datos inválidos (con
`errores` por campo) · `429` demasiados intentos · `500` error inesperado.

## Servicios

La sesión va en la cabecera `Authorization: Bearer <token>` (la devuelve `POST /api/cuentas/sesion`).

### HU-1 · Cuenta y acceso — `/api/cuentas`
| Verbo | Ruta | Permiso |
|---|---|---|
| POST | `/sesion` · `/estudiantes` · `/encargados` · `/verificacion` · `/recuperacion` | público |
| GET · POST | `/recuperacion/:token` | público |
| GET · PATCH | `/yo` | sesión |
| PUT | `/yo/contrasena` | sesión |
| GET | `/yo/resumen-prestamos` | sesión |
| GET | `/usuarios` | encargado |

### HU-2 · Inventario — `/api/inventario`
| Verbo | Ruta | Permiso |
|---|---|---|
| GET | `/equipos`, `/equipos/:id`, `/resumen`, `/claves`, `/codigos` | encargado |
| POST · PUT · DELETE | `/equipos`, `/equipos/:id` | encargado |
| PUT | `/equipos/:id/condiciones` | encargado |
| POST | `/equipos/:id/unidades` | encargado |
| PUT · DELETE | `/unidades/:id` | encargado |
| PATCH | `/unidades/:id/estado` | encargado |
| GET | `/publico/equipos/:id`, `/categorias`, `/con-unidades` | público |

### HU-3 · Catálogo y solicitud — `/api/catalogo`
| Verbo | Ruta | Permiso |
|---|---|---|
| GET | `/equipos`, `/equipos/:id`, `/equipos/:id/disponibilidad` | público |
| GET | `/solicitudes/mias` | estudiante |
| POST | `/solicitudes`, `/solicitudes/:id/retiro` | estudiante |

### HU-4 · Aprobación y entrega — `/api/prestamos`
| Verbo | Ruta | Permiso |
|---|---|---|
| GET | `/bandeja`, `/contadores`, `/vigentes` | encargado |
| GET · POST | `/solicitudes/:id/aprobacion` | encargado / encargado activo |
| POST | `/solicitudes/:id/rechazo` | encargado activo |
| GET · POST | `/solicitudes/:id/entrega` | encargado / encargado activo |
| GET | `/constancias/:codigo` | sesión |

### HU-5 · Devoluciones — `/api/devoluciones`
| Verbo | Ruta | Permiso |
|---|---|---|
| GET | `/por-devolver`, `/prestamos/:codigo` | encargado |
| POST | `/prestamos/:codigo/devolucion` | encargado activo |
| GET · POST | `/prestamos/:codigo/renovacion` | encargado / encargado activo |
| GET | `/estudiantes/:id/historial` | sesión |
| POST | `/estudiantes/:id/pago` | encargado activo |

### HU-6 · Reservas — `/api/reservas`
| Verbo | Ruta | Permiso |
|---|---|---|
| GET | `/equipos`, `/ocupacion`, `/mias` | sesión |
| GET | `/espera/mias` | estudiante |
| GET | `/espera` | encargado |
| POST | `/`, `/:id/cancelacion` | estudiante |
| POST | `/conversiones` | sesión |
