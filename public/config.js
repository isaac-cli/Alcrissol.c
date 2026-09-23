// config.js
// Configuración de la URL del Backend (Render) para el Frontend (Vercel)
// Si cambias tu URL en Render, edítala aquí una sola vez.

window.API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : (window.location.origin.includes('accsalcrison.cl') ? window.location.origin : 'https://alcrissol-c.onrender.com');

