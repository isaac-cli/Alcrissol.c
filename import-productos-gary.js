// ============================================================
// IMPORTADOR DE PRODUCTOS → tu tabla "productos" en Neon
// Ajustado a tu esquema ACTUAL (visto en tus capturas de Neon):
// id, sku, nombre, precio, stock, categoria, marca, imagen, descripcion, created_at
// ------------------------------------------------------------
// Uso:
//   node import-productos-gary.js productos-gary.csv
// ============================================================

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const archivo = process.argv[2];
if (!archivo) {
    console.error('❌ Indica el archivo CSV. Ejemplo: node import-productos-gary.js productos-gary.csv');
    process.exit(1);
}

const rutaArchivo = path.resolve(archivo);
if (!fs.existsSync(rutaArchivo)) {
    console.error(`❌ No se encontró el archivo: ${rutaArchivo}`);
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

function parseCSV(contenido) {
    const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);
    const encabezados = lineas[0].split(',').map(h => h.trim());
    const filas = [];

    for (let i = 1; i < lineas.length; i++) {
        const valores = [];
        let actual = '';
        let dentroComillas = false;
        for (const char of lineas[i]) {
            if (char === '"') { dentroComillas = !dentroComillas; continue; }
            if (char === ',' && !dentroComillas) { valores.push(actual); actual = ''; continue; }
            actual += char;
        }
        valores.push(actual);

        const fila = {};
        encabezados.forEach((h, idx) => fila[h] = (valores[idx] || '').trim());
        filas.push(fila);
    }
    return filas;
}

async function importar() {
    const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
    const productos = parseCSV(contenido);

    console.log(`📦 ${productos.length} productos encontrados. Subiendo a Neon...\n`);

    let creados = 0, actualizados = 0, errores = 0, pendientes = 0;

    for (const p of productos) {
        try {
            const precio = Number(p.precio) || 0;
            if (precio === 0) pendientes++;

            const result = await pool.query(
                `INSERT INTO productos (sku, nombre, precio, stock, categoria, marca, imagen, descripcion)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                 ON CONFLICT (sku) DO UPDATE SET
                    nombre=EXCLUDED.nombre, precio=EXCLUDED.precio, stock=EXCLUDED.stock,
                    categoria=EXCLUDED.categoria, marca=EXCLUDED.marca, imagen=EXCLUDED.imagen,
                    descripcion=EXCLUDED.descripcion
                 RETURNING (xmax = 0) AS es_nuevo`,
                [
                    p.sku || null,
                    p.nombre,
                    precio,
                    Number(p.stock) || 0,
                    p.categoria || null,
                    p.marca || null,
                    p.imagen || null,
                    p.descripcion || null
                ]
            );

            const marcaPendiente = precio === 0 ? ' ⚠️  (precio/stock pendiente de verificar)' : '';
            if (result.rows[0].es_nuevo) { creados++; console.log(`✅ Creado: ${p.nombre}${marcaPendiente}`); }
            else { actualizados++; console.log(`🔄 Actualizado: ${p.nombre}${marcaPendiente}`); }

        } catch (err) {
            errores++;
            console.error(`❌ Error con "${p.nombre}":`, err.message);
        }
    }

    console.log(`\n— Resumen —`);
    console.log(`Creados: ${creados} | Actualizados: ${actualizados} | Errores: ${errores}`);
    console.log(`⚠️  Productos con precio en $0 (pendientes de verificar antes de vender): ${pendientes}`);
    await pool.end();
}

importar();
