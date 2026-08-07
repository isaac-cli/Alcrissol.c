# Plan de Despliegue de Car Center

Este plan detalla cómo subir la aplicación (Frontend y Backend) de la manera más rápida, económica (100% gratis o con costo mínimo) y segura posible.

---

## 🚀 Arquitectura de Despliegue Recomendada

Para optimizar costos y maximizar la velocidad y seguridad, dividiremos la aplicación en tres partes:

- **Base de Datos:** Neon PostgreSQL (Gratis)
- **Frontend:** Netlify o Vercel (Gratis)
- **Backend (API):** Render.com (Gratis o $7 USD/mes)

---

## 🛠️ Guía Paso a Paso para Desplegar

### Paso 1: Subir tu Código a GitHub
1. Crea un repositorio privado en GitHub.
2. Sube todos los archivos de tu proyecto **excepto** el archivo `.env` (este se define en Render directamente). El archivo `.gitignore` debe incluir `.env`.

### Paso 2: Desplegar el Backend en Render.com
1. Crea una cuenta en [Render](https://render.com/).
2. Haz clic en **New +** y selecciona **Web Service**.
3. Conecta tu repositorio de GitHub y selecciona la carpeta del proyecto.
4. Configura los siguientes parámetros:
   *   **Name:** `carcenter-api`
   *   **Runtime:** `Node`
   *   **Build Command:** `npm install`
   *   **Start Command:** `npm start`
5. En la sección **Environment**, agrega todas las variables de entorno de tu archivo `.env`:
   *   `DATABASE_URL`: *Tu cadena de conexión de Neon.*
   *   `TBK_ENV`: `test` *(o `production` cuando tengas el código de comercio real).*
   *   `TBK_COMMERCE_CODE`: *(Vacío para pruebas).*
   *   `TBK_API_KEY`: *(Vacío para pruebas).*
   *   `CHILEXPRESS_ENV`: `test`
   *   `CHILEXPRESS_SUBSCRIPTION_KEY`: *(Tu credencial de Chilexpress).*
   *   `CHILEXPRESS_TCC`: *(Tu TCC).*
   *   `BASE_URL`: *La URL que te asigne Render (ej. `https://tu-app.onrender.com`).*
6. Haz clic en **Create Web Service**.

### Paso 3: Desplegar el Frontend en Netlify / Vercel
1. Crea una cuenta en Netlify o Vercel.
2. Conecta tu cuenta de GitHub y selecciona el mismo repositorio.
3. Configura la carpeta raíz de publicación como `carcenter_out`.
4. Haz clic en **Deploy**.
5. ¡Listo! Netlify/Vercel te dará una URL segura tipo `https://tu-tienda.netlify.app`.

---


 
  
## 🔒 Buenas Prácticas de Seguridad

*   **HTTPS obligatorio:** Netlify y Render generan automáticamente certificados SSL (HTTPS). Nunca permitas tráfico HTTP sin encriptar.
*   **Variables de Entorno ocultas:** Bajo ninguna circunstancia subas tu archivo `.env` a GitHub. Las contraseñas de Neon, Transbank y Chilexpress deben vivir únicamente en el panel de control de Render.
*   **Sanitización de Datos:** La base de datos utiliza consultas preparadas (`pool.query('SELECT ... WHERE id = $1')`) lo que previene ataques de Inyección SQL.
