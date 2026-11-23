import { crearClienteAdmin } from '@/lib/supabase/admin'

// Eliminación de la cuenta propia desde la app (RF8, HU6, corrección A5). Es la única
// operación de la app que necesita la llave secreta: borrar el usuario de auth.users.
// La base borra en cascada su perfil, sus incidencias y el historial, pero las fotos del
// bucket no tienen cascada: se borran aquí primero. Contrato en docs/api-app.md.

const CARPETA_MAX_VUELTAS = 20

function respuesta(estado: number, cuerpo: object) {
  return Response.json(cuerpo, { status: estado, headers: { 'Cache-Control': 'no-store' } })
}

export async function DELETE(request: Request) {
  const cabecera = request.headers.get('authorization') ?? ''
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : ''
  if (!token) return respuesta(401, { error: 'Falta el token de sesión' })

  const admin = crearClienteAdmin()
  // getUser consulta al servidor de Auth: además de la firma, confirma que la sesión
  // sigue vigente. El uid sale del token, nunca del cuerpo: solo se borra la cuenta propia.
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return respuesta(401, { error: 'Sesión inválida o vencida' })
  const uid = data.user.id

  // 1) Fotos de incidencias/<uid>/. Si esto falla, no se borra la cuenta: quedarían
  // archivos huérfanos de alguien que ya no existe y nadie podría pedir que se eliminen.
  const fotos = admin.storage.from('incidencias')
  for (let vuelta = 0; vuelta < CARPETA_MAX_VUELTAS; vuelta++) {
    const { data: archivos, error: errorLista } = await fotos.list(uid, { limit: 100 })
    if (errorLista) {
      console.error('Cuenta: no se pudo listar la carpeta de fotos', errorLista)
      return respuesta(502, { error: 'No se pudieron borrar tus fotos. La cuenta no se eliminó; intenta de nuevo.' })
    }
    if (!archivos?.length) break
    const { error: errorBorrado } = await fotos.remove(archivos.map((a) => `${uid}/${a.name}`))
    if (errorBorrado) {
      console.error('Cuenta: no se pudieron borrar las fotos', errorBorrado)
      return respuesta(502, { error: 'No se pudieron borrar tus fotos. La cuenta no se eliminó; intenta de nuevo.' })
    }
  }

  // 2) La cuenta. El resto de los datos se va en cascada.
  const { error: errorCuenta } = await admin.auth.admin.deleteUser(uid)
  if (errorCuenta) {
    console.error('Cuenta: no se pudo eliminar el usuario', errorCuenta)
    return respuesta(502, { error: 'Tus fotos se borraron, pero la cuenta no se pudo eliminar. Intenta de nuevo.' })
  }

  return respuesta(200, { eliminada: true })
}
