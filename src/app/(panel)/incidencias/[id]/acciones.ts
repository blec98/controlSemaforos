'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirRol } from '@/lib/sesion'
import { crearClienteServidor } from '@/lib/supabase/servidor'

export type EstadoFormulario = { error?: string; listo?: boolean }

const cambio = z.object({
  id: z.uuid(),
  estado: z.enum(['en_revision', 'resuelta']),
  nota: z.string().trim().max(1000),
})

// Códigos que la función SQL lanza con un mensaje pensado para el operador.
const ERRORES_PROPIOS = new Set(['22023', '42501', 'P0002'])

export async function cambiarEstado(_previo: EstadoFormulario, formulario: FormData): Promise<EstadoFormulario> {
  // Una Server Action es un endpoint público: se vuelve a revisar el rol aquí, aunque
  // el formulario solo se muestre a operadores.
  await exigirRol('operador')

  const datos = cambio.safeParse({ id: formulario.get('id'), estado: formulario.get('estado'), nota: formulario.get('nota') ?? '' })
  if (!datos.success) return { error: 'Revisa el estado elegido y que la nota no supere los 1000 caracteres.' }
  const { id, estado, nota } = datos.data
  if (estado === 'resuelta' && !nota) return { error: 'Para resolver la incidencia escribe una nota de cierre.' }

  const supabase = await crearClienteServidor()

  // La foto se borra antes de cerrar (M3). Si el borrado falla, no se cierra la incidencia:
  // así nunca queda una incidencia resuelta con una foto que nadie va a volver a borrar.
  if (estado === 'resuelta') {
    const { data: actual } = await supabase.from('incidencias').select('foto_path').eq('id', id).maybeSingle()
    if (actual?.foto_path) {
      const { error } = await supabase.storage.from('incidencias').remove([actual.foto_path])
      if (error) return { error: 'No se pudo eliminar la foto adjunta, así que la incidencia no se cerró. Intenta de nuevo.' }
    }
  }

  const { error } = await supabase.rpc('cambiar_estado_incidencia', { p_incidencia: id, p_estado: estado, p_nota: nota || null })
  if (error) {
    return { error: error.code && ERRORES_PROPIOS.has(error.code) ? error.message : 'No se pudo guardar el cambio. Intenta de nuevo.' }
  }

  revalidatePath(`/incidencias/${id}`)
  revalidatePath('/incidencias')
  return { listo: true }
}
