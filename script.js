// Inicializar AOS
AOS.init({
    duration: 800,
    once: true,
    offset: 100
});

// ========== ESTADO GLOBAL Y CONFIGURACIÓN ==========
const API_URL = window.API_URL || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3000'
    : 'https://carcenter-api.onrender.com');
const VALID_CATEGORIES = new Set(['neumaticos','iluminacion','plumillas','refrigerantes','lubricantes','limpieza']);
const LOCAL_JSON_PATH = 'productos-update.json';

let products = [];
let cart = [];
let categoriaActual = 'destacados';

// ========== IMÁGENES VECTORIALES BASE64 (SVG FALLBACKS LIMPIOS) ==========
function getCategoryFallbackImage(category) {
    const svgs = {
        neumaticos: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f8f9fa"/><circle cx="150" cy="95" r="55" fill="#212121"/><circle cx="150" cy="95" r="35" fill="#424242"/><circle cx="150" cy="95" r="18" fill="#D32F2F"/><text x="150" y="175" font-family="sans-serif" font-size="13" font-weight="800" fill="#333" text-anchor="middle">NEUMÁTICO ALCRISOL</text></svg>`,
        iluminacion: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#1a1a2e"/><path d="M150 35 L175 85 L125 85 Z" fill="#ffeb3b"/><circle cx="150" cy="105" r="30" fill="#ffffff" stroke="#ffeb3b" stroke-width="4"/><text x="150" y="175" font-family="sans-serif" font-size="13" font-weight="800" fill="#ffeb3b" text-anchor="middle">ILUMINACIÓN LED</text></svg>`,
        plumillas: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f8f9fa"/><path d="M50 130 Q 150 40 250 130" fill="none" stroke="#D32F2F" stroke-width="8" stroke-linecap="round"/><path d="M60 135 Q 150 48 240 135" fill="none" stroke="#212121" stroke-width="4"/><text x="150" y="175" font-family="sans-serif" font-size="13" font-weight="800" fill="#333" text-anchor="middle">PLUMILLA AUTOMOTRIZ</text></svg>`,
        refrigerantes: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f8f9fa"/><rect x="110" y="50" width="80" height="95" rx="10" fill="#0288d1"/><rect x="130" y="30" width="40" height="20" rx="4" fill="#212121"/><text x="150" y="105" font-family="sans-serif" font-size="14" font-weight="800" fill="#fff" text-anchor="middle">PRESTONE</text><text x="150" y="175" font-family="sans-serif" font-size="13" font-weight="800" fill="#333" text-anchor="middle">REFRIGERANTE MAX</text></svg>`,
        lubricantes: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f8f9fa"/><path d="M110 60 L190 60 L180 145 L120 145 Z" fill="#D32F2F"/><rect x="130" y="38" width="40" height="22" rx="4" fill="#212121"/><text x="150" y="110" font-family="sans-serif" font-size="15" font-weight="800" fill="#fff" text-anchor="middle">MOTUL</text><text x="150" y="175" font-family="sans-serif" font-size="13" font-weight="800" fill="#333" text-anchor="middle">LUBRICANTE SINTÉTICO</text></svg>`,
        limpieza: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f8f9fa"/><rect x="120" y="70" width="60" height="75" rx="8" fill="#388e3c"/><path d="M140 45 L160 45 L160 70 L140 70 Z" fill="#212121"/><text x="150" y="175" font-family="sans-serif" font-size="13" font-weight="800" fill="#333" text-anchor="middle">LIMPIEZA AUTOMOTRIZ</text></svg>`
    };
    const rawSvg = svgs[category] || svgs['neumaticos'];
    return 'data:image/svg+xml;base64,' + btoa(rawSvg);
}

// ========== ADAPTADOR Y CARGA DE PRODUCTOS ==========
function adaptProduct(p, idx) {
    const precio = Number(p.precio) || 0;
    const stock = Number(p.stock) || 0;
    const category = p.categoria || 'general';
    let image = p.imagen && p.imagen.trim() ? p.imagen.trim() : '';
    
    if (!image || image.includes('PENDIENTE')) {
        image = getCategoryFallbackImage(category);
    }

    return {
        id: p.id || (idx + 1),
        sku: p.sku || `SKU-${idx + 1}`,
        name: p.nombre,
        price: precio,
        oldPrice: p.oldPrice || null,
        stock: stock,
        image: image,
        category: category,
        brand: (p.marca || 'Alcrisol').toUpperCase(),
        badge: stock > 0 ? (precio > 50000 ? 'Envío Gratis' : 'Destacado') : 'Agotado',
        description: p.descripcion || 'Producto automotriz de alta calidad garantizada.',
        compatibility: p.compatibility || []
    };
}

