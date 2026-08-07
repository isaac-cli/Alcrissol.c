// ============================================================
// CAR CENTER - API SERVER
// Base de datos: Neon PostgreSQL
// Pagos: Transbank Webpay Plus (SDK oficial)
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const chilexpress = require('./chilexpress');
const { buscarCalle, obtenerCertificadoOT, obtenerRegiones, obtenerComunas } = chilexpress;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ============================================================
// DATOS DE ORIGEN (tu tienda) — se usan para generar cada envío
// Reemplaza con la dirección real de retiro/despacho.
// El "coverage_code" se obtiene con la API de Coberturas de Chilexpress
// (o te lo entrega tu ejecutivo junto con tu TCC).
// ============================================================
const REMITENTE = {
    nombre: process.env.TIENDA_NOMBRE || 'CAR CENTER',
    telefono: process.env.TIENDA_TELEFONO || '+56900000000',
    email: process.env.TIENDA_EMAIL || 'pedidos@carcenter.cl',
    calle: process.env.TIENDA_CALLE || 'Av. Principal',
    numero: process.env.TIENDA_NUMERO || '123',
    calle2: process.env.TIENDA_CALLE2 || '',
    coverage_code: process.env.TIENDA_COVERAGE_CODE || 'STGO'
};

// ============================================================
// CONEXIÓN A NEON POSTGRESQL
// ============================================================
if (!process.env.DATABASE_URL) {
    console.error('❌ Falta DATABASE_URL en las variables de entorno. Configúrala en .env (local) o en Render (Environment).');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============================================================
// TRANSBANK WEBPAY PLUS
// ============================================================
// npm install transbank-sdk
const { WebpayPlus, Options, IntegrationApiKeys, Environment, IntegrationCommerceCodes } = require('transbank-sdk');

// AMBIENTE: se controla con la variable de entorno TBK_ENV=production
// Mientras no la definas, corre en modo Integración (pruebas) con las
// tarjetas y comercio de prueba oficiales de Transbank.
const esProduccion = process.env.TBK_ENV === 'production';
const tbkOptions = new Options(
    esProduccion ? process.env.TBK_COMMERCE_CODE : IntegrationCommerceCodes.WEBPAY_PLUS,
    esProduccion ? process.env.TBK_API_KEY : IntegrationApiKeys.WEBPAY,
    esProduccion ? Environment.Production : Environment.Integration
);

const tx = new WebpayPlus.Transaction(tbkOptions);

// ============================================================
// RUTAS: PRODUCTOS
// ============================================================

// GET /productos - listar todos
app.get('/productos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos ORDER BY id');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// GET /productos/:id - detalle de un producto
app.get('/productos/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener producto' });
    }
});

// POST /productos - crear producto (admin)
app.post('/productos', async (req, res) => {
    const { sku, nombre, precio, stock, categoria, marca, imagen, descripcion } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO productos (sku, nombre, precio, stock, categoria, marca, imagen, descripcion)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [sku, nombre, precio, stock, categoria, marca, imagen, descripcion]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Error al crear producto' });
    }
});

