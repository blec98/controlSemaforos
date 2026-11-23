import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { connection } from 'next/server'
import { variable } from '@/lib/config'

// Cliente con la sesión de quien navega: todo lo que consulta pasa por RLS.
export async function crearClienteServidor() {
  // Con Partial Prefetching, Next prerenderiza también lo que depende de la cookie de
  // sesión. Supabase usa Date.now() al leer la sesión, y Next exige que eso ocurra en
  // tiempo de solicitud: connection() marca ese punto.
  await connection()
  const almacen = await cookies()
  return createServerClient(variable('NEXT_PUBLIC_SUPABASE_URL'), variable('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll(porGuardar) {
        // Un Server Component no puede escribir cookies. No hace falta: el proxy ya
        // renovó la sesión antes de llegar aquí. En Server Actions sí se escriben.
        try {
          porGuardar.forEach(({ name, value, options }) => almacen.set(name, value, options))
        } catch {}
      },
    },
  })
}
