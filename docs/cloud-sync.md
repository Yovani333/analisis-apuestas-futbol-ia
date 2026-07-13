# Sincronizacion en linea con Supabase

La aplicacion mantiene una copia local y sincroniza por cuenta los picks, parlays, borrador de parlay, evidencias prepartido, alertas, preferencias y uso responsable.

## Configuracion inicial

1. Abre el proyecto en Supabase.
2. En **SQL Editor**, ejecuta completo `supabase/migrations/001_user_sync_state.sql`.
3. En **Authentication > URL Configuration**, configura como Site URL la URL publica de Render y agrega esa misma URL a Redirect URLs.
4. En Render deben existir:

```text
SUPABASE_URL=https://proyecto.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

5. Despliega de nuevo el servicio.

No se debe agregar `service_role`, `secret key` ni la contrasena de PostgreSQL al frontend. La clave publicable solo permite operaciones autorizadas por las politicas RLS.

## Uso

En **Mi cuenta > Sincronizacion en linea**, crea una cuenta o inicia sesion. Si Supabase exige confirmacion de correo, abre el enlace recibido y despues inicia sesion.

La primera conexion de cada cuenta en un navegador combina los datos locales y remotos. Las conexiones posteriores descargan el estado remoto antes de habilitar la sincronizacion automatica. Cerrar sesion elimina la copia personal de ese navegador, pero no borra la informacion de Supabase.

## Datos y seguridad

La tabla `public.user_sync_state` tiene una fila por usuario. Row Level Security exige que `auth.uid()` coincida con `user_id` para seleccionar, insertar, actualizar o eliminar. Las contrasenas son administradas por Supabase Auth y nunca se almacenan en esta aplicacion.
