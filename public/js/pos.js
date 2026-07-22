(function() {
  var token = localStorage.getItem('token');
  var user = JSON.parse(localStorage.getItem('user') || 'null');
  var productos = [];
  var carrito = [];
  var cajaActual = null;
  var categoriaActiva = 'todas';

  if (!token) { window.location.href = '/'; return; }

  function getHeaders() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }; }
  function fmt(n) { return '$' + Number(n||0).toLocaleString('es-CO', {minimumFractionDigits:0, maximumFractionDigits:0}); }

  function toast(msg, type) {
    type = type || 'success';
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(function() { el.remove(); }, 3000);
  }

  function cerrarModal(id) { document.getElementById(id).classList.remove('active'); }
  function abrirModal(id) { document.getElementById(id).classList.add('active'); }

  function api(url, opts) {
    opts = opts || {};
    opts.headers = getHeaders();
    return fetch(url, opts).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Error');
        return data;
      });
    });
  }

  // ── Close modals via data-close ──
  document.addEventListener('click', function(e) {
    var closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { cerrarModal(closeBtn.getAttribute('data-close')); }
  });

  // ── Header buttons ──
  document.getElementById('btnHistorial').addEventListener('click', abrirHistorial);
  document.getElementById('btnInventario').addEventListener('click', abrirInventarioModal);
  document.getElementById('btnCaja').addEventListener('click', toggleCaja);
  document.getElementById('btnSalir').addEventListener('click', function() { localStorage.clear(); window.location.href = '/'; });

  // ── Payment buttons ──
  document.getElementById('btnEfectivo').addEventListener('click', function() { cobrar('EFECTIVO'); });
  document.getElementById('btnTransfer').addEventListener('click', function() { cobrar('TRANSFERENCIA'); });
  document.getElementById('btnCredito').addEventListener('click', function() { abrirModalCredito(); });
  document.getElementById('btnLimpiar').addEventListener('click', function() { carrito = []; renderCarrito(); });

  // ── Modal action buttons ──
  document.getElementById('btnConfirmarAbrir').addEventListener('click', confirmarAbrirCaja);
  document.getElementById('btnConfirmarCerrar').addEventListener('click', confirmarCerrarCaja);
  document.getElementById('btnConfirmarEntrada').addEventListener('click', confirmarEntrada);

  // ── Products ──
  function cargarProductos() {
    return api('/api/productos?activo=1').then(function(p) {
      productos = p;
      renderCategorias();
      renderProductos();
    });
  }

  function renderCategorias() {
    var cats = ['todas'];
    var seen = {};
    productos.forEach(function(p) { if (!seen[p.categoria]) { seen[p.categoria] = true; cats.push(p.categoria); } });
    document.getElementById('filtrosCat').innerHTML = cats.map(function(c) {
      return '<button class="filtro-cat ' + (c === categoriaActiva ? 'active' : '') + '" data-cat="' + c + '">' + c.charAt(0).toUpperCase() + c.slice(1) + '</button>';
    }).join('');
  }

  // Category filter delegation
  document.getElementById('filtrosCat').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-cat]');
    if (btn) {
      categoriaActiva = btn.getAttribute('data-cat');
      renderCategorias();
      renderProductos();
    }
  });

  function renderProductos() {
    var filtered = categoriaActiva === 'todas' ? productos : productos.filter(function(p) { return p.categoria === categoriaActiva; });
    document.getElementById('productosGrid').innerHTML = filtered.map(function(p) {
      var imgHtml = p.imagen ? '<img src="' + p.imagen + '" class="p-img">' : '';
      return '<button class="producto-btn ' + (p.stock_actual <= 0 ? 'sin-stock' : '') + '" ' +
        (p.stock_actual > 0 ? 'data-add-prod="' + p.id + '"' : '') +
        ' title="' + p.nombre + ' - Stock: ' + p.stock_actual + '">' +
        imgHtml +
        '<span class="p-nombre">' + p.nombre + '</span>' +
        '<span class="p-precio">' + fmt(p.precio_venta) + '</span>' +
        '<span class="p-stock">' + (p.stock_actual > 0 ? p.stock_actual + ' disp.' : 'Agotado') + '</span>' +
        '</button>';
    }).join('');
  }

  // Product click delegation
  document.getElementById('productosGrid').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-add-prod]');
    if (btn) agregarAlCarrito(Number(btn.getAttribute('data-add-prod')));
  });

  function agregarAlCarrito(id) {
    if (!cajaActual) { toast('Debe abrir caja primero', 'error'); return; }
    var prod = productos.find(function(p) { return p.id === id; });
    if (!prod) return;
    var existing = carrito.find(function(c) { return c.producto_id === id; });
    if (existing) {
      if (existing.cantidad >= prod.stock_actual) { toast('Stock insuficiente', 'error'); return; }
      existing.cantidad++;
    } else {
      carrito.push({ producto_id: id, nombre: prod.nombre, precio: prod.precio_venta, cantidad: 1, stock: prod.stock_actual });
    }
    renderCarrito();
  }

  function renderCarrito() {
    var container = document.getElementById('carritoItems');
    var total = carrito.reduce(function(s, c) { return s + c.precio * c.cantidad; }, 0);

    if (carrito.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>Seleccione productos para vender</p></div>';
    } else {
      container.innerHTML = carrito.map(function(c) {
        return '<div class="carrito-item">' +
          '<span class="ci-nombre">' + c.nombre + '</span>' +
          '<span class="ci-qty">' +
            '<button data-qty-change="' + c.producto_id + '" data-delta="-1">-</button>' +
            '<span>' + c.cantidad + '</span>' +
            '<button data-qty-change="' + c.producto_id + '" data-delta="1">+</button>' +
          '</span>' +
          '<span class="ci-subtotal">' + fmt(c.precio * c.cantidad) + '</span>' +
          '<button class="ci-remove" data-remove-prod="' + c.producto_id + '">&times;</button>' +
          '</div>';
      }).join('');
    }

    document.getElementById('carritoTotal').textContent = fmt(total);
    document.getElementById('carritoCount').textContent = '(' + carrito.length + ')';
    document.getElementById('btnEfectivo').disabled = carrito.length === 0 || !cajaActual;
    document.getElementById('btnTransfer').disabled = carrito.length === 0 || !cajaActual;
    document.getElementById('btnCredito').disabled = carrito.length === 0 || !cajaActual;
    document.getElementById('btnLimpiar').disabled = carrito.length === 0;
  }

  // Cart delegation
  document.getElementById('carritoItems').addEventListener('click', function(e) {
    var qtyBtn = e.target.closest('[data-qty-change]');
    if (qtyBtn) {
      var id = Number(qtyBtn.getAttribute('data-qty-change'));
      var delta = Number(qtyBtn.getAttribute('data-delta'));
      var item = carrito.find(function(c) { return c.producto_id === id; });
      if (!item) return;
      item.cantidad += delta;
      if (item.cantidad <= 0) { carrito = carrito.filter(function(c) { return c.producto_id !== id; }); }
      else if (item.cantidad > item.stock) { item.cantidad = item.stock; toast('Stock maximo alcanzado', 'info'); }
      renderCarrito();
      return;
    }
    var removeBtn = e.target.closest('[data-remove-prod]');
    if (removeBtn) {
      var rid = Number(removeBtn.getAttribute('data-remove-prod'));
      carrito = carrito.filter(function(c) { return c.producto_id !== rid; });
      renderCarrito();
    }
  });

  function cobrar(metodo) {
    if (carrito.length === 0) return;
    var items = carrito.map(function(c) { return { producto_id: c.producto_id, cantidad: c.cantidad }; });
    api('/api/ventas', { method: 'POST', body: JSON.stringify({ items: items, metodo_pago: metodo }) }).then(function(venta) {
      toast('Venta registrada: ' + fmt(venta.total) + ' (' + metodo.toLowerCase() + ')');
      carrito = [];
      renderCarrito();
      return cargarProductos().then(verificarCaja);
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  // ── Caja ──
  function verificarCaja() {
    return api('/api/caja/actual').then(function(data) {
      if (data.abierta) {
        cajaActual = data.caja;
        document.getElementById('cajaInfo').textContent = 'Caja abierta | Ventas: ' + fmt(data.ventas.monto_total) + ' (' + data.ventas.total_ventas + ' ventas)';
        document.getElementById('btnCaja').textContent = 'Cerrar caja';
        document.getElementById('btnCaja').className = 'btn btn-sm btn-danger';
      } else {
        cajaActual = null;
        document.getElementById('cajaInfo').textContent = 'Caja: Sin abrir';
        document.getElementById('btnCaja').textContent = 'Abrir caja';
        document.getElementById('btnCaja').className = 'btn btn-sm btn-gold';
      }
      renderCarrito();
    }).catch(function(e) { console.error(e); });
  }

  function toggleCaja() {
    if (cajaActual) {
      document.getElementById('resumenEfectivo').textContent = fmt(cajaActual.total_ventas_efectivo);
      document.getElementById('resumenTransfer').textContent = fmt(cajaActual.total_ventas_transferencia);
      var esperado = cajaActual.monto_apertura + cajaActual.total_ventas_efectivo;
      document.getElementById('resumenEsperado').textContent = fmt(esperado);
      document.getElementById('montoCierreReal').value = '';
      document.getElementById('notasCierre').value = '';
      document.getElementById('diferenciaCaja').style.display = 'none';
      abrirModal('modalCerrarCaja');
    } else {
      document.getElementById('montoApertura').value = 0;
      abrirModal('modalAbrirCaja');
    }
  }

  function confirmarAbrirCaja() {
    api('/api/caja/abrir', { method: 'POST', body: JSON.stringify({ monto_apertura: Number(document.getElementById('montoApertura').value) || 0 }) }).then(function() {
      cerrarModal('modalAbrirCaja');
      toast('Caja abierta correctamente');
      return verificarCaja();
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  document.getElementById('montoCierreReal').addEventListener('input', function() {
    var real = Number(this.value) || 0;
    var esperado = cajaActual.monto_apertura + cajaActual.total_ventas_efectivo;
    var dif = real - esperado;
    var el = document.getElementById('diferenciaCaja');
    el.style.display = 'block';
    document.getElementById('diferenciaMonto').textContent = fmt(Math.abs(dif));
    var texto = document.getElementById('diferenciaTexto');
    if (Math.abs(dif) < 1) {
      el.className = 'stat-card success'; texto.textContent = 'La caja cuadra perfectamente';
    } else if (dif > 0) {
      el.className = 'stat-card gold'; texto.textContent = 'Sobrante de ' + fmt(dif);
    } else {
      el.className = 'stat-card danger'; texto.textContent = 'Faltante de ' + fmt(Math.abs(dif));
    }
  });

  function confirmarCerrarCaja() {
    var real = Number(document.getElementById('montoCierreReal').value);
    if (!real && real !== 0) { toast('Ingrese el monto real', 'error'); return; }
    api('/api/caja/cerrar', {
      method: 'POST',
      body: JSON.stringify({ monto_cierre_real: real, notas: document.getElementById('notasCierre').value })
    }).then(function(res) {
      cerrarModal('modalCerrarCaja');
      var dif = res.caja.diferencia;
      if (Math.abs(dif) < 1) toast('Caja cerrada. Cuadra perfectamente.');
      else if (dif > 0) toast('Caja cerrada. Sobrante: ' + fmt(dif), 'info');
      else toast('Caja cerrada. Faltante: ' + fmt(Math.abs(dif)), 'error');
      return verificarCaja();
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  function abrirHistorial() {
    var hoy = new Date().toISOString().split('T')[0];
    api('/api/ventas?fecha=' + hoy).then(function(ventas) {
      var body = document.getElementById('historialBody');
      if (ventas.length === 0) {
        body.innerHTML = '<div class="empty-state"><p>No hay ventas hoy</p></div>';
      } else {
        body.innerHTML = '<table>' +
          '<thead><tr><th>#</th><th>Hora</th><th>Total</th><th>Pago</th><th>Estado</th></tr></thead>' +
          '<tbody>' + ventas.map(function(v) {
            return '<tr>' +
              '<td>' + v.id + '</td>' +
              '<td>' + new Date(v.fecha).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) + '</td>' +
              '<td class="tabular text-right">' + fmt(v.total) + '</td>' +
              '<td><span class="badge ' + (v.metodo_pago==='EFECTIVO'?'badge-primary':'badge-gold') + '">' + v.metodo_pago + '</span></td>' +
              '<td>' + (v.anulada ? '<span class="badge badge-danger">Anulada</span>' : '<span class="badge badge-success">OK</span>') + '</td>' +
              '</tr>';
          }).join('') + '</tbody></table>';
      }
      abrirModal('modalHistorial');
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  function abrirInventarioModal() {
    var select = document.getElementById('invProducto');
    select.innerHTML = productos.map(function(p) { return '<option value="' + p.id + '">' + p.nombre + ' (stock: ' + p.stock_actual + ')</option>'; }).join('');
    document.getElementById('invCantidad').value = 1;
    document.getElementById('invMotivo').value = 'Reposicion';
    abrirModal('modalInventario');
  }

  function confirmarEntrada() {
    api('/api/inventario/entrada', {
      method: 'POST',
      body: JSON.stringify({
        producto_id: Number(document.getElementById('invProducto').value),
        cantidad: Number(document.getElementById('invCantidad').value),
        motivo: document.getElementById('invMotivo').value
      })
    }).then(function() {
      cerrarModal('modalInventario');
      toast('Entrada registrada');
      return cargarProductos();
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  // ── Credito ──
  function abrirModalCredito() {
    if (carrito.length === 0) return;
    var total = carrito.reduce(function(s, c) { return s + c.precio * c.cantidad; }, 0);
    document.getElementById('credTotal').textContent = fmt(total);
    document.getElementById('credNombre').value = '';
    document.getElementById('credTipo').value = 'profesor';
    document.getElementById('credNotas').value = '';
    abrirModal('modalCredito');
  }

  document.getElementById('btnConfirmarCredito').addEventListener('click', function() {
    var nombre = document.getElementById('credNombre').value.trim();
    if (!nombre) { toast('Ingrese el nombre del cliente', 'error'); return; }
    var items = carrito.map(function(c) { return { producto_id: c.producto_id, cantidad: c.cantidad }; });
    var total = carrito.reduce(function(s, c) { return s + c.precio * c.cantidad; }, 0);
    api('/api/creditos', {
      method: 'POST',
      body: JSON.stringify({
        nombre_cliente: nombre,
        tipo_cliente: document.getElementById('credTipo').value,
        monto: total,
        notas: document.getElementById('credNotas').value,
        items: items,
        caja_id: cajaActual ? cajaActual.id : null
      })
    }).then(function() {
      cerrarModal('modalCredito');
      toast('Credito registrado para ' + nombre);
      carrito = [];
      renderCarrito();
      return cargarProductos().then(verificarCaja);
    }).catch(function(e) { toast(e.message, 'error'); });
  });

  // ── Barcode scanner ──
  var barcodeInput = document.getElementById('barcodeInput');
  barcodeInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var code = barcodeInput.value.trim();
      if (!code) return;
      if (!cajaActual) { toast('Debe abrir caja primero', 'error'); barcodeInput.value = ''; return; }
      api('/api/productos/buscar-barcode/' + encodeURIComponent(code)).then(function(prod) {
        agregarAlCarrito(prod.id);
        toast(prod.nombre + ' agregado');
        barcodeInput.value = '';
        barcodeInput.focus();
      }).catch(function() {
        toast('Producto no encontrado: ' + code, 'error');
        barcodeInput.value = '';
        barcodeInput.focus();
      });
    }
  });

  // ── Init ──
  document.getElementById('userName').textContent = (user && user.nombre) || '';
  cargarProductos();
  verificarCaja();
})();
