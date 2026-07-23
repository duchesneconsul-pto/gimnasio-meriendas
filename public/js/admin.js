(function() {
  var token = localStorage.getItem('token');
  var user = JSON.parse(localStorage.getItem('user') || 'null');
  if (!token || !user || user.rol !== 'admin') { localStorage.clear(); window.location.href = '/'; return; }

  var headers = function() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }; };
  var fmt = function(n) { return '$' + Number(n||0).toLocaleString('es-CO', {minimumFractionDigits:0, maximumFractionDigits:0}); };

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
    opts.headers = headers();
    return fetch(url, opts).then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error || 'Error');
        return data;
      });
    });
  }

  // ── Sidebar toggle ──
  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('active');
  }
  document.getElementById('menuBtn').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarBackdrop').addEventListener('click', toggleSidebar);

  // ── Close modals via data-close ──
  document.addEventListener('click', function(e) {
    var closeBtn = e.target.closest('[data-close]');
    if (closeBtn) {
      cerrarModal(closeBtn.getAttribute('data-close'));
      return;
    }
  });

  // ── Navigation ──
  var currentSection = 'dashboard';
  function showSection(name) {
    var sections = document.querySelectorAll('main > section');
    for (var i = 0; i < sections.length; i++) sections[i].classList.add('hidden');
    document.getElementById('sec-' + name).classList.remove('hidden');
    var navItems = document.querySelectorAll('.nav-item');
    for (var j = 0; j < navItems.length; j++) navItems[j].classList.remove('active');
    var active = document.querySelector('.nav-item[data-section="' + name + '"]');
    if (active) active.classList.add('active');
    currentSection = name;
    loadSection(name);
    if (window.innerWidth <= 768) toggleSidebar();
  }

  function loadSection(name) {
    var loaders = { dashboard: cargarDashboard, productos: cargarProductos, inventario: cargarMovimientos, ventas: cargarVentas, arqueos: cargarArqueos, creditos: cargarCreditos, rentabilidad: cargarRentabilidad, papelera: cargarPapelera, config: cargarConfig };
    if (loaders[name]) loaders[name]();
  }

  // Nav click delegation
  document.getElementById('sidebarNav').addEventListener('click', function(e) {
    var btn = e.target.closest('.nav-item');
    if (btn && btn.dataset.section) showSection(btn.dataset.section);
  });

  // Cerrar sesion
  document.getElementById('btnCerrarSesion').addEventListener('click', function(e) {
    e.preventDefault();
    localStorage.clear();
    window.location.href = '/';
  });

  // ── Dashboard ──
  function cargarDashboard() {
    api('/api/reportes/dashboard').then(function(d) {
      document.getElementById('dashFecha').textContent = new Date().toLocaleDateString('es-CO', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
      document.getElementById('dashStats').innerHTML =
        '<div class="stat-card primary"><div class="stat-label">Ventas hoy</div><div class="stat-value">' + fmt(d.ventasHoy.total) + '</div><div class="stat-sub">' + d.ventasHoy.cantidad + ' transacciones</div></div>' +
        '<div class="stat-card gold"><div class="stat-label">Ventas semana</div><div class="stat-value">' + fmt(d.ventasSemana.total) + '</div><div class="stat-sub">' + d.ventasSemana.cantidad + ' transacciones</div></div>' +
        '<div class="stat-card info"><div class="stat-label">Ventas mes</div><div class="stat-value">' + fmt(d.ventasMes.total) + '</div><div class="stat-sub">' + d.ventasMes.cantidad + ' transacciones</div></div>' +
        '<div class="stat-card primary"><div class="stat-label">Productos activos</div><div class="stat-value">' + d.totalProductos + '</div><div class="stat-sub">Inventario: ' + fmt(d.valorInventario.venta) + '</div></div>';

      if (d.ventasPorDia.length > 0) {
        var max = Math.max.apply(null, d.ventasPorDia.map(function(v) { return v.total; }));
        document.getElementById('dashChart').innerHTML = d.ventasPorDia.map(function(v) {
          var h = max > 0 ? (v.total / max * 140) : 2;
          var fecha = new Date(v.dia + 'T12:00:00').toLocaleDateString('es-CO', {day:'2-digit', month:'short'});
          return '<div class="chart-bar" style="height:' + h + 'px"><div class="chart-tooltip">' + fecha + ': ' + fmt(v.total) + '</div></div>';
        }).join('');
      } else {
        document.getElementById('dashChart').innerHTML = '<div class="empty-state"><p>Sin datos aun</p></div>';
      }

      if (d.topProductos.length > 0) {
        document.getElementById('dashTopProd').innerHTML = '<table><thead><tr><th>Producto</th><th class="text-right">Uds</th><th class="text-right">Total</th></tr></thead><tbody>' +
          d.topProductos.map(function(p) { return '<tr><td>' + p.nombre + '</td><td class="text-right tabular">' + p.unidades + '</td><td class="text-right tabular">' + fmt(p.total) + '</td></tr>'; }).join('') +
          '</tbody></table>';
      } else {
        document.getElementById('dashTopProd').innerHTML = '<div class="empty-state"><p>Sin ventas hoy</p></div>';
      }

      if (d.stockBajo.length > 0) {
        document.getElementById('dashStockBajo').innerHTML = '<table><thead><tr><th>Producto</th><th class="text-right">Stock</th><th class="text-right">Minimo</th></tr></thead><tbody>' +
          d.stockBajo.map(function(p) { return '<tr><td>' + p.nombre + '</td><td class="text-right tabular" style="color:var(--danger);font-weight:600">' + p.stock_actual + '</td><td class="text-right tabular">' + p.stock_minimo + '</td></tr>'; }).join('') +
          '</tbody></table>';
      } else {
        document.getElementById('dashStockBajo').innerHTML = '<div class="empty-state" style="padding:1.5rem"><p>Todo el stock esta bien</p></div>';
      }

      if (d.ultimoArqueo) {
        var a = d.ultimoArqueo;
        var difClass = Math.abs(a.diferencia) < 1 ? 'badge-success' : a.diferencia > 0 ? 'badge-gold' : 'badge-danger';
        var difText = Math.abs(a.diferencia) < 1 ? 'Cuadra' : a.diferencia > 0 ? 'Sobrante ' + fmt(a.diferencia) : 'Faltante ' + fmt(Math.abs(a.diferencia));
        document.getElementById('dashArqueo').innerHTML =
          '<div class="flex-between mb-1"><span style="font-size:0.82rem;color:var(--text-muted)">' + a.fecha + ' — ' + a.cajero_nombre + '</span><span class="badge ' + difClass + '">' + difText + '</span></div>' +
          '<div class="stats-grid" style="grid-template-columns:1fr 1fr 1fr;margin:0">' +
          '<div><div style="font-size:0.7rem;color:var(--text-muted)">Esperado</div><div style="font-weight:700;font-variant-numeric:tabular-nums">' + fmt(a.monto_cierre_esperado) + '</div></div>' +
          '<div><div style="font-size:0.7rem;color:var(--text-muted)">Real</div><div style="font-weight:700;font-variant-numeric:tabular-nums">' + fmt(a.monto_cierre_real) + '</div></div>' +
          '<div><div style="font-size:0.7rem;color:var(--text-muted)">Ventas</div><div style="font-weight:700;font-variant-numeric:tabular-nums">' + fmt(a.total_ventas_efectivo + a.total_ventas_transferencia) + '</div></div>' +
          '</div>';
      } else {
        document.getElementById('dashArqueo').innerHTML = '<div class="empty-state" style="padding:1.5rem"><p>Sin arqueos registrados</p></div>';
      }
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  // ── Productos ──
  function cargarProductos() {
    api('/api/productos').then(function(prods) {
      document.getElementById('tablaProductos').innerHTML =
        '<thead><tr><th></th><th>Nombre</th><th>Barcode</th><th>Categoria</th><th class="text-right">P. Compra</th><th class="text-right">P. Venta</th><th class="text-right">Stock</th><th class="text-right">Min</th><th>Estado</th><th></th></tr></thead>' +
        '<tbody>' + prods.map(function(p) {
          var imgCell = p.imagen ? '<img src="' + p.imagen + '" style="width:36px;height:36px;border-radius:6px;object-fit:cover">' : '<div style="width:36px;height:36px;border-radius:6px;background:var(--surface);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>';
          return '<tr>' +
            '<td>' + imgCell + '</td>' +
            '<td style="font-weight:600">' + p.nombre + '</td>' +
            '<td style="font-size:0.78rem;color:var(--text-muted);font-family:monospace">' + (p.codigo_barras || '—') + '</td>' +
            '<td><span class="badge badge-primary">' + p.categoria + '</span></td>' +
            '<td class="text-right tabular">' + fmt(p.precio_compra) + '</td>' +
            '<td class="text-right tabular" style="font-weight:600">' + fmt(p.precio_venta) + '</td>' +
            '<td class="text-right tabular" style="' + (p.stock_actual <= p.stock_minimo ? 'color:var(--danger);font-weight:700' : '') + '">' + p.stock_actual + '</td>' +
            '<td class="text-right tabular">' + p.stock_minimo + '</td>' +
            '<td>' + (p.activo ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>') + '</td>' +
            '<td style="white-space:nowrap"><button class="btn btn-outline btn-sm" data-edit-prod="' + p.id + '">Editar</button> <button class="btn btn-danger btn-sm" data-del-prod="' + p.id + '">Borrar</button></td>' +
            '</tr>';
        }).join('') + '</tbody>';
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  // Event delegation for dynamic product edit/delete buttons
  document.getElementById('tablaProductos').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-edit-prod]');
    if (btn) editarProducto(Number(btn.getAttribute('data-edit-prod')));
    var delBtn = e.target.closest('[data-del-prod]');
    if (delBtn) {
      if (!confirm('¿Esta seguro que desea eliminar este producto?\n\nSe movera a la Papelera donde podra restaurarlo o eliminarlo permanentemente.')) return;
      api('/api/productos/' + delBtn.getAttribute('data-del-prod'), { method: 'PUT', body: JSON.stringify({ activo: 0 }) }).then(function() {
        toast('Producto movido a la papelera');
        cargarProductos();
      }).catch(function(e) { toast(e.message, 'error'); });
    }
  });

  function resetImgPreview() {
    document.getElementById('prodImagen').value = '';
    document.getElementById('prodImgPreview').innerHTML = '<span style="font-size:0.7rem;color:var(--text-muted);text-align:center">Sin imagen</span>';
    document.getElementById('btnQuitarImagen').style.display = 'none';
  }
  function setImgPreview(src) {
    document.getElementById('prodImgPreview').innerHTML = '<img src="' + src + '" style="width:100%;height:100%;object-fit:cover">';
    document.getElementById('btnQuitarImagen').style.display = '';
  }
  document.getElementById('prodImgFile').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('Imagen muy grande (max 2MB)', 'error'); e.target.value = ''; return; }
    var reader = new FileReader();
    reader.onload = function(ev) {
      document.getElementById('prodImagen').value = ev.target.result;
      setImgPreview(ev.target.result);
    };
    reader.readAsDataURL(file);
  });
  document.getElementById('btnQuitarImagen').addEventListener('click', function() {
    document.getElementById('prodImgFile').value = '';
    resetImgPreview();
  });

  function abrirModalProducto() {
    document.getElementById('modalProdTitle').textContent = 'Nuevo producto';
    document.getElementById('prodId').value = '';
    document.getElementById('prodBarcode').value = '';
    document.getElementById('prodNombre').value = '';
    document.getElementById('prodCategoria').value = 'general';
    document.getElementById('prodPrecioCompra').value = '';
    document.getElementById('prodPrecioVenta').value = '';
    document.getElementById('prodStockMin').value = 5;
    document.getElementById('prodImgFile').value = '';
    resetImgPreview();
    abrirModal('modalProducto');
  }
  document.getElementById('btnNuevoProducto').addEventListener('click', abrirModalProducto);

  function editarProducto(id) {
    api('/api/productos').then(function(prods) {
      var prod = prods.find(function(p) { return p.id === id; });
      if (!prod) return;
      document.getElementById('modalProdTitle').textContent = 'Editar producto';
      document.getElementById('prodId').value = prod.id;
      document.getElementById('prodBarcode').value = prod.codigo_barras || '';
      document.getElementById('prodNombre').value = prod.nombre;
      document.getElementById('prodPrecioCompra').value = prod.precio_compra;
      document.getElementById('prodPrecioVenta').value = prod.precio_venta;
      document.getElementById('prodStockMin').value = prod.stock_minimo;
      document.getElementById('prodImgFile').value = '';
      if (prod.imagen) {
        document.getElementById('prodImagen').value = prod.imagen;
        setImgPreview(prod.imagen);
      } else {
        resetImgPreview();
      }
      abrirModal('modalProducto');
    });
  }

  function guardarProducto() {
    var id = document.getElementById('prodId').value;
    var body = {
      nombre: document.getElementById('prodNombre').value,
      codigo_barras: document.getElementById('prodBarcode').value.trim() || null,
      categoria: document.getElementById('prodCategoria').value,
      precio_compra: Number(document.getElementById('prodPrecioCompra').value) || 0,
      precio_venta: Number(document.getElementById('prodPrecioVenta').value),
      stock_minimo: Number(document.getElementById('prodStockMin').value) || 5,
      imagen: document.getElementById('prodImagen').value || null,
    };
    if (!body.nombre || !body.precio_venta) { toast('Nombre y precio venta requeridos', 'error'); return; }
    var url = id ? '/api/productos/' + id : '/api/productos';
    var method = id ? 'PUT' : 'POST';
    api(url, { method: method, body: JSON.stringify(body) }).then(function() {
      cerrarModal('modalProducto');
      toast(id ? 'Producto actualizado' : 'Producto creado');
      cargarProductos();
    }).catch(function(e) { toast(e.message, 'error'); });
  }
  document.getElementById('btnGuardarProducto').addEventListener('click', guardarProducto);

  // ── Inventario ──
  function cargarMovimientos() {
    api('/api/inventario?limit=100').then(function(movs) {
      document.getElementById('tablaInventario').innerHTML =
        '<thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="text-right">Cantidad</th><th>Motivo</th><th>Usuario</th></tr></thead>' +
        '<tbody>' + movs.map(function(m) {
          var badgeClass = m.tipo === 'ENTRADA' ? 'badge-success' : m.tipo === 'SALIDA' ? 'badge-danger' : 'badge-gold';
          return '<tr>' +
            '<td>' + new Date(m.fecha).toLocaleString('es-CO', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) + '</td>' +
            '<td style="font-weight:500">' + m.producto_nombre + '</td>' +
            '<td><span class="badge ' + badgeClass + '">' + m.tipo + '</span></td>' +
            '<td class="text-right tabular" style="font-weight:600">' + (m.cantidad > 0 ? '+' : '') + m.cantidad + '</td>' +
            '<td style="color:var(--text-muted);font-size:0.82rem">' + (m.motivo || '') + '</td>' +
            '<td>' + m.usuario_nombre + '</td>' +
            '</tr>';
        }).join('') + '</tbody>';
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  function abrirModalEntrada() {
    api('/api/productos?activo=1').then(function(prods) {
      document.getElementById('entProducto').innerHTML = prods.map(function(p) { return '<option value="' + p.id + '">' + p.nombre + ' (stock: ' + p.stock_actual + ')</option>'; }).join('');
      document.getElementById('entCantidad').value = 1;
      document.getElementById('entMotivo').value = 'Reposicion';
      abrirModal('modalEntrada');
    });
  }
  document.getElementById('btnNuevaEntrada').addEventListener('click', abrirModalEntrada);

  function registrarEntrada() {
    api('/api/inventario/entrada', { method: 'POST', body: JSON.stringify({
      producto_id: Number(document.getElementById('entProducto').value),
      cantidad: Number(document.getElementById('entCantidad').value),
      motivo: document.getElementById('entMotivo').value
    })}).then(function() {
      cerrarModal('modalEntrada');
      toast('Entrada registrada');
      cargarMovimientos();
    }).catch(function(e) { toast(e.message, 'error'); });
  }
  document.getElementById('btnRegistrarEntrada').addEventListener('click', registrarEntrada);

  // ── Ventas ──
  function cargarVentas() {
    var fechaInput = document.getElementById('ventasFecha');
    if (!fechaInput.value) fechaInput.value = new Date().toISOString().split('T')[0];
    api('/api/ventas?fecha=' + fechaInput.value).then(function(ventas) {
      var total = ventas.filter(function(v) { return !v.anulada; }).reduce(function(s, v) { return s + v.total; }, 0);
      document.getElementById('tablaVentas').innerHTML =
        '<thead><tr><th>#</th><th>Hora</th><th>Cajero</th><th>Pago</th><th class="text-right">Total</th><th>Estado</th><th></th></tr></thead>' +
        '<tbody>' + ventas.map(function(v) {
          return '<tr style="' + (v.anulada ? 'opacity:0.5' : '') + '">' +
            '<td>' + v.id + '</td>' +
            '<td>' + new Date(v.fecha).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit'}) + '</td>' +
            '<td>' + v.cajero_nombre + '</td>' +
            '<td><span class="badge ' + (v.metodo_pago==='EFECTIVO'?'badge-primary':'badge-gold') + '">' + v.metodo_pago + '</span></td>' +
            '<td class="text-right tabular" style="font-weight:600">' + fmt(v.total) + '</td>' +
            '<td>' + (v.anulada ? '<span class="badge badge-danger">Anulada</span>' : '<span class="badge badge-success">OK</span>') + '</td>' +
            '<td>' +
              '<button class="btn btn-outline btn-sm" data-ver-venta="' + v.id + '">Ver</button> ' +
              (!v.anulada ? '<button class="btn btn-danger btn-sm" data-anular-venta="' + v.id + '">Anular</button>' : '') +
            '</td></tr>';
        }).join('') +
        '<tr style="font-weight:700;border-top:2px solid var(--border)"><td colspan="4">Total del dia</td><td class="text-right tabular">' + fmt(total) + '</td><td colspan="2">' + ventas.filter(function(v){return !v.anulada;}).length + ' ventas</td></tr>' +
        '</tbody>';
    }).catch(function(e) { toast(e.message, 'error'); });
  }
  document.getElementById('ventasFecha').addEventListener('change', cargarVentas);

  // Event delegation for venta buttons
  document.getElementById('tablaVentas').addEventListener('click', function(e) {
    var verBtn = e.target.closest('[data-ver-venta]');
    if (verBtn) { verDetalleVenta(Number(verBtn.getAttribute('data-ver-venta'))); return; }
    var anularBtn = e.target.closest('[data-anular-venta]');
    if (anularBtn) { anularVenta(Number(anularBtn.getAttribute('data-anular-venta'))); }
  });

  function verDetalleVenta(id) {
    api('/api/ventas/' + id).then(function(v) {
      document.getElementById('detalleVentaBody').innerHTML =
        '<div class="flex-between mb-1"><strong>Venta #' + v.id + '</strong><span class="badge ' + (v.metodo_pago==='EFECTIVO'?'badge-primary':'badge-gold') + '">' + v.metodo_pago + '</span></div>' +
        '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1rem">' + new Date(v.fecha).toLocaleString('es-CO') + ' — ' + v.cajero_nombre + '</p>' +
        '<table><thead><tr><th>Producto</th><th class="text-right">Cant</th><th class="text-right">P.Unit</th><th class="text-right">Subtotal</th></tr></thead>' +
        '<tbody>' + v.detalles.map(function(d) { return '<tr><td>' + d.producto_nombre + '</td><td class="text-right tabular">' + d.cantidad + '</td><td class="text-right tabular">' + fmt(d.precio_unitario) + '</td><td class="text-right tabular">' + fmt(d.subtotal) + '</td></tr>'; }).join('') +
        '<tr style="font-weight:700;border-top:2px solid var(--border)"><td colspan="3">Total</td><td class="text-right tabular">' + fmt(v.total) + '</td></tr></tbody></table>';
      abrirModal('modalDetalleVenta');
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  function anularVenta(id) {
    if (!confirm('Esta seguro de anular esta venta? El inventario se repondra.')) return;
    api('/api/ventas/' + id + '/anular', { method: 'POST' }).then(function() {
      toast('Venta anulada');
      cargarVentas();
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  // ── Arqueos ──
  function cargarArqueos() {
    api('/api/caja/historial?limit=50').then(function(arqueos) {
      document.getElementById('tablaArqueos').innerHTML =
        '<thead><tr><th>Fecha</th><th>Cajero</th><th class="text-right">Apertura</th><th class="text-right">Efectivo</th><th class="text-right">Transfer</th><th class="text-right">Esperado</th><th class="text-right">Real</th><th>Resultado</th></tr></thead>' +
        '<tbody>' + arqueos.map(function(a) {
          var difClass = Math.abs(a.diferencia) < 1 ? 'badge-success' : a.diferencia > 0 ? 'badge-gold' : 'badge-danger';
          var difText = Math.abs(a.diferencia) < 1 ? 'Cuadra' : a.diferencia > 0 ? '+' + fmt(a.diferencia) : fmt(a.diferencia);
          return '<tr>' +
            '<td>' + a.fecha + '</td><td>' + a.cajero_nombre + '</td>' +
            '<td class="text-right tabular">' + fmt(a.monto_apertura) + '</td>' +
            '<td class="text-right tabular">' + fmt(a.total_ventas_efectivo) + '</td>' +
            '<td class="text-right tabular">' + fmt(a.total_ventas_transferencia) + '</td>' +
            '<td class="text-right tabular" style="font-weight:600">' + fmt(a.monto_cierre_esperado) + '</td>' +
            '<td class="text-right tabular" style="font-weight:600">' + fmt(a.monto_cierre_real) + '</td>' +
            '<td><span class="badge ' + difClass + '">' + difText + '</span></td></tr>';
        }).join('') + '</tbody>';
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  // ── Rentabilidad ──
  function cargarRentabilidad() {
    api('/api/reportes/rentabilidad').then(function(prods) {
      document.getElementById('tablaRentabilidad').innerHTML =
        '<thead><tr><th>Producto</th><th>Categoria</th><th class="text-right">P.Compra</th><th class="text-right">P.Venta</th><th class="text-right">Ganancia/u</th><th class="text-right">Vendidos</th><th class="text-right">Ingresos</th><th class="text-right">Ganancia total</th></tr></thead>' +
        '<tbody>' + prods.map(function(p) {
          return '<tr>' +
            '<td style="font-weight:500">' + p.nombre + '</td>' +
            '<td><span class="badge badge-primary">' + p.categoria + '</span></td>' +
            '<td class="text-right tabular">' + fmt(p.precio_compra) + '</td>' +
            '<td class="text-right tabular">' + fmt(p.precio_venta) + '</td>' +
            '<td class="text-right tabular" style="color:var(--success);font-weight:600">' + fmt(p.ganancia_unitaria) + '</td>' +
            '<td class="text-right tabular">' + p.total_vendido + '</td>' +
            '<td class="text-right tabular">' + fmt(p.ingresos) + '</td>' +
            '<td class="text-right tabular" style="font-weight:700;color:var(--primary)">' + fmt(p.ganancia_total) + '</td></tr>';
        }).join('') + '</tbody>';
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  // ── Config ──
  function cargarConfig() {
    api('/api/reportes/config').then(function(cfg) {
      document.getElementById('cfgWebhook').value = cfg.webhook_url || '';
      document.getElementById('cfgWebhookCredito').value = cfg.webhook_credito || '';
      document.getElementById('cfgNombre').value = cfg.nombre_negocio || '';
    }).catch(function(e) { toast(e.message, 'error'); });
    cargarBackupInfo();

    api('/api/auth/usuarios').then(function(usuarios) {
      document.getElementById('tablaUsuarios').innerHTML =
        '<thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead>' +
        '<tbody>' + usuarios.map(function(u) {
          var btns = '';
          if (u.activo) {
            btns = '<button class="btn btn-outline btn-sm" data-edit-user=\'' + JSON.stringify({id:u.id,nombre:u.nombre,usuario:u.usuario,rol:u.rol}) + '\'>Editar</button> ' +
                   '<button class="btn btn-danger btn-sm" data-del-user="' + u.id + '">Eliminar</button>';
          }
          return '<tr>' +
            '<td style="font-weight:500">' + u.nombre + '</td><td>' + u.usuario + '</td>' +
            '<td><span class="badge ' + (u.rol==='admin'?'badge-gold':'badge-primary') + '">' + u.rol + '</span></td>' +
            '<td>' + (u.activo ? '<span class="badge badge-success">Activo</span>' : '<span class="badge badge-danger">Inactivo</span>') + '</td>' +
            '<td style="white-space:nowrap">' + btns + '</td></tr>';
        }).join('') + '</tbody>';
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  document.getElementById('btnGuardarConfig').addEventListener('click', function() {
    api('/api/reportes/config', { method: 'PUT', body: JSON.stringify({
      webhook_url: document.getElementById('cfgWebhook').value,
      webhook_credito: document.getElementById('cfgWebhookCredito').value,
      nombre_negocio: document.getElementById('cfgNombre').value
    })}).then(function() {
      toast('Configuracion guardada');
    }).catch(function(e) { toast(e.message, 'error'); });
  });

  function abrirModalUsuario(data) {
    if (data) {
      document.getElementById('modalUsrTitle').textContent = 'Editar usuario';
      document.getElementById('usrId').value = data.id;
      document.getElementById('usrNombre').value = data.nombre;
      document.getElementById('usrUsuario').value = data.usuario;
      document.getElementById('usrUsuario').disabled = true;
      document.getElementById('usrPassword').value = '';
      document.getElementById('usrPassword').placeholder = 'Dejar vacio para no cambiar';
      document.getElementById('usrPassHint').textContent = '(opcional)';
      document.getElementById('usrRol').value = data.rol;
    } else {
      document.getElementById('modalUsrTitle').textContent = 'Nuevo usuario';
      document.getElementById('usrId').value = '';
      document.getElementById('usrNombre').value = '';
      document.getElementById('usrUsuario').value = '';
      document.getElementById('usrUsuario').disabled = false;
      document.getElementById('usrPassword').value = '';
      document.getElementById('usrPassword').placeholder = '';
      document.getElementById('usrPassHint').textContent = '';
      document.getElementById('usrRol').value = 'cajero';
    }
    abrirModal('modalUsuario');
  }
  document.getElementById('btnNuevoUsuario').addEventListener('click', function() { abrirModalUsuario(); });

  document.getElementById('btnGuardarUsuario').addEventListener('click', function() {
    var id = document.getElementById('usrId').value;
    var nombre = document.getElementById('usrNombre').value;
    var usuario = document.getElementById('usrUsuario').value;
    var password = document.getElementById('usrPassword').value;
    var rol = document.getElementById('usrRol').value;

    if (!nombre) { toast('Nombre es requerido', 'error'); return; }

    if (id) {
      var body = { nombre: nombre, rol: rol };
      if (password.trim()) body.password = password;
      api('/api/auth/usuarios/' + id, { method: 'PUT', body: JSON.stringify(body) }).then(function() {
        cerrarModal('modalUsuario');
        toast('Usuario actualizado');
        cargarConfig();
      }).catch(function(e) { toast(e.message, 'error'); });
    } else {
      if (!usuario || !password) { toast('Usuario y contrasena requeridos', 'error'); return; }
      api('/api/auth/usuarios', { method: 'POST', body: JSON.stringify({
        nombre: nombre, usuario: usuario, password: password, rol: rol
      })}).then(function() {
        cerrarModal('modalUsuario');
        toast('Usuario creado');
        cargarConfig();
      }).catch(function(e) { toast(e.message, 'error'); });
    }
  });

  // ── User edit/delete delegation ──
  document.getElementById('tablaUsuarios').addEventListener('click', function(e) {
    var editBtn = e.target.closest('[data-edit-user]');
    if (editBtn) {
      var data = JSON.parse(editBtn.getAttribute('data-edit-user'));
      abrirModalUsuario(data);
      return;
    }
    var delBtn = e.target.closest('[data-del-user]');
    if (delBtn) {
      if (!confirm('Desactivar este usuario?')) return;
      api('/api/auth/usuarios/' + delBtn.getAttribute('data-del-user'), { method: 'DELETE' }).then(function() {
        toast('Usuario desactivado');
        cargarConfig();
      }).catch(function(e) { toast(e.message, 'error'); });
    }
  });

  // ── Backup ──
  function cargarBackupInfo() {
    api('/api/backup/info').then(function(info) {
      document.getElementById('backupInfo').innerHTML =
        '<div class="stats-grid" style="grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));margin-bottom:0">' +
        '<div class="stat-card info"><div class="stat-label">Productos</div><div class="stat-value" style="font-size:1.1rem">' + info.productos + '</div></div>' +
        '<div class="stat-card gold"><div class="stat-label">Ventas</div><div class="stat-value" style="font-size:1.1rem">' + info.ventas + '</div></div>' +
        '<div class="stat-card success"><div class="stat-label">Creditos</div><div class="stat-value" style="font-size:1.1rem">' + info.creditos + '</div></div>' +
        '<div class="stat-card primary"><div class="stat-label">Tamano</div><div class="stat-value" style="font-size:1.1rem">' + info.tamano + '</div></div>' +
        '</div>';
    }).catch(function() {});
  }

  document.getElementById('btnDescargarBackup').addEventListener('click', function() {
    fetch('/api/backup/descargar', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(res) {
        if (!res.ok) throw new Error('Error al descargar');
        return res.blob();
      })
      .then(function(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'meriendas_backup_' + new Date().toISOString().slice(0,10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        toast('Backup descargado');
      })
      .catch(function(e) { toast(e.message, 'error'); });
  });

  document.getElementById('btnRestaurarBackup').addEventListener('change', function(e) {
    var file = e.target.files[0];
    if (!file) return;
    if (!confirm('Esto reemplazara TODOS los datos actuales con el backup. Continuar?')) {
      e.target.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result.split(',')[1];
      api('/api/backup/restaurar', { method: 'POST', body: JSON.stringify({ data: base64 }) }).then(function() {
        toast('Backup restaurado. Recargando...', 'info');
        setTimeout(function() { window.location.reload(); }, 2000);
      }).catch(function(e) { toast(e.message, 'error'); });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  // ── Creditos ──
  function cargarCreditos() {
    api('/api/creditos/resumen').then(function(r) {
      document.getElementById('creditosStats').innerHTML =
        '<div class="stat-card danger"><div class="stat-label">Total pendiente</div><div class="stat-value">' + fmt(r.total_pendiente) + '</div><div class="stat-sub">' + r.total_creditos + ' creditos</div></div>' +
        '<div class="stat-card success"><div class="stat-label">Creditos pagados</div><div class="stat-value">' + (r.pagados || 0) + '</div></div>' +
        '<div class="stat-card gold"><div class="stat-label">Creditos activos</div><div class="stat-value">' + (r.activos || 0) + '</div></div>';
    }).catch(function() {});

    api('/api/creditos?estado=PENDIENTE').then(function(creditos) {
      api('/api/creditos?estado=PARCIAL').then(function(parciales) {
        var todos = creditos.concat(parciales);
        document.getElementById('tablaCreditos').innerHTML =
          '<thead><tr><th>Fecha</th><th>Cliente</th><th>Tipo</th><th class="text-right">Monto</th><th class="text-right">Pendiente</th><th>Estado</th><th></th></tr></thead>' +
          '<tbody>' + (todos.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No hay creditos pendientes</td></tr>' : todos.map(function(c) {
            var estadoClass = c.estado === 'PENDIENTE' ? 'badge-danger' : 'badge-gold';
            return '<tr>' +
              '<td>' + new Date(c.fecha).toLocaleDateString('es-CO') + '</td>' +
              '<td style="font-weight:500">' + c.nombre_cliente + '</td>' +
              '<td><span class="badge badge-primary">' + c.tipo_cliente + '</span></td>' +
              '<td class="text-right tabular">' + fmt(c.monto) + '</td>' +
              '<td class="text-right tabular" style="font-weight:700;color:var(--danger)">' + fmt(c.saldo_pendiente) + '</td>' +
              '<td><span class="badge ' + estadoClass + '">' + c.estado + '</span></td>' +
              '<td>' +
                '<button class="btn btn-primary btn-sm" data-abonar-cred="' + c.id + '" data-saldo="' + c.saldo_pendiente + '" data-cliente="' + c.nombre_cliente + '">Abonar</button> ' +
                '<button class="btn btn-outline btn-sm" data-ver-cred="' + c.id + '">Ver</button>' +
              '</td></tr>';
          }).join('')) + '</tbody>';
      });
    }).catch(function(e) { toast(e.message, 'error'); });

    api('/api/creditos/resumen').then(function(r) {
      if (r.top_deudores && r.top_deudores.length > 0) {
        document.getElementById('topDeudores').innerHTML =
          '<table><thead><tr><th>Cliente</th><th class="text-right">Deuda total</th><th class="text-right">Creditos</th></tr></thead>' +
          '<tbody>' + r.top_deudores.map(function(d) {
            return '<tr><td style="font-weight:500">' + d.nombre_cliente + '</td><td class="text-right tabular" style="color:var(--danger);font-weight:700">' + fmt(d.total) + '</td><td class="text-right">' + d.cantidad + '</td></tr>';
          }).join('') + '</tbody></table>';
      } else {
        document.getElementById('topDeudores').innerHTML = '<p style="color:var(--text-muted)">No hay deudores</p>';
      }
    }).catch(function() {});
  }

  // Creditos delegation
  document.getElementById('tablaCreditos').addEventListener('click', function(e) {
    var abonarBtn = e.target.closest('[data-abonar-cred]');
    if (abonarBtn) {
      document.getElementById('pagoCredId').value = abonarBtn.getAttribute('data-abonar-cred');
      document.getElementById('pagoCredSaldo').textContent = fmt(Number(abonarBtn.getAttribute('data-saldo')));
      document.getElementById('pagoCredCliente').textContent = abonarBtn.getAttribute('data-cliente');
      document.getElementById('pagoCredMonto').value = '';
      document.getElementById('pagoCredMonto').max = abonarBtn.getAttribute('data-saldo');
      abrirModal('modalPagoCredito');
      return;
    }
    var verBtn = e.target.closest('[data-ver-cred]');
    if (verBtn) {
      api('/api/creditos/' + verBtn.getAttribute('data-ver-cred')).then(function(c) {
        var pagosHtml = '';
        if (c.pagos && c.pagos.length > 0) {
          pagosHtml = '<h4 style="margin:1rem 0 0.5rem;font-size:0.9rem">Abonos realizados</h4>' +
            '<table><thead><tr><th>Fecha</th><th>Metodo</th><th class="text-right">Monto</th></tr></thead><tbody>' +
            c.pagos.map(function(p) {
              return '<tr><td>' + new Date(p.fecha).toLocaleDateString('es-CO') + '</td><td><span class="badge ' + (p.metodo_pago==='EFECTIVO'?'badge-primary':'badge-gold') + '">' + p.metodo_pago + '</span></td><td class="text-right tabular">' + fmt(p.monto) + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
        document.getElementById('detalleCreditoBody').innerHTML =
          '<div class="flex-between mb-1"><strong>' + c.nombre_cliente + '</strong><span class="badge badge-primary">' + c.tipo_cliente + '</span></div>' +
          '<p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:1rem">' + new Date(c.fecha).toLocaleDateString('es-CO') + (c.notas ? ' — ' + c.notas : '') + '</p>' +
          '<div class="stats-grid" style="grid-template-columns:1fr 1fr 1fr">' +
            '<div class="stat-card info"><div class="stat-label">Monto total</div><div class="stat-value">' + fmt(c.monto) + '</div></div>' +
            '<div class="stat-card ' + (c.saldo_pendiente > 0 ? 'danger' : 'success') + '"><div class="stat-label">Pendiente</div><div class="stat-value">' + fmt(c.saldo_pendiente) + '</div></div>' +
            '<div class="stat-card success"><div class="stat-label">Abonado</div><div class="stat-value">' + fmt(c.monto - c.saldo_pendiente) + '</div></div>' +
          '</div>' + pagosHtml;
        abrirModal('modalDetalleCredito');
      }).catch(function(e) { toast(e.message, 'error'); });
    }
  });

  document.getElementById('btnConfirmarPagoCredito').addEventListener('click', function() {
    var monto = Number(document.getElementById('pagoCredMonto').value);
    if (!monto || monto <= 0) { toast('Ingrese un monto valido', 'error'); return; }
    api('/api/creditos/' + document.getElementById('pagoCredId').value + '/pago', {
      method: 'POST',
      body: JSON.stringify({ monto: monto, metodo_pago: document.getElementById('pagoCredMetodo').value })
    }).then(function() {
      cerrarModal('modalPagoCredito');
      toast('Abono registrado');
      cargarCreditos();
    }).catch(function(e) { toast(e.message, 'error'); });
  });

  // ── Papelera ──
  function cargarPapelera() {
    api('/api/productos/papelera').then(function(prods) {
      if (prods.length === 0) {
        document.getElementById('tablaPapelera').innerHTML = '<tbody><tr><td style="text-align:center;color:var(--text-muted);padding:2rem">La papelera esta vacia</td></tr></tbody>';
        return;
      }
      document.getElementById('tablaPapelera').innerHTML =
        '<thead><tr><th></th><th>Nombre</th><th>Categoria</th><th class="text-right">P. Venta</th><th class="text-right">Stock</th><th></th></tr></thead>' +
        '<tbody>' + prods.map(function(p) {
          var imgCell = p.imagen ? '<img src="' + p.imagen + '" style="width:36px;height:36px;border-radius:6px;object-fit:cover">' : '<div style="width:36px;height:36px;border-radius:6px;background:var(--surface);display:flex;align-items:center;justify-content:center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>';
          return '<tr>' +
            '<td>' + imgCell + '</td>' +
            '<td style="font-weight:600">' + p.nombre + '</td>' +
            '<td><span class="badge badge-primary">' + p.categoria + '</span></td>' +
            '<td class="text-right tabular">' + fmt(p.precio_venta) + '</td>' +
            '<td class="text-right tabular">' + p.stock_actual + '</td>' +
            '<td style="white-space:nowrap">' +
              '<button class="btn btn-primary btn-sm" data-restaurar-prod="' + p.id + '">Restaurar</button> ' +
              '<button class="btn btn-danger btn-sm" data-eliminar-perm="' + p.id + '" data-nombre="' + p.nombre + '">Eliminar</button>' +
            '</td></tr>';
        }).join('') + '</tbody>';
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  document.getElementById('tablaPapelera').addEventListener('click', function(e) {
    var restBtn = e.target.closest('[data-restaurar-prod]');
    if (restBtn) {
      api('/api/productos/' + restBtn.getAttribute('data-restaurar-prod') + '/restaurar', { method: 'POST' }).then(function() {
        toast('Producto restaurado');
        cargarPapelera();
      }).catch(function(e) { toast(e.message, 'error'); });
      return;
    }
    var delBtn = e.target.closest('[data-eliminar-perm]');
    if (delBtn) {
      var nombre = delBtn.getAttribute('data-nombre');
      if (!confirm('¿Eliminar permanentemente "' + nombre + '"?\n\nEsta accion NO se puede deshacer.')) return;
      api('/api/productos/' + delBtn.getAttribute('data-eliminar-perm') + '/permanente', { method: 'DELETE' }).then(function() {
        toast('Producto eliminado permanentemente');
        cargarPapelera();
      }).catch(function(e) { toast(e.message, 'error'); });
    }
  });

  // ── Categorias ──
  function cargarCategorias() {
    api('/api/productos/categorias').then(function(cats) {
      document.getElementById('listaCategorias').innerHTML = cats.map(function(c) {
        return '<div style="display:inline-flex;align-items:center;gap:0.25rem;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:0.25rem 0.5rem;font-size:0.82rem">' +
          '<span style="font-weight:600">' + c + '</span>' +
          (c !== 'general' ? ' <button class="btn btn-outline btn-sm" data-rename-cat="' + c + '" style="padding:0 4px;font-size:0.65rem;min-width:auto">Renombrar</button>' +
          '<button class="btn btn-danger btn-sm" data-delete-cat="' + c + '" style="padding:0 4px;font-size:0.65rem;min-width:auto">X</button>' : '') +
        '</div>';
      }).join('');
    }).catch(function(e) { toast(e.message, 'error'); });
  }

  document.getElementById('btnToggleCats').addEventListener('click', function() {
    var panel = document.getElementById('categoriasPanel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) cargarCategorias();
  });

  document.getElementById('listaCategorias').addEventListener('click', function(e) {
    var renameBtn = e.target.closest('[data-rename-cat]');
    if (renameBtn) {
      var cat = renameBtn.getAttribute('data-rename-cat');
      document.getElementById('catVieja').value = cat;
      document.getElementById('catNueva').value = cat;
      document.getElementById('modalCatTitle').textContent = 'Renombrar: ' + cat;
      abrirModal('modalCategoria');
      return;
    }
    var delBtn = e.target.closest('[data-delete-cat]');
    if (delBtn) {
      var catName = delBtn.getAttribute('data-delete-cat');
      if (!confirm('¿Eliminar la categoria "' + catName + '"?\n\nLos productos se moveran a "general".')) return;
      api('/api/productos/categorias/' + encodeURIComponent(catName), { method: 'DELETE' }).then(function(r) {
        toast(r.movidos + ' productos movidos a "general"');
        cargarCategorias();
        cargarProductos();
      }).catch(function(e) { toast(e.message, 'error'); });
    }
  });

  document.getElementById('btnGuardarCategoria').addEventListener('click', function() {
    var vieja = document.getElementById('catVieja').value;
    var nueva = document.getElementById('catNueva').value.trim();
    if (!nueva) { toast('Escriba un nombre', 'error'); return; }
    if (vieja === nueva) { cerrarModal('modalCategoria'); return; }
    api('/api/productos/categorias/renombrar', { method: 'PUT', body: JSON.stringify({ vieja: vieja, nueva: nueva }) }).then(function(r) {
      cerrarModal('modalCategoria');
      toast('Categoria renombrada (' + r.actualizados + ' productos)');
      cargarCategorias();
      cargarProductos();
    }).catch(function(e) { toast(e.message, 'error'); });
  });

  // ── Init ──
  document.getElementById('adminName').textContent = user.nombre || 'Admin';
  document.getElementById('ventasFecha').value = new Date().toISOString().split('T')[0];
  cargarDashboard();
})();
