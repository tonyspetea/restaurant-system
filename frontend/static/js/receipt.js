/**
 * receipt.js — Renders receipt HTML from API data
 */
const Receipt = (() => {
  const cfg = () => ({
    name:    localStorage.getItem('restaurantName')  || 'Spice Garden Restaurant',
    phone:   localStorage.getItem('restaurantPhone') || '+254 700 000 000',
    paybill: localStorage.getItem('mpesaPaybill')    || '123456',
  });

  const fmt = n => 'KSh ' + Number(n).toLocaleString('en-KE', { minimumFractionDigits: 0 });

  function kitchen(data) {
    if (!data.items || !data.items.length) return '<div class="empty-state">No kitchen items in this order.</div>';
    return `
      <div class="rp">
        <div class="rp-header">
          <div class="rp-title" style="color:#185FA5">🍽 KITCHEN TICKET</div>
          <div class="rp-sub">Priority Print — Do Not Give to Customer</div>
        </div>
        <div class="rp-meta"><span>${data.order_id}</span><span>Table: ${data.table_id}</span></div>
        <div class="rp-meta"><span>${data.printed_at}</span><span>Waiter: ${data.waiter}</span></div>
        <div class="rp-section">Items to Prepare Now</div>
        ${data.items.map(i => `
          <div class="rp-kds-item">${i.qty}× ${i.name}${i.note ? `<div style="font-size:12px;font-weight:400;color:#666">Note: ${i.note}</div>` : ''}</div>
        `).join('')}
        <div class="rp-footer">Prepare and ring bell when ready ✓</div>
      </div>`;
  }

  function bar(data) {
    if (!data.items || !data.items.length) return '<div class="empty-state">No bar items in this order.</div>';
    return `
      <div class="rp">
        <div class="rp-header">
          <div class="rp-title" style="color:#854F0B">🍺 BAR TICKET</div>
          <div class="rp-sub">Beverages — Do Not Give to Customer</div>
        </div>
        <div class="rp-meta"><span>${data.order_id}</span><span>Table: ${data.table_id}</span></div>
        <div class="rp-meta"><span>${data.printed_at}</span><span>Waiter: ${data.waiter}</span></div>
        <div class="rp-section">Beverages to Serve</div>
        ${data.items.map(i => `
          <div class="rp-kds-item">${i.qty}× ${i.name}${i.note ? `<div style="font-size:12px;font-weight:400;color:#666">Note: ${i.note}</div>` : ''}</div>
        `).join('')}
        <div class="rp-footer">Prepare and deliver to table ✓</div>
      </div>`;
  }

  function customer(data) {
    const c = cfg();
    return `
      <div class="rp">
        <div class="rp-header">
          <div class="rp-name">${c.name}</div>
          <div class="rp-sub">${c.phone}</div>
          <div class="rp-title">ORDER RECEIPT</div>
        </div>
        <div class="rp-meta"><span>Order: ${data.order_id}</span><span>Table: ${data.table_id}</span></div>
        <div class="rp-meta"><span>${data.printed_at}</span><span>Waiter: ${data.waiter}</span></div>
        <div class="rp-section">Your Order</div>
        ${data.items.map(i => `
          <div class="rp-line"><span>${i.qty}× ${i.name}</span><span>${fmt(i.line_total)}</span></div>
        `).join('')}
        <div class="rp-line muted" style="margin-top:6px"><span>Subtotal</span><span>${fmt(data.subtotal)}</span></div>
        <div class="rp-line muted"><span>VAT 16%</span><span>${fmt(data.tax)}</span></div>
        <div class="rp-line big"><span>TOTAL</span><span>${fmt(data.total)}</span></div>
        <div class="rp-footer">
          Pay via M-Pesa Paybill: <strong>${c.paybill}</strong><br>
          Thank you for dining with us! 🙏
        </div>
      </div>`;
  }

  function invoice(data) {
    const c = cfg();
    return `
      <div class="rp">
        <div class="rp-header">
          <div class="rp-name">${c.name}</div>
          <div class="rp-sub">${c.phone}</div>
          <div class="rp-title">TAX INVOICE</div>
        </div>
        <div class="rp-paid">✓ PAID</div>
        <div class="rp-meta"><span>Inv: INV-${data.order_id}</span><span>Table: ${data.table_id}</span></div>
        <div class="rp-meta"><span>${data.printed_at}</span><span>Waiter: ${data.waiter}</span></div>
        <div class="rp-section">Description</div>
        ${data.items.map(i => `
          <div class="rp-line"><span>${i.qty}× ${i.name}</span><span>${fmt(i.line_total)}</span></div>
        `).join('')}
        <div class="rp-line muted" style="margin-top:6px"><span>Subtotal</span><span>${fmt(data.subtotal)}</span></div>
        <div class="rp-line muted"><span>VAT 16% (KRA)</span><span>${fmt(data.tax)}</span></div>
        <div class="rp-line big"><span>TOTAL PAID</span><span>${fmt(data.total)}</span></div>
        ${data.payment_method ? `<div class="rp-line muted"><span>Payment</span><span>${data.payment_method.toUpperCase()}</span></div>` : ''}
        ${data.mpesa_ref ? `<div class="rp-line muted"><span>M-Pesa Ref</span><span>${data.mpesa_ref}</span></div>` : ''}
        <div class="rp-footer">
          KRA ETR: ${data.kra_etr || 'ETR-' + data.order_id + '-KE'}<br>
          This is your official tax receipt.<br>
          ${c.name} — ${c.phone}
        </div>
      </div>`;
  }

  function render(type, data) {
    if (type === 'kitchen')  return kitchen(data);
    if (type === 'bar')      return bar(data);
    if (type === 'customer') return customer(data);
    if (type === 'invoice')  return invoice(data);
    return '<div class="empty-state">Unknown receipt type</div>';
  }

  function printWindow(html, title) {
    const w = window.open('', '_blank', 'width=400,height=650');
    w.document.write(`
      <!DOCTYPE html><html><head>
      <title>${title}</title>
      <style>
        body { font-family: 'Courier New', monospace; font-size: 13px; padding: 20px; }
        .rp-line { display: flex; justify-content: space-between; padding: 3px 0; }
        .rp-line.big { font-size: 16px; font-weight: 700; border-top: 1px dashed #ccc; padding-top: 8px; margin-top: 8px; }
        .rp-line.muted { color: #666; font-size: 12px; }
        .rp-header { text-align: center; border-bottom: 1px dashed #ccc; padding-bottom: 10px; margin-bottom: 10px; }
        .rp-name { font-size: 18px; font-weight: 700; }
        .rp-title { font-weight: 700; letter-spacing: 0.08em; margin-top: 6px; }
        .rp-sub { font-size: 11px; color: #666; }
        .rp-meta { display: flex; justify-content: space-between; font-size: 11px; color: #666; }
        .rp-section { text-transform: uppercase; font-weight: 700; font-size: 10px; letter-spacing: 0.1em; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin: 10px 0 6px; }
        .rp-kds-item { font-size: 20px; font-weight: 700; padding: 4px 0; }
        .rp-footer { text-align: center; border-top: 1px dashed #ccc; padding-top: 10px; margin-top: 10px; font-size: 11px; color: #666; }
        .rp-paid { text-align: center; font-size: 14px; font-weight: 700; color: green; }
      </style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 300);
  }

  return { render, printWindow };
})();
