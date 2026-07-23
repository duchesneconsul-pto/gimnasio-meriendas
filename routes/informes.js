const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { pool } = require('../database');
const { verificarToken, soloAdmin } = require('../middleware/auth');

const router = express.Router();

// Colores de la marca
var COLOR_PRIMARY = '#B71C1C';
var COLOR_PRIMARY_LIGHT = '#FDEAEA';
var COLOR_GOLD = '#C5A55A';
var COLOR_GOLD_BG = '#FDF8EC';
var COLOR_NAVY = '#1A237E';
var COLOR_INFO = '#1565C0';
var COLOR_DANGER = '#D32F2F';
var COLOR_SUCCESS = '#2E7D32';
var EXCEL_PRIMARY = 'FFB71C1C';
var EXCEL_GOLD = 'FFC5A55A';
var EXCEL_NAVY = 'FF1A237E';

var fmt = function(n) { return '$' + Number(n||0).toLocaleString('es-CO', {minimumFractionDigits:0, maximumFractionDigits:0}); };

async function getLogo() {
  try {
    var row = (await pool.query("SELECT valor FROM config WHERE clave = 'informe_logo'")).rows[0];
    if (row && row.valor && row.valor.startsWith('data:image')) return row.valor;
  } catch (e) {}
  return null;
}

async function getNombreNegocio() {
  try {
    var row = (await pool.query("SELECT valor FROM config WHERE clave = 'nombre_negocio'")).rows[0];
    if (row && row.valor) return row.valor;
  } catch (e) {}
  return 'Meriendas - Gimnasio Campestre';
}

async function addPdfHeader(doc, titulo, subtitulo) {
  var logo = await getLogo();
  var nombre = await getNombreNegocio();
  var startY = doc.y;

  // Franja dorada superior (sutil)
  doc.rect(0, 0, doc.page.width, 2.5).fill(COLOR_GOLD);

  if (logo) {
    try {
      var imgData = logo.split(',')[1];
      var imgBuffer = Buffer.from(imgData, 'base64');
      doc.image(imgBuffer, 50, 20, { width: 60, height: 60 });
      doc.fontSize(16).font('Helvetica-Bold').fillColor(COLOR_PRIMARY).text(nombre, 120, 25, { width: doc.page.width - 170 });
      doc.fontSize(13).font('Helvetica-Bold').fillColor(COLOR_NAVY).text(titulo, 120, 45, { width: doc.page.width - 170 });
      doc.fontSize(8).font('Helvetica').fillColor('#666666').text(subtitulo, 120, 63, { width: doc.page.width - 170 });
      doc.y = 90;
    } catch (e) {
      doc.y = 20;
      doc.fontSize(16).font('Helvetica-Bold').fillColor(COLOR_PRIMARY).text(nombre, { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(13).font('Helvetica-Bold').fillColor(COLOR_NAVY).text(titulo, { align: 'center' });
      doc.moveDown(0.1);
      doc.fontSize(8).font('Helvetica').fillColor('#666666').text(subtitulo, { align: 'center' });
    }
  } else {
    doc.y = 20;
    doc.fontSize(16).font('Helvetica-Bold').fillColor(COLOR_PRIMARY).text(nombre, { align: 'center' });
    doc.moveDown(0.2);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(COLOR_NAVY).text(titulo, { align: 'center' });
    doc.moveDown(0.1);
    doc.fontSize(8).font('Helvetica').fillColor('#666666').text(subtitulo, { align: 'center' });
  }

  doc.fillColor('#000000');
  doc.moveDown(0.3);
  // Linea decorativa rojo + dorado (fina)
  var lineY = doc.y;
  doc.moveTo(50, lineY).lineTo(doc.page.width - 50, lineY).lineWidth(1).stroke(COLOR_PRIMARY);
  doc.moveTo(50, lineY + 2).lineTo(doc.page.width - 50, lineY + 2).lineWidth(0.5).stroke(COLOR_GOLD);
  doc.lineWidth(1);
  doc.y = lineY + 8;
}

function addPdfTable(doc, headers, rows, colWidths) {
  var startX = 50;
  var tableWidth = colWidths.reduce(function(s, w) { return s + w; }, 0);
  var rowHeight = 16;
  var y = doc.y;

  // Header
  doc.rect(startX, y, tableWidth, rowHeight).fill(COLOR_PRIMARY);
  var x = startX;
  doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold');
  for (var i = 0; i < headers.length; i++) {
    var align = headers[i].align || 'left';
    var textX = align === 'right' ? x + colWidths[i] - 4 : x + 4;
    doc.text(headers[i].label, textX, y + 4, { width: colWidths[i] - 8, align: align });
    x += colWidths[i];
  }

  y += rowHeight;
  doc.fillColor('#000000').fontSize(7).font('Helvetica');

  for (var r = 0; r < rows.length; r++) {
    if (y + rowHeight > doc.page.height - 40) {
      doc.addPage();
      y = 50;
    }
    if (r % 2 === 0) {
      doc.rect(startX, y, tableWidth, rowHeight).fill('#F8F8F8');
    }
    doc.fillColor('#333333');
    x = startX;
    for (var c = 0; c < headers.length; c++) {
      var cellAlign = headers[c].align || 'left';
      var cellX = cellAlign === 'right' ? x + colWidths[c] - 4 : x + 4;
      doc.text(String(rows[r][c] != null ? rows[r][c] : ''), cellX, y + 4, { width: colWidths[c] - 8, align: cellAlign, lineBreak: false });
      x += colWidths[c];
    }
    y += rowHeight;
  }

  doc.y = y + 4;
}

function addPdfSectionTitle(doc, title) {
  doc.moveDown(0.4);
  var y = doc.y;
  doc.rect(50, y + 1, 2, 12).fill(COLOR_GOLD);
  doc.fontSize(10).font('Helvetica-Bold').fillColor(COLOR_NAVY).text(title, 57, y + 1);
  doc.fillColor('#000000');
  doc.y = y + 18;
}

function addPdfSummaryBox(doc, items, boxColor) {
  boxColor = boxColor || '#FAFAF8';
  var startX = 50;
  var boxWidth = doc.page.width - 100;
  var lineH = 13;
  var boxH = items.length * lineH + 10;

  doc.rect(startX, doc.y, boxWidth, boxH).fill(boxColor);
  doc.rect(startX, doc.y, 1.5, boxH).fill(COLOR_GOLD);
  var y = doc.y + 5;
  for (var i = 0; i < items.length; i++) {
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#444444').text(items[i].label + ':  ', startX + 10, y, { continued: true });
    doc.font('Helvetica').fillColor('#222222').text(items[i].value);
    y += lineH;
  }
  doc.fillColor('#000000');
  doc.y = y + 5;
}

function addPdfFooter(doc) {
  var pages = doc.bufferedPageRange();
  for (var i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    var footY = doc.page.height - 25;
    doc.moveTo(50, footY).lineTo(doc.page.width - 50, footY).lineWidth(0.5).stroke('#cccccc');
    doc.fontSize(6.5).font('Helvetica').fillColor('#999999');
    doc.text('Sistema de Meriendas - Gimnasio Campestre', 50, footY + 4, { width: doc.page.width - 200, align: 'left' });
    doc.text('Pag. ' + (i + 1) + '/' + pages.count, doc.page.width - 130, footY + 4, { width: 80, align: 'right' });
  }
}

function excelHeaderStyle(ws) {
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_PRIMARY } };
}

