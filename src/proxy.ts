import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Renueva la sesión de Supabase en cada navegación y manda a /login a quien no la tenga.
// Es un filtro de comodidad: el permiso real lo revisan exigirRol() en cada página y RLS.
export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(porGuardar, cabeceras) {
          porGuardar.forEach(({ name, value }) => request.cookies.set(name, value))
          respuesta = NextResponse.next({ request })
          porGuardar.forEach(({ name, value, options }) => respuesta.cookies.set(name, value, options))
          // Cabeceras anti-caché que pide @supabase/ssr cuando escribe cookies de sesión.
          Object.entries(cabeceras).forEach(([clave, valor]) => respuesta.headers.set(clave, valor))
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  const enLogin = request.nextUrl.pathname === '/login'

  if (!data?.claims && !enLogin) return redirigir(request, respuesta, '/login')
  if (data?.claims && enLogin) return redirigir(request, respuesta, '/monitoreo')
  return respuesta
}

// La redirección conserva las cookies que se acaban de renovar o limpiar.
function redirigir(request: NextRequest, origen: NextResponse, destino: string) {
  const redireccion = NextResponse.redirect(new URL(destino, request.url))
  origen.cookies.getAll().forEach((cookie) => redireccion.cookies.set(cookie))
  return redireccion
}

export const config = {
  // Las rutas de /api/ se autentican solas con un token (la ingesta con el del cruce y
  // /api/cuenta con el de la sesión de la app) y no llevan cookies: redirigirlas a
  // /login rompería a Godot y a la app.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico).*)'],
}