// PUT /productos/:id - actualizar stock (admin)
app.put('/productos/:id', async (req, res) => {
    const { nombre, precio, stock, categoria, marca, imagen, descripcion } = req.body;
    try {
        const result = await pool.query(
            `UPDATE productos SET nombre=$1, precio=$2, stock=$3, categoria=$4, marca=$5,
             imagen=$6, descripcion=$7 WHERE id=$8 RETURNING *`,
            [nombre, precio, stock, categoria, marca, imagen, descripcion, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// ============================================================
// RUTAS: PEDIDOS
// ============================================================

// POST /pedidos - crear pedido
app.post('/pedidos', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { nombre, email, telefono, nit, metodo_pago, total, items, direccion } = req.body;

        // 1. Crear el pedido
        const pedidoResult = await client.query(
            `INSERT INTO pedidos (nombre, email, telefono, nit, metodo_pago, total, estado)
             VALUES ($1,$2,$3,$4,$5,$6,'pendiente') RETURNING *`,
            [nombre, email, telefono, nit, metodo_pago, total]
        );
        const pedido = pedidoResult.rows[0];

        // 2. Insertar dirección de envío
        if (direccion) {
            // Separamos "Av. Ejemplo 1234" en nombre de calle + número,
            // ya que Chilexpress los pide como campos independientes.
            const match = direccion.calle.match(/^(.*?)(\d+)\s*$/);
            const calleNombre = match ? match[1].trim() : direccion.calle;
            const calleNumero = match ? match[2].trim() : 'S/N';

            await client.query(
                `INSERT INTO direccion_envio (pedido_id, calle, calle2, numero, comuna, region, instrucciones, coverage_code)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [pedido.id, calleNombre, direccion.calle2, calleNumero, direccion.comuna, direccion.region, direccion.instrucciones, direccion.coverage_code || null]
            );
        }

        // 3. Insertar detalle del pedido y actualizar stock
        for (const item of items) {
            await client.query(
                `INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, precio_historico)
                 VALUES ($1,$2,$3,$4)`,
                [pedido.id, item.id, item.quantity, item.price]
            );
            // Bajar stock
            await client.query(
                'UPDATE productos SET stock = stock - $1 WHERE id = $2',
                [item.quantity, item.id]
            );
        }

        await client.query('COMMIT');
        res.status(201).json({ pedido_id: pedido.id, orden: `ORD-${pedido.id}` });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Error al crear pedido' });
    } finally {
        client.release();
    }
});

// GET /pedidos/:id - ver un pedido
app.get('/pedidos/:id', async (req, res) => {
    try {
        const pedido = await pool.query('SELECT * FROM pedidos WHERE id = $1', [req.params.id]);
        const detalles = await pool.query(
            `SELECT dp.*, p.nombre, p.imagen FROM detalle_pedido dp
             JOIN productos p ON dp.producto_id = p.id
             WHERE dp.pedido_id = $1`,
            [req.params.id]
        );
        const direccion = await pool.query(
            'SELECT * FROM direccion_envio WHERE pedido_id = $1', [req.params.id]
        );
        res.json({
            pedido: pedido.rows[0],
            items: detalles.rows,
            direccion: direccion.rows[0]
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al obtener pedido' });
    }
});

// PATCH /pedidos/:id/estado - actualizar estado
app.patch('/pedidos/:id/estado', async (req, res) => {
    try {
        await pool.query(
            'UPDATE pedidos SET estado=$1 WHERE id=$2',
            [req.body.estado, req.params.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// ============================================================
// RUTAS: TRANSBANK WEBPAY PLUS
// ============================================================

// PASO 1: Iniciar transacción Webpay
// El frontend llama esto para obtener la URL de pago de Transbank
app.post('/transbank/crear', async (req, res) => {
    const { pedido_id, monto } = req.body;

    // URLs donde Transbank redirigirá al usuario después del pago
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const returnUrl = `${baseUrl}/transbank/retorno`;

    try {
        const response = await tx.create(
            `ORD-${pedido_id}`,   // buyOrder: identificador único del pedido
            `SES-${Date.now()}`,  // sessionId: ID de sesión
            monto,                // amount: monto en pesos CLP
            returnUrl             // returnUrl: donde Transbank devuelve al comprador
        );

        // Guardar el token en la BD para verificarlo después
        await pool.query(
            'UPDATE pedidos SET transbank_token=$1 WHERE id=$2',
            [response.token, pedido_id]
        );

        res.json({
            url: response.url,    // URL del formulario de pago de Transbank
            token: response.token // Token que hay que enviar como campo POST a esa URL
        });
    } catch (err) {
        console.error('Transbank crear:', err);
        res.status(500).json({ error: 'Error al crear transacción Transbank' });
    }
});

// PASO 2: Retorno desde Transbank (Soporta POST y GET con token_ws)
// Transbank redirige aquí después de que el usuario interactúa con Webpay
app.all('/transbank/retorno', async (req, res) => {
    const token_ws = req.body?.token_ws || req.query?.token_ws;
    const TBK_TOKEN = req.body?.TBK_TOKEN || req.query?.TBK_TOKEN;

    if (!token_ws || TBK_TOKEN) {
        // El usuario canceló el pago
        return res.redirect('/checkout.html?pago=cancelado');
    }

    try {
        // Confirmar la transacción con Transbank
        const response = await tx.commit(token_ws);

        // Buscar el pedido asociado al token
        const pedidoResult = await pool.query(
            'SELECT * FROM pedidos WHERE transbank_token=$1', [token_ws]
        );
        const pedido = pedidoResult.rows[0];

        if (!pedido) {
            return res.redirect('/checkout.html?pago=error');
        }

        if (response.response_code === 0) {
            // PAGO APROBADO
            await pool.query(
                `UPDATE pedidos SET estado='pagado', transbank_auth_code=$1,
                 transbank_card_number=$2 WHERE id=$3`,
                [response.authorization_code, response.card_detail?.card_number, pedido.id]
            );

            // Generar el envío en Chilexpress automáticamente (no bloquea la compra si falla)
            try {
                await generarEnvioParaPedido(pedido.id);
            } catch (chxErr) {
                console.error('No se pudo generar el envío Chilexpress automáticamente:', chxErr.response?.data || chxErr.message);
            }

            // Redirigir a página de gracias
            res.redirect(`/gracias.html?orden=ORD-${pedido.id}&total=${pedido.total}&tipo=webpay`);

        } else {

            // PAGO RECHAZADO
            await pool.query(
                'UPDATE pedidos SET estado=$1 WHERE id=$2',
                [`rechazado_${response.response_code}`, pedido.id]
            );
            res.redirect(`/checkout.html?pago=rechazado&codigo=${response.response_code}`);
        }

    } catch (err) {
        console.error('Transbank retorno:', err);
        res.redirect('/checkout.html?pago=error');
    }
});

// ============================================================
// RUTAS: CHILEXPRESS (ENVÍOS)
// ============================================================

// Función reutilizable: arma los datos del pedido y genera la OT en Chilexpress
async function generarEnvioParaPedido(pedido_id) {
    const pedidoRes = await pool.query('SELECT * FROM pedidos WHERE id=$1', [pedido_id]);
    const pedido = pedidoRes.rows[0];
    if (!pedido) throw new Error('Pedido no encontrado');

    const dirRes = await pool.query('SELECT * FROM direccion_envio WHERE pedido_id=$1', [pedido_id]);
    const direccion = dirRes.rows[0];
    if (!direccion) throw new Error('El pedido no tiene dirección de envío');
    if (!direccion.coverage_code) {
        // Sin coverage_code, Chilexpress rechaza el countyCode (obligatorio) y la OT nunca se genera.
        // Esto pasa porque el checkout hoy solo guarda la comuna como texto libre, sin resolverla
        // contra /chilexpress/comunas o /chilexpress/calles. Hay que agregar ese paso en el checkout
        // (ver LEEME-DESPLIEGUE.md, sección "código de cobertura por comuna").
        throw new Error('La dirección de este pedido no tiene coverage_code de Chilexpress asignado. Debes resolverlo (API de comunas/calles o tabla propia) antes de generar el envío.');
    }

    // Sumar peso real de los productos del pedido (si tus productos tienen peso_kg cargado)
    const itemsRes = await pool.query(
        `SELECT dp.cantidad, p.peso_kg, p.alto_cm, p.ancho_cm, p.largo_cm
         FROM detalle_pedido dp JOIN productos p ON dp.producto_id = p.id
         WHERE dp.pedido_id = $1`,
        [pedido_id]
    );
    const peso_total_kg = itemsRes.rows.reduce((acc, r) => acc + (Number(r.peso_kg) || 1) * r.cantidad, 0) || 1;
    direccion.peso_total_kg = peso_total_kg;

    const resultado = await chilexpress.generarEnvio({ pedido, direccion, remitente: REMITENTE });

    // La API entrega un arreglo de bultos generados; tomamos el primero
    const bulto = resultado?.data?.[0] || resultado?.[0] || resultado;
    const ot = bulto?.transportOrderNumber || bulto?.otNumber || null;
    const certificado = bulto?.certificateNumber || null;
    const etiqueta = bulto?.labelData || null;

    await pool.query(
        `UPDATE pedidos SET chilexpress_ot=$1, chilexpress_certificado=$2,
         chilexpress_tracking=$3, chilexpress_etiqueta=$4, chilexpress_estado='generado'
         WHERE id=$5`,
        [ot, certificado, ot, etiqueta, pedido_id]
    );

    return { ot, certificado, etiqueta };
}

// POST /chilexpress/generar/:pedido_id
// Genera (o regenera) el envío para un pedido puntual.
// Úsalo para pedidos pagados por transferencia/efectivo una vez confirmados,
// ya que esos métodos no disparan la generación automática como Webpay.
app.post('/chilexpress/generar/:pedido_id', async (req, res) => {
    try {
        const resultado = await generarEnvioParaPedido(req.params.pedido_id);
        res.json({ ok: true, ...resultado });
    } catch (err) {
        console.error('Chilexpress generar envío:', err.response?.data || err.message);
        res.status(500).json({ error: 'Error al generar el envío en Chilexpress', detalle: err.response?.data || err.message });
    }
});

// GET /chilexpress/rastreo/:pedido_id
// El frontend (ej. gracias.html o "seguimiento de pedido") consulta esto
app.get('/chilexpress/rastreo/:pedido_id', async (req, res) => {
    try {
        const pedidoRes = await pool.query('SELECT chilexpress_tracking, chilexpress_estado FROM pedidos WHERE id=$1', [req.params.pedido_id]);
        const pedido = pedidoRes.rows[0];
        if (!pedido || !pedido.chilexpress_tracking) {
            return res.status(404).json({ error: 'Este pedido aún no tiene envío generado' });
        }

        const tracking = await chilexpress.rastrearEnvio(pedido.chilexpress_tracking);

        const ultimoEstado = tracking?.data?.[0]?.statusDescription || tracking?.statusDescription || null;
        if (ultimoEstado) {
            await pool.query('UPDATE pedidos SET chilexpress_estado=$1 WHERE id=$2', [ultimoEstado, req.params.pedido_id]);
        }

        res.json({ tracking_number: pedido.chilexpress_tracking, estado: ultimoEstado, detalle: tracking });
    } catch (err) {
        console.error('Chilexpress rastreo:', err.response?.data || err.message);
        res.status(500).json({ error: 'Error al consultar el estado del envío' });
    }
});

// GET /chilexpress/calles?input=av.%20ejem&countyCode=STGO&limit=10
// Autocompletado de dirección en el checkout.
// Retorna un arreglo de calles que coinciden con el texto buscado en la comuna dada.
// Requiere CHILEXPRESS_SUBSCRIPTION_KEY en .env (suscripción a Georeference API).
app.get('/chilexpress/calles', async (req, res) => {
    const { input, countyCode, limit } = req.query;
    if (!input || !countyCode) {
        return res.status(400).json({ error: 'Se requieren los parámetros: input, countyCode' });
    }
    try {
        const resultado = await buscarCalle({ input, countyCode, limit: Number(limit) || 10 });
        res.json(resultado);
    } catch (err) {
        console.error('Chilexpress buscarCalle:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Error al buscar calles en Chilexpress',
            detalle: err.response?.data || err.message
        });
    }
});

// GET /chilexpress/regiones
// Retorna el listado de regiones oficiales de Chilexpress
app.get('/chilexpress/regiones', async (req, res) => {
    try {
        const resultado = await obtenerRegiones();
        res.json(resultado);
    } catch (err) {
        console.error('Chilexpress obtenerRegiones:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Error al obtener regiones de Chilexpress',
            detalle: err.response?.data || err.message
        });
    }
});

// GET /chilexpress/comunas/:regionId
// Retorna el listado de comunas/coberturas para la región indicada
app.get('/chilexpress/comunas/:regionId', async (req, res) => {
    try {
        const resultado = await obtenerComunas(req.params.regionId);
        res.json(resultado);
    } catch (err) {
        console.error('Chilexpress obtenerComunas:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Error al obtener comunas de Chilexpress',
            detalle: err.response?.data || err.message
        });
    }
});

// GET /chilexpress/certificado/:pedido_id
// Descarga el certificado de la OT generada para un pedido.
// Requiere que el pedido ya tenga chilexpress_certificado guardado.
app.get('/chilexpress/certificado/:pedido_id', async (req, res) => {
    try {
        const pedidoRes = await pool.query(
            'SELECT chilexpress_certificado, chilexpress_ot FROM pedidos WHERE id=$1',
            [req.params.pedido_id]
        );
        const pedido = pedidoRes.rows[0];
        if (!pedido || !pedido.chilexpress_certificado) {
            return res.status(404).json({ error: 'Este pedido no tiene certificado de envío generado' });
        }
        const certificado = await obtenerCertificadoOT({
            certificateNumber: pedido.chilexpress_certificado
        });
        res.json({
            pedido_id: req.params.pedido_id,
            ot: pedido.chilexpress_ot,
            certificado_numero: pedido.chilexpress_certificado,
            detalle: certificado
        });
    } catch (err) {
        console.error('Chilexpress certificado:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Error al consultar el certificado de envío',
            detalle: err.response?.data || err.message
        });
    }
});

// ============================================================
// RUTA: ESTADO NEON (healthcheck)
// ============================================================
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (err) {
        res.status(500).json({ status: 'error', db: 'disconnected' });
    }
});

// ============================================================
// INICIO
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ CAR CENTER API corriendo en puerto ${PORT}`);
    console.log(`🗄️  Neon PostgreSQL conectado`);
    console.log(`💳 Transbank Webpay en modo: ${esProduccion ? 'PRODUCCIÓN' : 'INTEGRACIÓN (pruebas)'}`);
    console.log(`📦 Chilexpress en modo: ${process.env.CHILEXPRESS_ENV === 'production' ? 'PRODUCCIÓN' : 'PRUEBAS'} (${chilexpress.CHX_BASE_URL})`);
});