/**
 * Modelos de Sequelize: el «contrato de datos» del grupo (datos/CONTRATO-DATOS.md) como
 * tablas de PostgreSQL. Cada modelo tiene una historia dueña, la única que escribe en él:
 *
 *   HU-1  Usuario, TokenCuenta, IntentoAcceso
 *   HU-2  Categoria, Equipo, Unidad, HistorialEstado
 *   HU-3  Solicitud (la crea y la retira; la HU-4 y la HU-5 escriben sus propios campos)
 *   HU-5  Renovacion
 *   HU-6  Reserva
 *
 * Las propiedades van en camelCase (codigoInventario) y las columnas en snake_case
 * (codigo_inventario) gracias a `underscored: true`.
 */
import { DataTypes } from 'sequelize'
import { sequelize } from './sequelize.js'

const { STRING, TEXT, INTEGER, BOOLEAN, DATE, DATEONLY, DECIMAL, JSONB } = DataTypes
const opciones = (tabla) => ({ tableName: tabla, underscored: true, timestamps: false })

// Marca de tiempo que se devuelve como texto ISO 8601 (lo que ya usaba el frontend).
const fechaHora = (campo, extra = {}) => ({
  type: DATE,
  ...extra,
  get() {
    const valor = this.getDataValue(campo)
    return valor ? new Date(valor).toISOString() : valor
  },
})

// Montos en soles: PostgreSQL los guarda exactos (DECIMAL) y se devuelven como número.
const soles = (campo, extra = {}) => ({
  type: DECIMAL(10, 2),
  ...extra,
  get() {
    const valor = this.getDataValue(campo)
    return valor === null || valor === undefined ? valor : Number(valor)
  },
})

const unoDe = (...valores) => ({ isIn: [valores] })

// ------------------------------------------------------------------ HU-1: cuentas

export const Usuario = sequelize.define(
  'Usuario',
  {
    id: { type: STRING, primaryKey: true }, //               US-101, US-201…
    rol: { type: STRING, allowNull: false, validate: unoDe('estudiante', 'encargado') },
    nombres: { type: STRING, allowNull: false },
    apellidos: { type: STRING, allowNull: false },
    correo: { type: STRING, allowNull: false, unique: true },
    estado: {
      type: STRING,
      allowNull: false,
      validate: unoDe('activo', 'por_verificar', 'pendiente_aprobacion', 'bloqueado'),
    },
    contrasenaHash: { type: STRING, allowNull: false }, //  bcrypt, nunca texto plano
    codigo: STRING,
    carrera: STRING,
    ciclo: INTEGER,
    celular: { type: STRING, allowNull: false, defaultValue: '' },
    deudaPendiente: soles('deudaPendiente', { allowNull: false, defaultValue: 0 }),
    almacenAsignado: STRING,
    anexo: STRING,
    motivoBloqueo: STRING,
    creadoEn: fechaHora('creadoEn', { allowNull: false, defaultValue: DataTypes.NOW }),
    actualizadoEn: fechaHora('actualizadoEn'),
  },
  opciones('usuarios'),
)

export const TokenCuenta = sequelize.define(
  'TokenCuenta',
  {
    token: { type: STRING, primaryKey: true },
    tipo: { type: STRING, allowNull: false, validate: unoDe('verificacion', 'recuperacion') },
    usuarioId: { type: STRING, allowNull: false },
    expira: fechaHora('expira', { allowNull: false }),
  },
  opciones('tokens_cuenta'),
)

export const IntentoAcceso = sequelize.define(
  'IntentoAcceso',
  {
    correo: { type: STRING, primaryKey: true },
    fallidos: { type: INTEGER, allowNull: false, defaultValue: 0 },
    bloqueadoHasta: fechaHora('bloqueadoHasta'),
  },
  opciones('intentos_acceso'),
)

// --------------------------------------------------------------- HU-2: inventario

export const Categoria = sequelize.define(
  'Categoria',
  {
    id: { type: STRING, primaryKey: true }, //               medicion, audiovisual…
    nombre: { type: STRING, allowNull: false, unique: true },
  },
  opciones('categorias'),
)

