'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { crearClienteServidor } from '@/lib/supabase/servidor'

export type EstadoLogin = { error?: string }

const credenciales = z.object({ email: z.email(), password: z.string().min(1).max(200) })

export async function iniciarSesion(_previo: EstadoLogin, formulario: FormData): Promise<EstadoLogin> {
  const datos = credenciales.safeParse({ email: formulario.get('email'), password: formulario.get('password') })
  if (!datos.success) return { error: 'Ingresa un correo válido y tu contraseña.' }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.signInWithPassword(datos.data)
  // Sin status (fallo de red) o 5xx: el problema es el servicio, no las credenciales.
  if (error && (!error.status || error.status >= 500)) return { error: 'No se pudo conectar con el servicio de autenticación. Intenta en un momento.' }
  // Un solo mensaje para correo o contraseña equivocados: no se confirma qué correos existen.
  if (error) return { error: 'Correo o contraseña incorrectos, o la cuenta aún no confirma su correo.' }

  redirect('/monitoreo')
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  redirect('/login')
}
