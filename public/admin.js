const API_URL = 'http://localhost:3000'; // Se ajusta según el entorno automáticamente
const baseUrl = window.location.origin.includes('localhost') ? API_URL : '';

// DOM Elements
const loginOverlay = document.getElementById('login-overlay');
const adminDashboard = document.getElementById('admin-dashboard');
const apiKeyInput = document.getElementById('api-key');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const loginError = document.getElementById('login-error');
const ordersTbody = document.getElementById('orders-tbody');
const btnRefresh = document.getElementById('btn-refresh');

// Modal Elements
const orderModal = document.getElementById('order-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const modalTitle = document.getElementById('modal-title');
const modalEmail = document.getElementById('modal-email-placeholder');
const modalTel = document.getElementById('modal-tel-placeholder');
const modalDireccion = document.getElementById('modal-direccion');
const modalEstado = document.getElementById('modal-estado');
const btnUpdateStatus = document.getElementById('btn-update-status');
const modalChxOt = document.getElementById('modal-chx-ot');
const btnGenerateShipping = document.getElementById('btn-generate-shipping');
const btnDownloadLabel = document.getElementById('btn-download-label');
const modalProducts = document.getElementById('modal-products');
const chxError = document.getElementById('chx-error');

let currentOrderId = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    const savedKey = localStorage.getItem('admin_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
        verificarAcceso(savedKey);
    }
});

// Toast Notification
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.borderLeft = `4px solid ${isError ? 'var(--danger)' : 'var(--success)'}`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Authentication
btnLogin.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) return;
    verificarAcceso(key);
});

async function verificarAcceso(key) {
    btnLogin.textContent = 'Verificando...';
    try {
        const res = await fetch(`${baseUrl}/pedidos`, {
            headers: { 'x-api-key': key }
        });
        
        if (res.ok) {
            localStorage.setItem('admin_api_key', key);
            loginOverlay.style.display = 'none';
            adminDashboard.style.display = 'flex';
            cargarPedidos(key);
        } else {
            throw new Error('Clave incorrecta');
        }
    } catch (err) {
        loginError.textContent = err.message;
        localStorage.removeItem('admin_api_key');
    } finally {
        btnLogin.textContent = 'Ingresar';
    }
}

btnLogout.addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('admin_api_key');
    window.location.reload();
});

// Load Orders
btnRefresh.addEventListener('click', () => {
    const key = localStorage.getItem('admin_api_key');
    if (key) cargarPedidos(key);
});

async function cargarPedidos(key) {
    btnRefresh.textContent = 'Cargando...';
    try {
        const res = await fetch(`${baseUrl}/pedidos`, { headers: { 'x-api-key': key } });
        const pedidos = await res.json();
        renderPedidos(pedidos);
    } catch (err) {
        showToast('Error al cargar pedidos', true);
    } finally {
        btnRefresh.textContent = 'Actualizar Datos';
    }
}

function renderPedidos(pedidos) {
    ordersTbody.innerHTML = '';
    if (pedidos.length === 0) {
        ordersTbody.innerHTML = '<tr><td colspan="8" style="text-align:center">No hay pedidos</td></tr>';
        return;
    }
    
    pedidos.forEach(p => {
        const tr = document.createElement('tr');
        
        // Determinar colores de estado
        let estadoBadge = 'warning';
        if (p.estado === 'pagado') estadoBadge = 'success';
        if (p.estado === 'entregado') estadoBadge = 'success';
        if (p.estado === 'cancelado') estadoBadge = 'danger';
        
        tr.innerHTML = `
            <td><strong>ORD-${p.id}</strong></td>
            <td>${new Date(p.fecha).toLocaleString()}</td>
            <td>$${Number(p.total).toLocaleString('es-CL')}</td>
            <td>${p.metodo_pago}</td>
            <td><span class="badge ${estadoBadge}">${p.estado}</span></td>
            <td>${p.chilexpress_ot ? `<span class="badge chx-badge">${p.chilexpress_ot}</span>` : '-'}</td>
            <td>${p.chilexpress_estado || '-'}</td>
            <td>
                <button class="btn secondary small" onclick="abrirModalPedido(${p.id})">👁️ Ver / Gestionar</button>
            </td>
        `;
        ordersTbody.appendChild(tr);
    });
}

