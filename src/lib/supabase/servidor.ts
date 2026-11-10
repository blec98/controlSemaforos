import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { variable } from '@/lib/config'

// Cliente con la sesión de quien navega: todo lo que consulta pasa por RLS.
export async function crearClienteServidor() {
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
