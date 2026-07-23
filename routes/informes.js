const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { pool } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

var fmt = function(n) { return '$' + Number(n||0).toLocaleString('es-CO', {minimumFractionDigits:0, maximumFractionDigits:0}); };

function addPdfHeader(doc, titulo, subtitulo) {
  doc.fontSize(18).font('Helvetica-Bold').text('Gimnasio Campestre - Meriendas', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).text(titulo, { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(9).font('Helvetica').fillColor('#666666').text(subtitulo, { align: 'center' });
  doc.fillColor('#000000');
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#cccccc');
  doc.moveDown(0.5);
}

function addPdfTable(doc, headers, rows, colWidths) {
  var startX = 50;
  var tableWidth = colWidths.reduce(function(s, w) { return s + w; }, 0);
  var rowHeight = 18;
  var y = doc.y;

  doc.rect(startX, y, tableWidth, rowHeight).fill('#2d5a27');
  var x = startX;
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
  for (var i = 0; i < headers.length; i++) {
    var align = headers[i].align || 'left';
    var textX = align === 'right' ? x + colWidths[i] - 5 : x + 5;
    var opts = { width: colWidths[i] - 10, align: align };
    doc.text(headers[i].label, textX, y + 4, opts);
    x += colWidths[i];
  }

  y += rowHeight;
  doc.fillColor('#000000').fontSize(7.5).font('Helvetica');

  for (var r = 0; r < rows.length; r++) {
    if (y + rowHeight > doc.page.height - 60) {
      doc.addPage();
      y = 50;
    }
    if (r % 2 === 0) {
      doc.rect(startX, y, tableWidth, rowHeight).fill('#f5f5f5');
    }
    doc.fillColor('#333333');
    x = startX;
    for (var c = 0; c < headers.length; c++) {
      var cellAlign = headers[c].align || 'left';
      var cellX = cellAlign === 'right' ? x + colWidths[c] - 5 : x + 5;
      doc.text(String(rows[r][c] != null ? rows[r][c] : ''), cellX, y + 5, { width: colWidths[c] - 10, align: cellAlign });
      x += colWidths[c];
    }
    y += rowHeight;
  }

  doc.y = y + 5;
}

function addPdfSummary(doc, items) {
  var startX = 50;
  doc.moveDown(0.3);
  for (var i = 0; i < items.length; i++) {
    doc.fontSize(9).font('Helvetica-Bold').text(items[i].label + ': ', startX, doc.y, { continued: true });
    doc.font('Helvetica').text(items[i].value);
  }
  doc.moveDown(0.5);
}

// ── Ventas PDF ──
router.get('/ventas/pdf', verificarToken, soloAdmin, async (req, res) => {
  try {
    var fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    var ventas = (await pool.query(`
      SELECT v.id, v.fecha, v.total, v.metodo_pago, v.anulada, u.nombre as cajero
      FROM ventas v JOIN usuarios u ON v.cajero_id = u.id
      WHERE v.fecha::date = $1 ORDER BY v.fecha
    `, [fecha])).rows;

    var totalEfectivo = 0, totalTransferencia = 0, totalCredito = 0, anuladas = 0;
    ventas.forEach(function(v) {
      if (v.anulada) { anuladas++; return; }
      if (v.metodo_pago === 'EFECTIVO') totalEfectivo += Number(v.total);
      else if (v.metodo_pago === 'TRANSFERENCIA') totalTransferencia += Number(v.total);
      else totalCredito += Number(v.total);
    });

    var doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=ventas_' + fecha + '.pdf');
    doc.pipe(res);

    addPdfHeader(doc, 'Informe de Ventas', 'Fecha: ' + fecha + ' | Generado: ' + new Date().toLocaleString('es-CO'));

    addPdfSummary(doc, [
      { label: 'Total ventas', value: fmt(totalEfectivo + totalTransferencia + totalCredito) },
      { label: 'Efectivo', value: fmt(totalEfectivo) },
      { label: 'Transferencia', value: fmt(totalTransferencia) },
      { label: 'Credito', value: fmt(totalCredito) },
      { label: 'Transacciones', value: ventas.filter(function(v) { return !v.anulada; }).length.toString() },
      { label: 'Anuladas', value: anuladas.toString() }
    ]);

    var headers = [
      { label: '#', align: 'left' },
      { label: 'Hora', align: 'left' },
      { label: 'Cajero', align: 'left' },
      { label: 'Metodo', align: 'left' },
      { label: 'Total', align: 'right' },
      { label: 'Estado', align: 'left' }
    ];
    var colWidths = [40, 70, 120, 90, 80, 80];
    var rows = ventas.map(function(v) {
      return [
        v.id,
        new Date(v.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        v.cajero,
        v.metodo_pago,
        fmt(v.total),
        v.anulada ? 'ANULADA' : 'OK'
      ];
    });

    addPdfTable(doc, headers, rows, colWidths);

    // Top productos del dia
    var topProds = (await pool.query(`
      SELECT p.nombre, SUM(vd.cantidad) as uds, SUM(vd.subtotal) as total
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE v.fecha::date = $1 AND v.anulada = 0
      GROUP BY p.nombre ORDER BY uds DESC LIMIT 15
    `, [fecha])).rows;

    if (topProds.length > 0) {
      doc.moveDown(1);
      doc.fontSize(12).font('Helvetica-Bold').text('Top Productos del Dia');
      doc.moveDown(0.3);
      addPdfTable(doc,
        [{ label: 'Producto', align: 'left' }, { label: 'Unidades', align: 'right' }, { label: 'Total', align: 'right' }],
        topProds.map(function(p) { return [p.nombre, p.uds, fmt(p.total)]; }),
        [250, 100, 100]
      );
    }

    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Ventas Excel ──
router.get('/ventas/excel', verificarToken, soloAdmin, async (req, res) => {
  try {
    var fecha = req.query.fecha || new Date().toISOString().split('T')[0];
    var ventas = (await pool.query(`
      SELECT v.id, v.fecha, v.total, v.metodo_pago, v.anulada, u.nombre as cajero
      FROM ventas v JOIN usuarios u ON v.cajero_id = u.id
      WHERE v.fecha::date = $1 ORDER BY v.fecha
    `, [fecha])).rows;

    var detalles = (await pool.query(`
      SELECT vd.venta_id, p.nombre as producto, vd.cantidad, vd.precio_unitario, vd.subtotal
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE v.fecha::date = $1 ORDER BY vd.venta_id
    `, [fecha])).rows;

    var wb = new ExcelJS.Workbook();
    wb.creator = 'Meriendas Gimnasio Campestre';

    // Hoja Resumen
    var ws = wb.addWorksheet('Ventas');
    ws.columns = [
      { header: '#', key: 'id', width: 8 },
      { header: 'Hora', key: 'hora', width: 12 },
      { header: 'Cajero', key: 'cajero', width: 20 },
      { header: 'Metodo', key: 'metodo', width: 15 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'Estado', key: 'estado', width: 12 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5A27' } };

    ventas.forEach(function(v) {
      ws.addRow({
        id: v.id,
        hora: new Date(v.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        cajero: v.cajero,
        metodo: v.metodo_pago,
        total: Number(v.total),
        estado: v.anulada ? 'ANULADA' : 'OK'
      });
    });
    ws.getColumn('total').numFmt = '$#,##0';

    // Hoja Detalles
    var ws2 = wb.addWorksheet('Detalles');
    ws2.columns = [
      { header: 'Venta #', key: 'venta_id', width: 10 },
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'P. Unitario', key: 'precio', width: 15 },
      { header: 'Subtotal', key: 'subtotal', width: 15 }
    ];
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5A27' } };

    detalles.forEach(function(d) {
      ws2.addRow({ venta_id: d.venta_id, producto: d.producto, cantidad: Number(d.cantidad), precio: Number(d.precio_unitario), subtotal: Number(d.subtotal) });
    });
    ws2.getColumn('precio').numFmt = '$#,##0';
    ws2.getColumn('subtotal').numFmt = '$#,##0';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=ventas_' + fecha + '.xlsx');
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Inventario PDF ──
router.get('/inventario/pdf', verificarToken, soloAdmin, async (req, res) => {
  try {
    var productos = (await pool.query(`
      SELECT nombre, categoria, codigo_barras, precio_compra, precio_venta, stock_actual, stock_minimo
      FROM productos WHERE activo = 1 ORDER BY categoria, nombre
    `)).rows;

    var totalCosto = 0, totalVenta = 0;
    productos.forEach(function(p) {
      totalCosto += p.precio_compra * p.stock_actual;
      totalVenta += p.precio_venta * p.stock_actual;
    });

    var doc = new PDFDocument({ size: 'LETTER', margin: 50, layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=inventario_' + new Date().toISOString().split('T')[0] + '.pdf');
    doc.pipe(res);

    addPdfHeader(doc, 'Informe de Inventario', 'Generado: ' + new Date().toLocaleString('es-CO'));

    addPdfSummary(doc, [
      { label: 'Total productos activos', value: productos.length.toString() },
      { label: 'Valor inventario (costo)', value: fmt(totalCosto) },
      { label: 'Valor inventario (venta)', value: fmt(totalVenta) },
      { label: 'Ganancia potencial', value: fmt(totalVenta - totalCosto) }
    ]);

    var headers = [
      { label: 'Producto', align: 'left' },
      { label: 'Categoria', align: 'left' },
      { label: 'Barcode', align: 'left' },
      { label: 'P.Compra', align: 'right' },
      { label: 'P.Venta', align: 'right' },
      { label: 'Stock', align: 'right' },
      { label: 'Min', align: 'right' },
      { label: 'Valor stock', align: 'right' }
    ];
    var colWidths = [150, 90, 90, 70, 70, 50, 50, 80];
    var rows = productos.map(function(p) {
      return [
        p.nombre, p.categoria, p.codigo_barras || '', fmt(p.precio_compra), fmt(p.precio_venta),
        p.stock_actual, p.stock_minimo, fmt(p.precio_venta * p.stock_actual)
      ];
    });

    addPdfTable(doc, headers, rows, colWidths);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Inventario Excel ──
router.get('/inventario/excel', verificarToken, soloAdmin, async (req, res) => {
  try {
    var productos = (await pool.query(`
      SELECT nombre, categoria, codigo_barras, precio_compra, precio_venta, stock_actual, stock_minimo
      FROM productos WHERE activo = 1 ORDER BY categoria, nombre
    `)).rows;

    var wb = new ExcelJS.Workbook();
    wb.creator = 'Meriendas Gimnasio Campestre';
    var ws = wb.addWorksheet('Inventario');
    ws.columns = [
      { header: 'Producto', key: 'nombre', width: 30 },
      { header: 'Categoria', key: 'categoria', width: 15 },
      { header: 'Cod. Barras', key: 'barcode', width: 18 },
      { header: 'P. Compra', key: 'precio_compra', width: 14 },
      { header: 'P. Venta', key: 'precio_venta', width: 14 },
      { header: 'Stock', key: 'stock', width: 10 },
      { header: 'Minimo', key: 'minimo', width: 10 },
      { header: 'Valor Stock', key: 'valor', width: 15 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5A27' } };

    productos.forEach(function(p) {
      ws.addRow({
        nombre: p.nombre, categoria: p.categoria, barcode: p.codigo_barras || '',
        precio_compra: Number(p.precio_compra), precio_venta: Number(p.precio_venta),
        stock: Number(p.stock_actual), minimo: Number(p.stock_minimo),
        valor: Number(p.precio_venta) * Number(p.stock_actual)
      });
    });
    ws.getColumn('precio_compra').numFmt = '$#,##0';
    ws.getColumn('precio_venta').numFmt = '$#,##0';
    ws.getColumn('valor').numFmt = '$#,##0';

    // Conditional formatting for low stock
    productos.forEach(function(p, i) {
      if (Number(p.stock_actual) <= Number(p.stock_minimo)) {
        ws.getRow(i + 2).getCell('stock').font = { bold: true, color: { argb: 'FFFF0000' } };
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=inventario_' + new Date().toISOString().split('T')[0] + '.xlsx');
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Rentabilidad PDF ──
router.get('/rentabilidad/pdf', verificarToken, soloAdmin, async (req, res) => {
  try {
    var prods = (await pool.query(`
      SELECT p.nombre, p.categoria, p.precio_compra, p.precio_venta,
        (p.precio_venta - p.precio_compra) as ganancia_unitaria,
        COALESCE(SUM(vd.cantidad),0) as total_vendido,
        COALESCE(SUM(vd.subtotal),0) as ingresos,
        COALESCE(SUM(vd.cantidad * p.precio_compra),0) as costo_total,
        COALESCE(SUM(vd.subtotal) - SUM(vd.cantidad * p.precio_compra),0) as ganancia_total
      FROM productos p
      LEFT JOIN venta_detalles vd ON p.id = vd.producto_id
      LEFT JOIN ventas v ON vd.venta_id = v.id AND v.anulada = 0
      WHERE p.activo = 1
      GROUP BY p.id, p.nombre, p.categoria, p.precio_compra, p.precio_venta
      ORDER BY ganancia_total DESC
    `)).rows;

    var totalGanancia = prods.reduce(function(s, p) { return s + Number(p.ganancia_total); }, 0);
    var totalIngresos = prods.reduce(function(s, p) { return s + Number(p.ingresos); }, 0);

    var doc = new PDFDocument({ size: 'LETTER', margin: 50, layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=rentabilidad_' + new Date().toISOString().split('T')[0] + '.pdf');
    doc.pipe(res);

    addPdfHeader(doc, 'Informe de Rentabilidad', 'Generado: ' + new Date().toLocaleString('es-CO'));

    addPdfSummary(doc, [
      { label: 'Total ingresos', value: fmt(totalIngresos) },
      { label: 'Total ganancia', value: fmt(totalGanancia) },
      { label: 'Margen promedio', value: totalIngresos > 0 ? (totalGanancia / totalIngresos * 100).toFixed(1) + '%' : '0%' }
    ]);

    var headers = [
      { label: 'Producto', align: 'left' },
      { label: 'Categoria', align: 'left' },
      { label: 'P.Compra', align: 'right' },
      { label: 'P.Venta', align: 'right' },
      { label: 'Ganancia/u', align: 'right' },
      { label: 'Vendidos', align: 'right' },
      { label: 'Ingresos', align: 'right' },
      { label: 'Ganancia', align: 'right' }
    ];
    var colWidths = [140, 80, 70, 70, 70, 60, 80, 80];
    var rows = prods.map(function(p) {
      return [
        p.nombre, p.categoria, fmt(p.precio_compra), fmt(p.precio_venta),
        fmt(p.ganancia_unitaria), p.total_vendido, fmt(p.ingresos), fmt(p.ganancia_total)
      ];
    });

    addPdfTable(doc, headers, rows, colWidths);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Rentabilidad Excel ──
router.get('/rentabilidad/excel', verificarToken, soloAdmin, async (req, res) => {
  try {
    var prods = (await pool.query(`
      SELECT p.nombre, p.categoria, p.precio_compra, p.precio_venta,
        (p.precio_venta - p.precio_compra) as ganancia_unitaria,
        COALESCE(SUM(vd.cantidad),0) as total_vendido,
        COALESCE(SUM(vd.subtotal),0) as ingresos,
        COALESCE(SUM(vd.cantidad * p.precio_compra),0) as costo_total,
        COALESCE(SUM(vd.subtotal) - SUM(vd.cantidad * p.precio_compra),0) as ganancia_total
      FROM productos p
      LEFT JOIN venta_detalles vd ON p.id = vd.producto_id
      LEFT JOIN ventas v ON vd.venta_id = v.id AND v.anulada = 0
      WHERE p.activo = 1
      GROUP BY p.id, p.nombre, p.categoria, p.precio_compra, p.precio_venta
      ORDER BY ganancia_total DESC
    `)).rows;

    var wb = new ExcelJS.Workbook();
    wb.creator = 'Meriendas Gimnasio Campestre';
    var ws = wb.addWorksheet('Rentabilidad');
    ws.columns = [
      { header: 'Producto', key: 'nombre', width: 30 },
      { header: 'Categoria', key: 'categoria', width: 15 },
      { header: 'P. Compra', key: 'precio_compra', width: 14 },
      { header: 'P. Venta', key: 'precio_venta', width: 14 },
      { header: 'Ganancia/u', key: 'ganancia_u', width: 14 },
      { header: 'Vendidos', key: 'vendidos', width: 12 },
      { header: 'Ingresos', key: 'ingresos', width: 15 },
      { header: 'Ganancia Total', key: 'ganancia', width: 16 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5A27' } };

    prods.forEach(function(p) {
      ws.addRow({
        nombre: p.nombre, categoria: p.categoria,
        precio_compra: Number(p.precio_compra), precio_venta: Number(p.precio_venta),
        ganancia_u: Number(p.ganancia_unitaria), vendidos: Number(p.total_vendido),
        ingresos: Number(p.ingresos), ganancia: Number(p.ganancia_total)
      });
    });
    ['precio_compra','precio_venta','ganancia_u','ingresos','ganancia'].forEach(function(col) {
      ws.getColumn(col).numFmt = '$#,##0';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=rentabilidad_' + new Date().toISOString().split('T')[0] + '.xlsx');
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Arqueos PDF ──
router.get('/arqueos/pdf', verificarToken, soloAdmin, async (req, res) => {
  try {
    var arqueos = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre FROM cajas c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.estado = 'CERRADA'
      ORDER BY c.cerrada_en DESC LIMIT 50
    `)).rows;

    var doc = new PDFDocument({ size: 'LETTER', margin: 50, layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=arqueos_' + new Date().toISOString().split('T')[0] + '.pdf');
    doc.pipe(res);

    addPdfHeader(doc, 'Historial de Arqueos de Caja', 'Generado: ' + new Date().toLocaleString('es-CO'));

    var headers = [
      { label: 'Fecha', align: 'left' },
      { label: 'Cajero', align: 'left' },
      { label: 'Apertura', align: 'right' },
      { label: 'Efectivo', align: 'right' },
      { label: 'Transfer.', align: 'right' },
      { label: 'Esperado', align: 'right' },
      { label: 'Real', align: 'right' },
      { label: 'Diferencia', align: 'right' }
    ];
    var colWidths = [90, 100, 70, 70, 70, 80, 80, 80];
    var rows = arqueos.map(function(a) {
      var dif = Number(a.diferencia);
      var difText = Math.abs(dif) < 1 ? 'Cuadra' : (dif > 0 ? '+' : '') + fmt(dif);
      return [
        a.fecha, a.cajero_nombre, fmt(a.monto_apertura),
        fmt(a.total_ventas_efectivo), fmt(a.total_ventas_transferencia),
        fmt(a.monto_cierre_esperado), fmt(a.monto_cierre_real), difText
      ];
    });

    addPdfTable(doc, headers, rows, colWidths);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Arqueos Excel ──
router.get('/arqueos/excel', verificarToken, soloAdmin, async (req, res) => {
  try {
    var arqueos = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre FROM cajas c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.estado = 'CERRADA'
      ORDER BY c.cerrada_en DESC LIMIT 50
    `)).rows;

    var wb = new ExcelJS.Workbook();
    wb.creator = 'Meriendas Gimnasio Campestre';
    var ws = wb.addWorksheet('Arqueos');
    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 20 },
      { header: 'Cajero', key: 'cajero', width: 20 },
      { header: 'Apertura', key: 'apertura', width: 14 },
      { header: 'V. Efectivo', key: 'efectivo', width: 14 },
      { header: 'V. Transfer.', key: 'transfer', width: 14 },
      { header: 'Esperado', key: 'esperado', width: 14 },
      { header: 'Real', key: 'real', width: 14 },
      { header: 'Diferencia', key: 'diferencia', width: 14 }
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5A27' } };

    arqueos.forEach(function(a) {
      var row = ws.addRow({
        fecha: a.fecha, cajero: a.cajero_nombre,
        apertura: Number(a.monto_apertura), efectivo: Number(a.total_ventas_efectivo),
        transfer: Number(a.total_ventas_transferencia), esperado: Number(a.monto_cierre_esperado),
        real: Number(a.monto_cierre_real), diferencia: Number(a.diferencia)
      });
      var dif = Number(a.diferencia);
      if (Math.abs(dif) >= 1) {
        row.getCell('diferencia').font = { bold: true, color: { argb: dif > 0 ? 'FF008000' : 'FFFF0000' } };
      }
    });
    ['apertura','efectivo','transfer','esperado','real','diferencia'].forEach(function(col) {
      ws.getColumn(col).numFmt = '$#,##0';
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=arqueos_' + new Date().toISOString().split('T')[0] + '.xlsx');
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
