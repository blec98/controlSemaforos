// Ejecuta la migración sobre PGlite (Postgres en proceso) con stubs mínimos de lo que
// Supabase trae de fábrica (roles, auth.uid(), storage) y prueba RLS, permisos y funciones.
// Uso: npm run test:sql
//
// Límite: aquí postgres es superusuario y en Supabase no. Lo que esto prueba son las
// políticas y los permisos vistos desde anon y authenticated, no la instalación en Supabase.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const migracion = readFileSync(new URL('../migrations/20261029000000_esquema_inicial.sql', import.meta.url), 'utf8')
const db = new PGlite()

const stubs = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public bool, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable
  as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create publication supabase_realtime;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const O = '00000000-0000-4000-8000-00000000000c'
const N = '00000000-0000-4000-8000-00000000000d'

let fallos = 0
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALLA'} ${msg}`); if (!cond) fallos++ }

async function como(uid, sql, params) {
  await db.exec('reset role')
  await db.exec(uid === 'anon' ? 'set role anon' : 'set role authenticated')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid === 'anon' ? '' : uid])
  try { return { filas: (await db.query(sql, params)).rows } }
  catch (e) { return { error: e.message, code: e.code } }
  finally { await db.exec('reset role') }
}

await db.exec(stubs)
await db.exec(migracion)
console.log('Migración aplicada sin errores')

for (const [id, email] of [[A, 'a@x.cl'], [B, 'b@x.cl'], [O, 'o@x.cl'], [N, 'n@x.cl']]) {
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email])
}
ok((await db.query('select count(*)::int n from public.perfiles where rol = $1', ['ciudadano'])).rows[0].n === 4, 'el trigger crea perfil ciudadano por cada cuenta')
await db.query(`update public.perfiles set rol = 'operador', nombre = 'Operador prueba' where id = $1`, [O])
await db.query(`update public.perfiles set rol = 'analista' where id = $1`, [N])

// Incidencias
let r = await como(A, `insert into public.incidencias (cruce_id, tipo, descripcion, foto_path) values ('maqueta-01', 'luz_apagada', 'No enciende el rojo norte', $1) returning id, estado, autor_id`, [`${A}/foto.jpg`])
ok(!r.error && r.filas[0].estado === 'recibida' && r.filas[0].autor_id === A, `ciudadano reporta y nace recibida ${r.error ?? ''}`)
const incA = r.filas?.[0]?.id

r = await como(A, `insert into public.incidencias (cruce_id, tipo, descripcion, estado) values ('maqueta-01', 'otro', 'intento de fijar estado', 'resuelta')`)
ok(r.error?.includes('permission denied'), 'no puede fijar estado al insertar')
r = await como(A, `insert into public.incidencias (cruce_id, tipo, descripcion, autor_id) values ('maqueta-01', 'otro', 'a nombre de otro', $1)`, [B])
ok(r.error?.includes('permission denied'), 'no puede fijar autor_id')
r = await como(A, `insert into public.incidencias (cruce_id, tipo, descripcion, foto_path) values ('maqueta-01', 'otro', 'foto ajena', $1)`, [`${B}/x.jpg`])
ok(r.error?.includes('row-level security'), 'no puede apuntar a una foto en carpeta ajena')
r = await como(B, 'select id from public.incidencias')
ok(r.filas?.length === 0, 'B no ve la incidencia de A')
r = await como(A, `update public.incidencias set estado = 'resuelta'`)
ok(r.error?.includes('permission denied'), 'ciudadano no puede actualizar incidencias')
r = await como(A, `select public.cambiar_estado_incidencia($1, 'resuelta', 'nota')`, [incA])
ok(r.code === '42501', 'ciudadano no puede usar cambiar_estado_incidencia')
r = await como(N, `select public.cambiar_estado_incidencia($1, 'en_revision')`, [incA])
ok(r.code === '42501', 'analista no puede cambiar estado')
r = await como(N, 'select id from public.incidencias')
ok(r.filas?.length === 0, 'analista no ve incidencias')

