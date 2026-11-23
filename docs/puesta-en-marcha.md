# Puesta en marcha

Pasos para dejar funcionando la base de datos y el panel sobre el proyecto Supabase `rhtoneixthvfejonusan`, vacío.

## 1. Base de datos

1. En Supabase, abrir **SQL Editor**, pegar completo `supabase/migrations/20261029000000_esquema_inicial.sql` y ejecutarlo una sola vez. Crea las tablas con RLS, las funciones, el bucket privado `incidencias`, la publicación de tiempo real y el cruce `maqueta-01` con sus cuatro accesos.
2. En **Authentication > Sign In / Providers > Email**, dejar activo **Confirm email**. Es la verificación de correo de M7: sin ella cualquiera crea cuentas en masa desde la app.
3. Después, y una sola vez, ejecutar `supabase/migrations/20261124000000_correcciones_auditoria.sql` (correcciones A3, A4 y A6 a A10 de la auditoría del 23-11-2026). Las migraciones nunca se editan después de aplicadas: cada cambio va en un archivo nuevo con fecha posterior.

Antes de ejecutar cualquier migración se corre la prueba local, que aplica todas en orden sobre un Postgres en memoria y no toca Supabase:

```bash
pnpm test:sql
```

Después de aplicar la migración del 24-11, comprobar en el SQL Editor lo que la prueba local no puede ver. El tope de 5 fotos en 24 horas (A4) cuenta con una función que necesita que `postgres` pase por alto RLS en `storage.objects`; si no lo hace, el conteo da 0 en silencio y el tope no se aplica:

```sql
select rolbypassrls from pg_roles where rolname = 'postgres';
```

Debe responder `true`. La prueba definitiva es funcional: con una cuenta de ciudadano, subir 6 fotos a su carpeta del bucket `incidencias` en el mismo día; la sexta debe ser rechazada.

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

El proyecto usa **pnpm**; la versión está fijada en `package.json` (`packageManager`). Si pnpm no está instalado, sirve el que trae Node con `corepack pnpm`.

| Archivo | Qué hace |
|---|---|
| `iniciar-local.bat` | Instala lo que falte y abre el panel en http://localhost:3000, visible solo desde este equipo |
| `iniciar-red.bat` | Lo mismo, pero accesible desde otros dispositivos de la misma red en `http://<IP del equipo>:3000`; muestra la IP al iniciar |

Sin los `.bat`, lo mismo a mano:

```bash
pnpm install
```

```bash
pnpm dev
```

`pnpm dev:red` es el modo red, pero así Next no conoce la IP del equipo y bloquea la recarga en caliente desde otros dispositivos; por eso conviene `iniciar-red.bat`, que la pasa en `ORIGENES_DEV`.

En modo red, la primera vez Windows pregunta si Node.js puede usar la red: hay que permitirlo **solo en redes privadas**, y la red Wi-Fi debe estar marcada como privada. Es un servidor de desarrollo, así que conviene usarlo solo en redes de confianza.

Abrir el panel e ingresar con una cuenta del personal. El contrato que debe cumplir Godot está en [api-ingesta.md](api-ingesta.md), con un `curl` para probar el monitoreo sin Godot.

## 5. Publicar en Vercel

Importar el repositorio en Vercel y cargar las mismas cuatro variables en **Settings > Environment Variables**. Las variables `NEXT_PUBLIC_` se incrustan al compilar, así que después de cambiarlas hay que volver a desplegar. `NEXT_PUBLIC_SUPABASE_URL` también la usa `next.config.ts` para armar la Content-Security-Policy: sin ella, el panel no podría conectarse a Supabase.

`Strict-Transport-Security` no hace falta configurarlo: Vercel ya lo entrega en producción (`max-age=63072000; includeSubDomains; preload`).

### Límites de solicitudes (A1)

Ninguna de las dos rutas públicas tiene límite en el código: en Vercel cada solicitud puede caer en una instancia distinta, así que un contador en memoria no sirve. El límite se configura en las plataformas.

- **`/api/ingesta`, en Vercel.** Regla publicada el 23-11-2026 en **Firewall** (plan Hobby): *Límite de ingesta*. Si la ruta es igual a `/api/ingesta`, aplica *Rate Limit* de ventana fija, **300 solicitudes cada 60 s por IP**, y responde 429. Godot envía cerca de 1 por segundo, más un envío extra en cada cambio de fase, así que tiene margen de sobra. El token de ingesta (32 bytes aleatorios) no se puede adivinar por fuerza bruta en ningún plazo realista; el límite evita sobre todo que alguien con el token robado inunde la base con lotes de 512 KB.
- **Inicio de sesión, en Supabase.** En **Authentication > Rate Limits**, revisar el límite de inicios de sesión por IP y anotarlo aquí: ____ por ____.

Para comprobar la regla, 350 solicitudes con un token inválido, 20 a la vez para que caigan en la misma ventana, deben terminar en parte con 401 y el resto con 429. El 23-11-2026 dieron 276 con 401 y 74 con 429: Vercel cuenta de forma aproximada entre sus servidores, así que el corte puede caer algo antes de 300. Después de la prueba, la IP que la corre queda bloqueada hasta que termina la ventana.

```bash
seq 1 350 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer invalido" https://control-semaforos.vercel.app/api/ingesta | sort | uniq -c
```

### Integración continua

Cada push y cada PR a `main` corren `.github/workflows/ci.yml`: instalación con el lockfile, ESLint, TypeScript y `pnpm test:sql`. No necesita secretos, porque no toca Supabase.

## App móvil

Todo lo que necesita la app Flutter está en [api-app.md](api-app.md): conexión, qué ve cada rol, el flujo de incidencias, los errores y `DELETE /api/cuenta` para eliminar la cuenta (RF8).
