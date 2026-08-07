const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function runTests() {
    console.log('🚀 Starting Integration Tests for CAR CENTER API...\n');
    let testOrder = null;
    let tempProductId = null;

    // Test 1: Healthcheck
    try {
        console.log('🧪 Test 1: Checking server health...');
        const res = await axios.get(`${BASE_URL}/health`);
        console.log(`✅ Server health check passed. Status: ${res.data.status}, DB: ${res.data.db}\n`);
    } catch (e) {
        console.error('❌ Test 1 failed: Healthcheck failed.', e.message);
        return;
    }

    // Test 2: Get Products Catalog and Find/Insert a Product
    try {
        console.log('🧪 Test 2: Getting products catalog...');
        const res = await axios.get(`${BASE_URL}/productos`);
        console.log(`✅ Received ${res.data.length} products.`);

        if (res.data.length > 0) {
            tempProductId = res.data[0].id;
            console.log(`ℹ️ Using existing product for tests: ID=${tempProductId}, SKU=${res.data[0].sku}\n`);
        } else {
            console.log('ℹ️ No products found. Inserting a temporary test product...');
            const newProd = await axios.post(`${BASE_URL}/productos`, {
                sku: 'TEST-SKU-999',
                nombre: 'Aceite de motor test',
                precio: 15000,
                stock: 50,
                categoria: 'lubricantes',
                marca: 'Mobil',
                imagen: 'https://via.placeholder.com/200x150?text=Mobil',
                descripcion: 'Aceite de motor para pruebas'
            });
            tempProductId = newProd.data.id;
            console.log(`✅ Temporary product created: ID=${tempProductId}\n`);
        }
    } catch (e) {
        console.error('❌ Test 2 failed: Product management error.', e.response ? e.response.data : e.message);
        return;
    }

    // Test 3: Chilexpress Regions API
    try {
        console.log('🧪 Test 3: Fetching Chilexpress Regions...');
        const res = await axios.get(`${BASE_URL}/chilexpress/regiones`);
        if (res.data && res.data.regions && res.data.regions.length > 0) {
            console.log(`✅ Regions retrieved. Count: ${res.data.regions.length}. Sample region:`, res.data.regions[0]);
            console.log();
        } else {
            throw new Error('No regions returned or invalid structure');
        }
    } catch (e) {
        console.error('❌ Test 3 failed: Chilexpress Regions API error.', e.response ? e.response.data : e.message);
        return;
    }

    // Test 4: Chilexpress Communes API for Region Metropolitana (RM)
    try {
        console.log('🧪 Test 4: Fetching Chilexpress Communes for RM...');
        const res = await axios.get(`${BASE_URL}/chilexpress/comunas/RM`);
        if (res.data && res.data.coverageAreas && res.data.coverageAreas.length > 0) {
            console.log(`✅ Communes retrieved. Count: ${res.data.coverageAreas.length}. Sample commune:`, res.data.coverageAreas[0]);
            console.log();
        } else {
            throw new Error('No communes returned or invalid structure');
        }
    } catch (e) {
        console.error('❌ Test 4 failed: Chilexpress Communes API error.', e.response ? e.response.data : e.message);
        return;
    }

    // Test 5: Create a new order with valid coverage_code (e.g. STGO for Santiago)
    try {
        console.log('🧪 Test 5: Creating a new test order...');
        const orderData = {
            nombre: 'Juan Perez Test',
            email: 'juan.perez.test@example.com',
            telefono: '+56912345678',
            nit: '19000000-0',
            metodo_pago: 'webpay',
            total: 15000,
            items: [
                {
                    id: tempProductId,
                    quantity: 1,
                    price: 15000
                }
            ],
            direccion: {
                calle: 'Avenida Providencia 1234',
                calle2: 'Depto 402',
                comuna: 'Santiago',
                region: 'Región Metropolitana',
                instrucciones: 'Entregar en conserjería',
                coverage_code: 'STGO' // Essential for Chilexpress
            }
        };

        const res = await axios.post(`${BASE_URL}/pedidos`, orderData);
        testOrder = res.data; // contains { pedido_id, orden }
        console.log(`✅ Order created successfully. Order ID: ${testOrder.pedido_id}, Order Code: ${testOrder.orden}\n`);
    } catch (e) {
        console.error('❌ Test 5 failed: Order creation failed.', e.response ? e.response.data : e.message);
        return;
    }

    // Test 6: Create Transbank Transaction
    try {
        console.log(`🧪 Test 6: Creating Transbank transaction for Order ID ${testOrder.pedido_id}...`);
        const res = await axios.post(`${BASE_URL}/transbank/crear`, {
            pedido_id: testOrder.pedido_id,
            monto: 15000
        });
        if (res.data && res.data.url && res.data.token) {
            console.log(`✅ Transbank transaction token generated: ${res.data.token}`);
            console.log(`✅ Transbank redirection URL: ${res.data.url}\n`);
        } else {
            throw new Error('Transbank response did not return url/token');
        }
    } catch (e) {
        console.error('❌ Test 6 failed: Transbank payment integration failed.', e.response ? e.response.data : e.message);
        return;
    }

    // Test 7: Generate Chilexpress Shipping Order (Transport Order)
    try {
        console.log(`🧪 Test 7: Generating Chilexpress Shipping Order for Order ID ${testOrder.pedido_id}...`);
        const res = await axios.post(`${BASE_URL}/chilexpress/generar/${testOrder.pedido_id}`);
        if (res.data && res.data.ok) {
            console.log(`✅ Chilexpress shipment generated!`);
            console.log(`✅ Transport Order Number (OT): ${res.data.ot}`);
            console.log(`✅ Certificate Number: ${res.data.certificado}`);
            console.log(`✅ Label Data Length: ${res.data.etiqueta ? res.data.etiqueta.length : 0} chars\n`);
        } else {
            throw new Error('Chilexpress shipment generation returned not OK');
        }
    } catch (e) {
        console.error('❌ Test 7 failed: Chilexpress shipment generation failed.', e.response ? e.response.data : e.message);
        return;
    }

    // Test 8: Get Chilexpress Shipment Tracking
    try {
        console.log(`🧪 Test 8: Getting tracking status for Order ID ${testOrder.pedido_id}...`);
        const res = await axios.get(`${BASE_URL}/chilexpress/rastreo/${testOrder.pedido_id}`);
        console.log(`✅ Tracking info fetched. Tracking number: ${res.data.tracking_number}, Status: ${res.data.estado}`);
        console.log(`✅ Tracking details retrieved successfully.\n`);
    } catch (e) {
        console.error('❌ Test 8 failed: Chilexpress tracking failed.', e.response ? e.response.data : e.message);
        return;
    }

    // Test 9: Get Chilexpress Certificate PDF
    try {
        console.log(`🧪 Test 9: Fetching Chilexpress Shipping Certificate for Order ID ${testOrder.pedido_id}...`);
        const res = await axios.get(`${BASE_URL}/chilexpress/certificado/${testOrder.pedido_id}`);
        if (res.data && res.data.certificado_numero) {
            console.log(`✅ Certificate info retrieved successfully. Certificate Number: ${res.data.certificado_numero}\n`);
        } else {
            throw new Error('Certificate response did not return expected number');
        }
    } catch (e) {
        console.error('❌ Test 9 failed: Chilexpress certificate retrieval failed.', e.response ? e.response.data : e.message);
        return;
    }

    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests();