function filterValidProducts(list) {
    return list.filter(p => VALID_CATEGORIES.has(p.category) && p.price > 0 && p.stock > 0);
}

async function loadProductsFromAPI() {
    const res = await fetch(`${API_URL}/productos`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    return data.map((p, idx) => adaptProduct(p, idx));
}

async function loadProductsFromLocal() {
    const res = await fetch(LOCAL_JSON_PATH);
    if (!res.ok) throw new Error('Local JSON not found');
    const data = await res.json();
    return data.map((p, idx) => adaptProduct(p, idx));
}

async function reemplazarProductsConBD() {
    let raw;
    try {
        raw = await loadProductsFromAPI();
    } catch (e) {
        try {
            raw = await loadProductsFromLocal();
        } catch (e2) {
            console.warn('No se pudieron cargar productos desde API ni JSON local.');
            renderProductos([]);
            updateCategoryCounts([]);
            return;
        }
    }

    products.length = 0;
    const valid = filterValidProducts(raw);
    products.push(...valid);
    updateCategoryCounts(products);
    updateHomeProductCount();
    mostrarDestacados();
}

function updateHomeProductCount() {
    const note = document.getElementById('resultadoBusqueda');
    if (note) {
        const total = products.length;
        note.innerHTML = `<i class="bi bi-check-circle-fill text-success me-1"></i> ${total} repuestos y accesorios en inventario activo`;
    }
}

function updateCategoryCounts(productsList) {
    const counts = {};
    VALID_CATEGORIES.forEach(c => counts[c] = 0);
    productsList.forEach(p => {
        if (counts[p.category] !== undefined) counts[p.category] += 1;
    });

    const map = {
        neumaticos: 'badge-neumaticos',
        iluminacion: 'badge-iluminacion',
        plumillas: 'badge-plumillas',
        refrigerantes: 'badge-refrigerantes',
        lubricantes: 'badge-lubricantes',
        limpieza: 'badge-limpieza'
    };

    Object.entries(map).forEach(([cat, id]) => {
        const badge = document.getElementById(id);
        if (badge) badge.textContent = counts[cat] + (counts[cat] === 1 ? ' producto' : ' productos');
    });
}

// ========== RENDERIZADO DE CATALOGO DE PRODUCTOS ==========
function renderProductos(productosARenderizar) {
    const container = document.getElementById('product-list-container');
    if (!container) return;

    container.innerHTML = '';

    if (productosARenderizar.length === 0) {
        container.innerHTML = `
            <div class="col-12 text-center py-5">
                <i class="bi bi-search fs-1 text-muted d-block mb-3"></i>
                <h5 class="fw-bold text-secondary">No se encontraron productos</h5>
                <p class="text-muted">Intenta buscar con otro término o selecciona una categoría diferente.</p>
                <button class="btn btn-outline-danger btn-sm mt-2" onclick="mostrarDestacados()">
                    Ver todos los productos
                </button>
            </div>`;
        if (typeof AOS !== 'undefined') AOS.refresh();
        return;
    }

    productosARenderizar.forEach(product => {
        const discountHtml = product.oldPrice ? `<span>$${product.oldPrice.toLocaleString('es-CL')}</span>` : '';
        const badgeHtml = product.badge ? `<div class="product-badge">${product.badge}</div>` : '';

        const productCard = document.createElement('div');
        productCard.className = 'col-lg-3 col-md-6 mb-4';
        productCard.setAttribute('data-aos', 'fade-up');

        productCard.innerHTML = `
            <div class="product-card">
                <div>
                    ${badgeHtml}
                    <div class="product-img-wrapper" onclick="verDetalleProducto(${product.id})" style="cursor:pointer;" title="Ver detalle de ${product.name}">
                        <img src="${product.image}" alt="${product.name}" data-category="${product.category}" loading="lazy">
                    </div>
                    <span class="product-brand-tag">${product.brand}</span>
                    <h6 class="fw-bold" onclick="verDetalleProducto(${product.id})" style="cursor:pointer;" title="${product.name}">
                        ${product.name}
                    </h6>
                    <div class="product-price-container">
                        <p class="product-price">$${product.price.toLocaleString('es-CL')}</p>
                        ${discountHtml}
                    </div>
                </div>
                <div class="product-actions">
                    <button class="btn-quick-view" onclick="verDetalleProducto(${product.id})" title="Vista Rápida">
                        <i class="bi bi-eye"></i>
                    </button>
                    <button class="btn-add-cart" data-id="${product.id}" ${product.stock <= 0 ? 'disabled' : ''}>
                        <i class="bi bi-cart-plus"></i> ${product.stock > 0 ? 'Agregar' : 'Agotado'}
                    </button>
                </div>
            </div>
        `;
        container.appendChild(productCard);
    });

    if (typeof AOS !== 'undefined') {
        AOS.refresh();
    }
}

// ========== MODAL DE DETALLE / VISTA RÁPIDA ==========
function verDetalleProducto(productId) {
    const p = products.find(prod => prod.id === productId);
    if (!p) return;

    const fallbackImg = getCategoryFallbackImage(p.category);
    const content = document.getElementById('qv-content');
    if (!content) return;

    content.innerHTML = `
        <div class="row align-items-center">
            <div class="col-md-6 text-center mb-3 mb-md-0">
                <div class="p-3 bg-light rounded-3 d-flex align-items-center justify-content-center" style="min-height:260px;">
                    <img src="${p.image}" alt="${p.name}" class="img-fluid" style="max-height:240px; object-fit:contain;" data-category="${p.category}">
                </div>
            </div>
            <div class="col-md-6">
                <span class="badge bg-danger mb-2">${p.brand}</span>
                <span class="badge bg-secondary mb-2 ms-1">SKU: ${p.sku}</span>
                <h4 class="fw-bold text-dark mb-2">${p.name}</h4>
                <p class="text-muted small mb-3">${p.description}</p>
                <div class="d-flex align-items-baseline gap-2 mb-3">
                    <h3 class="fw-bold text-danger mb-0">$${p.price.toLocaleString('es-CL')}</h3>
                    ${p.oldPrice ? `<span class="text-decoration-line-through text-muted">$${p.oldPrice.toLocaleString('es-CL')}</span>` : ''}
                </div>
                <div class="mb-4">
                    <span class="badge bg-success-subtle text-success border border-success-subtle p-2">
                        <i class="bi bi-check-circle-fill me-1"></i> Disponible (${p.stock} unidades en stock)
                    </span>
                </div>
                <div class="d-grid gap-2">
                    <button class="btn btn-danger btn-lg fw-bold rounded-pill" onclick="addToCartFromModal(${p.id})">
                        <i class="bi bi-cart-plus me-2"></i> Agregar al Carrito
                    </button>
                    <button class="btn btn-outline-secondary rounded-pill" data-bs-dismiss="modal">
                        Continuar Comprando
                    </button>
                </div>
            </div>
        </div>
    `;

    const qvModalElement = document.getElementById('quickViewModal');
    if (qvModalElement && typeof bootstrap !== 'undefined') {
        const qvModal = new bootstrap.Modal(qvModalElement);
        qvModal.show();
    }
}

function addToCartFromModal(productId) {
    addToCart(productId);
    const qvEl = document.getElementById('quickViewModal');
    if (qvEl && typeof bootstrap !== 'undefined') {
        const qvModal = bootstrap.Modal.getInstance(qvEl);
        if (qvModal) qvModal.hide();
    }
}

// ========== CARRITO DE COMPRAS ==========
function toggleCart() {
    const modal = document.getElementById('cartModal');
    if (modal) {
        modal.classList.toggle('show');
    }
}

function updateCartUI() {
    const cartCount = document.getElementById('cart-count');
    if (cartCount) {
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        cartCount.textContent = totalItems;
    }

    const cartItems = document.getElementById('cartItems');
    const cartTotal = document.getElementById('cartTotal');

    if (!cartItems || !cartTotal) return;

    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="text-center text-muted py-4"><i class="bi bi-cart-x fs-2 d-block mb-2"></i>El carrito está vacío</p>';
        cartTotal.textContent = 'Total: $0';
    } else {
        let html = '';
        let total = 0;

        cart.forEach(item => {
            total += item.price * item.quantity;
            html += `
                <div class="cart-item">
                    <img src="${item.image}" alt="${item.name}" data-category="${item.category}">
                    <div class="cart-item-info">
                        <h4>${item.name}</h4>
                        <div class="cart-item-price">$${item.price.toLocaleString('es-CL')}</div>
                    </div>
                    <div class="cart-item-quantity">
                        <button class="quantity-btn" onclick="updateQuantity(${item.id}, ${item.quantity - 1})">-</button>
                        <span>${item.quantity}</span>
                        <button class="quantity-btn" onclick="updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
                    </div>
                </div>
            `;
        });

        cartItems.innerHTML = html;
        cartTotal.textContent = `Total: $${total.toLocaleString('es-CL')}`;
    }
}