export const Equipo = sequelize.define(
  'Equipo',
  {
    id: { type: STRING, primaryKey: true }, //               EQ-001
    nombre: { type: STRING, allowNull: false },
    marca: { type: STRING, allowNull: false },
    modelo: { type: STRING, allowNull: false },
    categoria: { type: STRING, allowNull: false }, //        llave foránea a categorias
    descripcion: { type: TEXT, allowNull: false, defaultValue: '' },
    fotografias: { type: JSONB, allowNull: false, defaultValue: [] }, // [{ url, alt }]
    accesorios: { type: JSONB, allowNull: false, defaultValue: [] },
    duracionMaximaDias: { type: INTEGER, allowNull: false, validate: { min: 1, max: 90 } },
    requiereAutorizacion: { type: BOOLEAN, allowNull: false, defaultValue: false },
    admiteRenovacion: { type: BOOLEAN, allowNull: false, defaultValue: false },
    penalidadPorDia: soles('penalidadPorDia', {
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0, max: 500 },
    }),
    esBorrador: { type: BOOLEAN, allowNull: false, defaultValue: false },
    creadoEn: fechaHora('creadoEn', { allowNull: false, defaultValue: DataTypes.NOW }),
    actualizadoEn: fechaHora('actualizadoEn', { allowNull: false, defaultValue: DataTypes.NOW }),
  },
  opciones('equipos'),
)
// Marca + modelo identifican al equipo sin distinguir mayúsculas.
Equipo.afterSync(() =>
  sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS equipos_marca_modelo ON equipos (lower(marca), lower(modelo))',
  ),
)

export const Unidad = sequelize.define(
  'Unidad',
  {
    id: { type: STRING, primaryKey: true }, //               UN-0001
    equipoId: { type: STRING, allowNull: false },
    codigoInventario: { type: STRING, allowNull: false, unique: true }, // INV-OSC-0042
    ubicacion: { type: STRING, allowNull: false },
    observaciones: { type: TEXT, allowNull: false, defaultValue: '' },
    estado: {
      type: STRING,
      allowNull: false,
      validate: unoDe('disponible', 'prestada', 'mantenimiento', 'baja'),
    },
    prestamoVigente: STRING, //                              código del préstamo (HU-4)
  },
  opciones('unidades'),
)

export const HistorialEstado = sequelize.define(
  'HistorialEstado',
  {
    id: { type: INTEGER, primaryKey: true, autoIncrement: true },
    unidadId: { type: STRING, allowNull: false },
    de: STRING, //                                           null = alta de la unidad
    a: { type: STRING, allowNull: false },
    motivo: { type: TEXT, allowNull: false },
    fecha: fechaHora('fecha', { allowNull: false, defaultValue: DataTypes.NOW }),
    usuarioId: STRING,
  },
  opciones('historial_estados'),
)

// ------------------------------------------------- HU-3, HU-4, HU-5: solicitudes

// equipoId y unidadId no son llaves foráneas a propósito: si un equipo se elimina del
// inventario, el historial de préstamos se conserva («Equipo retirado del inventario»).
export const Solicitud = sequelize.define(
  'Solicitud',
  {
    id: { type: STRING, primaryKey: true }, //               SOL-0001
    estudianteId: { type: STRING, allowNull: false },
    equipoId: { type: STRING, allowNull: false },
    unidadId: STRING,
    reservaId: STRING, //                                    si nació de una reserva (HU-6)
    fechaInicio: { type: DATEONLY, allowNull: false },
    fechaFin: { type: DATEONLY, allowNull: false },
    curso: { type: STRING, allowNull: false, defaultValue: '' },
    motivo: { type: TEXT, allowNull: false },
    estado: {
      type: STRING,
      allowNull: false,
      validate: unoDe('pendiente', 'aprobada', 'rechazada', 'retirada', 'en_prestamo', 'devuelta'),
    },
    creadaEn: fechaHora('creadaEn', { allowNull: false, defaultValue: DataTypes.NOW }),
    // HU-4: aprobación, rechazo y entrega
    motivoRechazo: { type: TEXT, allowNull: false, defaultValue: '' },
    resueltaEn: fechaHora('resueltaEn'),
    resueltaPor: STRING,
    codigoPrestamo: { type: STRING, unique: true }, //       PRE-2026-0318
    fechaEntregaReal: fechaHora('fechaEntregaReal'),
    accesoriosEntregados: JSONB,
    detalleAccesorios: JSONB, //                             [{ nombre, entregado, nota }]
    observacionesEntrega: TEXT,
    entregadaPor: STRING,
    // HU-5: devolución y penalidad
    fechaDevolucionReal: DATEONLY,
    estadoRetorno: STRING,
    accesoriosDevueltos: JSONB,
    accesoriosFaltantes: JSONB,
    descripcionDano: TEXT,
    fotoDano: TEXT,
    derivadaMantenimiento: BOOLEAN,
    observacionesDevolucion: TEXT,
    diasRetraso: INTEGER,
    recibidaPor: STRING,
    devueltaEn: fechaHora('devueltaEn'),
    penalidadMonto: soles('penalidadMonto'),
    penalidadEstado: { type: STRING, validate: unoDe('pendiente', 'pagada') },
    penalidadCalculadaEn: fechaHora('penalidadCalculadaEn'),
    penalidadPagadaEn: fechaHora('penalidadPagadaEn'),
    penalidadRecibidoPor: STRING,
  },
  {
    ...opciones('solicitudes'),
    validate: {
      fechasEnOrden() {
        if (this.fechaFin < this.fechaInicio)
          throw new Error('La fecha de fin no puede ser anterior a la de inicio.')
      },
    },
  },
)

