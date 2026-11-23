'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirRol } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'

// `nota` vuelve al formulario cuando hay error: React 19 lo limpia al terminar la acción
// y el operador perdería lo que escribió.
export type EstadoFormulario = { error?: string; listo?: string; nota?: string }

const cambio = z.object({
  id: z.uuid(),
  estado: z.enum(['en_revision', 'resuelta']),
  // El navegador cuenta un salto de línea como un carácter y lo envía como dos (\r\n):
  // se normaliza antes de medir para que el límite coincida con el del formulario.
  nota: z.string().transform((t) => t.replace(/\r\n/g, '\n').trim()).pipe(z.string().max(1000)),
})

// Las mismas transiciones que acepta la función SQL.
const PERMITIDAS: Record<string, string[]> = { recibida: ['en_revision', 'resuelta'], en_revision: ['resuelta'] }

// Códigos que la función SQL lanza con un mensaje pensado para el operador.
const ERRORES_PROPIOS = new Set(['22023', '42501', 'P0002'])

export async function cambiarEstado(_previo: EstadoFormulario, formulario: FormData): Promise<EstadoFormulario> {
  // Una Server Action es un endpoint público: se vuelve a revisar el rol aquí, aunque
  // el formulario solo se muestre a operadores.
  await exigirRol('operador')

  const notaEnviada = String(formulario.get('nota') ?? '')
  const datos = cambio.safeParse({ id: formulario.get('id'), estado: formulario.get('estado'), nota: notaEnviada })
  if (!datos.success) return { error: 'Revisa el estado elegido y que la nota no supere los 1000 caracteres.', nota: notaEnviada }
  const { id, estado, nota } = datos.data
  if (estado === 'resuelta' && !nota) return { error: 'Para resolver la incidencia escribe una nota de cierre.', nota: notaEnviada }

  const supabase = await crearClienteServidor()
  const { data: actual, error: errorLectura } = await supabase.from('incidencias').select('estado, foto_path').eq('id', id).maybeSingle()
  if (errorLectura) return { error: 'No se pudo leer la incidencia. Intenta de nuevo.', nota: notaEnviada }
  if (!actual) return { error: 'La incidencia ya no existe.' }
  // Se revisa antes de tocar la foto: si otro operador ya la cambió, no se borra nada.
  if (!PERMITIDAS[actual.estado]?.includes(estado)) {
    return { error: 'Otro operador ya cambió esta incidencia. Recarga la página para ver su estado actual.' }
  }

  // La foto se borra antes de cerrar (M3). Si el borrado falla, la incidencia no se cierra:
  // así nunca queda una incidencia resuelta con una foto que nadie va a volver a borrar.
  if (estado === 'resuelta' && actual.foto_path) {
    const { error } = await supabase.storage.from('incidencias').remove([actual.foto_path])
    if (error) return { error: 'No se pudo eliminar la foto adjunta, así que la incidencia no se cerró. Intenta de nuevo.', nota: notaEnviada }
  }

  const { error } = await supabase.rpc('cambiar_estado_incidencia', { p_incidencia: id, p_estado: estado, p_nota: nota || null })
  if (error) {
    return {
      error: error.code && ERRORES_PROPIOS.has(error.code) ? error.message : 'No se pudo guardar el cambio. Intenta de nuevo.',
      nota: notaEnviada,
    }
  }

  revalidatePath(`/incidencias/${id}`)
  revalidatePath('/incidencias')
  return { listo: estado === 'resuelta' ? 'Incidencia resuelta.' : 'Incidencia en revisión.' }
}
