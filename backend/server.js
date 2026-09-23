// ============================================================
// CAR CENTER - API SERVER
// Base de datos: Neon PostgreSQL
// Pagos: Transferencia bancaria (único método activo)
// ============================================================

require('dotenv').config();

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, param, validationResult } = require('express-validator');
const xss = require('xss-clean');
const crypto = require('crypto');

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const chilexpress = require('./chilexpress');
const { buscarCalle, obtenerCertificadoOT, obtenerRegiones, obtenerComunas } = chilexpress;

const app = express();

// ============================================================
// ENTORNO
// ============================================================
const esProduccion = process.env.NODE_ENV === 'production';

// ============================================================
// SEGURIDAD
// ============================================================

// CORS: lista blanca de orígenes permitidos
const originesPermitidos = [
    'https://accsalcrison.cl',
    'https://www.accsalcrison.cl',
    'https://api.accsalcrison.cl',
    'https://alcrissol-c.onrender.com'
];
if (!esProduccion) {
    originesPermitidos.push('http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:3000', 'http://127.0.0.1:5500');
}
app.use(cors({
    origin: function (origin, callback) {
        // Permitir requests sin origin (apps móviles, curl, etc)
        if (!origin) return callback(null, true);
        if (originesPermitidos.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        return callback(new Error('Origen no permitido por CORS'));
    },
    credentials: true
}));

// Cabeceras de seguridad con CSP habilitado
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            connectSrc: ["'self'", "https://nominatim.openstreetmap.org", ...originesPermitidos],
            frameSrc: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"]
        }
    },
    crossOriginEmbedderPolicy: false // Para cargar imágenes externas
}));

// Forzar HTTPS en producción si estamos detrás de un proxy (Render/Vercel)
app.use((req, res, next) => {
    if (esProduccion && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect('https://' + req.headers.host + req.url);
    }
    next();
});

app.use(xss()); // Escapa contenido del usuario
app.use(express.json({ limit: '10kb' })); // Restringe tamaño de body

// Rate limit general
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,
    message: { error: 'Demasiadas peticiones. Intente más tarde.' }
});
app.use(limiter);

// Rate limit más estricto para pedidos (anti-abuso)
const pedidosLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Demasiados pedidos. Intente más tarde.' }
});

// Autenticación para administradores — sin fallback inseguro
if (!process.env.ADMIN_API_KEY) {
    console.warn('⚠️  [SEGURIDAD] ADMIN_API_KEY no está definida en .env. Las rutas admin no serán accesibles.');
}
const authMiddleware = (req, res, next) => {
    const token = req.headers['x-api-key'];
    if (!process.env.ADMIN_API_KEY) {
        return res.status(503).json({ error: 'Servicio de administración no configurado' });
    }
    if (token && token === process.env.ADMIN_API_KEY) {
        next();
    } else {
        res.status(401).json({ error: 'No autorizado' });
    }
};

// Funciones de cifrado — requiere clave en variables de entorno
if (!process.env.ENCRYPTION_KEY) {
    console.warn('⚠️  [SEGURIDAD] ENCRYPTION_KEY no está definida en .env. Se usará clave aleatoria temporal.');
}
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
    ? process.env.ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32)
    : crypto.randomBytes(32).toString('hex').substring(0, 32);
const IV_LENGTH = 16;

function encrypt(text) {
    if (!text) return text;
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

// Métodos de pago permitidos actualmente
const METODOS_PAGO_ACTIVOS = ['transferencia'];

// ============================================================
// SERVIR ARCHIVOS ESTÁTICOS
// ============================================================
app.use(express.static(path.join(__dirname, '../public')));

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
    console.error('❌ [ERROR CRÍTICO] Falta la variable DATABASE_URL en las variables de entorno de Render.');
    console.error('👉 Ingresa al panel de Render > Environment > Add Environment Variable > DATABASE_URL');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 5000 // Monitoriza consultas DB
});

pool.on('error', (err) => {
    console.error('⚠️ Error inesperado en el cliente PostgreSQL de Neon:', err);
});

