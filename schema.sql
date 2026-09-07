-- ============================================================
-- ESQUEMA DE BASE DE DATOS - CAR CENTER
-- Neon PostgreSQL
-- ============================================================

-- Tabla de Productos
CREATE TABLE IF NOT EXISTS productos (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    precio NUMERIC(10, 2) NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    categoria VARCHAR(100),
    marca VARCHAR(100),
    imagen TEXT,
    descripcion TEXT,
    peso_kg NUMERIC(10, 2) DEFAULT 1.0,
    alto_cm NUMERIC(10, 2) DEFAULT 10.0,
    ancho_cm NUMERIC(10, 2) DEFAULT 10.0,
    largo_cm NUMERIC(10, 2) DEFAULT 10.0,
    compatibility TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    telefono VARCHAR(50),
    nit VARCHAR(50), -- RUT en Chile
    metodo_pago VARCHAR(50) NOT NULL,
    total NUMERIC(10, 2) NOT NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'pendiente',
    transbank_token VARCHAR(255),
    transbank_auth_code VARCHAR(50),
    transbank_card_number VARCHAR(50),
    chilexpress_ot VARCHAR(100),
    chilexpress_certificado VARCHAR(100),
    chilexpress_tracking VARCHAR(100),
    chilexpress_etiqueta TEXT,
    chilexpress_estado VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Dirección de Envío
CREATE TABLE IF NOT EXISTS direccion_envio (
    id SERIAL PRIMARY KEY,
    pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
    calle VARCHAR(255) NOT NULL,
    calle2 VARCHAR(255),
    numero VARCHAR(50) NOT NULL,
    comuna VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    instrucciones TEXT,
    coverage_code VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Detalle de Pedido
CREATE TABLE IF NOT EXISTS detalle_pedido (
    id SERIAL PRIMARY KEY,
    pedido_id INTEGER REFERENCES pedidos(id) ON DELETE CASCADE,
    producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
    cantidad INTEGER NOT NULL,
    precio_historico NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SEGURIDAD (Punto 4: Row Level Security)
-- ============================================================

ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE direccion_envio ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_pedido ENABLE ROW LEVEL SECURITY;

-- Políticas de lectura para productos (público)
CREATE POLICY "Public read access for productos" ON productos FOR SELECT USING (true);
-- Políticas de lectura/escritura para administradores en productos
CREATE POLICY "Admin write access for productos" ON productos FOR ALL USING (current_user = 'admin_user');

-- Pedidos (solo inserciones públicas, lectura solo admin)
CREATE POLICY "Public insert access for pedidos" ON pedidos FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin full access for pedidos" ON pedidos FOR ALL USING (current_user = 'admin_user');
