// Real PDF & Excel export for order receipts and sell history.
// Uses jsPDF + jspdf-autotable and xlsx. Client-side, zero cost.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { OrderRecord } from '../types';

const BRAND = 'ZENVEGO';
const BRAND_TAG = 'Hyperlocal Agrarian Grid';

export function downloadOrderPdf(order: OrderRecord): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Brand header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(BRAND, 40, 50);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(BRAND_TAG, 40, 66);

  doc.setFontSize(10);
  doc.text(`Order No: ${order.orderNo}`, pageWidth - 180, 50, { align: 'left' });
  doc.text(`Date: ${new Date(order.createdAt).toLocaleString()}`, pageWidth - 180, 66);

  doc.setLineWidth(1);
  doc.line(40, 78, pageWidth - 40, 78);

  // Customer info (no personal details beyond name & address for bag label)
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('Delivery Details', 40, 100);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Customer: ${order.customerName}`, 40, 118);
  doc.text(`Address: ${order.address}`, 40, 134);

  // Items table
  autoTable(doc, {
    startY: 150,
    head: [['Item', 'Qty', 'Unit', 'Price', 'Total']],
    body: order.items.map((it) => [
      it.name,
      String(it.quantity),
      it.unit,
      `${order.currency === 'INR' ? '₹' : '$'}${it.price.toFixed(2)}`,
      `${order.currency === 'INR' ? '₹' : '$'}${(it.price * it.quantity).toFixed(2)}`,
    ]),
    theme: 'grid',
    headStyles: { fillColor: [15, 82, 56], textColor: 255 },
    styles: { fontSize: 10 },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(
    `Total: ${order.currency === 'INR' ? '₹' : '$'}${order.total.toFixed(2)}`,
    pageWidth - 40,
    finalY,
    { align: 'right' }
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Payment: ${order.paymentMethod.toUpperCase()} | Status: ${order.status}`, 40, finalY + 20);
  doc.text('Thank you for supporting local growers.', 40, finalY + 36);

  doc.save(`Order_${order.orderNo}.pdf`);
}

export function downloadSellHistoryExcel(orders: OrderRecord[], sellerName: string): void {
  const rows = orders.map((o) => ({
    'Order No': o.orderNo,
    'Date': new Date(o.createdAt).toLocaleDateString(),
    'Customer': o.customerName,
    'Items': o.items.map((i) => `${i.name} x${i.quantity}`).join(', '),
    'Total': `${o.currency === 'INR' ? '₹' : '$'}${o.total.toFixed(2)}`,
    'Status': o.status,
    'Payment': o.paymentMethod,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sell History');
  XLSX.writeFile(wb, `SellHistory_${sellerName}_${Date.now()}.xlsx`);
}

export function downloadSellHistoryPdf(orders: OrderRecord[], sellerName: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(`${BRAND} - Sell History`, 40, 45);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Seller: ${sellerName}`, 40, 62);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 76);

  autoTable(doc, {
    startY: 90,
    head: [['Order No', 'Date', 'Customer', 'Items', 'Total', 'Status', 'Payment']],
    body: orders.map((o) => [
      o.orderNo,
      new Date(o.createdAt).toLocaleDateString(),
      o.customerName,
      o.items.map((i) => `${i.name} x${i.quantity}`).join(', '),
      `${o.currency === 'INR' ? '₹' : '$'}${o.total.toFixed(2)}`,
      o.status,
      o.paymentMethod,
    ]),
    theme: 'grid',
    headStyles: { fillColor: [15, 82, 56], textColor: 255 },
    styles: { fontSize: 9 },
  });

  doc.save(`SellHistory_${sellerName}.pdf`);
}

// Printable order bag label (small, no personal details)
export function printOrderBagLabel(order: OrderRecord): void {
  const w = window.open('', '_blank');
  if (!w) return;
  const itemsHtml = order.items
    .map(
      (i) =>
        `<tr><td>${i.name}</td><td>${i.quantity} ${i.unit}</td></tr>`
    )
    .join('');
  w.document.write(`
    <html><head><title>Order Bag Label - ${order.orderNo}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:20px;width:320px;margin:0 auto}
      .brand{font-size:22px;font-weight:bold;color:#0f5238;text-align:center}
      .tag{font-size:11px;color:#543b2a;text-align:center;margin-bottom:10px}
      .orderno{font-size:14px;text-align:center;font-weight:bold;margin:8px 0}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td{border-bottom:1px dashed #ccc;padding:4px 0}
      .total{font-size:16px;font-weight:bold;text-align:right;margin-top:10px;color:#a24000}
      .addr{font-size:12px;margin-top:12px;border-top:1px solid #ccc;padding-top:8px}
    </style></head><body>
      <div class="brand">ZENVEGO</div>
      <div class="tag">Hyperlocal Agrarian Grid</div>
      <div class="orderno">Order: ${order.orderNo}</div>
      <table>${itemsHtml}</table>
      <div class="total">Total: ${order.currency === 'INR' ? '₹' : '$'}${order.total.toFixed(2)}</div>
      <div class="addr">Deliver to: ${order.address}</div>
      <script>window.onload=function(){window.print()}</script>
    </body></html>
  `);
  w.document.close();
}