// ── CONFIGURACION INFORMES ──
router.post('/config/logo', verificarToken, soloAdmin, async (req, res) => {
  try {
    var { logo } = req.body;
    if (!logo) return res.status(400).json({ error: 'Logo requerido' });
    await pool.query(
      "INSERT INTO config (clave, valor) VALUES ('informe_logo', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1",
      [logo]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/config/logo', verificarToken, soloAdmin, async (req, res) => {
  try {
    var row = (await pool.query("SELECT valor FROM config WHERE clave = 'informe_logo'")).rows[0];
    res.json({ logo: row ? row.valor : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/config/logo', verificarToken, soloAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM config WHERE clave = 'informe_logo'");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════
// ── INFORME DIARIO COMPLETO (PDF) ──
// ══════════════════════════════════════════════
router.get('/diario/pdf', verificarToken, soloAdmin, async (req, res) => {
  try {
    var fecha = req.query.fecha || new Date().toISOString().split('T')[0];

    // Datos de ventas
    var ventas = (await pool.query(`
      SELECT v.id, v.fecha, v.total, v.metodo_pago, v.anulada, u.nombre as cajero
      FROM ventas v JOIN usuarios u ON v.cajero_id = u.id
      WHERE v.fecha::date = $1 ORDER BY v.fecha
    `, [fecha])).rows;

    var totalEfectivo = 0, totalTransferencia = 0, totalCredito = 0, anuladas = 0, totalAnulado = 0;
    ventas.forEach(function(v) {
      if (v.anulada) { anuladas++; totalAnulado += Number(v.total); return; }
      if (v.metodo_pago === 'EFECTIVO') totalEfectivo += Number(v.total);
      else if (v.metodo_pago === 'TRANSFERENCIA') totalTransferencia += Number(v.total);
      else totalCredito += Number(v.total);
    });
    var totalVentas = totalEfectivo + totalTransferencia + totalCredito;

    // Top productos
    var topProds = (await pool.query(`
      SELECT p.nombre, p.categoria, p.precio_compra, p.precio_venta,
        SUM(vd.cantidad) as uds, SUM(vd.subtotal) as total,
        SUM(vd.cantidad * p.precio_compra) as costo
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE v.fecha::date = $1 AND v.anulada = 0
      GROUP BY p.id, p.nombre, p.categoria, p.precio_compra, p.precio_venta
      ORDER BY uds DESC LIMIT 20
    `, [fecha])).rows;

    var totalCostoVendido = topProds.reduce(function(s, p) { return s + Number(p.costo); }, 0);
    var gananciaDelDia = totalVentas - totalCostoVendido;

    // Arqueo del dia
    var arqueo = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre FROM cajas c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.fecha = $1 AND c.estado = 'CERRADA'
      ORDER BY c.cerrada_en DESC LIMIT 1
    `, [fecha])).rows[0];

    // Creditos del dia
    var creditosDia = (await pool.query(`
      SELECT c.nombre_cliente, c.tipo_cliente, c.monto, c.saldo_pendiente, c.estado, c.notas
      FROM creditos c WHERE c.fecha::date = $1
      ORDER BY c.fecha
    `, [fecha])).rows;
    var totalCreditosDia = creditosDia.reduce(function(s, c) { return s + Number(c.monto); }, 0);

    // Pagos de creditos recibidos hoy
    var pagosHoy = (await pool.query(`
      SELECT pc.monto, pc.metodo_pago, c.nombre_cliente
      FROM pagos_credito pc
      JOIN creditos c ON pc.credito_id = c.id
      WHERE pc.fecha::date = $1
    `, [fecha])).rows;
    var totalPagosCredito = pagosHoy.reduce(function(s, p) { return s + Number(p.monto); }, 0);

    // Stock bajo
    var stockBajo = (await pool.query(
      'SELECT nombre, stock_actual, stock_minimo FROM productos WHERE activo = 1 AND stock_actual <= stock_minimo ORDER BY stock_actual'
    )).rows;

    // ── Generar PDF ──
    var doc = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=informe_diario_' + fecha + '.pdf');
    doc.pipe(res);

    await addPdfHeader(doc, 'INFORME DIARIO COMPLETO', 'Fecha: ' + fecha + '  |  Generado: ' + new Date().toLocaleString('es-CO'));

    // ── 1. RESUMEN EJECUTIVO ──
    addPdfSectionTitle(doc, 'RESUMEN EJECUTIVO');
    var resultado = gananciaDelDia >= 0 ? 'GANANCIA' : 'PERDIDA';
    var resultadoColor = gananciaDelDia >= 0 ? COLOR_SUCCESS : COLOR_DANGER;

    addPdfSummaryBox(doc, [
      { label: 'Total vendido', value: fmt(totalVentas) + '  (' + ventas.filter(function(v) { return !v.anulada; }).length + ' transacciones)' },
      { label: 'Efectivo', value: fmt(totalEfectivo) },
      { label: 'Transferencia', value: fmt(totalTransferencia) },
      { label: 'Credito/Fiado', value: fmt(totalCredito) },
      { label: 'Ventas anuladas', value: anuladas + ' (' + fmt(totalAnulado) + ')' },
      { label: 'Costo de lo vendido', value: fmt(totalCostoVendido) },
      { label: resultado + ' DEL DIA', value: fmt(Math.abs(gananciaDelDia)) + ' (' + (totalVentas > 0 ? (gananciaDelDia / totalVentas * 100).toFixed(1) : '0') + '% margen)' }
    ]);

    // ── 2. ARQUEO DE CAJA ──
    addPdfSectionTitle(doc, 'ARQUEO DE CAJA');
    if (arqueo) {
      var dif = Number(arqueo.diferencia);
      var difText = Math.abs(dif) < 1 ? 'CUADRA' : (dif > 0 ? 'SOBRANTE +' + fmt(dif) : 'FALTANTE ' + fmt(Math.abs(dif)));
      var arqueoItems = [
        { label: 'Cajero', value: arqueo.cajero_nombre },
        { label: 'Monto apertura', value: fmt(arqueo.monto_apertura) },
        { label: 'Ventas efectivo', value: fmt(arqueo.total_ventas_efectivo) },
        { label: 'Ventas transferencia', value: fmt(arqueo.total_ventas_transferencia) },
        { label: 'Monto esperado en caja', value: fmt(arqueo.monto_cierre_esperado) },
        { label: 'Monto real contado', value: fmt(arqueo.monto_cierre_real) },
        { label: 'RESULTADO', value: difText }
      ];
      if (arqueo.notas) {
        arqueoItems.push({ label: 'NOTAS DEL CAJERO', value: arqueo.notas });
      }
      addPdfSummaryBox(doc, arqueoItems);

      if (Math.abs(dif) >= 1) {
        doc.fontSize(8).font('Helvetica-Bold').fillColor(dif < 0 ? COLOR_DANGER : COLOR_GOLD);
        doc.text(dif < 0 ? '⚠ ATENCION: La caja cerro con FALTANTE de ' + fmt(Math.abs(dif)) : '⚠ La caja cerro con SOBRANTE de ' + fmt(dif), 50, doc.y);
        doc.fillColor('#000000');
        doc.moveDown(0.3);
      }
    } else {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text('No se registro arqueo de caja para esta fecha.', 50);
      doc.fillColor('#000000');
      doc.moveDown(0.5);
    }

    // ── 3. CREDITOS DEL DIA ──
    addPdfSectionTitle(doc, 'CREDITOS / FIADOS DEL DIA');
    if (creditosDia.length > 0) {
      addPdfSummaryBox(doc, [
        { label: 'Creditos otorgados hoy', value: creditosDia.length.toString() },
        { label: 'Total fiado hoy', value: fmt(totalCreditosDia) }
      ]);
      addPdfTable(doc,
        [
          { label: 'Cliente', align: 'left' },
          { label: 'Tipo', align: 'left' },
          { label: 'Monto', align: 'right' },
          { label: 'Estado', align: 'left' },
          { label: 'Notas', align: 'left' }
        ],
        creditosDia.map(function(c) {
          return [c.nombre_cliente, c.tipo_cliente, fmt(c.monto), c.estado, c.notas || ''];
        }),
        [130, 80, 80, 80, 130]
      );
    } else {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text('No se otorgaron creditos este dia.', 50);
      doc.fillColor('#000000');
    }

    // Pagos de credito recibidos
    if (pagosHoy.length > 0) {
      doc.moveDown(0.3);
      addPdfSummaryBox(doc, [
        { label: 'Pagos de credito recibidos hoy', value: pagosHoy.length + ' abonos por ' + fmt(totalPagosCredito) }
      ]);
    }

    // ── 4. DETALLE DE VENTAS ──
    addPdfSectionTitle(doc, 'DETALLE DE VENTAS');
    if (ventas.length > 0) {
      addPdfTable(doc,
        [
          { label: '#', align: 'left' },
          { label: 'Hora', align: 'left' },
          { label: 'Cajero', align: 'left' },
          { label: 'Metodo', align: 'left' },
          { label: 'Total', align: 'right' },
          { label: 'Estado', align: 'left' }
        ],
        ventas.map(function(v) {
          return [
            v.id,
            new Date(v.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
            v.cajero, v.metodo_pago, fmt(v.total),
            v.anulada ? 'ANULADA' : 'OK'
          ];
        }),
        [35, 55, 115, 85, 75, 60]
      );
    } else {
      doc.fontSize(9).font('Helvetica').fillColor('#666666').text('No hubo ventas este dia.', 50);
      doc.fillColor('#000000');
    }

    // ── 5. PRODUCTOS MAS VENDIDOS ──
    if (topProds.length > 0) {
      addPdfSectionTitle(doc, 'TOP PRODUCTOS VENDIDOS');
      addPdfTable(doc,
        [
          { label: 'Producto', align: 'left' },
          { label: 'Categoria', align: 'left' },
          { label: 'Uds', align: 'right' },
          { label: 'Ingreso', align: 'right' },
          { label: 'Costo', align: 'right' },
          { label: 'Ganancia', align: 'right' }
        ],
        topProds.map(function(p) {
          return [p.nombre, p.categoria, p.uds, fmt(p.total), fmt(p.costo), fmt(Number(p.total) - Number(p.costo))];
        }),
        [130, 75, 35, 75, 75, 75]
      );
    }

    // ── 6. ALERTAS STOCK BAJO ──
    if (stockBajo.length > 0) {
      addPdfSectionTitle(doc, 'ALERTAS: STOCK BAJO');
      doc.fontSize(8).font('Helvetica').fillColor(COLOR_DANGER).text('Los siguientes productos necesitan reposicion:', 50);
      doc.fillColor('#000000');
      doc.moveDown(0.3);
      addPdfTable(doc,
        [
          { label: 'Producto', align: 'left' },
          { label: 'Stock actual', align: 'right' },
          { label: 'Minimo', align: 'right' }
        ],
        stockBajo.map(function(p) { return [p.nombre, p.stock_actual, p.stock_minimo]; }),
        [200, 80, 80]
      );
    }

    // ── 7. BALANCE FINAL ──
    addPdfSectionTitle(doc, 'BALANCE FINAL DEL DIA');
    var balanceItems = [
      { label: 'Ingresos por ventas', value: fmt(totalVentas) },
      { label: '(-) Costo de productos vendidos', value: fmt(totalCostoVendido) },
      { label: '(=) Ganancia bruta', value: fmt(gananciaDelDia) },
      { label: 'Creditos otorgados (pendiente cobro)', value: fmt(totalCreditosDia) },
      { label: 'Pagos de credito recibidos', value: fmt(totalPagosCredito) }
    ];
    if (arqueo) {
      var difArqueo = Number(arqueo.diferencia);
      if (Math.abs(difArqueo) >= 1) {
        balanceItems.push({ label: 'Diferencia en caja', value: (difArqueo > 0 ? '+' : '') + fmt(difArqueo) + (difArqueo < 0 ? ' (FALTANTE)' : ' (SOBRANTE)') });
      }
    }
    addPdfSummaryBox(doc, balanceItems);

    addPdfFooter(doc);
    doc.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── INFORME DIARIO COMPLETO (Excel) ──
router.get('/diario/excel', verificarToken, soloAdmin, async (req, res) => {
  try {
    var fecha = req.query.fecha || new Date().toISOString().split('T')[0];

    var ventas = (await pool.query(`
      SELECT v.id, v.fecha, v.total, v.metodo_pago, v.anulada, u.nombre as cajero
      FROM ventas v JOIN usuarios u ON v.cajero_id = u.id
      WHERE v.fecha::date = $1 ORDER BY v.fecha
    `, [fecha])).rows;

    var detalles = (await pool.query(`
      SELECT vd.venta_id, p.nombre as producto, vd.cantidad, vd.precio_unitario, vd.subtotal, p.precio_compra
      FROM venta_detalles vd
      JOIN ventas v ON vd.venta_id = v.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE v.fecha::date = $1 ORDER BY vd.venta_id
    `, [fecha])).rows;

    var arqueo = (await pool.query(`
      SELECT c.*, u.nombre as cajero_nombre FROM cajas c
      JOIN usuarios u ON c.cajero_id = u.id
      WHERE c.fecha = $1 AND c.estado = 'CERRADA'
      ORDER BY c.cerrada_en DESC LIMIT 1
    `, [fecha])).rows[0];

    var creditosDia = (await pool.query(`
      SELECT c.nombre_cliente, c.tipo_cliente, c.monto, c.saldo_pendiente, c.estado, c.notas
      FROM creditos c WHERE c.fecha::date = $1
    `, [fecha])).rows;

    var totalEfectivo = 0, totalTransferencia = 0, totalCredito = 0;
    ventas.forEach(function(v) {
      if (v.anulada) return;
      if (v.metodo_pago === 'EFECTIVO') totalEfectivo += Number(v.total);
      else if (v.metodo_pago === 'TRANSFERENCIA') totalTransferencia += Number(v.total);
      else totalCredito += Number(v.total);
    });

    var wb = new ExcelJS.Workbook();
    wb.creator = 'Meriendas Gimnasio Campestre';

    // Hoja 1: Resumen
    var wsR = wb.addWorksheet('Resumen');
    wsR.columns = [{ width: 35 }, { width: 25 }];
    wsR.addRow(['INFORME DIARIO - ' + fecha]).font = { bold: true, size: 14, color: { argb: EXCEL_PRIMARY } };
    wsR.addRow([]);
    wsR.addRow(['VENTAS']).font = { bold: true, size: 12, color: { argb: EXCEL_NAVY } };
    wsR.addRow(['Total efectivo', totalEfectivo]);
    wsR.addRow(['Total transferencia', totalTransferencia]);
    wsR.addRow(['Total credito', totalCredito]);
    wsR.addRow(['TOTAL VENTAS', totalEfectivo + totalTransferencia + totalCredito]).font = { bold: true };
    wsR.addRow([]);

    if (arqueo) {
      wsR.addRow(['ARQUEO DE CAJA']).font = { bold: true, size: 12, color: { argb: EXCEL_NAVY } };
      wsR.addRow(['Cajero', arqueo.cajero_nombre]);
      wsR.addRow(['Monto apertura', Number(arqueo.monto_apertura)]);
      wsR.addRow(['Esperado', Number(arqueo.monto_cierre_esperado)]);
      wsR.addRow(['Real contado', Number(arqueo.monto_cierre_real)]);
      var difRow = wsR.addRow(['Diferencia', Number(arqueo.diferencia)]);
      var dif = Number(arqueo.diferencia);
      if (Math.abs(dif) >= 1) {
        difRow.getCell(2).font = { bold: true, color: { argb: dif < 0 ? 'FFFF0000' : 'FF008000' } };
      }
      if (arqueo.notas) wsR.addRow(['Notas', arqueo.notas]);
      wsR.addRow([]);
    }

    if (creditosDia.length > 0) {
      wsR.addRow(['CREDITOS DEL DIA']).font = { bold: true, size: 12, color: { argb: EXCEL_NAVY } };
      creditosDia.forEach(function(c) {
        wsR.addRow([c.nombre_cliente + ' (' + c.tipo_cliente + ')', Number(c.monto)]);
      });
      wsR.addRow([]);
    }

    [4,5,6,7].forEach(function(r) {
      try { wsR.getRow(r).getCell(2).numFmt = '$#,##0'; } catch(e) {}
    });

    // Hoja 2: Ventas
    var wsV = wb.addWorksheet('Ventas');
    wsV.columns = [
      { header: '#', key: 'id', width: 8 },
      { header: 'Hora', key: 'hora', width: 12 },
      { header: 'Cajero', key: 'cajero', width: 20 },
      { header: 'Metodo', key: 'metodo', width: 15 },
      { header: 'Total', key: 'total', width: 15 },
      { header: 'Estado', key: 'estado', width: 12 }
    ];
    excelHeaderStyle(wsV);
    ventas.forEach(function(v) {
      wsV.addRow({
        id: v.id, hora: new Date(v.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        cajero: v.cajero, metodo: v.metodo_pago, total: Number(v.total), estado: v.anulada ? 'ANULADA' : 'OK'
      });
    });
    wsV.getColumn('total').numFmt = '$#,##0';

    // Hoja 3: Detalles
    var wsD = wb.addWorksheet('Detalles');
    wsD.columns = [
      { header: 'Venta #', key: 'venta_id', width: 10 },
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'P. Unitario', key: 'precio', width: 15 },
      { header: 'Subtotal', key: 'subtotal', width: 15 },
      { header: 'Costo unit.', key: 'costo', width: 14 },
      { header: 'Ganancia', key: 'ganancia', width: 14 }
    ];
    excelHeaderStyle(wsD);
    detalles.forEach(function(d) {
      wsD.addRow({
        venta_id: d.venta_id, producto: d.producto, cantidad: Number(d.cantidad),
        precio: Number(d.precio_unitario), subtotal: Number(d.subtotal),
        costo: Number(d.precio_compra), ganancia: Number(d.subtotal) - (Number(d.precio_compra) * Number(d.cantidad))
      });
    });
    ['precio','subtotal','costo','ganancia'].forEach(function(c) { wsD.getColumn(c).numFmt = '$#,##0'; });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=informe_diario_' + fecha + '.xlsx');
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

    var doc = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=ventas_' + fecha + '.pdf');
    doc.pipe(res);

    await addPdfHeader(doc, 'Informe de Ventas', 'Fecha: ' + fecha + ' | Generado: ' + new Date().toLocaleString('es-CO'));

    addPdfSummaryBox(doc, [
      { label: 'Total ventas', value: fmt(totalEfectivo + totalTransferencia + totalCredito) },
      { label: 'Efectivo', value: fmt(totalEfectivo) },
      { label: 'Transferencia', value: fmt(totalTransferencia) },
      { label: 'Credito', value: fmt(totalCredito) },
      { label: 'Transacciones', value: ventas.filter(function(v) { return !v.anulada; }).length.toString() },
      { label: 'Anuladas', value: anuladas.toString() }
    ]);

    addPdfTable(doc,
      [
        { label: '#', align: 'left' }, { label: 'Hora', align: 'left' },
        { label: 'Cajero', align: 'left' }, { label: 'Metodo', align: 'left' },
        { label: 'Total', align: 'right' }, { label: 'Estado', align: 'left' }
      ],
      ventas.map(function(v) {
        return [v.id, new Date(v.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
          v.cajero, v.metodo_pago, fmt(v.total), v.anulada ? 'ANULADA' : 'OK'];
      }),
      [40, 70, 120, 90, 80, 80]
    );

    addPdfFooter(doc);
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
      FROM venta_detalles vd JOIN ventas v ON vd.venta_id = v.id
      JOIN productos p ON vd.producto_id = p.id
      WHERE v.fecha::date = $1 ORDER BY vd.venta_id
    `, [fecha])).rows;

    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Ventas');
    ws.columns = [
      { header: '#', key: 'id', width: 8 }, { header: 'Hora', key: 'hora', width: 12 },
      { header: 'Cajero', key: 'cajero', width: 20 }, { header: 'Metodo', key: 'metodo', width: 15 },
      { header: 'Total', key: 'total', width: 15 }, { header: 'Estado', key: 'estado', width: 12 }
    ];
    excelHeaderStyle(ws);
    ventas.forEach(function(v) {
      ws.addRow({ id: v.id, hora: new Date(v.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
        cajero: v.cajero, metodo: v.metodo_pago, total: Number(v.total), estado: v.anulada ? 'ANULADA' : 'OK' });
    });
    ws.getColumn('total').numFmt = '$#,##0';

    var ws2 = wb.addWorksheet('Detalles');
    ws2.columns = [
      { header: 'Venta #', key: 'venta_id', width: 10 }, { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Cantidad', key: 'cantidad', width: 12 }, { header: 'P. Unitario', key: 'precio', width: 15 },
      { header: 'Subtotal', key: 'subtotal', width: 15 }
    ];
    excelHeaderStyle(ws2);
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
    productos.forEach(function(p) { totalCosto += p.precio_compra * p.stock_actual; totalVenta += p.precio_venta * p.stock_actual; });

    var doc = new PDFDocument({ size: 'LETTER', margin: 50, layout: 'landscape', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=inventario_' + new Date().toISOString().split('T')[0] + '.pdf');
    doc.pipe(res);

    await addPdfHeader(doc, 'Informe de Inventario', 'Generado: ' + new Date().toLocaleString('es-CO'));
    addPdfSummaryBox(doc, [
      { label: 'Total productos activos', value: productos.length.toString() },
      { label: 'Valor inventario (costo)', value: fmt(totalCosto) },
      { label: 'Valor inventario (venta)', value: fmt(totalVenta) },
      { label: 'Ganancia potencial', value: fmt(totalVenta - totalCosto) }
    ]);

    addPdfTable(doc,
      [{ label: 'Producto' }, { label: 'Categoria' }, { label: 'Barcode' },
       { label: 'P.Compra', align: 'right' }, { label: 'P.Venta', align: 'right' },
       { label: 'Stock', align: 'right' }, { label: 'Min', align: 'right' }, { label: 'Valor', align: 'right' }],
      productos.map(function(p) {
        return [p.nombre, p.categoria, p.codigo_barras || '', fmt(p.precio_compra), fmt(p.precio_venta), p.stock_actual, p.stock_minimo, fmt(p.precio_venta * p.stock_actual)];
      }),
      [150, 90, 90, 70, 70, 50, 50, 80]
    );

    addPdfFooter(doc);
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
    var ws = wb.addWorksheet('Inventario');
    ws.columns = [
      { header: 'Producto', key: 'nombre', width: 30 }, { header: 'Categoria', key: 'categoria', width: 15 },
      { header: 'Cod. Barras', key: 'barcode', width: 18 }, { header: 'P. Compra', key: 'precio_compra', width: 14 },
      { header: 'P. Venta', key: 'precio_venta', width: 14 }, { header: 'Stock', key: 'stock', width: 10 },
      { header: 'Minimo', key: 'minimo', width: 10 }, { header: 'Valor Stock', key: 'valor', width: 15 }
    ];
    excelHeaderStyle(ws);
    productos.forEach(function(p, i) {
      ws.addRow({ nombre: p.nombre, categoria: p.categoria, barcode: p.codigo_barras || '',
        precio_compra: Number(p.precio_compra), precio_venta: Number(p.precio_venta),
        stock: Number(p.stock_actual), minimo: Number(p.stock_minimo), valor: Number(p.precio_venta) * Number(p.stock_actual) });
      if (Number(p.stock_actual) <= Number(p.stock_minimo)) {
        ws.getRow(i + 2).getCell('stock').font = { bold: true, color: { argb: 'FFFF0000' } };
      }
    });
    ['precio_compra','precio_venta','valor'].forEach(function(c) { ws.getColumn(c).numFmt = '$#,##0'; });

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
        COALESCE(SUM(vd.cantidad),0) as total_vendido, COALESCE(SUM(vd.subtotal),0) as ingresos,
        COALESCE(SUM(vd.subtotal) - SUM(vd.cantidad * p.precio_compra),0) as ganancia_total
      FROM productos p LEFT JOIN venta_detalles vd ON p.id = vd.producto_id
      LEFT JOIN ventas v ON vd.venta_id = v.id AND v.anulada = 0
      WHERE p.activo = 1 GROUP BY p.id, p.nombre, p.categoria, p.precio_compra, p.precio_venta ORDER BY ganancia_total DESC
    `)).rows;

    var totalGanancia = prods.reduce(function(s, p) { return s + Number(p.ganancia_total); }, 0);
    var totalIngresos = prods.reduce(function(s, p) { return s + Number(p.ingresos); }, 0);

    var doc = new PDFDocument({ size: 'LETTER', margin: 50, layout: 'landscape', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=rentabilidad_' + new Date().toISOString().split('T')[0] + '.pdf');
    doc.pipe(res);

    await addPdfHeader(doc, 'Informe de Rentabilidad', 'Generado: ' + new Date().toLocaleString('es-CO'));
    addPdfSummaryBox(doc, [
      { label: 'Total ingresos', value: fmt(totalIngresos) },
      { label: 'Total ganancia', value: fmt(totalGanancia) },
      { label: 'Margen promedio', value: totalIngresos > 0 ? (totalGanancia / totalIngresos * 100).toFixed(1) + '%' : '0%' }
    ]);

    addPdfTable(doc,
      [{ label: 'Producto' }, { label: 'Categoria' }, { label: 'P.Compra', align: 'right' },
       { label: 'P.Venta', align: 'right' }, { label: 'Ganancia/u', align: 'right' },
       { label: 'Vendidos', align: 'right' }, { label: 'Ingresos', align: 'right' }, { label: 'Ganancia', align: 'right' }],
      prods.map(function(p) {
        return [p.nombre, p.categoria, fmt(p.precio_compra), fmt(p.precio_venta), fmt(p.ganancia_unitaria), p.total_vendido, fmt(p.ingresos), fmt(p.ganancia_total)];
      }),
      [140, 80, 70, 70, 70, 60, 80, 80]
    );

    addPdfFooter(doc);
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
        COALESCE(SUM(vd.cantidad),0) as total_vendido, COALESCE(SUM(vd.subtotal),0) as ingresos,
        COALESCE(SUM(vd.subtotal) - SUM(vd.cantidad * p.precio_compra),0) as ganancia_total
      FROM productos p LEFT JOIN venta_detalles vd ON p.id = vd.producto_id
      LEFT JOIN ventas v ON vd.venta_id = v.id AND v.anulada = 0
      WHERE p.activo = 1 GROUP BY p.id, p.nombre, p.categoria, p.precio_compra, p.precio_venta ORDER BY ganancia_total DESC
    `)).rows;

    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Rentabilidad');
    ws.columns = [
      { header: 'Producto', key: 'nombre', width: 30 }, { header: 'Categoria', key: 'categoria', width: 15 },
      { header: 'P. Compra', key: 'precio_compra', width: 14 }, { header: 'P. Venta', key: 'precio_venta', width: 14 },
      { header: 'Ganancia/u', key: 'ganancia_u', width: 14 }, { header: 'Vendidos', key: 'vendidos', width: 12 },
      { header: 'Ingresos', key: 'ingresos', width: 15 }, { header: 'Ganancia Total', key: 'ganancia', width: 16 }
    ];
    excelHeaderStyle(ws);
    prods.forEach(function(p) {
      ws.addRow({ nombre: p.nombre, categoria: p.categoria, precio_compra: Number(p.precio_compra),
        precio_venta: Number(p.precio_venta), ganancia_u: Number(p.ganancia_unitaria),
        vendidos: Number(p.total_vendido), ingresos: Number(p.ingresos), ganancia: Number(p.ganancia_total) });
    });
    ['precio_compra','precio_venta','ganancia_u','ingresos','ganancia'].forEach(function(c) { ws.getColumn(c).numFmt = '$#,##0'; });

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
      JOIN usuarios u ON c.cajero_id = u.id WHERE c.estado = 'CERRADA'
      ORDER BY c.cerrada_en DESC LIMIT 50
    `)).rows;

    var doc = new PDFDocument({ size: 'LETTER', margin: 50, layout: 'landscape', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=arqueos_' + new Date().toISOString().split('T')[0] + '.pdf');
    doc.pipe(res);

    await addPdfHeader(doc, 'Historial de Arqueos de Caja', 'Generado: ' + new Date().toLocaleString('es-CO'));

    addPdfTable(doc,
      [{ label: 'Fecha' }, { label: 'Cajero' }, { label: 'Apertura', align: 'right' },
       { label: 'Efectivo', align: 'right' }, { label: 'Transfer.', align: 'right' },
       { label: 'Esperado', align: 'right' }, { label: 'Real', align: 'right' },
       { label: 'Diferencia', align: 'right' }, { label: 'Notas' }],
      arqueos.map(function(a) {
        var dif = Number(a.diferencia);
        var difText = Math.abs(dif) < 1 ? 'Cuadra' : (dif > 0 ? '+' : '') + fmt(dif);
        return [a.fecha, a.cajero_nombre, fmt(a.monto_apertura), fmt(a.total_ventas_efectivo),
          fmt(a.total_ventas_transferencia), fmt(a.monto_cierre_esperado), fmt(a.monto_cierre_real), difText, a.notas || ''];
      }),
      [70, 90, 65, 65, 65, 70, 70, 70, 85]
    );

    addPdfFooter(doc);
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
      JOIN usuarios u ON c.cajero_id = u.id WHERE c.estado = 'CERRADA'
      ORDER BY c.cerrada_en DESC LIMIT 50
    `)).rows;

    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet('Arqueos');
    ws.columns = [
      { header: 'Fecha', key: 'fecha', width: 20 }, { header: 'Cajero', key: 'cajero', width: 20 },
      { header: 'Apertura', key: 'apertura', width: 14 }, { header: 'V. Efectivo', key: 'efectivo', width: 14 },
      { header: 'V. Transfer.', key: 'transfer', width: 14 }, { header: 'Esperado', key: 'esperado', width: 14 },
      { header: 'Real', key: 'real', width: 14 }, { header: 'Diferencia', key: 'diferencia', width: 14 },
      { header: 'Notas', key: 'notas', width: 30 }
    ];
    excelHeaderStyle(ws);
    arqueos.forEach(function(a) {
      var row = ws.addRow({ fecha: a.fecha, cajero: a.cajero_nombre, apertura: Number(a.monto_apertura),
        efectivo: Number(a.total_ventas_efectivo), transfer: Number(a.total_ventas_transferencia),
        esperado: Number(a.monto_cierre_esperado), real: Number(a.monto_cierre_real),
        diferencia: Number(a.diferencia), notas: a.notas || '' });
      var dif = Number(a.diferencia);
      if (Math.abs(dif) >= 1) row.getCell('diferencia').font = { bold: true, color: { argb: dif > 0 ? 'FF008000' : 'FFFF0000' } };
    });
    ['apertura','efectivo','transfer','esperado','real','diferencia'].forEach(function(c) { ws.getColumn(c).numFmt = '$#,##0'; });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=arqueos_' + new Date().toISOString().split('T')[0] + '.xlsx');
    await wb.xlsx.write(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
