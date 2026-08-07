// ============================================================
// CLIENTE CHILEXPRESS — Integración completa de APIs
// Portal: https://developers.wschilexpress.com
// Empresa: ALCSE SPA — RUT 78254962-6
//
// APIs integradas:
//   1. Georeferenciación → búsqueda de calles
//      testservices.wschilexpress.com/georeference/api/v1.0/streets/search
//   2. Órdenes de Transporte → generar envío, rastrear, reimprimir etiqueta
//      testservices.wschilexpress.com/transport-orders/api/v1.0/transport-orders
//   3. Certificados de OT → consultar certificado de una orden
//      testservices.wschilexpress.com/transport-orders/api/v1.0/transport-order-certificates
//
// CREDENCIALES NECESARIAS:
//   CHILEXPRESS_TCC=15227953          ← tu T.C.C (ya lo tienes de la tarjeta)
//   CHILEXPRESS_SUBSCRIPTION_KEY=???  ← la obtienes al suscribirte en el portal
//       https://developers.wschilexpress.com → suscribete a las APIs de
//       "Georreferencia" y "API Envíos"
//
// PASOS PARA OBTENER LA SUBSCRIPTION KEY:
//   1. Entra a https://developers.wschilexpress.com con tu cuenta de empresa
//   2. Ve a "Products" o "APIs"
//   3. Suscríbete a: "Georeference API" y "Transport Orders API"
//   4. En tu perfil > Subscriptions verás tu Ocp-Apim-Subscription-Key
//   5. Cópiala en .env como CHILEXPRESS_SUBSCRIPTION_KEY=...
// ============================================================

const axios = require('axios');

function CHX_BASE_URL() {
    return process.env.CHILEXPRESS_ENV === 'production'
        ? 'https://services.wschilexpress.com'
        : 'https://testservices.wschilexpress.com';
}

function chxHeaders(type = 'envios') {
    let key;
    if (type === 'coberturas') {
        key = process.env.CHILEXPRESS_SUBSCRIPTION_KEY_COBERTURAS || process.env.CHILEXPRESS_SUBSCRIPTION_KEY || '';
    } else {
        key = process.env.CHILEXPRESS_SUBSCRIPTION_KEY_ENVIOS || process.env.CHILEXPRESS_SUBSCRIPTION_KEY || '';
    }
    if (!key) {
        console.warn(`[Chilexpress] ⚠️  CHILEXPRESS_SUBSCRIPTION_KEY_${type.toUpperCase()} no está definida en .env`);
    }
    return {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/json'
    };
}

// ------------------------------------------------------------
// GENERAR ENVÍO (Orden de Transporte)
// pedido: fila de la tabla "pedidos"
// direccion: fila de "direccion_envio"
// items: filas de "detalle_pedido" (para el contenido del bulto)
// remitente: datos fijos de tu tienda (origen del envío)
// ------------------------------------------------------------
async function generarEnvio({ pedido, direccion, remitente }) {
    const body = {
        header: {
            certificateNumber: 0,           // 0 = deja que Chilexpress cree el certificado automáticamente
            customerCardNumber: process.env.CHILEXPRESS_TCC || '15227953',    // TCC de tu socio afiliado
            countyOfOriginCoverageCode: remitente.coverage_code || 'STGO',
            labelType: 2,                   // 2 = imagen binaria (fácil de mostrar/imprimir)
            countryCode: 'CL'
        },
        details: [
            {
                addresses: [
                    {
                        addressId: 1,
                        countyCoverageCode: direccion.coverage_code,  // código de comuna obtenido con la API de Coberturas
                        streetName: direccion.calle,
                        streetNumber: direccion.numero || 'S/N',
                        supplement: direccion.calle2 || '',
                        addressType: 'DEST',                  // dirección de destino
                        deliveryOnCommercialOffice: false
                    },
                    {
                        addressId: 2,
                        countyCoverageCode: remitente.coverage_code,
                        streetName: remitente.calle,
                        streetNumber: remitente.numero,
                        supplement: remitente.calle2 || '',
                        addressType: 'DEV'                    // dirección de devolución (tu tienda)
                    }
                ],
                contacts: [
                    {
                        contactId: 1,
                        name: pedido.nombre,
                        phoneNumber: pedido.telefono || '',
                        mail: pedido.email,
                        contactType: 'D'   // D = Destinatario (código oficial Chilexpress)
                    },
                    {
                        contactId: 2,
                        name: remitente.nombre,
                        phoneNumber: remitente.telefono,
                        mail: remitente.email,
                        contactType: 'R'   // R = Remitente (código oficial Chilexpress)
                    }
                ],
                packages: [
                    {
                        weight: direccion.peso_total_kg || 1,
                        height: direccion.alto_cm || 10,
                        width: direccion.ancho_cm || 10,
                        length: direccion.largo_cm || 10,
                        serviceDeliveryCode: 3,          // 3 = CHEX (Express) / 4 = XTEN (Extendido) / 5 = XTRE (Extremos)
                        productCode: 3,                  // 3 = Encomienda / Express
                        productType: 3,                  // 3 = Encomienda
                        deliveryReference: `ORD-${pedido.id}`,
                        declaredValue: Number(pedido.total) || 0,
                        declaredContent: 6,              // 6 = "Otros" (código de contenido genérico)
                        groupReference: `ORD-${pedido.id}`,
                        labelType: 2
                    }
                ]
            }
        ]
    };

    const { data } = await axios.post(
        `${CHX_BASE_URL()}/transport-orders/api/v1.0/transport-orders`,
        body,
        { headers: chxHeaders('envios') }
    );

    // La respuesta trae, por bulto: transportOrderNumber (N° de OT / seguimiento),
    // certificateNumber, y labelData (etiqueta en base64 si labelType=2).
    return data;
}

