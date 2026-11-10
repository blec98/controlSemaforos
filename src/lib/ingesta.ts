import 'server-only'
import { z } from 'zod'

// Contrato del lote que envía Godot a POST /api/ingesta. Detalle en docs/api-ingesta.md.
// Los nombres de `estado` son los de FTITrafficController.snapshot() tal cual, para que
// Godot pueda mandar su snapshot sin traducirlo.

const MAX_FUTURO_MS = 60_000
const MAX_PASADO_MS = 7 * 86_400_000

// Se aceptan marcas con zona horaria explícita y dentro de una ventana razonable:
// hasta 7 días atrás cubre el reenvío de la cola local tras una desconexión (RNF5).
const instante = z.iso.datetime({ offset: true }).refine((valor) => {
  const diferencia = Date.parse(valor) - Date.now()
  return diferencia <= MAX_FUTURO_MS && diferencia >= -MAX_PASADO_MS
}, 'Fuera de la ventana aceptada: máximo 60 s en el futuro y 7 días en el pasado')

const acceso = z.enum(['N', 'E', 'S', 'W'])
const modo = z.enum(['fti', 'adaptive', 'fixed'])
const etapa = z.enum(['GREEN', 'YELLOW', 'ALL_RED'])
const activos = z.array(acceso).max(4).refine((lista) => new Set(lista).size === lista.length, 'Accesos repetidos')

const estado = z.object({
  reportado_en: instante,
  mode: modo,
  running_mode: modo,
  stage: etapa,
  active: activos,
  counts: z.array(z.number().min(0).max(500)).length(4),
  sensor_age: z.number().min(0).max(86_400),
  fallback: z.boolean(),
  reason: z.string().max(120).optional(),
})

const evento = z
  .object({
    ocurrido_en: instante,
    stage: etapa,
    active: activos,
    running_mode: modo,
    fallback: z.boolean().default(false),
    motivo: z.enum(['sin_demanda', 'verde_maximo', 'tiempo_fijo', 'balance_colas', 'prioridad', 'cambio_modo']).nullable().default(null),
  })
  .refine((e) => e.motivo === null || e.stage === 'YELLOW', 'El motivo solo se informa al cortar un verde (stage YELLOW)')

const conteo = z.object({
  minuto: instante.refine((valor) => new Date(valor).getUTCSeconds() === 0 && new Date(valor).getUTCMilliseconds() === 0, 'El minuto debe venir sin segundos'),
  acceso,
  tipo: z.enum(['auto', 'camioneta', 'bus']),
  cantidad: z.int().min(0).max(1000),
})

export const esquemaLote = z
  .object({
    cruce_id: z.string().regex(/^[a-z0-9-]{3,40}$/),
    estado: estado.optional(),
    eventos: z.array(evento).max(2000).default([]),
    conteos: z.array(conteo).max(2000).default([]),
  })
  .refine((l) => l.estado || l.eventos.length || l.conteos.length, 'El lote viene vacío')

export type Lote = z.infer<typeof esquemaLote>

export function filasDelLote(lote: Lote) {
  const { cruce_id } = lote
  return {
    estado: lote.estado && {
      cruce_id,
      modo: lote.estado.mode,
      modo_activo: lote.estado.running_mode,
      etapa: lote.estado.stage,
      activos: lote.estado.active,
      // Godot entrega los conteos como float; la tabla guarda vehículos enteros.
      detectados: lote.estado.counts.map((n) => Math.round(n)),
      edad_sensor: lote.estado.sensor_age,
      respaldo: lote.estado.fallback,
      motivo_texto: lote.estado.reason ?? null,
      reportado_en: lote.estado.reportado_en,
    },
    eventos: lote.eventos.map((e) => ({
      cruce_id,
      ocurrido_en: e.ocurrido_en,
      etapa: e.stage,
      activos: e.active,
      modo_activo: e.running_mode,
      respaldo: e.fallback,
      motivo: e.motivo,
    })),
    conteos: lote.conteos.map((c) => ({ cruce_id, ...c })),
  }
}
