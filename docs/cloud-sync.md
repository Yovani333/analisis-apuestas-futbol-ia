# Sincronizacion en linea con Supabase

La aplicacion mantiene una copia local y sincroniza por cuenta los picks, parlays, borrador de parlay, evidencias prepartido, alertas, preferencias y uso responsable.

## Configuracion inicial

1. Abre el proyecto en Supabase.
2. En **SQL Editor**, ejecuta completo `supabase/migrations/001_user_sync_state.sql`.
3. Para evidencias automaticas, ejecuta tambien `supabase/migrations/002_automatic_evidence.sql`.
4. Para sincronizacion acumulativa entre dispositivos, ejecuta `supabase/migrations/003_lossless_cloud_sync.sql`.
5. Para evitar errores al sincronizar cupones con fechas vacias o antiguas, ejecuta `supabase/migrations/004_parlay_draft_revision.sql` y luego `supabase/migrations/005_safe_cloud_sync_timestamps.sql`.
6. En **Authentication > URL Configuration**, configura como Site URL la URL publica de Render y agrega esa misma URL a Redirect URLs.
7. En Render deben existir:

```text
SUPABASE_URL=https://proyecto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
EVIDENCE_AUTOMATION_SECRET=una-cadena-aleatoria-larga
EVIDENCE_AUTOMATION_INTERVAL_MS=300000
```

8. Despliega de nuevo el servicio.

`SUPABASE_SECRET_KEY` se usa exclusivamente dentro del backend de Render para procesar encuentros de todas las cuentas. Nunca debe agregarse a HTML, JavaScript publico ni GitHub. La clave publicable solo permite operaciones autorizadas por las politicas RLS.

## Uso

En **Mi cuenta > Sincronizacion en linea**, crea una cuenta o inicia sesion. Si Supabase exige confirmacion de correo, abre el enlace recibido y despues inicia sesion.

Cada conexion y cada uso de **Sincronizar ahora** combina primero los datos locales y remotos por identificador. La funcion SQL de la migracion 003 hace la union de forma atomica para que dos dispositivos no reemplacen sus picks o parlays entre si. Cerrar sesion elimina la copia personal de ese navegador, pero no borra la informacion de Supabase.

La migracion `004_parlay_draft_revision.sql` agrega una revision para el cupon en preparacion. Quitar un pick o vaciar el cupon reemplaza su version anterior y evita que selecciones antiguas reaparezcan desde otro dispositivo.

La migracion `005_safe_cloud_sync_timestamps.sql` endurece esa revision: si un navegador envia una fecha vacia, invalida o faltante, Supabase ya no debe romper la sincronizacion. Tambien vuelve a cargar el schema cache de PostgREST con `notify pgrst, 'reload schema';`.

## Evidencia automatica una hora antes

Cuando una cuenta ha iniciado sesion, cada busqueda registra sus fixtures programados en `evidence_watchlist`. El backend revisa la cola cada cinco minutos y captura una sola evidencia por usuario y fixture cuando faltan aproximadamente 60 minutos. La captura usa API-Football y los modelos internos; no llama a OpenAI y no usa estadisticas del fixture actual. Un error temporal se reintenta hasta tres veces antes de marcar la captura como fallida. Si varias cuentas vigilan el mismo fixture en un ciclo, la respuesta deportiva se consulta una vez y se reutiliza sin mezclar los datos privados de las cuentas.

La tarea interna funciona mientras el servicio de Render esta activo. Si el plan permite suspender el servicio, configura un monitor o cron externo para enviar cada cinco minutos:

```text
POST https://TU-SERVICIO.onrender.com/api/automation/evidence/run
X-Automation-Secret: el mismo valor de EVIDENCE_AUTOMATION_SECRET
```

El endpoint esta protegido y no debe invocarse desde el navegador. Las evidencias automaticas se descargan al iniciar sesion, recargar o pulsar **Sincronizar ahora**.

## Datos y seguridad

La tabla `public.user_sync_state` tiene una fila por usuario. Row Level Security exige que `auth.uid()` coincida con `user_id` para seleccionar, insertar, actualizar o eliminar. Las contrasenas son administradas por Supabase Auth y nunca se almacenan en esta aplicacion.
