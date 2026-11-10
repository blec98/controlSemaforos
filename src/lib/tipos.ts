// Tipos escritos a mano a partir de la migración. Si el esquema crece, conviene
// reemplazarlos por los generados con `supabase gen types typescript`.

export type Rol = 'ciudadano' | 'operador' | 'analista'
export type Acceso = 'N' | 'E' | 'S' | 'W'
export type Modo = 'fti' | 'adaptive' | 'fixed'
export type Etapa = 'GREEN' | 'YELLOW' | 'ALL_RED'
export type Motivo = 'sin_demanda' | 'verde_maximo' | 'tiempo_fijo' | 'balance_colas' | 'prioridad' | 'cambio_modo'
export type TipoVehiculo = 'auto' | 'camioneta' | 'bus'
export type EstadoIncidencia = 'recibida' | 'en_revision' | 'resuelta'
export type TipoIncidencia = 'luz_apagada' | 'intermitente' | 'tiempo_anomalo' | 'dano_fisico' | 'otro'

export const ACCESOS: Acceso[] = ['N', 'E', 'S', 'W']
export const TIPOS_VEHICULO: TipoVehiculo[] = ['auto', 'camioneta', 'bus']

export type EstadoCruce = {
  cruce_id: string
  modo: Modo
  modo_activo: Modo
  etapa: Etapa
  activos: Acceso[]
  detectados: number[]
  edad_sensor: number
  respaldo: boolean
  motivo_texto: string | null
  reportado_en: string
  recibido_en: string
}

export type EventoFase = {
  id: number
  ocurrido_en: string
  etapa: Etapa
  activos: Acceso[]
  modo_activo: Modo
  respaldo: boolean
  motivo: Motivo | null
}

export type Incidencia = {
  id: string
  cruce_id: string
  tipo: TipoIncidencia
  descripcion: string
  foto_path: string | null
  estado: EstadoIncidencia
  creada_en: string
  actualizada_en: string
}

export type CambioIncidencia = {
  id: number
  estado_anterior: EstadoIncidencia
  estado_nuevo: EstadoIncidencia
  nota: string | null
  responsable_id: string | null
  cambiado_en: string
}

export type PorTipo = { auto: number; camioneta: number; bus: number }

export type Estadisticas = {
  unidad: 'hour' | 'day'
  total: number
  por_acceso: Partial<Record<Acceso, number>>
  por_tipo: Partial<PorTipo>
  serie: ({ periodo: string } & PorTipo)[]
  perfil_horario: ({ hora: number } & PorTipo)[]
  cortes: Partial<Record<Motivo | 'sin_motivo', number>>
}
