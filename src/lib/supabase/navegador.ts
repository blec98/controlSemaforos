import { createBrowserClient } from '@supabase/ssr'

// En el navegador solo viajan la URL y la llave publicable. Lo que protege los datos
// son las políticas RLS, no el secreto de esta llave (S2 del informe).
// Las variables NEXT_PUBLIC_ se escriben literales para que Next las incluya en el bundle.
export function crearClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
