# CAR CENTER — Qué se agregó y cómo subirlo a la nube

## 1. Lo que hice

- **Transbank Webpay Plus**: ya estaba integrado en tu `server.js` (modo Integración/pruebas). Lo dejé
  controlable por variables de entorno (`TBK_ENV=production` + `TBK_COMMERCE_CODE` + `TBK_API_KEY`)
  para cuando Transbank te entregue tus credenciales reales.
- **Chilexpress (envíos)**: agregué `chilexpress.js` con las funciones para generar la orden de
  transporte, rastrear el envío y reimprimir etiqueta, más 2 rutas nuevas en `server.js`:
  - `POST /chilexpress/generar/:pedido_id` → genera el envío para un pedido.
  - `GET /chilexpress/rastreo/:pedido_id` → devuelve el N° de seguimiento y estado.
  Cuando el cliente paga con Webpay y la transacción es aprobada, el envío se genera
  **automáticamente**. Para pagos por transferencia/efectivo, llama tú manualmente a
  `POST /chilexpress/generar/:pedido_id` una vez que confirmes el pago (por ejemplo desde un
  panel de administración simple, o con Postman/curl mientras no tengas panel).
- **Base de datos** (`schema.sql`): agregué las columnas que Chilexpress necesita (número de
  seguimiento, certificado, estado, etiqueta) y datos de producto que la API pide para cotizar/enviar
  (peso y dimensiones).
- **`import-productos.js` + `productos-ejemplo.csv`**: para subir tus productos a Neon en bloque
  desde una planilla, en vez de uno por uno.

## 2. Datos que te faltan pedirle a tu socio / a Chilexpress y Transbank

| Dato | Dónde se usa | Cómo se obtiene |
|---|---|---|
| Subscription Key de "API Envíos" | `CHILEXPRESS_SUBSCRIPTION_KEY` | Portal Developers Chilexpress → crear cuenta → suscribirse a la API Envíos |
| N° de TCC (Tarjeta Cliente Chilexpress) | `CHILEXPRESS_TCC` | Tu socio, ya que es la cuenta que Chilexpress cobra |
| Código de cobertura de tu comuna de origen | `TIENDA_COVERAGE_CODE` | API de Coberturas de Chilexpress (o pídeselo a tu socio/ejecutivo) |
| Código de comercio y API Key Webpay | `TBK_COMMERCE_CODE`, `TBK_API_KEY` | Portal Transbank, una vez que te aprueben como comercio afiliado |

**Importante sobre Chilexpress:** en la imagen que me compartiste veo que ya tienes acceso al portal
de pruebas con esos 8 endpoints. Los nombres de campo que usé en `chilexpress.js`
(`countyCode`, `serviceDeliveryCode`, `labelType`, etc.) corresponden a la estructura pública estándar
de esa API — antes de pasar a producción, abre cada endpoint ("Generar envío", "Tracking") en el
portal con el botón **"Try it"** y compara los nombres de campo exactos de tu contrato; si difieren
levemente, ajústalos en `chilexpress.js` (están todos concentrados ahí).

También falta resolver el **código de cobertura por comuna** (`coverage_code`): hoy el checkout
solo pide el nombre de la comuna en texto libre. Antes de generar envíos reales, hay que:
1. Llamar a la API de Coberturas de Chilexpress con el nombre de la comuna, o
2. Cargar una tabla propia (comuna → coverage_code) que Chilexpress te puede entregar como listado.
Puedo ayudarte a construir cualquiera de las dos apenas tengas la Subscription Key.

## 3. Base de datos: cómo crear las tablas y subir tus productos

1. Entra a tu proyecto en [Neon](https://console.neon.tech), abre el **SQL Editor**.
2. Pega y ejecuta el contenido completo de `schema.sql` (crea las 4 tablas, es seguro
   ejecutarlo aunque ya existan: usa `IF NOT EXISTS`).
3. Para subir productos:
   - Duplica `productos-ejemplo.csv`, complétalo con tus productos reales (respeta las columnas).
   - En tu computador, dentro de la carpeta del proyecto:
     ```bash
     npm install
     cp .env.example .env      # y completa tu DATABASE_URL real de Neon
     node import-productos.js mis-productos.csv
     ```
   - Puedes correrlo cuantas veces quieras: si repites un mismo `sku`, actualiza el producto
     en vez de duplicarlo.

## 4. Cómo subir esto a la nube (no tienes hosting todavía)

Tu `script.js` ya apunta a `https://carcenter-api.onrender.com`, así que te dejo los pasos para
**Render** (tiene plan gratuito, es la opción más simple para un backend Node + Express):

1. Sube esta carpeta a un repositorio de GitHub (puede ser privado).
2. Entra a [render.com](https://render.com) → **New + → Web Service** → conecta tu repo.
3. Configuración:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. En la pestaña **Environment**, agrega TODAS las variables de `.env.example` con tus valores
   reales (`DATABASE_URL`, `TBK_*`, `CHILEXPRESS_*`, `TIENDA_*`, y `BASE_URL` con la URL pública
   que Render te asigne, ej: `https://carcenter-api.onrender.com`).
5. Deploy. Cuando termine, prueba `https://TU-URL.onrender.com/health` — debe responder
   `{"status":"ok","db":"connected"}`.
6. Si tu URL final es distinta a `carcenter-api.onrender.com`, actualízala en 3 archivos:
   `script.js` (línea con `fetch("https://carcenter-api.onrender.com/...")`, aparece 2 veces),
   `checkout.html` (`const API_URL = ...`), y `gracias.html` (`const API_URL = ...`).
7. El frontend (`index.html`, `checkout.html`, `gracias.html`, `styles.css`, `script.js`) lo puedes
   publicar gratis en **Netlify**, **Vercel** o **GitHub Pages** — son sitios estáticos, no necesitan
   servidor propio.

**Nota sobre el plan gratuito de Render:** el servicio "se duerme" tras ~15 min sin uso y demora
unos segundos en despertar en la primera visita del día. Si eso te molesta cuando tengas tráfico
real, el plan pagado más económico (~US$7/mes) lo mantiene siempre activo.

## 5. Antes de salir a producción real (checklist)

- [ ] Ejecutar `schema.sql` en Neon
- [ ] Subir productos reales con `import-productos.js`
- [ ] Backend desplegado en Render (u otro) con todas las variables de entorno
- [ ] Frontend desplegado (Netlify/Vercel) apuntando a la URL del backend
- [ ] Credenciales de **producción** de Transbank cargadas (`TBK_ENV=production`)
- [ ] Subscription Key de **producción** de Chilexpress + TCC de tu socio cargados
- [ ] Código de cobertura por comuna resuelto (paso pendiente descrito arriba)
- [ ] Probar una compra de punta a punta con una tarjeta real de bajo monto