// Modal Logic
async function abrirModalPedido(id) {
    currentOrderId = id;
    const key = localStorage.getItem('admin_api_key');
    
    try {
        const res = await fetch(`${baseUrl}/pedidos/${id}`, { headers: { 'x-api-key': key } });
        const data = await res.json();
        
        const { pedido, direccion, items } = data;
        
        modalTitle.textContent = `Gestión Orden ORD-${pedido.id}`;
        
        // Datos encriptados, por ahora mostramos que lo están, se desencriptan en backend si tuvieras ruta, 
        // pero mostramos la orden directamente.
        modalEmail.textContent = "Dato Encriptado (Seguridad)";
        modalTel.textContent = "Dato Encriptado (Seguridad)";
        
        modalDireccion.innerHTML = direccion ? `
            Calle: ${direccion.calle} ${direccion.numero || ''} ${direccion.calle2 ? '('+direccion.calle2+')' : ''}<br>
            Comuna: ${direccion.comuna || '-'}<br>
            Región: ${direccion.region || '-'}<br>
            Instrucciones: ${direccion.instrucciones || 'Ninguna'}<br>
            <strong>Cobertura Chilexpress:</strong> ${direccion.coverage_code || '<span style="color:red">FALTA CÓDIGO</span>'}
        ` : 'Sin dirección guardada';
        
        modalEstado.value = pedido.estado;
        
        // Chilexpress logic
        chxError.style.display = 'none';
        if (pedido.chilexpress_ot) {
            modalChxOt.textContent = pedido.chilexpress_ot;
            btnGenerateShipping.style.display = 'none';
            if (pedido.chilexpress_etiqueta) {
                btnDownloadLabel.style.display = 'inline-block';
                // La etiqueta de Chilexpress suele ser un base64 de imagen PNG si labelType=2
                btnDownloadLabel.href = `data:image/png;base64,${pedido.chilexpress_etiqueta}`;
                btnDownloadLabel.download = `Etiqueta_ORD-${pedido.id}.png`;
            } else {
                btnDownloadLabel.style.display = 'none';
            }
        } else {
            modalChxOt.textContent = 'No generado';
            btnGenerateShipping.style.display = 'inline-block';
            btnDownloadLabel.style.display = 'none';
        }
        
        // Productos
        modalProducts.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><img src="${item.imagen || ''}" width="40" height="40" style="border-radius:4px; object-fit:cover;"></td>
                <td>${item.nombre}</td>
                <td>${item.cantidad}</td>
                <td>$${Number(item.precio_historico).toLocaleString('es-CL')}</td>
                <td>$${(item.cantidad * item.precio_historico).toLocaleString('es-CL')}</td>
            `;
            modalProducts.appendChild(tr);
        });
        
        orderModal.style.display = 'flex';
        
    } catch (err) {
        showToast('Error al obtener detalles', true);
    }
}

btnCloseModal.addEventListener('click', () => {
    orderModal.style.display = 'none';
});

// Update Status
btnUpdateStatus.addEventListener('click', async () => {
    const key = localStorage.getItem('admin_api_key');
    const nuevoEstado = modalEstado.value;
    
    btnUpdateStatus.textContent = 'Guardando...';
    btnUpdateStatus.disabled = true;
    
    try {
        const res = await fetch(`${baseUrl}/pedidos/${currentOrderId}/estado`, {
            method: 'PATCH',
            headers: { 
                'Content-Type': 'application/json',
                'x-api-key': key 
            },
            body: JSON.stringify({ estado: nuevoEstado })
        });
        
        if (res.ok) {
            showToast('Estado actualizado');
            cargarPedidos(key); // Refresh
        } else {
            throw new Error('Error al actualizar');
        }
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btnUpdateStatus.textContent = 'Guardar Estado';
        btnUpdateStatus.disabled = false;
    }
});

// Generate Chilexpress
btnGenerateShipping.addEventListener('click', async () => {
    if (!confirm('¿Seguro que quieres generar el envío en Chilexpress ahora? Esto creará la Orden de Transporte real.')) return;
    
    const key = localStorage.getItem('admin_api_key');
    
    btnGenerateShipping.textContent = 'Generando...';
    btnGenerateShipping.disabled = true;
    chxError.style.display = 'none';
    
    try {
        const res = await fetch(`${baseUrl}/chilexpress/generar/${currentOrderId}`, {
            method: 'POST',
            headers: { 'x-api-key': key }
        });
        
        const data = await res.json();
        
        if (res.ok) {
            showToast('¡Envío generado exitosamente!');
            abrirModalPedido(currentOrderId); // Refresh modal
            cargarPedidos(key); // Refresh table
        } else {
            throw new Error(data.error || 'Error desconocido');
        }
    } catch (err) {
        showToast('Error al generar envío', true);
        chxError.textContent = err.message;
        chxError.style.display = 'block';
    } finally {
        btnGenerateShipping.textContent = '🚚 Generar Envío Chilexpress';
        btnGenerateShipping.disabled = false;
    }
});
