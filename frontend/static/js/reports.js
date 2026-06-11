/**
 * reports.js — Report rendering for manager/admin
 */
const Reports = (() => {
  const fmt  = n => 'KSh ' + Number(n||0).toLocaleString('en-KE');
  const fmtn = n => Number(n||0).toLocaleString('en-KE');

  async function renderSummary(params = {}) {
    const el = document.getElementById('report-output');
    el.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
      const d = await API.reportSummary(params);
      el.innerHTML = `
        <div class="report-kpi-grid">
          ${kpi('Total Orders',   fmtn(d.total_orders),  '')}
          ${kpi('Paid Orders',    fmtn(d.paid_orders),   'success')}
          ${kpi('Void Orders',    fmtn(d.void_orders),   'danger')}
          ${kpi('Gross Sales',    fmt(d.gross_sales),    'success')}
          ${kpi('VAT Collected',  fmt(d.total_tax),      '')}
          ${kpi('Net Revenue',    fmt(d.net_revenue),    'success')}
          ${kpi('Cash',           fmt(d.cash_total),     '')}
          ${kpi('M-Pesa',         fmt(d.mpesa_total),    '')}
          ${kpi('Card',           fmt(d.card_total),     '')}
          ${kpi('Tables Served',  fmtn(d.tables_served), '')}
        </div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">Error: ${e.message}</div>`; }
  }

  async function renderByDay(params = {}) {
    const el = document.getElementById('report-output');
    el.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
      const rows = await API.reportByDay(params);
      if (!rows.length) { el.innerHTML = '<div class="empty-state">No data</div>'; return; }
      el.innerHTML = `
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Date</th><th>Orders</th><th>Revenue</th><th>VAT</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td>${r.day}</td>
            <td>${fmtn(r.orders)}</td>
            <td>${fmt(r.revenue)}</td>
            <td>${fmt(r.tax)}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr>
            <td><strong>Total</strong></td>
            <td><strong>${fmtn(rows.reduce((s,r)=>s+(r.orders||0),0))}</strong></td>
            <td><strong>${fmt(rows.reduce((s,r)=>s+(r.revenue||0),0))}</strong></td>
            <td><strong>${fmt(rows.reduce((s,r)=>s+(r.tax||0),0))}</strong></td>
          </tr></tfoot>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderByMonth(params = {}) {
    const el = document.getElementById('report-output');
    el.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
      const rows = await API.reportByMonth(params);
      if (!rows.length) { el.innerHTML = '<div class="empty-state">No data</div>'; return; }
      el.innerHTML = `
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Month</th><th>Orders</th><th>Revenue</th><th>VAT</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td>${r.month}</td>
            <td>${fmtn(r.orders)}</td>
            <td>${fmt(r.revenue)}</td>
            <td>${fmt(r.tax)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderByYear() {
    const el = document.getElementById('report-output');
    try {
      const rows = await API.reportByYear();
      el.innerHTML = `
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Year</th><th>Orders</th><th>Revenue</th><th>VAT</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td>${r.year}</td>
            <td>${fmtn(r.orders)}</td>
            <td>${fmt(r.revenue)}</td>
            <td>${fmt(r.tax)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderWaiters(params = {}) {
    const el = document.getElementById('report-output');
    el.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
      const rows = await API.reportWaiters(params);
      if (!rows.length) { el.innerHTML = '<div class="empty-state">No data</div>'; return; }
      el.innerHTML = `
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Waiter</th><th>Orders</th><th>Paid</th><th>Voided</th><th>Sales</th><th>Avg Order</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td><strong>${r.user_name || r.waiter || '—'}</strong></td>
            <td>${fmtn(r.total_orders)}</td>
            <td>${fmtn(r.paid_orders)}</td>
            <td>${fmtn(r.void_orders)}</td>
            <td>${fmt(r.total_sales)}</td>
            <td>${fmt(r.avg_order_value)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderTopItems(params = {}) {
    const el = document.getElementById('report-output');
    el.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
      const rows = await API.reportTopItems(params);
      if (!rows.length) { el.innerHTML = '<div class="empty-state">No data</div>'; return; }
      el.innerHTML = `
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Item</th><th>Destination</th><th>Qty Sold</th><th>Revenue</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td>${r.name}</td>
            <td><span class="tag-${r.destination}" style="font-size:11px;padding:2px 7px;border-radius:4px">${r.destination}</span></td>
            <td>${fmtn(r.qty_sold)}</td>
            <td>${fmt(r.revenue)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderKitchen(params = {}) { await _renderDest('kitchen', params); }
  async function renderBar(params = {})     { await _renderDest('bar',     params); }

  async function _renderDest(dest, params) {
    const el = document.getElementById('report-output');
    el.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
      const d = await (dest === 'kitchen' ? API.reportKitchen(params) : API.reportBar(params));
      const s = d.summary || {};
      el.innerHTML = `
        <div class="report-kpi-grid" style="margin-bottom:20px">
          ${kpi('Orders', fmtn(s.total_orders), '')}
          ${kpi('Items',  fmtn(s.total_items),  '')}
          ${kpi('Revenue',fmt(s.total_revenue), 'success')}
        </div>
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Revenue</th></tr></thead>
          <tbody>${(d.items||[]).map(r=>`<tr>
            <td>${r.name}</td>
            <td>${fmtn(r.qty)}</td>
            <td>${fmt(r.revenue)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderPayments(params = {}) {
    const el = document.getElementById('report-output');
    try {
      const rows = await API.reportPayments(params);
      el.innerHTML = `
        <div class="report-kpi-grid">
          ${rows.map(r=>kpi(r.payment_method?.toUpperCase()||'Unknown', fmt(r.total)+` (${r.count})`, '')).join('')}
        </div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderVoids(params = {}) {
    const el = document.getElementById('report-output');
    el.innerHTML = '<div class="empty-state">Loading...</div>';
    try {
      const rows = await API.reportVoids(params);
      if (!rows.length) { el.innerHTML = '<div class="empty-state">No void orders in range</div>'; return; }
      el.innerHTML = `
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Order</th><th>Table</th><th>Waiter</th><th>Amount</th><th>Voided By</th><th>Reason</th><th>Date</th></tr></thead>
          <tbody>${rows.map(r=>`<tr>
            <td>${r.id}</td>
            <td>${r.table_id}</td>
            <td>${r.waiter||'—'}</td>
            <td>${fmt(r.total)}</td>
            <td>${r.voided_by_name||'—'}</td>
            <td>${r.void_reason||'—'}</td>
            <td>${(r.created_at||'').slice(0,10)}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  async function renderInventory() {
    const el = document.getElementById('report-output');
    try {
      const d = await API.reportInventory();
      el.innerHTML = `
        <div class="report-kpi-grid" style="margin-bottom:16px">
          ${kpi('Stock Value', fmt(d.total_stock_value), 'success')}
          ${kpi('Low Stock Items', fmtn(d.items.filter(i=>i.low_stock).length), d.items.some(i=>i.low_stock)?'danger':'')}
        </div>
        <div class="report-table-wrap">
        <table class="report-table">
          <thead><tr><th>Item</th><th>Category</th><th>In Stock</th><th>Unit</th><th>Reorder At</th><th>Cost/Unit</th><th>Value</th><th>Status</th></tr></thead>
          <tbody>${d.items.map(r=>`<tr ${r.low_stock?'style="color:#C8420A"':''}>
            <td>${r.name}</td>
            <td>${r.category}</td>
            <td>${r.qty_in_stock}</td>
            <td>${r.unit}</td>
            <td>${r.reorder_level}</td>
            <td>${fmt(r.cost_per_unit)}</td>
            <td>${fmt(r.stock_value)}</td>
            <td>${r.low_stock?'⚠ Low':'OK'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`;
    } catch(e) { el.innerHTML = `<div class="empty-state">${e.message}</div>`; }
  }

  function kpi(label, value, type='') {
    const colors = {success:'var(--color-background-success)', danger:'var(--color-background-danger)', '':'var(--color-background-secondary)'};
    return `<div class="report-kpi" style="background:${colors[type]||colors['']}">
      <div class="report-kpi-value">${value}</div>
      <div class="report-kpi-label">${label}</div>
    </div>`;
  }

  return { renderSummary, renderByDay, renderByMonth, renderByYear,
           renderWaiters, renderTopItems, renderKitchen, renderBar,
           renderPayments, renderVoids, renderInventory };
})();