// ------------------------------------------------------------
// RASTREAR UN ENVÍO (Consulta individual)
// ------------------------------------------------------------
async function rastrearEnvio(numeroOT) {
    const { data } = await axios.get(
        `${CHX_BASE_URL()}/tracking/api/v1.0/trackings/${numeroOT}`,
        { headers: chxHeaders('envios') }
    );
    return data;
}

// ------------------------------------------------------------
// REIMPRIMIR ETIQUETA
// ------------------------------------------------------------
async function reimprimirEtiqueta(numeroOT) {
    const { data } = await axios.get(
        `${CHX_BASE_URL()}/transport-orders/api/v1.0/transport-orders/${numeroOT}/label`,
        { headers: chxHeaders('envios') }
    );
    return data;
}

// ------------------------------------------------------------
// CERTIFICADOS DE ORDEN DE TRANSPORTE
// Endpoint: /transport-orders/api/v1.0/transport-order-certificates
// Permite consultar/obtener el certificado PDF de una OT generada.
// Parámetros:
//   - certificateNumber: número de certificado devuelto al crear la OT
//   - customerCardNumber: tu TCC (se usa por defecto el de .env)
// ------------------------------------------------------------
async function obtenerCertificadoOT({ certificateNumber, customerCardNumber } = {}) {
    const params = {
        certificateNumber,
        customerCardNumber: customerCardNumber || process.env.CHILEXPRESS_TCC || '15227953'
    };
    const { data } = await axios.get(
        `${CHX_BASE_URL()}/transport-orders/api/v1.0/transport-order-certificates`,
        { headers: chxHeaders('envios'), params }
    );
    return data;
}

// ------------------------------------------------------------
// BÚSQUEDA DE CALLES (Georeferenciación)
// Endpoint: /georeference/api/v1.0/streets/search
// Se usa en el checkout para autocompletar la dirección del cliente
// y obtener el coverageCode de la comuna (necesario para generar la OT).
//
// Parámetros:
//   - input       : texto de búsqueda (ej. "Av. Independen")
//   - countyCode  : código de comuna Chilexpress (ej. "STGO")
//   - limit       : máximo de resultados (por defecto 10)
// ------------------------------------------------------------
async function buscarCalle({ input, countyCode, limit = 10 } = {}) {
    const params = { input, countyCode, limit };
    const { data } = await axios.get(
        `${CHX_BASE_URL()}/georeference/api/v1.0/streets/search`,
        { headers: chxHeaders('coberturas'), params }
    );
    // Retorna un arreglo de { streetId, streetName, countyCode, countyName, regionCode }
    return data;
}

// ------------------------------------------------------------
// LISTAR REGIONES
// Endpoint: /georeference/api/v1.0/regions
// ------------------------------------------------------------
async function obtenerRegiones() {
    const { data } = await axios.get(
        `${CHX_BASE_URL()}/georeference/api/v1.0/regions`,
        { headers: chxHeaders('coberturas') }
    );
    return data;
}

// ------------------------------------------------------------
// LISTAR COMUNAS POR REGIÓN
// Endpoint real: /georeference/api/v1.0/coverage-areas?RegionCode=XX&type=0
// (NO es /regions/{id}/counties — ese recurso no existe en la API actual,
// por eso daba 404 en todas las variantes probadas)
// regionCode: código de región tal como lo entrega obtenerRegiones() (ej. "RM", "II", "XV")
// ------------------------------------------------------------
async function obtenerComunas(regionCode) {
    const { data } = await axios.get(
        `${CHX_BASE_URL()}/georeference/api/v1.0/coverage-areas`,
        { headers: chxHeaders('coberturas'), params: { RegionCode: regionCode, type: 0 } }
    );
    return data;
}

module.exports = {
    generarEnvio,
    rastrearEnvio,
    reimprimirEtiqueta,
    obtenerCertificadoOT,
    buscarCalle,
    obtenerRegiones,
    obtenerComunas,
    get CHX_BASE_URL() { return CHX_BASE_URL(); },
    get CHX_TCC() { return process.env.CHILEXPRESS_TCC || '15227953'; }
};