r = await como(O, 'select id from public.incidencias')
ok(r.filas?.length === 1, 'operador ve todas las incidencias')
r = await como(O, `select public.cambiar_estado_incidencia($1, 'resuelta', '  ')`, [incA])
ok(r.error?.includes('nota de cierre'), 'resolver exige nota')
r = await como(O, `select public.cambiar_estado_incidencia($1, 'en_revision')`, [incA])
ok(!r.error, `recibida a en_revision ${r.error ?? ''}`)
r = await como(O, `select public.cambiar_estado_incidencia($1, 'resuelta', 'Se reemplazó la ampolleta')`, [incA])
ok(!r.error, `en_revision a resuelta ${r.error ?? ''}`)
r = await como(O, `select public.cambiar_estado_incidencia($1, 'en_revision')`, [incA])
ok(r.error?.includes('Transición no permitida'), 'resuelta es final')
r = await como(O, 'select estado, foto_path from public.incidencias where id = $1', [incA])
ok(r.filas[0].estado === 'resuelta' && r.filas[0].foto_path === null, 'resolver suelta la foto')
r = await como(A, 'select estado_nuevo, responsable_id from public.incidencias_historial where incidencia_id = $1 order by id', [incA])
ok(r.filas?.length === 2 && r.filas[1].responsable_id === O, 'el autor ve el historial con responsable')
r = await como(B, 'select id from public.incidencias_historial')
ok(r.filas?.length === 0, 'B no ve historial ajeno')

for (let i = 0; i < 4; i++) await como(A, `insert into public.incidencias (cruce_id, tipo, descripcion) values ('maqueta-01', 'otro', 'reporte ${i}')`)
r = await como(A, `insert into public.incidencias (cruce_id, tipo, descripcion) values ('maqueta-01', 'otro', 'reporte sexto')`)
ok(r.error?.includes('límite de 5'), 'límite de 5 reportes en 24 h')

// Perfiles
r = await como(A, `update public.perfiles set rol = 'operador' where id = $1`, [A])
ok(r.error?.includes('permission denied'), 'nadie se puede subir de rol')
r = await como(A, 'select id from public.perfiles')
ok(r.filas?.length === 1, 'ciudadano ve solo su perfil')
r = await como(O, 'select rol from public.perfiles order by rol')
ok(r.filas?.length === 2 && !r.filas.some(f => f.rol === 'ciudadano'), 'personal ve perfiles del personal, no de ciudadanos')

// Datos del cruce
await db.exec(`
  insert into public.conteos_minuto (cruce_id, acceso, minuto, tipo, cantidad) values
    ('maqueta-01', 'N', '2026-10-28 08:00-03', 'auto', 4),
    ('maqueta-01', 'N', '2026-10-28 08:01-03', 'bus', 1),
    ('maqueta-01', 'E', '2026-10-28 09:30-03', 'auto', 2),
    ('maqueta-01', 'S', '2026-10-29 10:00-03', 'camioneta', 3);
  insert into public.eventos_fase (cruce_id, ocurrido_en, etapa, activos, modo_activo, motivo) values
    ('maqueta-01', '2026-10-28 08:00:10-03', 'YELLOW', '{N,S}', 'adaptive', 'sin_demanda'),
    ('maqueta-01', '2026-10-28 08:00:30-03', 'YELLOW', '{E,W}', 'adaptive', 'verde_maximo'),
    ('maqueta-01', '2026-10-28 08:00:33-03', 'GREEN', '{N,S}', 'adaptive', null);
  insert into public.estado_cruce (cruce_id, modo, modo_activo, etapa, activos, detectados, edad_sensor, respaldo, reportado_en)
    values ('maqueta-01', 'fti', 'fti', 'GREEN', '{N}', '{1,0,0,0}', 0.1, false, now());
`)
r = await como(A, `insert into public.conteos_minuto (cruce_id, acceso, minuto, tipo, cantidad) values ('maqueta-01', 'N', date_trunc('minute', now()), 'auto', 999)`)
ok(r.error?.includes('permission denied'), 'la app no puede insertar conteos')
r = await como(A, `update public.estado_cruce set etapa = 'GREEN', activos = '{N,E}'`)
ok(r.error?.includes('permission denied'), 'la app no puede tocar las luces')
r = await como(A, 'select * from public.conteos_minuto')
ok(r.filas?.length === 0, 'ciudadano no ve conteos')
r = await como(A, 'select etapa from public.estado_cruce')
ok(r.filas?.length === 1, 'ciudadano ve el estado de las luces')
r = await como('anon', 'select etapa from public.estado_cruce')
ok(r.error?.includes('permission denied'), 'anon no lee nada')
r = await como('anon', `select public.estadisticas_trafico('maqueta-01', '2026-10-01', '2026-10-30')`)
ok(r.error?.includes('permission denied'), 'anon no ejecuta estadísticas')

