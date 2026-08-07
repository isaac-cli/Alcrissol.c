const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const jsonPath = path.join(__dirname, 'productos-update.json');
const csvPath = path.join(__dirname, 'productos-gary.csv');

function escapeCSV(val) {
    if (val === null || val === undefined) return '';
    let str = String(val).trim();
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

try {
    const products = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    
    // Headers: sku,nombre,precio,stock,categoria,marca,imagen,descripcion
    const csvLines = ['sku,nombre,precio,stock,categoria,marca,imagen,descripcion'];
    
    for (const p of products) {
        // Parse price to integer/number format if it has .00
        const price = Math.round(Number(p.precio)) || 0;
        
        const row = [
            escapeCSV(p.sku),
            escapeCSV(p.nombre),
            escapeCSV(price),
            escapeCSV(p.stock),
            escapeCSV(p.categoria),
            escapeCSV(p.marca),
            escapeCSV(p.imagen),
            escapeCSV(p.descripcion)
        ].join(',');
        
        csvLines.push(row);
    }
    
    fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');
    console.log('✅ productos-gary.csv actualizado con éxito a partir de productos-update.json');

    // Ahora ejecutar el importador
    console.log('⏳ Ejecutando el importador de productos para actualizar Neon...');
    exec('node import-productos-gary.js productos-gary.csv', (err, stdout, stderr) => {
        if (err) {
            console.error('❌ Error ejecutando import-productos-gary.js:', err);
            return;
        }
        if (stderr) {
            console.error('⚠️  Stderr:', stderr);
        }
        console.log(stdout);
        console.log('🚀 Base de datos Neon actualizada correctamente.');
    });

} catch (e) {
    console.error('❌ Error general:', e);
}
