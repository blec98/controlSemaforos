import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { crearClienteServidor } from '@/lib/supabase/servidor'
import type { Rol } from '@/lib/tipos'

export type Usuario = { id: string; email: string; rol: Rol; nombre: string | null }

// cache() evita repetir la consulta cuando el layout y la página piden el usuario
// en la misma solicitud.
export const obtenerUsuario = cache(async (): Promise<Usuario> => {
  const supabase = await crearClienteServidor()
  // getClaims verifica la firma del JWT; getSession solo leería la cookie sin validarla.
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) redirect('/login')

  const { data: perfil, error } = await supabase.from('perfiles').select('rol, nombre').eq('id', claims.sub).maybeSingle()
  // Si la base falla, no se asume "ciudadano": eso mandaría a un operador a /sin-acceso.
  // El error lo muestra error.tsx con la opción de reintentar.
  if (error) throw new Error('No se pudo leer el perfil del usuario')
  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : '',
    rol: (perfil?.rol as Rol | undefined) ?? 'ciudadano',
    nombre: perfil?.nombre ?? null,
  }
})

// Se llama en cada página y en cada Server Action. El proxy solo redirige a /login;
// la autorización real se decide aquí y, debajo, en RLS.
export async function exigirRol(...permitidos: Rol[]): Promise<Usuario> {
  const usuario = await obtenerUsuario()
  if (!permitidos.includes(usuario.rol)) redirect('/sin-acceso')
  return usuario
}
