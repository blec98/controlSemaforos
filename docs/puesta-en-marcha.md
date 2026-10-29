# Puesta en marcha

Pasos para dejar funcionando la base de datos y el panel sobre el proyecto Supabase `rhtoneixthvfejonusan`, vacío.

## 1. Base de datos

1. En Supabase, abrir **SQL Editor**, pegar completo `supabase/migrations/20261029000000_esquema_inicial.sql` y ejecutarlo una sola vez. Crea las tablas con RLS, las funciones, el bucket privado `incidencias`, la publicación de tiempo real y el cruce `maqueta-01` con sus cuatro accesos.
2. En **Authentication > Sign In / Providers > Email**, dejar activo **Confirm email**. Es la verificación de correo de M7: sin ella cualquiera crea cuentas en masa desde la app.

Antes de ejecutarla se puede correr la prueba local de políticas, que no toca Supabase:

```bash
npm run test:sql
```

## 2. Cuentas del personal

El panel no tiene registro: las cuentas de operador y analista se crean a mano, para que nadie pueda darse un rol a sí mismo.

1. **Authentication > Users > Add user > Create new user**, con correo, contraseña y **Auto Confirm User** marcado.
2. Asignar el rol en el SQL Editor. Toda cuenta nace como `ciudadano`:

```sql
update public.perfiles
   set rol = 'operador', nombre = 'Bernardo Cárdenas'
 where id = (select id from auth.users where email = 'correo@ejemplo.cl');
```

`operador` ve monitoreo, estadísticas e incidencias; `analista`, solo monitoreo y estadísticas.

## 3. Variables de entorno

```bash
cp .env.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`: en **Project Settings > API Keys**.
- `INGESTA_TOKEN`: generar uno nuevo y entregárselo a quien configure Godot.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`.env.local` no se sube al repositorio. Si la llave secreta o el token se exponen, se revocan y se generan de nuevo.

## 4. Ejecutar

```bash
npm install
```

```bash
npm run dev
```

Abrir http://localhost:3000 e ingresar con una cuenta del personal. El contrato que debe cumplir Godot está en [api-ingesta.md](api-ingesta.md), con un `curl` para probar el monitoreo sin Godot.

## 5. Publicar en Vercel

Importar el repositorio en Vercel y cargar las mismas cuatro variables en **Settings > Environment Variables**. Las variables `NEXT_PUBLIC_` se incrustan al compilar, así que después de cambiarlas hay que volver a desplegar.

## Lo que la app móvil debe saber

- Al reportar, la app inserta solo `cruce_id`, `tipo`, `descripcion` y `foto_path`. `estado`, `autor_id` y las fechas los pone la base; enviarlos devuelve un error de permisos.
- `tipo` admite `luz_apagada`, `intermitente`, `tiempo_anomalo`, `dano_fisico` y `otro`.
- La foto se sube primero a `incidencias/<id del usuario>/<archivo>` (JPEG, PNG o WebP, máximo 5 MB) y esa ruta va en `foto_path`.
- Hay un máximo de 5 reportes por cuenta en 24 horas.
- La tabla `incidencias` está en tiempo real: la app puede escuchar los cambios de estado de sus propias incidencias.
- Eliminar la cuenta (RF8) requiere borrar el usuario de `auth.users` con la llave secreta y sus fotos con la API de Storage; la base borra en cascada perfil, incidencias e historial. Ese endpoint todavía no existe.
