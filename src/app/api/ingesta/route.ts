import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { CRUCE_ID, variable } from '@/lib/config'
import { esquemaLote, filasDelLote } from '@/lib/ingesta'
import { crearClienteAdmin } from '@/lib/supabase/admin'

// Única puerta de escritura de los datos del cruce. El cruce solo conoce su token,
// que sirve para esta ruta y nada más: si se filtra, se cambia INGESTA_TOKEN y listo,
// sin rotar la llave secreta de Supabase (M5 y M6).

const MAX_BYTES = 512 * 1024

function tokenValido(cabecera: string | null): boolean {
  const recibido = cabecera?.startsWith('Bearer ') ? cabecera.slice(7) : ''
  // Se comparan hashes de largo fijo para que el tiempo de respuesta no revele el token.
  const a = createHash('sha256').update(recibido).digest()
  const b = createHash('sha256').update(variable('INGESTA_TOKEN')).digest()
  return recibido.length > 0 && timingSafeEqual(a, b)
}

function respuesta(estado: number, cuerpo: object) {
  return Response.json(cuerpo, { status: estado, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  if (!tokenValido(request.headers.get('authorization'))) {
    return respuesta(401, { error: 'Token de cruce inválido' })
  }

  const texto = await request.text()
  if (texto.length > MAX_BYTES) return respuesta(413, { error: 'Lote demasiado grande; envía como máximo 512 KB' })

  let json: unknown
  try {
    json = JSON.parse(texto)
  } catch {
    return respuesta(400, { error: 'El cuerpo no es JSON válido' })
  }

  const lote = esquemaLote.safeParse(json)
  if (!lote.success) return respuesta(400, { error: 'Lote inválido', detalle: z.flattenError(lote.error) })
  // El token pertenece a un solo cruce: no puede escribir a nombre de otro.
  if (lote.data.cruce_id !== CRUCE_ID) return respuesta(403, { error: 'El token no corresponde a ese cruce' })

  const filas = filasDelLote(lote.data)
  const supabase = crearClienteAdmin()

  const [estado, eventos, conteos] = await Promise.all([
    filas.estado ? supabase.from('estado_cruce').upsert(filas.estado, { onConflict: 'cruce_id' }) : null,
    // Reenviar la cola local no duplica: los eventos repetidos se ignoran y el conteo
    // de un minuto ya guardado se reemplaza por el último valor.
    filas.eventos.length
      ? supabase.from('eventos_fase').upsert(filas.eventos, { onConflict: 'cruce_id,ocurrido_en', ignoreDuplicates: true })
      : null,
    filas.conteos.length
      ? supabase.from('conteos_minuto').upsert(filas.conteos, { onConflict: 'cruce_id,acceso,minuto,tipo' })
      : null,
  ])

  const errores = [estado?.error, eventos?.error, conteos?.error].filter(Boolean)
  if (errores.length) {
    // El detalle queda en el log del servidor; a quien envía no le sirve y expone el esquema.
    console.error('Ingesta: error al guardar el lote', errores)
    return respuesta(502, { error: 'No se pudo guardar el lote; Godot debe conservarlo en su cola y reintentar' })
  }

  // Cuenta lo aceptado en el lote; los eventos repetidos se aceptan pero no se duplican.
  return respuesta(200, {
    aceptado: { estado: Boolean(filas.estado), eventos: filas.eventos.length, conteos: filas.conteos.length },
  })
}