// ============================================================
// MERCADO PAGO (DESHABILITADO TEMPORALMENTE)
// Se activará cuando las credenciales estén configuradas.
// ============================================================
let mpClient = null;
if (process.env.MP_ACCESS_TOKEN && process.env.MP_ACCESS_TOKEN !== 'TU_ACCESS_TOKEN_AQUI') {
    try {
        const { MercadoPagoConfig } = require('mercadopago');
        mpClient = new MercadoPagoConfig({
            accessToken: process.env.MP_ACCESS_TOKEN
        });
        console.log('💳 Mercado Pago configurado (deshabilitado hasta activación)');
    } catch (e) {
        console.warn('⚠️  Mercado Pago SDK no disponible:', e.message);
    }
}

// ============================================================
// RUTAS: PRODUCTOS
// ============================================================

// GET /productos - listar todos
app.get('/productos', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM productos ORDER BY id LIMIT 100');
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
app.post('/productos', authMiddleware, [body('sku').escape(), body('nombre').escape()], async (req, res) => {
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
app.put('/productos/:id', authMiddleware, async (req, res) => {
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

// POST /pedidos - crear pedido (con validación completa)
app.post('/pedidos', pedidosLimiter, [
    body('nombre').trim().notEmpty().withMessage('Nombre es obligatorio').isLength({ max: 255 }),
    body('email').trim().isEmail().withMessage('Email inválido').normalizeEmail(),
    body('telefono').optional().trim().isLength({ max: 50 }),
    body('nit').optional().trim().isLength({ max: 50 }),
    body('metodo_pago').trim().notEmpty().withMessage('Método de pago requerido'),
    body('total').isNumeric().withMessage('Total debe ser numérico'),
    body('items').isArray({ min: 1 }).withMessage('Debe incluir al menos un producto'),
    body('items.*.id').isInt({ min: 1 }).withMessage('ID de producto inválido'),
    body('items.*.quantity').isInt({ min: 1, max: 100 }).withMessage('Cantidad inválida'),
    body('items.*.price').isNumeric({ min: 1 }).withMessage('Precio inválido')
], async (req, res) => {
    // Validar errores de express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Datos inválidos', detalles: errors.array() });
    }

    const { nombre, email, telefono, nit, metodo_pago, total, items, direccion } = req.body;

    // Validar método de pago permitido
    if (!METODOS_PAGO_ACTIVOS.includes(metodo_pago)) {
        return res.status(400).json({
            error: `Método de pago "${metodo_pago}" no disponible. Métodos activos: ${METODOS_PAGO_ACTIVOS.join(', ')}`
        });
    }

    // Validar que el total sea positivo
    if (Number(total) <= 0) {
        return res.status(400).json({ error: 'El total debe ser mayor a 0' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const encryptedEmail = encrypt(email);
        const encryptedTelefono = encrypt(telefono);
        const encryptedNit = encrypt(nit);

        // 1. Verificar stock suficiente para TODOS los items antes de procesar
        for (const item of items) {
            const stockResult = await client.query(
                'SELECT stock, nombre FROM productos WHERE id = $1',
                [item.id]
            );
            if (stockResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Producto ID ${item.id} no encontrado` });
            }
            const productoActual = stockResult.rows[0];
            if (productoActual.stock < item.quantity) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: `Stock insuficiente para "${productoActual.nombre}". Disponible: ${productoActual.stock}, solicitado: ${item.quantity}`
                });
            }
        }

        // 2. Crear el pedido
        const pedidoResult = await client.query(
            `INSERT INTO pedidos (nombre, email, telefono, nit, metodo_pago, total, estado)
             VALUES ($1,$2,$3,$4,$5,$6,'pendiente') RETURNING *`,
            [nombre, encryptedEmail, encryptedTelefono, encryptedNit, metodo_pago, total]
        );
        const pedido = pedidoResult.rows[0];

        // 3. Insertar dirección de envío
        if (direccion) {
            const calleStr = String(direccion.calle || '');
            const match = calleStr.match(/^(.*?)(\d+)\s*$/);
            const calleNombre = match ? match[1].trim() : calleStr;
            const calleNumero = match ? match[2].trim() : 'S/N';

            await client.query(
                `INSERT INTO direccion_envio (pedido_id, calle, calle2, numero, comuna, region, instrucciones, coverage_code)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [pedido.id, calleNombre, direccion.calle2, calleNumero, direccion.comuna, direccion.region, direccion.instrucciones, direccion.coverage_code || null]
            );
        }

        // 4. Insertar detalle del pedido y actualizar stock
        for (const item of items) {
            await client.query(
                `INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, precio_historico)
                 VALUES ($1,$2,$3,$4)`,
                [pedido.id, item.id, item.quantity, item.price]
            );
            // Bajar stock (ya validamos que hay suficiente)
            await client.query(
                'UPDATE productos SET stock = stock - $1 WHERE id = $2 AND stock >= $1',
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

// GET /pedidos/:id - ver un pedido (ADMIN ONLY)
app.get('/pedidos/:id', authMiddleware, async (req, res) => {
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

// GET /pedidos/:id/estado-publico — endpoint público (solo estado y tracking, sin datos privados)
app.get('/pedidos/:id/estado-publico', [
    param('id').isInt({ min: 1 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'ID de pedido inválido' });
    }
    try {
        const result = await pool.query(
            'SELECT id, estado, metodo_pago, chilexpress_tracking, chilexpress_estado, created_at FROM pedidos WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pedido no encontrado' });
        }
        const pedido = result.rows[0];
        res.json({
            orden: `ORD-${pedido.id}`,
            estado: pedido.estado,
            metodo_pago: pedido.metodo_pago,
            tracking: pedido.chilexpress_tracking || null,
            envio_estado: pedido.chilexpress_estado || null,
            fecha: pedido.created_at
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al consultar estado del pedido' });
    }
});

// PATCH /pedidos/:id/estado - actualizar estado (ADMIN ONLY)
app.patch('/pedidos/:id/estado', authMiddleware, async (req, res) => {
    try {
        const estadosValidos = ['pendiente', 'pagado', 'preparando', 'enviado', 'entregado', 'cancelado'];
        const nuevoEstado = req.body.estado;
        if (!estadosValidos.includes(nuevoEstado)) {
            return res.status(400).json({ error: `Estado inválido. Válidos: ${estadosValidos.join(', ')}` });
        }
        await pool.query(
            'UPDATE pedidos SET estado=$1 WHERE id=$2',
            [nuevoEstado, req.params.id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'Error al actualizar estado' });
    }
});

// ============================================================
// RUTAS: MERCADO PAGO (DESHABILITADAS TEMPORALMENTE)
// Se activarán cuando las credenciales estén configuradas.
// ============================================================

const mpDeshabilitado = (req, res) => {
    res.status(503).json({
        error: 'Mercado Pago no está habilitado actualmente. Use transferencia bancaria.',
        metodo_activo: 'transferencia'
    });
};

app.post('/mercadopago/crear', mpDeshabilitado);
app.get('/mercadopago/retorno', mpDeshabilitado);
app.post('/mercadopago/webhook', (req, res) => {
    res.status(200).send('OK');
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

// POST /chilexpress/generar/:pedido_id (ADMIN ONLY)
// Genera (o regenera) el envío para un pedido puntual.
// Úsalo para pedidos pagados por transferencia una vez confirmados.
app.post('/chilexpress/generar/:pedido_id', authMiddleware, async (req, res) => {
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

// GET /chilexpress/certificado/:pedido_id (ADMIN ONLY)
// Descarga el certificado de la OT generada para un pedido.
// Requiere que el pedido ya tenga chilexpress_certificado guardado.
app.get('/chilexpress/certificado/:pedido_id', authMiddleware, async (req, res) => {
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
        res.json({
            status: 'ok',
            db: 'connected',
            metodos_pago: METODOS_PAGO_ACTIVOS,
            entorno: esProduccion ? 'producción' : 'desarrollo'
        });
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
    console.log(`💳 Pago activo: Transferencia bancaria (Mercado Pago API ${mpClient ? 'configurado pero deshabilitado' : 'no configurado'})`);
    console.log(`📦 Chilexpress en modo: ${process.env.CHILEXPRESS_ENV === 'production' ? 'PRODUCCIÓN' : 'PRUEBAS'} (${chilexpress.CHX_BASE_URL})`);
    console.log(`🔒 Entorno: ${esProduccion ? 'PRODUCCIÓN' : 'DESARROLLO'}`);
});