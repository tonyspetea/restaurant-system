/**
 * app.js v2 — Main RestoPOS controller
 * Roles: waiter (create orders) | manager (void, reports) | admin (all)
 */
const App = (() => {
  const state = {
    cart: {}, tableId: '', currentView: 'order',
    isOnline: navigator.onLine, menuData: [],
    menuFilter: 'all', receiptType: 'customer',
    receiptOrderId: null, currentReportType: 'summary',
    pendingVoidOrderId: null,
  };

  const fmt  = n => 'KSh ' + Number(n||0).toLocaleString('en-KE');
  const user = () => Auth.getUser() || {};
  const role = () => user().role || '';

  // ── Navigation config by role ──────────────────────────────────────────
  const NAV = [
    { id:'order',     label:'New Order',        icon:'📋', roles:['waiter','manager','admin'] },
    { id:'orders',    label:'Active Orders',     icon:'🔥', roles:['waiter','manager','admin'], badge:'badge-orders' },
    { id:'tables',    label:'Tables',            icon:'🪑', roles:['waiter','manager','admin'] },
    { id:'receipts',  label:'Receipts & Print',  icon:'🧾', roles:['waiter','manager','admin'] },
    { id:'kds',       label:'Kitchen Display',   icon:'👨‍🍳', roles:['waiter','manager','admin'] },
    { id:'bar',       label:'Bar Display',       icon:'🍺', roles:['waiter','manager','admin'] },
    { id:'reports',   label:'Reports',           icon:'📊', roles:['manager','admin'] },
    { id:'menu',      label:'Menu Manager',      icon:'📖', roles:['manager','admin'] },
    { id:'inventory', label:'Inventory',         icon:'📦', roles:['manager','admin'] },
    { id:'users',     label:'Staff Management',  icon:'👥', roles:['admin'] },
    { id:'settings',  label:'Settings',          icon:'⚙️', roles:['manager','admin'] },
  ];

  // ── Init ──────────────────────────────────────────────────────────────
  async function init() {
    if (!Auth.isLoggedIn()) { Auth.showLoginScreen(); return; }
    buildNav();
    updateUserUI();
    loadSettings();
    setupConnectivity();
    setupWebSocket();
    await loadMenu();
    await loadTableSelect();
    showView('order');
    updateQueueCount();
    document.getElementById('pay-method')?.addEventListener('change', onPayMethodChange);
  }

  function buildNav() {
    const r   = role();
    const nav = document.getElementById('nav-links');
    if (!nav) return;
    nav.innerHTML = NAV
      .filter(n => n.roles.includes(r))
      .map(n => `<a class="nav-link" data-view="${n.id}" onclick="App.showView('${n.id}')">
        <span class="nav-icon">${n.icon}</span> ${n.label}
        ${n.badge ? `<span class="badge" id="${n.badge}" style="display:none">0</span>` : ''}
      </a>`).join('');
  }

  function updateUserUI() {
    const u = user();
    const el = id => document.getElementById(id);
    if (el('waiter-name-display'))  el('waiter-name-display').textContent  = u.name  || '—';
    if (el('waiter-role-display'))  el('waiter-role-display').textContent  = u.role  || '—';
    if (el('sidebar-role-label'))   el('sidebar-role-label').textContent   = u.role  || '—';
    if (el('waiter-avatar'))        el('waiter-avatar').textContent        = (u.name||'?')[0].toUpperCase();
    if (el('waiter-badge'))         el('waiter-badge').textContent         = u.name  || '';
    // Show void section only for manager/admin
    const vs = el('void-section');
    if (vs) vs.style.display = Auth.isManager() ? 'block' : 'none';
  }

  function loadSettings() {
    const map = {
      's-restaurant':'restaurantName','s-phone':'restaurantPhone',
      's-paybill':'mpesaPaybill','s-api-url':'apiBaseUrl',
      's-kitchen-ip':'kitchenPrinterIP','s-bar-ip':'barPrinterIP',
    };
    Object.entries(map).forEach(([elId, key]) => {
      const el = document.getElementById(elId);
      if (el) el.value = localStorage.getItem(key) || '';
    });
  }

  function saveSetting(key, value) {
    localStorage.setItem(key, value);
  }

  // ── Connectivity ────────────────────────────────────────────────────────
  function setupConnectivity() {
    const update = online => {
      state.isOnline = online;
      ['conn-dot','conn-dot-mobile'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = id.replace('-','_').includes('mobile')
          ? ('conn-dot-mobile' + (online?' online':' offline'))
          : ('conn-dot' + (online?' online':' offline'));
      });
      const lbl = document.getElementById('conn-label');
      if (lbl) lbl.textContent = online ? 'Online' : 'Offline — queuing orders';
      if (online) syncOfflineQueue();
    };
    window.addEventListener('online',  () => update(true));
    window.addEventListener('offline', () => update(false));
    update(navigator.onLine);
  }

  function setupWebSocket() {
    const base = (localStorage.getItem('apiBaseUrl') || window.location.origin).replace(/^http/,'ws');
    try {
      const ws = new WebSocket(base + '/ws');
      ws.onmessage = e => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event === 'new_order') {
            if (state.currentView === 'kds') loadKDS();
            if (state.currentView === 'bar') loadBar();
            showToast('New order', `${msg.order_id} · Table ${msg.table_id}`, '🔔');
          }
          if (['status_update','order_paid','order_voided'].includes(msg.event)) {
            if (state.currentView === 'orders') loadOrders();
          }
          updateOrderBadge();
        } catch {}
      };
    } catch {}
  }

  // ── View routing ────────────────────────────────────────────────────────
  function showView(name) {
    // Role guard
    const nav = NAV.find(n => n.id === name);
    if (nav && !nav.roles.includes(role())) {
      showToast('Access denied', 'You do not have permission for this view', '🔒');
      return;
    }
    state.currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.view === name));
    const v = document.getElementById('view-' + name);
    if (v) v.classList.add('active');

    const titles = { order:'New Order', orders:'Active Orders', tables:'Tables',
      receipts:'Receipts & Print', kds:'Kitchen Display', bar:'Bar Display',
      reports:'Reports', menu:'Menu Manager', inventory:'Inventory',
      users:'Staff Management', settings:'Settings' };
    const mt = document.getElementById('mobile-title');
    if (mt) mt.textContent = titles[name] || name;
    if (window.innerWidth <= 768) closeSidebar();

    if (name === 'orders')    loadOrders();
    if (name === 'tables')    loadTables();
    if (name === 'receipts')  loadReceiptOrders();
    if (name === 'kds')       loadKDS();
    if (name === 'bar')       loadBar();
    if (name === 'menu')      loadMenuManager();
    if (name === 'inventory') loadInventory();
    if (name === 'users')     loadUsers();
    if (name === 'reports')   initReports();
    if (name === 'settings')  updateQueueCount();
  }

  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('open');
  }
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }

  // ── Menu ────────────────────────────────────────────────────────────────
  async function loadMenu() {
    try {
      state.menuData = await API.getMenu();
      DB.setCache('menu', state.menuData);
    } catch {
      const cached = await DB.getCache('menu');
      if (cached) state.menuData = cached;
    }
    renderMenuPanel();
  }

  function renderMenuPanel() {
    const container = document.getElementById('menu-categories');
    if (!container) return;
    const search = (document.getElementById('menu-search')?.value || '').toLowerCase();
    const dest   = state.menuFilter;
    container.innerHTML = '';
    state.menuData.forEach(cat => {
      if (dest !== 'all' && cat.destination !== dest) return;
      const items = (cat.items || []).filter(i =>
        (!search || i.name.toLowerCase().includes(search)) &&
        (dest === 'all' || i.destination === dest)
      );
      if (!items.length) return;
      const sec = document.createElement('div');
      sec.className = 'cat-section';
      sec.innerHTML = `<div class="cat-label">
        ${cat.destination==='bar'?'🍺':'🍽'} ${cat.name}
        <span class="cat-dest-tag tag-${cat.destination}">${cat.destination}</span>
      </div><div class="menu-grid"></div>`;
      const grid = sec.querySelector('.menu-grid');
      items.forEach(item => {
        const el = document.createElement('div');
        el.className = 'menu-item';
        el.innerHTML = `<span class="cat-dest-tag tag-${item.destination}" style="font-size:9px">${item.destination}</span>
          <div class="menu-item-name">${item.name}</div>
          <div class="menu-item-price">${fmt(item.price)}</div>`;
        el.onclick = () => addToCart(item);
        grid.appendChild(el);
      });
      container.appendChild(sec);
    });
  }

  function filterMenu() { renderMenuPanel(); }
  function setDestFilter(dest, btn) {
    state.menuFilter = dest;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b===btn));
    renderMenuPanel();
  }

  // ── Cart ─────────────────────────────────────────────────────────────────
  function addToCart(item) {
    if (!state.cart[item.id]) state.cart[item.id] = {...item, qty:0};
    state.cart[item.id].qty++;
    renderCart();
  }
  function changeQty(id, delta) {
    id = +id || id;
    if (!state.cart[id]) return;
    state.cart[id].qty += delta;
    if (state.cart[id].qty <= 0) delete state.cart[id];
    renderCart();
  }
  function clearCart() { state.cart = {}; renderCart(); }
  function setTable(id) { state.tableId = id; renderCart(); }

  function renderCart() {
    const el    = document.getElementById('cart-body');
    const badge = document.getElementById('cart-table-badge');
    if (badge) badge.textContent = state.tableId || 'No table';
    const keys = Object.keys(state.cart);
    if (!keys.length) {
      el.innerHTML = '<div class="cart-empty">Tap menu items to add them</div>';
      ['c-subtotal','c-tax','c-total'].forEach(id => { const e=document.getElementById(id); if(e) e.textContent=fmt(0); });
      return;
    }
    el.innerHTML = keys.map(k => {
      const item = state.cart[k];
      return `<div class="cart-item">
        <span class="cat-dest-tag tag-${item.destination}" style="font-size:9px">${item.destination[0].toUpperCase()}</span>
        <span class="cart-item-name">${item.name}</span>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="App.changeQty(${k},-1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="App.changeQty(${k},1)">+</button>
        </div>
        <span class="cart-item-price">${fmt(item.price*item.qty)}</span>
      </div>`;
    }).join('');
    const sub = keys.reduce((s,k)=>s+state.cart[k].price*state.cart[k].qty,0);
    const tax = Math.round(sub*0.16);
    document.getElementById('c-subtotal').textContent = fmt(sub);
    document.getElementById('c-tax').textContent      = fmt(tax);
    document.getElementById('c-total').textContent    = fmt(sub+tax);
  }

  async function sendOrder() {
    const keys = Object.keys(state.cart);
    if (!keys.length)     { showToast('Empty cart','Add items first','⚠️'); return; }
    if (!state.tableId)   { showToast('No table','Select a table first','⚠️'); return; }
    const u = user();
    const items = keys.map(k => {
      const item = state.cart[k];
      return { menu_item_id:item.id, name:item.name, destination:item.destination,
               qty:item.qty, unit_price:item.price };
    });
    try {
      const res = await API.createOrder({
        table_id: state.tableId, waiter: u.name||'Staff', waiter_id: u.id,
        note: document.getElementById('order-note')?.value || null, items,
      });
      const k = items.filter(i=>i.destination==='kitchen').length;
      const b = items.filter(i=>i.destination==='bar').length;
      let msg = `${res.order_id} · ${fmt(res.total)}`;
      if (k) msg += `\n🍽 ${k} item(s) → Kitchen`;
      if (b) msg += `\n🍺 ${b} item(s) → Bar`;
      if (res.offline) msg += '\n⚠ Queued offline';
      showToast(res.offline?'Queued':'Order sent!', msg, res.offline?'📥':'✓');
      clearCart();
      document.getElementById('order-note').value = '';
      updateOrderBadge();
      updateQueueCount();
    } catch(e) { showToast('Error', e.message,'✕'); }
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  async function loadOrders() {
    const filter = document.getElementById('orders-filter')?.value;
    const grid   = document.getElementById('orders-grid');
    try {
      const orders = await API.getOrders(filter ? 'status='+filter : '');
      if (!orders.length) { grid.innerHTML='<div class="empty-state">No orders found</div>'; return; }
      grid.innerHTML = orders.map(o => orderCard(o)).join('');
      updateOrderBadge(orders);
    } catch { grid.innerHTML='<div class="empty-state">Could not load orders</div>'; }
  }

  function orderCard(o) {
    const canVoid  = Auth.isManager() && o.status !== 'paid' && o.status !== 'void';
    const canEdit  = Auth.isAdmin()   && o.status !== 'paid' && o.status !== 'void';
    const nextMap  = { pending:'cooking', cooking:'ready', ready:'paid' };
    const next     = nextMap[o.status];
    return `<div class="order-card">
      <div class="order-card-head">
        <div>
          <div class="order-num">${o.id}</div>
          <div class="order-table">Table: ${o.table_id} · ${o.waiter_name||o.waiter||'Staff'}</div>
        </div>
        <span class="cat-dest-tag tag-${o.status}">${o.status}</span>
      </div>
      <div class="order-card-body">
        <div class="order-time">🕐 ${(o.created_at||'').slice(11,16)}</div>
        ${(o.items||[]).map(i=>`<div class="order-item-row">
          <span>${i.qty}× ${i.name}${i.voided?'<span style="color:var(--danger);font-size:10px"> [voided]</span>':''}</span>
          <span class="cat-dest-tag tag-${i.destination}" style="font-size:9px">${i.destination}</span>
          <span>${fmt(i.line_total)}</span>
        </div>`).join('')}
        <div class="order-total"><span>Total</span><span>${fmt(o.total)}</span></div>
      </div>
      <div class="order-card-foot" style="flex-wrap:wrap">
        ${next?`<button class="btn btn-ghost btn-sm" style="flex:1" onclick="App.advanceStatus('${o.id}','${next}')">→ ${next}</button>`:''}
        ${o.status!=='paid'&&o.status!=='void'?`<button class="btn btn-primary btn-sm" style="flex:1" onclick="App.goToReceipts('${o.id}')">Pay</button>`:''}
        ${canVoid?`<button class="btn btn-danger btn-sm" onclick="App.openVoidModal('${o.id}')">Void</button>`:''}
        ${canEdit?`<button class="btn btn-ghost btn-sm" onclick="App.openEditOrderModal(${JSON.stringify(o).replace(/"/g,'&quot;')})">✏ Edit</button>`:''}
        ${canEdit?`<button class="btn btn-ghost btn-sm" onclick="App.openManualItemModal('${o.id}')">+ Item</button>`:''}
        <button class="btn btn-ghost btn-sm" onclick="App.goToReceipts('${o.id}')">🧾</button>
      </div>
    </div>`;
  }

  async function advanceStatus(orderId, status) {
    try { await API.updateStatus(orderId, status); loadOrders(); }
    catch(e) { showToast('Error', e.message,'✕'); }
  }

  function goToReceipts(orderId) {
    state.receiptOrderId = orderId;
    showView('receipts');
  }

  // ── Void ─────────────────────────────────────────────────────────────────
  function openVoidModal(orderId) {
    state.pendingVoidOrderId = orderId;
    document.getElementById('void-order-id').textContent = orderId;
    document.getElementById('void-reason').value = '';
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('modal-void').style.display = 'block';
  }

  async function confirmVoid() {
    const id     = state.pendingVoidOrderId;
    const reason = document.getElementById('void-reason').value || 'Voided by manager';
    try {
      await API.voidOrder(id, reason);
      showToast('Order voided', id + ' has been voided','✓');
      closeModal();
      loadOrders();
    } catch(e) { showToast('Error', e.message,'✕'); }
  }

  function openEditOrderModal(order) {
    openFormModal(`Edit Order: ${order.id}`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
        Admin only — change table, waiter or note. Items can be added using "+ Item".
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Table</label>
        <input class="input" id="f-eo-table" value="${order.table_id||''}" placeholder="e.g. T3" style="width:100%">
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Waiter Name</label>
        <input class="input" id="f-eo-waiter" value="${order.waiter||''}" style="width:100%">
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Order Note</label>
        <input class="input" id="f-eo-note" value="${order.note||''}" placeholder="Special instructions…" style="width:100%">
      </div>
      <button class="btn btn-primary btn-full" style="margin-top:4px" onclick="App.saveOrderEdit('${order.id}')">Save Changes</button>
    `);
  }

  async function saveOrderEdit(orderId) {
    const table_id = document.getElementById('f-eo-table')?.value.trim();
    const waiter   = document.getElementById('f-eo-waiter')?.value.trim();
    const note     = document.getElementById('f-eo-note')?.value.trim();
    if (!table_id) { showToast('Error','Table ID is required','⚠️'); return; }
    try {
      await API.editOrder(orderId, {table_id, waiter, note: note||null});
      showToast('Order updated', orderId,'✓');
      closeModal(); loadOrders();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  function openManualItemModal(orderId) {
    openFormModal(`Add Custom Item to ${orderId}`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">
        Add any item not on the menu — a special dish, external product, or custom charge.
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Item Name</label>
        <input class="input" id="f-mi-name" placeholder="e.g. Chef's Special, Corkage Fee…" style="width:100%">
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Route to</label>
        <select class="select" id="f-mi-dest" style="width:100%">
          <option value="kitchen">🍽 Kitchen</option>
          <option value="bar">🍺 Bar</option>
        </select>
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Quantity</label>
        <input type="number" class="input" id="f-mi-qty" value="1" min="1" style="width:100%">
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Unit Price (KSh)</label>
        <input type="number" class="input" id="f-mi-price" placeholder="0" style="width:100%">
      </div>
      <div class="field-group" style="margin-bottom:8px">
        <label class="field-label">Note (optional)</label>
        <input class="input" id="f-mi-note" placeholder="e.g. extra spicy, no onions…" style="width:100%">
      </div>
      <div id="f-mi-preview" style="background:var(--bg);border-radius:6px;padding:10px;font-size:13px;margin-bottom:8px;display:none">
        Line total: <strong id="f-mi-total">KSh 0</strong>
      </div>
      <button class="btn btn-primary btn-full" onclick="App.saveManualItem('${orderId}')">Add to Order</button>
    `);
    // Live preview
    ['f-mi-qty','f-mi-price'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        const qty   = parseFloat(document.getElementById('f-mi-qty')?.value)||0;
        const price = parseFloat(document.getElementById('f-mi-price')?.value)||0;
        const prev  = document.getElementById('f-mi-preview');
        const tot   = document.getElementById('f-mi-total');
        if (prev) prev.style.display = qty && price ? 'block' : 'none';
        if (tot)  tot.textContent = fmt(qty * price);
      });
    });
  }

  async function saveManualItem(orderId) {
    const name  = document.getElementById('f-mi-name')?.value.trim();
    const dest  = document.getElementById('f-mi-dest')?.value;
    const qty   = parseInt(document.getElementById('f-mi-qty')?.value)||0;
    const price = parseFloat(document.getElementById('f-mi-price')?.value);
    const note  = document.getElementById('f-mi-note')?.value.trim();
    if (!name)         { showToast('Error','Item name is required','⚠️'); return; }
    if (!qty || qty<1) { showToast('Error','Quantity must be at least 1','⚠️'); return; }
    if (!price||price<=0) { showToast('Error','Price must be greater than 0','⚠️'); return; }
    try {
      const res = await API.addManualItem(orderId, {
        name, destination:dest, qty, unit_price:price, note:note||null
      });
      showToast('Item added', `${qty}× ${name} → ${dest}`, '✓');
      closeModal(); loadOrders();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }


    const id = document.getElementById('receipt-order-select')?.value;
    if (!id) { showToast('No order','Select an order first','⚠️'); return; }
    openVoidModal(id);
  }

  // ── Tables ───────────────────────────────────────────────────────────────
  async function loadTables() {
    const grid = document.getElementById('tables-grid');
    const acts = document.getElementById('tables-actions');
    if (Auth.isManager() && acts) {
      acts.innerHTML = `<button class="btn btn-primary" onclick="App.openAddTableModal()">+ Add Table</button>`;
    }
    try {
      const tables = await API.getTables();
      grid.innerHTML = tables.map(t => {
        const cls   = t.status==='occupied'?'occupied':t.status==='reserved'?'reserved':'';
        const order = t.active_order || {};
        return `<div class="table-cell ${cls}" onclick="App.pickTable('${t.id}')">
          <div class="table-num">${t.id}</div>
          <div class="table-status">${t.status}</div>
          ${order.total?`<div class="table-amount">${fmt(order.total)}</div>`:''}
        </div>`;
      }).join('');
    } catch { grid.innerHTML='<div class="empty-state">Could not load tables</div>'; }
  }

  function pickTable(id) {
    document.getElementById('table-select').value = id;
    setTable(id);
    showView('order');
  }

  async function loadTableSelect() {
    try {
      const tables = await API.getTables();
      const sel = document.getElementById('table-select');
      if (!sel) return;
      tables.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.name;
        sel.appendChild(opt);
      });
    } catch {}
  }

  function openAddTableModal() {
    openFormModal('Add Table', `
      <div class="field-group"><label class="field-label">Table Name</label>
        <input class="input" id="f-table-name" placeholder="e.g. Table 9" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Capacity (seats)</label>
        <input type="number" class="input" id="f-table-cap" value="4" style="width:100%"></div>
      <button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveTable()">Save Table</button>
    `);
  }

  async function saveTable() {
    const name = document.getElementById('f-table-name')?.value.trim();
    const cap  = parseInt(document.getElementById('f-table-cap')?.value) || 4;
    if (!name) { showToast('Error','Table name required','⚠️'); return; }
    try {
      const res = await API.createTable({name, capacity:cap});
      showToast('Table added', res.id + ' — ' + name,'✓');
      closeModal();
      loadTables();
      // Reload table select
      const sel = document.getElementById('table-select');
      const opt = document.createElement('option');
      opt.value = res.id; opt.textContent = name;
      sel.appendChild(opt);
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  // ── Receipts ─────────────────────────────────────────────────────────────
  async function loadReceiptOrders() {
    try {
      const orders = await API.getOrders();
      const sel = document.getElementById('receipt-order-select');
      if (!sel) return;
      sel.innerHTML = '<option value="">— select order —</option>';
      orders.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `${o.id} · T:${o.table_id} · ${o.status}`;
        sel.appendChild(opt);
      });
      if (state.receiptOrderId) {
        sel.value = state.receiptOrderId;
        loadReceipt();
      }
    } catch {}
  }

  function setReceiptType(type, btn) {
    state.receiptType = type;
    document.querySelectorAll('.rtype-btn').forEach(b => b.classList.remove('active'));
    const b = btn || document.querySelector(`.rtype-btn[data-type="${type}"]`);
    if (b) b.classList.add('active');
    const paySection  = document.getElementById('pay-section');
    const voidSection = document.getElementById('void-section');
    if (paySection)  paySection.style.display  = (type==='invoice' ? 'flex' : 'none');
    if (voidSection) voidSection.style.display = (Auth.isManager() && type!=='invoice' ? 'block' : 'none');
    loadReceipt();
  }

  function onPayMethodChange() {
    const method  = document.getElementById('pay-method')?.value;
    const refRow  = document.getElementById('mpesa-ref-row');
    if (refRow) refRow.style.display = method==='mpesa' ? 'flex' : 'none';
  }

  async function loadReceipt() {
    const orderId = document.getElementById('receipt-order-select')?.value;
    const preview = document.getElementById('receipt-preview');
    const printBtn= document.getElementById('print-btn');
    if (!orderId) { preview.innerHTML='<div class="empty-state">Select an order to preview</div>'; return; }
    state.receiptOrderId = orderId;
    try {
      const data = await API.getReceipt(orderId, state.receiptType);
      preview.innerHTML = Receipt.render(state.receiptType, data);
      if (printBtn) printBtn.style.display = 'block';
    } catch(e) {
      preview.innerHTML = `<div class="empty-state">Could not load receipt: ${e.message}</div>`;
    }
  }

  async function processPayment() {
    const orderId = document.getElementById('receipt-order-select')?.value;
    if (!orderId) { showToast('No order','Select an order first','⚠️'); return; }
    const method   = document.getElementById('pay-method')?.value;
    const mpesaRef = document.getElementById('mpesa-ref')?.value;
    try {
      await API.recordPayment(orderId, {payment_method:method, mpesa_ref:mpesaRef||null});
      showToast('Payment recorded!', orderId+' marked as paid via '+method,'✓');
      setReceiptType('invoice', null);
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function printReceipt() {
    const orderId = document.getElementById('receipt-order-select')?.value;
    if (!orderId) return;
    try {
      const data = await API.getReceipt(orderId, state.receiptType);
      Receipt.printWindow(Receipt.render(state.receiptType, data),
        state.receiptType.toUpperCase()+' — '+orderId);
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  // ── KDS / Bar display ────────────────────────────────────────────────────
  async function loadKDS() { await renderKDSGrid(document.getElementById('kds-grid'),'kitchen'); }
  async function loadBar() { await renderKDSGrid(document.getElementById('bar-grid'),'bar'); }

  async function renderKDSGrid(grid, dest) {
    try {
      const [pending, cooking] = await Promise.all([
        API.getOrders('status=pending'), API.getOrders('status=cooking')
      ]);
      const all = [...pending,...cooking].filter(o=>(o.items||[]).some(i=>i.destination===dest));
      if (!all.length) { grid.innerHTML='<div class="empty-state" style="color:rgba(255,255,255,0.5)">No active orders</div>'; return; }
      grid.innerHTML = all.map(o => {
        const items = (o.items||[]).filter(i=>i.destination===dest);
        const mins  = Math.floor((Date.now()-new Date((o.created_at||'')+'Z').getTime())/60000);
        const warn  = mins>=15?'style="color:#ff6b35"':'';
        return `<div class="kds-card ${dest}">
          <div class="kds-card-head">
            <span>${o.id} · ${o.table_id}</span>
            <span ${warn}>🕐 ${mins}m</span>
          </div>
          <div class="kds-card-body">
            ${items.map(i=>`<div class="kds-item">${i.qty}× ${i.name}</div>`).join('')}
            <div class="kds-time">Ordered ${(o.created_at||'').slice(11,16)}</div>
          </div>
          <div class="kds-bump">
            <button class="btn btn-primary btn-full btn-sm" onclick="App.bumpOrder('${o.id}','${dest}')">
              ${o.status==='pending'?'→ Start Cooking':'✓ Mark Ready'}
            </button>
          </div>
        </div>`;
      }).join('');
    } catch { grid.innerHTML='<div class="empty-state" style="color:rgba(255,255,255,0.5)">Could not load orders</div>'; }
  }

  async function bumpOrder(orderId, dest) {
    try {
      const order = await API.getOrder(orderId);
      const next  = order.status==='pending'?'cooking':'ready';
      await API.updateStatus(orderId, next);
      if (dest==='kitchen') loadKDS(); else loadBar();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  // ── Reports ───────────────────────────────────────────────────────────────
  const REPORT_TYPES = [
    { id:'summary',   label:'📊 Sales Summary',     needsDest:false },
    { id:'by-day',    label:'📅 Sales by Day',       needsDest:false },
    { id:'by-month',  label:'🗓 Sales by Month',     needsDest:false, yearFilter:true },
    { id:'by-year',   label:'📆 Sales by Year',      needsDest:false, noDate:true },
    { id:'top-items', label:'🏆 Top Items',          needsDest:true },
    { id:'kitchen',   label:'🍽 Kitchen Report',     needsDest:false },
    { id:'bar',       label:'🍺 Bar Report',         needsDest:false },
    { id:'waiters',   label:'👤 Waiter Performance', needsDest:false },
    { id:'payments',  label:'💳 Payment Methods',    needsDest:false },
    { id:'voids',     label:'🚫 Void Orders',        needsDest:false },
    { id:'inventory', label:'📦 Inventory Value',   needsDest:false, noDate:true },
  ];

  function initReports() {
    const list = document.getElementById('report-type-list');
    if (!list) return;
    list.innerHTML = REPORT_TYPES.map(r =>
      `<button class="report-type-btn ${r.id===state.currentReportType?'active':''}"
        onclick="App.selectReportType('${r.id}',this)">${r.label}</button>`
    ).join('');
    updateReportFilters();
  }

  function selectReportType(id, btn) {
    state.currentReportType = id;
    document.querySelectorAll('.report-type-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    updateReportFilters();
  }

  function updateReportFilters() {
    const rt = REPORT_TYPES.find(r=>r.id===state.currentReportType);
    if (!rt) return;
    const dateRows = document.getElementById('report-filters');
    if (!dateRows) return;
    const fromRow  = dateRows.querySelector('.field-group:nth-child(1)');
    const toRow    = dateRows.querySelector('.field-group:nth-child(2)');
    const yearRow  = document.getElementById('rep-year-row');
    const destRow  = document.getElementById('rep-dest-row');
    if (fromRow) fromRow.style.display = rt.noDate ? 'none' : '';
    if (toRow)   toRow.style.display   = rt.noDate ? 'none' : '';
    if (yearRow) yearRow.style.display = rt.yearFilter ? '' : 'none';
    if (destRow) destRow.style.display = rt.needsDest ? '' : 'none';
  }

  async function runReport() {
    const from = document.getElementById('rep-from')?.value;
    const to   = document.getElementById('rep-to')?.value;
    const year = document.getElementById('rep-year')?.value;
    const dest = document.getElementById('rep-dest')?.value;
    const p    = { date_from:from||null, date_to:to||null, year:year||null, destination:dest||null };
    const type = state.currentReportType;
    const map  = {
      'summary':   () => Reports.renderSummary(p),
      'by-day':    () => Reports.renderByDay(p),
      'by-month':  () => Reports.renderByMonth(p),
      'by-year':   () => Reports.renderByYear(),
      'top-items': () => Reports.renderTopItems(p),
      'kitchen':   () => Reports.renderKitchen(p),
      'bar':       () => Reports.renderBar(p),
      'waiters':   () => Reports.renderWaiters(p),
      'payments':  () => Reports.renderPayments(p),
      'voids':     () => Reports.renderVoids(p),
      'inventory': () => Reports.renderInventory(),
    };
    if (map[type]) map[type]();
  }

  // ── Menu Manager ──────────────────────────────────────────────────────────
  async function loadMenuManager() {
    const container = document.getElementById('menu-manager-grid');
    try {
      const menu = await API.getMenuAll();
      container.innerHTML = menu.map(cat => `
        <div class="menu-manager-cat">
          <div class="menu-manager-cat-head">
            ${cat.destination==='bar'?'🍺':'🍽'} ${cat.name}
            <span class="cat-dest-tag tag-${cat.destination}">${cat.destination}</span>
            ${Auth.isAdmin()?`<button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="App.deleteCategoryConfirm(${cat.id},'${cat.name}')">Delete cat</button>`:''}
          </div>
          <div class="menu-manager-items">
            ${(cat.items||[]).map(item => `
              <div class="mgr-item ${item.available?'':'unavailable'}">
                <div>
                  <div class="mgr-name">${item.name}</div>
                  <div class="mgr-price">${fmt(item.price)} <span style="font-size:10px;color:var(--text-hint)">cost: ${fmt(item.cost_price)}</span></div>
                </div>
                <div class="mgr-actions">
                  <button class="btn btn-ghost btn-sm" onclick="App.openEditItemModal(${JSON.stringify(item).replace(/"/g,'&quot;')})">✏</button>
                  <button class="btn btn-ghost btn-sm" onclick="App.toggleItem(${item.id})">${item.available?'🔴':'🟢'}</button>
                  ${Auth.isAdmin()?`<button class="btn btn-ghost btn-sm" onclick="App.deleteItemConfirm(${item.id},'${item.name}')">🗑</button>`:''}
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('');
    } catch { container.innerHTML='<div class="empty-state">Could not load menu</div>'; }
  }

  function openAddCategoryModal() {
    openFormModal('Add Category', `
      <div class="field-group"><label class="field-label">Name</label>
        <input class="input" id="f-cat-name" placeholder="e.g. Desserts" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Destination</label>
        <select class="select" id="f-cat-dest" style="width:100%">
          <option value="kitchen">Kitchen</option><option value="bar">Bar</option>
        </select></div>
      <button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveCategory()">Save Category</button>
    `);
  }

  async function saveCategory() {
    const name = document.getElementById('f-cat-name')?.value.trim();
    const dest = document.getElementById('f-cat-dest')?.value;
    if (!name) { showToast('Error','Category name required','⚠️'); return; }
    try {
      await API.createCategory({name, destination:dest});
      showToast('Category added',name,'✓');
      closeModal(); await loadMenu(); loadMenuManager();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function deleteCategoryConfirm(id, name) {
    if (!confirm(`Delete category "${name}"? Only works if it has no items.`)) return;
    try { await API.deleteCategory(id); await loadMenu(); loadMenuManager(); showToast('Deleted',name,'✓'); }
    catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function _itemFormHTML(cats, item={}) {
    return `
      <div class="field-group"><label class="field-label">Category</label>
        <select class="select" id="f-item-cat" style="width:100%">
          ${cats.map(c=>`<option value="${c.id}" ${item.category_id==c.id?'selected':''}>${c.name} (${c.destination})</option>`).join('')}
        </select></div>
      <div class="field-group"><label class="field-label">Item Name</label>
        <input class="input" id="f-item-name" value="${item.name||''}" placeholder="Item name" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Selling Price (KSh)</label>
        <input type="number" class="input" id="f-item-price" value="${item.price||''}" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Cost Price (KSh)</label>
        <input type="number" class="input" id="f-item-cost" value="${item.cost_price||0}" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Destination</label>
        <select class="select" id="f-item-dest" style="width:100%">
          <option value="kitchen" ${item.destination==='kitchen'?'selected':''}>Kitchen</option>
          <option value="bar"     ${item.destination==='bar'?'selected':''}>Bar</option>
        </select></div>`;
  }

  async function openAddItemModal() {
    const cats = await API.getCategories().catch(()=>[]);
    openFormModal('Add Menu Item', (await _itemFormHTML(cats)) +
      `<button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveMenuItem(null)">Save Item</button>`);
  }

  async function openEditItemModal(item) {
    const cats = await API.getCategories().catch(()=>[]);
    openFormModal('Edit Menu Item', (await _itemFormHTML(cats, item)) +
      `<button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveMenuItem(${item.id})">Update Item</button>`);
  }

  async function saveMenuItem(id) {
    const name  = document.getElementById('f-item-name')?.value.trim();
    const price = parseFloat(document.getElementById('f-item-price')?.value);
    const cost  = parseFloat(document.getElementById('f-item-cost')?.value)||0;
    const catId = parseInt(document.getElementById('f-item-cat')?.value);
    const dest  = document.getElementById('f-item-dest')?.value;
    if (!name||isNaN(price)) { showToast('Error','Name and price required','⚠️'); return; }
    try {
      if (id) await API.updateItem(id,{category_id:catId,name,price,cost_price:cost,destination:dest,available:true});
      else    await API.createItem({category_id:catId,name,price,cost_price:cost,destination:dest,available:true});
      showToast(id?'Updated':'Added', name,'✓');
      closeModal(); await loadMenu(); loadMenuManager();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function toggleItem(id) {
    try { await API.toggleItem(id); loadMenuManager(); }
    catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function deleteItemConfirm(id, name) {
    if (!confirm(`Delete "${name}"?`)) return;
    try { await API.deleteItem(id); await loadMenu(); loadMenuManager(); showToast('Deleted',name,'✓'); }
    catch(e) { showToast('Error',e.message,'✕'); }
  }

  // ── Inventory ─────────────────────────────────────────────────────────────
  async function loadInventory() {
    const grid   = document.getElementById('inventory-grid');
    const banner = document.getElementById('low-stock-banner');
    try {
      const items = await API.getInventory();
      const low   = items.filter(i=>i.low_stock);
      if (banner) banner.style.display = low.length ? 'block' : 'none';
      grid.innerHTML = `<table class="inv-table">
        <thead><tr><th>Item</th><th>Category</th><th>In Stock</th><th>Unit</th><th>Reorder At</th><th>Cost/Unit</th><th>Stock Level</th><th>Actions</th></tr></thead>
        <tbody>${items.map(i=>{
          const pct   = Math.min(100, i.reorder_level>0 ? (i.qty_in_stock/i.reorder_level)*50 : 100);
          const isLow = i.low_stock;
          return `<tr class="${isLow?'inv-low':''}">
            <td><strong>${i.name}</strong></td>
            <td>${i.category}</td>
            <td><strong>${i.qty_in_stock}</strong></td>
            <td>${i.unit}</td>
            <td>${i.reorder_level}</td>
            <td>${fmt(i.cost_per_unit)}</td>
            <td>
              <div style="display:flex;align-items:center;gap:6px">
                ${isLow?'⚠ Low':'OK'}
                <div class="stock-bar-wrap"><div class="stock-bar${isLow?' low':''}" style="width:${pct}%"></div></div>
              </div>
            </td>
            <td>
              <div style="display:flex;gap:4px">
                <button class="btn btn-ghost btn-sm" onclick="App.openStockActionModal(${i.id},'${i.name}','restock')">+ Restock</button>
                <button class="btn btn-ghost btn-sm" onclick="App.openStockActionModal(${i.id},'${i.name}','deduct')">- Deduct</button>
                <button class="btn btn-ghost btn-sm" onclick="App.openEditStockModal(${JSON.stringify(i).replace(/"/g,'&quot;')})">✏</button>
                ${Auth.isAdmin()?`<button class="btn btn-danger btn-sm" onclick="App.deleteStockConfirm(${i.id},'${i.name}')">🗑</button>`:''}
              </div>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
    } catch(e) { grid.innerHTML=`<div class="empty-state">Could not load inventory</div>`; }
  }

  function _stockFormHTML(item={}) {
    return `
      <div class="field-group"><label class="field-label">Item Name</label>
        <input class="input" id="f-inv-name" value="${item.name||''}" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Unit (bottles, kg, pcs…)</label>
        <input class="input" id="f-inv-unit" value="${item.unit||'pcs'}" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Qty in Stock</label>
        <input type="number" class="input" id="f-inv-qty" value="${item.qty_in_stock||0}" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Reorder Level</label>
        <input type="number" class="input" id="f-inv-reorder" value="${item.reorder_level||5}" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Cost per Unit (KSh)</label>
        <input type="number" class="input" id="f-inv-cost" value="${item.cost_per_unit||0}" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Category</label>
        <select class="select" id="f-inv-cat" style="width:100%">
          ${['bar','kitchen','general'].map(c=>`<option value="${c}" ${item.category===c?'selected':''}>${c}</option>`).join('')}
        </select></div>`;
  }

  function openAddStockModal() {
    openFormModal('Add Inventory Item', _stockFormHTML() +
      `<button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveStock(null)">Save Item</button>`);
  }

  function openEditStockModal(item) {
    openFormModal('Edit Inventory Item', _stockFormHTML(item) +
      `<button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveStock(${item.id})">Update Item</button>`);
  }

  function openStockActionModal(id, name, action) {
    openFormModal(`${action==='restock'?'Restock':'Deduct'}: ${name}`, `
      <div class="field-group"><label class="field-label">Quantity</label>
        <input type="number" class="input" id="f-sa-qty" placeholder="0" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Note (optional)</label>
        <input class="input" id="f-sa-note" placeholder="e.g. Weekly delivery" style="width:100%"></div>
      <button class="btn btn-primary btn-full" style="margin-top:8px"
        onclick="App.doStockAction(${id},'${action}')">Confirm</button>
    `);
  }

  async function doStockAction(id, action) {
    const qty  = parseFloat(document.getElementById('f-sa-qty')?.value);
    const note = document.getElementById('f-sa-note')?.value;
    if (!qty||qty<=0) { showToast('Error','Quantity must be > 0','⚠️'); return; }
    try {
      const res = await API.stockAction(id,{action,qty,note});
      showToast('Updated',`New qty: ${res.qty_in_stock}`,'✓');
      closeModal(); loadInventory();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function saveStock(id) {
    const body = {
      name:          document.getElementById('f-inv-name')?.value.trim(),
      unit:          document.getElementById('f-inv-unit')?.value.trim()||'pcs',
      qty_in_stock:  parseFloat(document.getElementById('f-inv-qty')?.value)||0,
      reorder_level: parseFloat(document.getElementById('f-inv-reorder')?.value)||5,
      cost_per_unit: parseFloat(document.getElementById('f-inv-cost')?.value)||0,
      category:      document.getElementById('f-inv-cat')?.value||'general',
    };
    if (!body.name) { showToast('Error','Name required','⚠️'); return; }
    try {
      if (id) await API.updateStock(id, body);
      else    await API.createStock(body);
      showToast(id?'Updated':'Added', body.name,'✓');
      closeModal(); loadInventory();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function deleteStockConfirm(id, name) {
    if (!confirm(`Delete "${name}" from inventory?`)) return;
    try { await API.deleteStock(id); loadInventory(); showToast('Deleted',name,'✓'); }
    catch(e) { showToast('Error',e.message,'✕'); }
  }

  // ── Users (Admin only) ────────────────────────────────────────────────────
  async function loadUsers() {
    const grid = document.getElementById('users-grid');
    try {
      const users = await API.getUsers();
      grid.innerHTML = `<table class="users-table">
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${users.map(u => `
          <tr class="${u.active?'':'user-inactive'}">
            <td><strong>${u.name}</strong></td>
            <td><span class="cat-dest-tag role-${u.role}" style="font-size:11px;padding:2px 8px;border-radius:4px">${u.role}</span></td>
            <td>${u.active?'<span style="color:var(--success)">Active</span>':'<span style="color:var(--text-muted)">Inactive</span>'}</td>
            <td style="color:var(--text-muted);font-size:12px">${(u.created_at||'').slice(0,10)}</td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" onclick="App.openEditUserModal(${u.id},'${u.name.replace(/'/g,"\\'")}','${u.role}')">✏ Edit</button>
                <button class="btn btn-ghost btn-sm" onclick="App.toggleUserConfirm(${u.id},'${u.name}',${u.active})">${u.active?'Deactivate':'Activate'}</button>
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    } catch(e) { grid.innerHTML=`<div class="empty-state">Could not load users</div>`; }
  }

  function openEditUserModal(id, name, currentRole) {
    openFormModal(`Edit Staff: ${name}`, `
      <div style="border-bottom:0.5px solid var(--border);padding-bottom:14px;margin-bottom:14px">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:10px">Profile</div>
        <div class="field-group" style="margin-bottom:8px">
          <label class="field-label">Full Name</label>
          <input class="input" id="f-edit-name" value="${name}" style="width:100%">
        </div>
        <div class="field-group" style="margin-bottom:8px">
          <label class="field-label">Role</label>
          <select class="select" id="f-edit-role" style="width:100%">
            <option value="waiter"  ${currentRole==='waiter' ?'selected':''}>Waiter</option>
            <option value="manager" ${currentRole==='manager'?'selected':''}>Manager</option>
            <option value="admin"   ${currentRole==='admin'  ?'selected':''}>Administrator</option>
          </select>
        </div>
        <button class="btn btn-primary btn-full" onclick="App.saveUserEdit(${id})">Save Profile</button>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:10px">Change PIN</div>
        <div class="field-group" style="margin-bottom:8px">
          <label class="field-label">New 4-Digit PIN</label>
          <input type="number" class="input" id="f-edit-pin1" placeholder="e.g. 7890" style="width:100%">
        </div>
        <div class="field-group" style="margin-bottom:8px">
          <label class="field-label">Confirm PIN</label>
          <input type="number" class="input" id="f-edit-pin2" placeholder="repeat PIN" style="width:100%">
        </div>
        <button class="btn btn-ghost btn-full" onclick="App.savePinFromEdit(${id})">Change PIN</button>
      </div>
    `);
  }

  async function saveUserEdit(id) {
    const name = document.getElementById('f-edit-name')?.value.trim();
    const role = document.getElementById('f-edit-role')?.value;
    if (!name) { showToast('Error','Name is required','⚠️'); return; }
    try {
      await API.updateUser(id, {name, role});
      showToast('Updated', name + ' (' + role + ')','✓');
      closeModal(); loadUsers();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function savePinFromEdit(id) {
    const p1 = String(document.getElementById('f-edit-pin1')?.value||'');
    const p2 = String(document.getElementById('f-edit-pin2')?.value||'');
    if (!/^\d{4}$/.test(p1)) { showToast('Error','PIN must be exactly 4 digits','⚠️'); return; }
    if (p1 !== p2)            { showToast('Error','PINs do not match','⚠️'); return; }
    try {
      await API.changePin(id, p1);
      showToast('PIN changed','Login PIN updated successfully','✓');
      document.getElementById('f-edit-pin1').value = '';
      document.getElementById('f-edit-pin2').value = '';
    } catch(e) { showToast('Error',e.message,'✕'); }
  }


    openFormModal('Add Staff Member', `
      <div class="field-group"><label class="field-label">Full Name</label>
        <input class="input" id="f-user-name" placeholder="e.g. Jane Doe" style="width:100%"></div>
      <div class="field-group"><label class="field-label">4-Digit PIN</label>
        <input type="number" class="input" id="f-user-pin" placeholder="e.g. 5678" maxlength="4" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Role</label>
        <select class="select" id="f-user-role" style="width:100%">
          <option value="waiter">Waiter</option>
          <option value="manager">Manager</option>
          <option value="admin">Administrator</option>
        </select></div>
      <button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveUser()">Create Account</button>
    `);
  }

  async function saveUser() {
    const name = document.getElementById('f-user-name')?.value.trim();
    const pin  = document.getElementById('f-user-pin')?.value;
    const role = document.getElementById('f-user-role')?.value;
    if (!name||!pin) { showToast('Error','Name and PIN required','⚠️'); return; }
    try {
      await API.createUser({name, pin: String(pin).padStart(4,'0'), role});
      showToast('Staff created', name+' ('+role+')','✓');
      closeModal(); loadUsers();
    } catch(e) { showToast('Error',e.message,'✕'); }
  }

  function openChangePinModal(id, name) {
    openFormModal(`Change PIN: ${name}`, `
      <div class="field-group"><label class="field-label">New 4-Digit PIN</label>
        <input type="number" class="input" id="f-new-pin" placeholder="e.g. 7890" maxlength="4" style="width:100%"></div>
      <div class="field-group"><label class="field-label">Confirm PIN</label>
        <input type="number" class="input" id="f-confirm-pin" placeholder="repeat PIN" maxlength="4" style="width:100%"></div>
      <button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.savePin(${id})">Change PIN</button>
    `);
  }

  async function savePin(id) {
    const p1 = String(document.getElementById('f-new-pin')?.value||'');
    const p2 = String(document.getElementById('f-confirm-pin')?.value||'');
    if (p1.length!==4||!/^\d{4}$/.test(p1)) { showToast('Error','PIN must be 4 digits','⚠️'); return; }
    if (p1!==p2) { showToast('Error','PINs do not match','⚠️'); return; }
    try { await API.changePin(id,p1); showToast('PIN changed','','✓'); closeModal(); }
    catch(e) { showToast('Error',e.message,'✕'); }
  }

  function openChangeRoleModal(id, name, currentRole) {
    openFormModal(`Change Role: ${name}`, `
      <div class="field-group"><label class="field-label">Role</label>
        <select class="select" id="f-role-select" style="width:100%">
          <option value="waiter"  ${currentRole==='waiter' ?'selected':''}>Waiter</option>
          <option value="manager" ${currentRole==='manager'?'selected':''}>Manager</option>
          <option value="admin"   ${currentRole==='admin'  ?'selected':''}>Administrator</option>
        </select></div>
      <button class="btn btn-primary btn-full" style="margin-top:8px" onclick="App.saveRole(${id})">Save Role</button>
    `);
  }

  async function saveRole(id) {
    const role = document.getElementById('f-role-select')?.value;
    try { await API.changeRole(id,role); showToast('Role updated',role,'✓'); closeModal(); loadUsers(); }
    catch(e) { showToast('Error',e.message,'✕'); }
  }

  async function toggleUserConfirm(id, name, active) {
    if (!confirm(`${active?'Deactivate':'Activate'} ${name}?`)) return;
    try { await API.toggleUser(id); loadUsers(); showToast('Updated',name,'✓'); }
    catch(e) { showToast('Error',e.message,'✕'); }
  }

  // ── Sync ──────────────────────────────────────────────────────────────────
  async function syncOfflineQueue() {
    const n = await DB.queueLength();
    if (!n) { updateQueueCount(); return; }
    if (!state.isOnline) { showToast('Offline','Cannot sync — no connection','⚠️'); return; }
    try {
      const res = await API.syncQueue();
      showToast('Synced!',`${res.synced} action(s) pushed`,'↑');
      updateQueueCount();
    } catch(e) { showToast('Sync failed',e.message,'✕'); }
  }

  async function updateQueueCount() {
    const n  = await DB.queueLength();
    const el = document.getElementById('queue-count');
    if (el) el.textContent = n + ' action(s) queued';
  }

  async function updateOrderBadge(orders) {
    try {
      if (!orders) orders = await API.getOrders('');
      const active = orders.filter(o=>!['paid','void'].includes(o.status)).length;
      const badge  = document.getElementById('badge-orders');
      if (badge) { badge.textContent=active; badge.style.display=active?'':'none'; }
    } catch {}
  }

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openFormModal(title, bodyHTML) {
    document.getElementById('modal-form-title').textContent = title;
    document.getElementById('modal-form-body').innerHTML   = bodyHTML;
    document.getElementById('modal-overlay').classList.add('open');
    document.getElementById('modal-form').style.display    = 'block';
  }

  function closeModal(e) {
    if (e && e.target !== document.getElementById('modal-overlay')) return;
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('modal-form').style.display  = 'none';
    document.getElementById('modal-void').style.display  = 'none';
  }

  let _toastTimer = null;
  function showToast(title, msg, icon='✓') {
    const el = document.getElementById('modal-toast');
    document.getElementById('toast-icon').textContent  = icon;
    document.getElementById('toast-title').textContent = title;
    document.getElementById('toast-msg').textContent   = msg;
    el.style.display = 'flex';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(()=>{ el.style.display='none'; }, 3500);
  }

  function clearLocalData() {
    if (!confirm('Clear cart and offline queue?')) return;
    DB.clearQueue(); state.cart = {}; renderCart(); updateQueueCount();
    showToast('Cleared','Local data cleared','✓');
  }

  return {
    state, init, showView, toggleSidebar,
    filterMenu, setDestFilter,
    addToCart, changeQty, clearCart, setTable,
    sendOrder,
    loadOrders, advanceStatus, goToReceipts,
    openVoidModal, confirmVoid, voidCurrentOrder,
    openEditOrderModal, saveOrderEdit,
    openManualItemModal, saveManualItem,
    loadTables, pickTable, openAddTableModal, saveTable,
    loadReceiptOrders, setReceiptType, loadReceipt,
    onPayMethodChange, processPayment, printReceipt,
    loadKDS, loadBar, bumpOrder,
    initReports, selectReportType, runReport,
    loadMenuManager, openAddCategoryModal, saveCategory,
    deleteCategoryConfirm, openAddItemModal, openEditItemModal,
    saveMenuItem, toggleItem, deleteItemConfirm,
    loadInventory, openAddStockModal, openEditStockModal,
    openStockActionModal, doStockAction, saveStock, deleteStockConfirm,
    loadUsers, openAddUserModal, saveUser,
    openEditUserModal, saveUserEdit, savePinFromEdit,
    openChangePinModal, savePin, openChangeRoleModal, saveRole,
    toggleUserConfirm,
    syncOfflineQueue, saveSetting, clearLocalData,
    closeModal,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