function addToCart(productId) {
    const product = products.find(p => p.id === productId);
    if (product) {
        const existingItem = cart.find(item => item.id === productId);

        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            cart.push({ ...product, quantity: 1 });
        }

        updateCartUI();

        // Feedback visual en botón si viene de evento click
        if (typeof window.event !== 'undefined' && window.event && window.event.target) {
            const button = window.event.target.closest('.btn-add-cart');
            if (button) {
                const originalText = button.innerHTML;
                button.innerHTML = '<i class="bi bi-check-lg"></i> Agregado';
                button.style.backgroundColor = '#28a745';

                setTimeout(() => {
                    button.innerHTML = originalText;
                    button.style.backgroundColor = '';
                }, 1500);
            }
        }
    }
}

function updateQuantity(productId, newQuantity) {
    if (newQuantity <= 0) {
        cart = cart.filter(item => item.id !== productId);
    } else {
        const item = cart.find(item => item.id === productId);
        if (item) {
            item.quantity = newQuantity;
        }
    }
    updateCartUI();
}

function checkout() {
    if (cart.length === 0) {
        alert('❌ El carrito está vacío. Agrega productos para continuar.');
        return;
    }
    localStorage.setItem('cart', JSON.stringify(cart));
    window.location.href = 'checkout.html';
}