export const Renovacion = sequelize.define(
  'Renovacion',
  {
    id: { type: INTEGER, primaryKey: true, autoIncrement: true },
    solicitudId: { type: STRING, allowNull: false },
    fechaFinAnterior: { type: DATEONLY, allowNull: false },
    fechaFinNueva: { type: DATEONLY, allowNull: false },
    dias: { type: INTEGER, allowNull: false },
    fecha: fechaHora('fecha', { allowNull: false, defaultValue: DataTypes.NOW }),
    por: STRING,
  },
  opciones('renovaciones'),
)

// ----------------------------------------------------------------- HU-6: reservas

export const Reserva = sequelize.define(
  'Reserva',
  {
    id: { type: STRING, primaryKey: true }, //               RES-0001
    equipoId: { type: STRING, allowNull: false },
    unidadId: STRING, //                                     null mientras está en espera
    usuarioId: { type: STRING, allowNull: false },
    fechaInicio: { type: DATEONLY, allowNull: false },
    fechaFin: { type: DATEONLY, allowNull: false },
    motivo: { type: TEXT, allowNull: false },
    estado: {
      type: STRING,
      allowNull: false,
      validate: unoDe('confirmada', 'en_espera', 'convertida', 'cancelada'),
    },
    solicitudId: STRING,
    creadaEn: fechaHora('creadaEn', { allowNull: false, defaultValue: DataTypes.NOW }),
    actualizadaEn: fechaHora('actualizadaEn', { allowNull: false, defaultValue: DataTypes.NOW }),
  },
  opciones('reservas'),
)

// ------------------------------------------------------------------ asociaciones

Usuario.hasMany(TokenCuenta, { foreignKey: 'usuarioId', onDelete: 'CASCADE' })
TokenCuenta.belongsTo(Usuario, { foreignKey: 'usuarioId' })

Categoria.hasMany(Equipo, { foreignKey: 'categoria', as: 'equipos' })
Equipo.belongsTo(Categoria, { foreignKey: 'categoria', as: 'categoriaDetalle' })

Equipo.hasMany(Unidad, { foreignKey: 'equipoId', as: 'unidades', onDelete: 'CASCADE' })
Unidad.belongsTo(Equipo, { foreignKey: 'equipoId', as: 'equipo' })

Unidad.hasMany(HistorialEstado, {
  foreignKey: 'unidadId',
  as: 'historialEstados',
  onDelete: 'CASCADE',
})
HistorialEstado.belongsTo(Unidad, { foreignKey: 'unidadId' })

Usuario.hasMany(Solicitud, { foreignKey: 'estudianteId', as: 'solicitudes' })
Solicitud.belongsTo(Usuario, { foreignKey: 'estudianteId', as: 'estudiante' })

Solicitud.hasMany(Renovacion, {
  foreignKey: 'solicitudId',
  as: 'renovaciones',
  onDelete: 'CASCADE',
})
Renovacion.belongsTo(Solicitud, { foreignKey: 'solicitudId' })

Usuario.hasMany(Reserva, { foreignKey: 'usuarioId', as: 'reservas' })
Reserva.belongsTo(Usuario, { foreignKey: 'usuarioId', as: 'usuario' })

/** Pasa una instancia (o null) a objeto plano, con los getters aplicados. */
export const plano = (instancia) => (instancia ? instancia.get({ plain: true }) : null)
