# Control de tránsito: panel web

Panel web del proyecto **Semáforo inteligente** (Proyecto Integrado TIHV43, INACAP Osorno). Recibe los datos del cruce que simula la maqueta 3D en Godot, los guarda en Supabase y los muestra al personal: el estado de las luces en vivo, las estadísticas de tráfico y las incidencias que reportan las personas desde la app móvil.

La regla que ordena todo el proyecto es que **el control vive en el cruce**: la web recibe datos de Godot, pero no le envía órdenes. Ni el panel ni la app pueden cambiar una luz.

## Qué hace

| Sección | Quién la ve | Qué muestra | Requerimientos |
|---|---|---|---|
| Monitoreo | Operador y analista | Luz y vehículos detectados por acceso, en tiempo real, con alertas si el cruce deja de informar, si la detección se cae o si opera el respaldo fijo | HU2: RF4, RNF3 |
| Estadísticas | Operador y analista | Vehículos por hora, día, acceso y tipo, y cuántos verdes se cortaron por falta de demanda | HU3: RF5 |
| Incidencias | Operador | Reportes de la app con su foto y su historial; cambio de estado con nota de cierre | HU5: RF7 |
| `POST /api/ingesta` | Godot, con su token | Recibe el estado, los cambios de fase y los conteos por minuto | RF1, RF3, RNF5 |

Las cuentas del personal se crean a mano en Supabase: el panel no tiene registro, para que nadie pueda asignarse un rol a sí mismo. Una cuenta de ciudadano que intenta entrar llega a una página de "sin acceso".

## Arquitectura

```
Godot (maqueta 3D) ──POST /api/ingesta──▶ Next.js ──llave secreta──▶ Supabase (PostgreSQL + RLS)
                       token del cruce       │                            │
                                             └── panel ◀── sesión ────────┘  tiempo real
App Flutter ─────────────── sesión del ciudadano ──────────────────────────▶ (solo sus incidencias)
```

- **Ingesta.** Es la única puerta de escritura de los datos del cruce. Godot se autentica con un token propio que sirve solo para esa ruta: si se filtra, se cambia sin tocar las llaves de Supabase. La ruta valida cada lote con zod antes de guardarlo, y reenviar la cola local después de una desconexión no duplica datos.
- **Panel.** Consulta Supabase con la sesión de quien navega, así que todo pasa por RLS. El rol se revisa en cada página y en cada acción del servidor, no solo en el menú.
- **Base de datos.** RLS está activado en todas las tablas y a las llaves públicas se les retiró el permiso de escritura. El estado de una incidencia cambia solo mediante la función `cambiar_estado_incidencia`, que exige rol de operador y deja el historial en la misma transacción.

## Requisitos

- Node.js 24, la versión con la que se probó
- pnpm 12, fijado en `packageManager`. Si no está instalado, los `.bat` usan el que trae Node mediante `corepack pnpm`.
- Un proyecto Supabase con la migración aplicada. Los pasos están en [docs/puesta-en-marcha.md](docs/puesta-en-marcha.md).

## Ejecutar

1. Copiar `.env.example` como `.env.local` o `.env` y completar las llaves. Ese archivo no se sube al repositorio.
2. Abrir uno de los dos scripts:

| Script | Uso |
|---|---|
| `iniciar-local.bat` | Panel en http://localhost:3000, visible solo desde este equipo |
| `iniciar-red.bat` | Panel accesible desde otros dispositivos de la misma red; al iniciar muestra la dirección, por ejemplo `http://10.30.33.186:3000` |

Los dos revisan que exista el archivo de variables, instalan las dependencias con el lockfile y levantan el servidor de desarrollo. El modo red es para redes de confianza: la primera vez, Windows pregunta si Node.js puede usar la red, y hay que permitirlo solo en redes privadas.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo en localhost |
| `pnpm dev:red` | Servidor de desarrollo en todas las interfaces. Sin la IP en `ORIGENES_DEV` Next bloquea la recarga en caliente desde otros equipos; por eso conviene `iniciar-red.bat` |
| `pnpm build` y `pnpm start` | Compilación y servidor de producción |
| `pnpm lint` | ESLint |
| `pnpm test:sql` | Corre la migración sobre PGlite, un Postgres en memoria, y prueba las políticas RLS, los permisos y las funciones desde los roles de cada actor |

## Estructura

| Ruta | Contenido |
|---|---|
| `src/app/(panel)/` | Monitoreo, estadísticas e incidencias |
| `src/app/login/`, `src/app/sin-acceso/` | Ingreso y página para cuentas sin rol de personal |
| `src/app/api/ingesta/route.ts` | Ruta que recibe los lotes de Godot |
| `src/lib/ingesta.ts` | Esquema zod del lote y traducción a filas de la base |
| `src/lib/sesion.ts` | Usuario actual y `exigirRol()` |
| `src/lib/supabase/` | Clientes de Supabase para el navegador, el servidor y la ingesta |
| `src/proxy.ts` | Renueva la sesión y redirige a `/login` a quien no la tiene |
| `supabase/migrations/` | Esquema, políticas RLS, funciones, bucket de fotos y datos base |
| `supabase/pruebas/` | Pruebas de las políticas |
| `docs/` | Puesta en marcha y contrato de ingesta |

## Documentación

- [Puesta en marcha](docs/puesta-en-marcha.md): base de datos, cuentas del personal, variables de entorno, ejecución, despliegue y lo que necesita saber la app móvil.
- [Contrato de ingesta](docs/api-ingesta.md): qué envía Godot, cómo responde la web y los acuerdos con la maqueta.

## Seguridad

- La llave secreta de Supabase se usa solo en la ruta de ingesta, y `server-only` hace fallar el build si algún código del navegador la importa.
- La llave publicable viaja al navegador; lo que protege los datos son las políticas RLS.
- Las fotos de las incidencias están en un bucket privado, se muestran con enlaces que vencen a los cinco minutos y se borran al resolver la incidencia.
- Si una llave o el token de ingesta se exponen, se revocan y se generan de nuevo. Los pasos están en [docs/puesta-en-marcha.md](docs/puesta-en-marcha.md).

## Equipo

| Integrante | Responsabilidad |
|---|---|
| Bernardo Cárdenas | Base de datos, aplicación web y dashboards |
| Nelson Hernández | Modelo 3D del cruce y lógica de control de los semáforos |
| Nicolás Romero | Aplicación móvil con Flutter |