// ========== FILTROS DE CATEGORÍA Y BÚSQUEDA ==========
function mostrarDestacados() {
    categoriaActual = 'destacados';

    const seen = new Set();
    const idsDestacados = [];
    for (const prod of products) {
        if (!seen.has(prod.category)) {
            seen.add(prod.category);
            idsDestacados.push(prod.id);
        }
    }
    const productosDestacados = products.filter(p => idsDestacados.includes(p.id));
    renderProductos(productosDestacados.length > 0 ? productosDestacados : products);

    const volverBtn = document.getElementById('boton-volver');
    if (volverBtn) volverBtn.style.display = 'none';

    const titleSpan = document.querySelector('#productos .section-title span');
    if (titleSpan) titleSpan.textContent = 'destacados';
}

function filtrarPorCategoria(categoria) {
    categoriaActual = categoria;

    let nombreCategoria = '';
    switch (categoria) {
        case 'neumaticos': nombreCategoria = 'Neumáticos'; break;
        case 'iluminacion': nombreCategoria = 'Iluminación LED'; break;
        case 'plumillas': nombreCategoria = 'Plumillas'; break;
        case 'refrigerantes': nombreCategoria = 'Refrigerantes'; break;
        case 'lubricantes': nombreCategoria = 'Lubricantes'; break;
        case 'limpieza': nombreCategoria = 'Limpieza'; break;
        default: nombreCategoria = categoria;
    }

    const productosFiltrados = products.filter(p => p.category === categoria);
    renderProductos(productosFiltrados);

    const volverBtn = document.getElementById('boton-volver');
    if (volverBtn) volverBtn.style.display = 'block';

    const titleSpan = document.querySelector('#productos .section-title span');
    if (titleSpan) titleSpan.textContent = nombreCategoria;

    const sec = document.getElementById('productos');
    if (sec) sec.scrollIntoView({ behavior: 'smooth' });
}

function addRenderErrorListeners() {
    document.addEventListener('error', function(e) {
        if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'img') {
            const cat = e.target.getAttribute('data-category') || 'neumaticos';
            e.target.src = getCategoryFallbackImage(cat.toLowerCase());
        }
    }, true);
}

