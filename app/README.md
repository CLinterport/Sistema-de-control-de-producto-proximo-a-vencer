# Control de producto próximo a vencer

Aplicación web para que el mercaderista registre en el anaquel el producto próximo
a vencer, y para que supervisores y KAM gestionen los casos hasta cerrarlos.

Construida sobre Next.js y PostgreSQL en Supabase, esquema `pvencer`.

---

## Cómo publicarlo

### 1. Subirlo a GitHub

```bash
git init
git add .
git commit -m "Sistema de control de producto proximo a vencer"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

### 2. Conseguir la cadena de conexión

En Supabase: **Project Settings → Database → Connection string → Transaction pooler**.

Usa el **puerto 6543**, no el 5432. Vercel abre y cierra una función en cada
petición; sin el pooler se agotan las conexiones de Postgres en minutos y la app
empieza a fallar de forma intermitente, que es el peor tipo de falla porque
parece aleatoria.

Sustituye `[YOUR-PASSWORD]` por la clave de la base.

### 3. Desplegar en Vercel

Importa el repositorio y agrega dos variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la cadena del paso 2, con puerto 6543 |
| `SESSION_SECRET` | cualquier texto largo y aleatorio |

Vercel detecta Next.js solo. No hay más configuración.

### 4. Entrar

Los usuarios ya están creados en la base con clave temporal `Merca2026`.
Todos deben cambiarla al primer ingreso; la app lo obliga.

| Usuario | Rol |
|---|---|
| `edilson`, `ramon`, `marvin`, `danny`, `brandon`, `cesar`, `edick` | supervisor |
| `jpablo`, `ssanchez`, `rcaceres`, `francesca` | KAM |
| `admin` | administrador |

**Cambia la clave del usuario `admin` antes de que esto sea público.**

---

## Cómo está organizado

```
app/
  page.js              inicio de sesión y cambio de clave obligatorio
  inicio/              resumen según el rol
  capturar/            captura en tienda: escaneo, cantidad, fecha
  api/
    login, logout, clave    autenticación propia
    buscar                  tiendas, productos y códigos de barra
    captura                 alta y actualización de detecciones
lib/
  db.js                conexión y bitácora de auditoría
  sesion.js            cookies firmadas y permisos por rol
```

---

## Decisiones que conviene no deshacer

**La app nunca habla directo con Supabase desde el navegador.** Todo pasa por el
servidor. Dos razones: exponer el esquema `pvencer` a la API es un cambio de todo
el proyecto y afectaría a InterCL, que comparte la misma base; y las credenciales
no tienen por qué llegar nunca al teléfono de nadie.

**La autenticación es propia, no la de Supabase.** Supabase Auth guarda usuarios en
el esquema `auth`, que InterCL también usa. Mezclar ahí a los mercaderistas haría
imposible separar los sistemas después. Las claves se guardan con bcrypt mediante
`pgcrypto`, y tras cinco intentos fallidos la cuenta se bloquea quince minutos.

**El estado y los días restantes nunca se guardan, se calculan.** Un producto que
ayer estaba en riesgo hoy aparece crítico solo. Así se elimina de raíz el problema
del Excel, donde el semáforo quedaba congelado al momento de copiar entre hojas.

**Un código de barras desconocido no bloquea la captura.** Se guarda con el producto
en blanco y queda marcado para revisar. Perder una captura por un código que falta
en el catálogo es peor que tener un registro incompleto.

**La cantidad se actualiza, no se duplica.** Si el mismo producto con la misma fecha
ya existe en esa tienda, la visita siguiente actualiza la cantidad y escribe una
fila en `deteccion_historial`. De ahí sale la rotación real medida en anaquel.
Si la cantidad sube, la app pregunta en vez de asumir.

---

## Lo que todavía falta

- Pantallas de propuesta, autorización y ejecución (el prototipo `casos.html` ya
  tiene el flujo completo, falta conectarlo a la base)
- Módulo de maestros conectado (el prototipo `maestros.html` tiene el diseño)
- Consolidado y exportación a Excel
- Captura sin señal con IndexedDB
- Resumen diario y alertas

---

## Pendientes de catálogo antes de arrancar

**281 de los 476 productos no tienen definidas sus unidades por caja.** La regla de
autorización se mide en cajas: hasta 3 autoriza el supervisor, más pasa al KAM. Un
producto sin ese dato escala al KAM por precaución.

Medido sobre las 79 capturas reales de la zona nororiente: 55 escalarían al KAM, y
42 de esas únicamente por falta de este dato. Mientras no se complete, el límite de
3 cajas no filtra nada y el KAM recibe casi todo.

Se completa en la pantalla de maestros, filtrando por «solo los que faltan».

---

## Nota de seguridad sobre las versiones

Este proyecto está fijado en **Next.js 15.5.25** y **React 19.2.8**, no en versiones
anteriores, y no conviene bajarlas.

En diciembre de 2025 se publicó CVE-2025-66478, una vulnerabilidad crítica de
ejecución remota de código (CVSS 10.0) que afecta a aplicaciones con App Router y
React Server Components, que es exactamente lo que usa esta app. Un atacante sin
credenciales podía ejecutar código en el servidor con una sola petición HTTP.
Después hubo parches adicionales por denegación de servicio y exposición de código
fuente, y más correcciones críticas durante 2026.

La línea 15.5 es la de mantenimiento a largo plazo y recibe parches de seguridad
mensuales. Conviene revisar https://nextjs.org/blog cada cierto tiempo y subir a la
última 15.5.x cuando salga.

`npm audit` todavía reporta avisos en `postcss` y `sharp`, que son dependencias
internas de Next.js. Afectan a la compilación y a la optimización de imágenes, no al
manejo de peticiones, y esta app no usa optimización de imágenes. Se resuelven al
migrar a la línea 16.x, que es un cambio mayor y conviene hacer con calma, no en
medio del arranque del piloto.
