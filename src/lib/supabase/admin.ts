import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { variable } from '@/lib/config'

// La llave secreta se salta RLS. Por eso se usa en un solo lugar, la ruta de ingesta,
// y solo para insertar datos del cruce ya validados. 'server-only' hace fallar el build
// si algún componente del navegador intenta importar este archivo (M6).
export function crearClienteAdmin() {
  return createClient(variable('NEXT_PUBLIC_SUPABASE_URL'), variable('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