r = await como(N, `select public.estadisticas_trafico('maqueta-01', '2026-10-28', '2026-10-29') as e`)
const e = r.filas?.[0]?.e
ok(e?.total === 10 && e.unidad === 'hour', `analista: total 10 por hora ${JSON.stringify(e)}`)
ok(e?.cortes?.sin_demanda === 1 && e.cortes.verde_maximo === 1 && !('sin_motivo' in e.cortes), 'cortes por motivo, sin contar los GREEN')
ok(e?.perfil_horario?.find(h => h.hora === 8)?.auto === 4 && e.perfil_horario.find(h => h.hora === 8).bus === 1, 'perfil horario por tipo en hora local')
r = await como(N, `select public.estadisticas_trafico('maqueta-01', '2026-10-28', '2026-10-28', 'N') as e`)
ok(r.filas[0].e.total === 5, 'filtro por acceso y por día')
r = await como(N, `select public.estadisticas_trafico('maqueta-01', '2026-10-01', '2026-10-29') as e`)
ok(r.filas[0].e.unidad === 'day' && r.filas[0].e.serie.length === 2, 'rango largo agrupa por día')
r = await como(A, `select public.estadisticas_trafico('maqueta-01', '2026-10-28', '2026-10-29') as e`)
ok(r.filas?.[0]?.e?.total === 0, 'ciudadano recibe ceros (security invoker)')
r = await como(N, `select public.estadisticas_trafico('maqueta-01', '2026-01-01', '2026-10-29')`)
ok(r.error?.includes('rango máximo'), 'rango limitado a 93 días')

let x = await db.query(`insert into public.eventos_fase (cruce_id, ocurrido_en, etapa, activos, modo_activo, motivo) values ('maqueta-01', now(), 'GREEN', '{N}', 'fti', 'sin_demanda')`).catch(err => err)
ok(x instanceof Error && x.message.includes('check'), 'motivo solo en YELLOW')
x = await db.query(`insert into public.conteos_minuto (cruce_id, acceso, minuto, tipo, cantidad) values ('maqueta-01', 'N', '2026-10-28 08:00:30-03', 'auto', 1)`).catch(err => err)
ok(x instanceof Error, 'el minuto debe venir truncado')

await db.exec(`update public.estado_cruce set recibido_en = '2000-01-01', etapa = 'YELLOW'`)
x = await db.query(`select recibido_en > now() - interval '1 minute' as fresco from public.estado_cruce`)
ok(x.rows[0].fresco, 'recibido_en lo fija el servidor en cada escritura')

// Storage
r = await como(A, `insert into storage.objects (bucket_id, name) values ('incidencias', $1)`, [`${A}/f.jpg`])
ok(!r.error, `sube foto en su carpeta ${r.error ?? ''}`)
r = await como(A, `insert into storage.objects (bucket_id, name) values ('incidencias', $1)`, [`${B}/f.jpg`])
ok(r.error?.includes('row-level security'), 'no sube en carpeta ajena')
r = await como(B, `select name from storage.objects`)
ok(r.filas?.length === 0, 'B no ve la foto de A')
r = await como(O, `delete from storage.objects where bucket_id = 'incidencias' returning name`)
ok(r.filas?.length === 1, 'operador puede borrar la foto')

// Supresión (RF8)
await db.query('delete from auth.users where id = $1', [A])
const quedan = (await db.query('select (select count(*) from public.incidencias where autor_id = $1)::int i, (select count(*) from public.perfiles where id = $1)::int p', [A])).rows[0]
ok(quedan.i === 0 && quedan.p === 0, 'borrar la cuenta borra perfil e incidencias')
ok((await db.query('select count(*)::int n from public.incidencias_historial')).rows[0].n === 0, 'y su historial')

console.log(fallos === 0 ? '\nTodas las pruebas pasaron' : `\n${fallos} prueba(s) fallaron`)
process.exit(fallos ? 1 : 0)