function buscarPorVehiculo() {
    const marca = document.getElementById('marca')?.value;
    const modelo = document.getElementById('modelo')?.value;
    const anio = document.getElementById('anio')?.value;
    const resultado = document.getElementById('resultadoBusqueda');

    if (marca && modelo && anio) {
        const query = marca.toLowerCase();
        const productosCompatibles = products.filter(p =>
            p.brand.toLowerCase().includes(query) ||
            p.description.toLowerCase().includes(query) ||
            p.compatibility.includes(query) ||
            p.category === 'neumaticos' ||
            p.category === 'refrigerantes' ||
            p.category === 'plumillas'
        );

        if (productosCompatibles.length > 0) {
            renderProductos(productosCompatibles);
            categoriaActual = 'busqueda';
            resultado.innerHTML = `<i class="bi bi-check-circle-fill text-success"></i> 
                ${productosCompatibles.length} productos compatibles para ${marca.toUpperCase()} ${modelo.toUpperCase()} ${anio}`;
            document.getElementById('boton-volver').style.display = 'block';
            
            const sec = document.getElementById('productos');
            if (sec) sec.scrollIntoView({ behavior: 'smooth' });
        } else {
            resultado.innerHTML = `<i class="bi bi-exclamation-circle-fill text-danger"></i> 
                No hay productos específicos para esta combinación`;
        }
    } else if (resultado) {
        resultado.innerHTML = `<i class="bi bi-exclamation-circle-fill text-danger"></i> 
            Selecciona marca, modelo y año para filtrar`;
    }
}

// ========== EVENT LISTENERS EN CARGA ==========
document.addEventListener('DOMContentLoaded', function () {
    reemplazarProductsConBD();
    addRenderErrorListeners();

    // Búsqueda en vivo
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');

    function ejecutarBusquedaTexto() {
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        if (!query) {
            mostrarDestacados();
            return;
        }
        const filtrados = products.filter(p =>
            p.name.toLowerCase().includes(query) ||
            p.brand.toLowerCase().includes(query) ||
            p.category.toLowerCase().includes(query) ||
            p.description.toLowerCase().includes(query)
        );
        renderProductos(filtrados);
        const titleSpan = document.querySelector('#productos .section-title span');
        if (titleSpan) titleSpan.textContent = `búsqueda: "${query}"`;
        document.getElementById('boton-volver').style.display = 'block';

        const sec = document.getElementById('productos');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    }

    if (searchInput) {
        searchInput.addEventListener('input', ejecutarBusquedaTexto);
    }
    if (searchBtn) {
        searchBtn.addEventListener('click', ejecutarBusquedaTexto);
    }

    // Delegación de eventos para carrito y modales
    document.addEventListener('click', function (e) {
        const addBtn = e.target.closest('.btn-add-cart');
        if (addBtn) {
            const productId = parseInt(addBtn.getAttribute('data-id'));
            if (!isNaN(productId)) {
                addToCart(productId);
            }
        }

        const cartBtn = e.target.closest('#carritoBoton');
        if (cartBtn) {
            e.preventDefault();
            toggleCart();
        }
    });

    // Dropdown interactivo de vehículos
    const marcaSelect = document.getElementById('marca');
    if (marcaSelect) {
        marcaSelect.addEventListener('change', function () {
            const marcaSeleccionada = this.value;
            const modeloSelect = document.getElementById('modelo');
            if (!modeloSelect) return;

            modeloSelect.innerHTML = '<option value="">Seleccionar modelo</option>';

            const modelos = {
                'chevrolet': ['Silverado', 'Cruze', 'Onix', 'Tracker', 'S10'],
                'ford': ['Ranger', 'F-150', 'Escape', 'Focus', 'Mustang'],
                'toyota': ['Hilux', 'Corolla', 'RAV4', 'Yaris', 'Land Cruiser'],
                'nissan': ['Frontier', 'Versa', 'Sentra', 'X-Trail', 'Kicks'],
                'hyundai': ['Tucson', 'Santa Fe', 'Creta', 'Accent', 'Elantra']
            };

            if (modelos[marcaSeleccionada]) {
                modelos[marcaSeleccionada].forEach(function (modeloNombre) {
                    const option = document.createElement('option');
                    option.value = modeloNombre.toLowerCase();
                    option.textContent = modeloNombre;
                    modeloSelect.appendChild(option);
                });
            }
        });
    }

    const btnBuscar = document.getElementById('btnBuscar');
    if (btnBuscar) {
        btnBuscar.addEventListener('click', buscarPorVehiculo);
    }
});

// Hacer funciones globales para handlers inline
window.toggleCart = toggleCart;
window.updateQuantity = updateQuantity;
window.checkout = checkout;
window.filtrarPorCategoria = filtrarPorCategoria;
window.mostrarDestacados = mostrarDestacados;
window.verDetalleProducto = verDetalleProducto;
window.addToCartFromModal = addToCartFromModal;