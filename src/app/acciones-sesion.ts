'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { crearClienteServidor } from '@/lib/supabase/servidor'

// `email` vuelve al formulario cuando hay error, para no tener que escribirlo de nuevo.
// La contraseña nunca vuelve.
export type EstadoLogin = { error?: string; email?: string }

const credenciales = z.object({ email: z.email(), password: z.string().min(1).max(200) })

export async function iniciarSesion(_previo: EstadoLogin, formulario: FormData): Promise<EstadoLogin> {
  const email = String(formulario.get('email') ?? '').slice(0, 320)
  const datos = credenciales.safeParse({ email, password: formulario.get('password') })
  if (!datos.success) return { error: 'Ingresa un correo válido y tu contraseña.', email }

  const supabase = await crearClienteServidor()
  const { error } = await supabase.auth.signInWithPassword(datos.data)
  // Sin status (fallo de red) o 5xx: el problema es el servicio, no las credenciales.
  if (error && (!error.status || error.status >= 500)) {
    return { error: 'No se pudo conectar con el servicio de autenticación. Intenta en un momento.', email }
  }
  // Un solo mensaje para correo o contraseña equivocados: no se confirma qué correos existen.
  if (error) return { error: 'Correo o contraseña incorrectos, o la cuenta aún no confirma su correo.', email }

  redirect('/monitoreo')
}

export async function cerrarSesion() {
  const supabase = await crearClienteServidor()
  await supabase.auth.signOut()
  redirect('/login')
}
