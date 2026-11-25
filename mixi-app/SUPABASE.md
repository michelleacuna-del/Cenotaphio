# Configurar inicio de sesión y respaldo

La aplicación deja Inicio y Explorar disponibles sin iniciar sesión. Al entrar en **Mi altar**, solicita una cuenta mediante una ventana de acceso. Usa Supabase Auth y una fila JSON privada por usuario para respaldar sus altares. Los ejemplos incluidos en la página son de solo lectura y no se copian al respaldo personal.

## Preparar el proyecto

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, ejecuta el contenido de `supabase-schema.sql`. La tabla activa RLS y solo permite a cada cuenta leer y modificar su propia fila. La función `get_public_altars()` solo expone el nombre, identificador y punto simbólico de altares que eligieron una posición; no da acceso público a la tabla ni a los respaldos completos.
3. En **Authentication → URL Configuration**, configura como **Site URL** `https://miacunaparra.github.io/Cenotaphio/` y agrega esa misma dirección a **Redirect URLs**. Agrega también las URLs locales que utilizarás para desarrollo.
4. En **Authentication → Providers → Email**, habilita correo y contraseña. La confirmación de correo puede requerir configurar SMTP para el dominio de producción.
5. Copia la **Project URL** y la **publishable key** (o la `anon` key heredada) a `supabase-config.js`, en `url` y `anonKey`. La configuración de este sitio ya está completada con esos valores públicos.
6. El sitio se publica en HTTPS en `https://miacunaparra.github.io/Cenotaphio/` mediante GitHub Actions cada vez que se actualiza `main`. Tras configurar el esquema y los ajustes de autenticación, prueba registro, confirmación, inicio de sesión, recuperación de contraseña y aislamiento entre dos cuentas.

La clave publishable/anon se usa en el navegador; nunca pongas una `service_role` o clave secreta en este archivo. La protección de los datos depende de las políticas RLS del esquema.

Un altar solo aparece en Explorar cuando la persona elige y guarda un punto simbólico para él. Al guardarlo se hace visible su nombre y esa posición; no es una dirección ni una ubicación física. Los altares que estaban marcados como privados anteriormente siguen ocultos hasta que su dueña o dueño vuelva a guardar un punto. Si ya tenías el esquema instalado, vuelve a ejecutar el SQL actualizado para quitar la antigua función pública de recuerdos y habilitar `get_public_altars()`.

## Datos guardados anteriormente en este navegador

Los datos del prototipo anterior permanecen en `localStorage` y no se importan automáticamente: este navegador puede ser compartido, y asignarlos a la primera cuenta que inicie sesión podría exponerlos a la persona equivocada. Si hay datos anteriores, después de iniciar sesión puedes elegir **Importar datos de este navegador**; se te pedirá confirmación y se copiarán a la cuenta actual sin borrar la copia local. Los perfiles de ejemplo incluidos en ese respaldo también se copiarán como altares editables de la cuenta.
