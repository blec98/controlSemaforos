import type { Acceso, Etapa, EstadoIncidencia, Modo, Motivo, TipoIncidencia, TipoVehiculo } from '@/lib/tipos'

// La base guarda los códigos del controlador; la interfaz siempre muestra estas etiquetas.

export const NOMBRE_ACCESO: Record<Acceso, string> = { N: 'Norte', E: 'Oriente', S: 'Sur', W: 'Poniente' }

export const NOMBRE_MODO: Record<Modo, string> = { fti: 'FTI por demanda', adaptive: 'Adaptativo', fixed: 'Tiempo fijo' }

export const NOMBRE_ETAPA: Record<Etapa, string> = { GREEN: 'Verde', YELLOW: 'Amarillo', ALL_RED: 'Todo rojo' }

export const NOMBRE_MOTIVO: Record<Motivo | 'sin_motivo', string> = {
  sin_demanda: 'Sin demanda',
  verde_maximo: 'Verde máximo',
  tiempo_fijo: 'Tiempo fijo',
  balance_colas: 'Balance de colas',
  prioridad: 'Prioridad',
  cambio_modo: 'Cambio de modo',
  sin_motivo: 'Sin motivo informado',
}

export const NOMBRE_TIPO_VEHICULO: Record<TipoVehiculo, string> = { auto: 'Auto', camioneta: 'Camioneta', bus: 'Bus' }

export const NOMBRE_ESTADO_INCIDENCIA: Record<EstadoIncidencia, string> = {
  recibida: 'Recibida',
  en_revision: 'En revisión',
  resuelta: 'Resuelta',
}

export const NOMBRE_TIPO_INCIDENCIA: Record<TipoIncidencia, string> = {
  luz_apagada: 'Luz apagada',
  intermitente: 'Intermitente',
  tiempo_anomalo: 'Tiempo anómalo',
  dano_fisico: 'Daño físico',
  otro: 'Otro',
}

// Toda hora se muestra en la zona del cruce, sin importar dónde esté el navegador.
const ZONA = 'America/Santiago'

export function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso))
}

export function hora(iso: string): string {
  return new Intl.DateTimeFormat('es-CL', { timeZone: ZONA, timeStyle: 'medium' }).format(new Date(iso))
}

export function hoyEnChile(): string {
  // en-CA formatea como AAAA-MM-DD, el mismo formato de <input type="date">.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date())
}

export function restarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10)
}

export const numero = new Intl.NumberFormat('es-CL')
