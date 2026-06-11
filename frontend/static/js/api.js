/**
 * api.js v2 — REST client with auth token, offline fallback
 */
const API = (() => {
  const base = () => (localStorage.getItem('apiBaseUrl') || '').replace(/\/$/, '');
  const token = () => sessionStorage.getItem('token') || '';

  async function request(method, path, body = null) {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Token': token(),
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(base() + '/api' + path, opts);
    if (res.status === 401) {
      sessionStorage.clear();
      window.location.reload();
      throw new Error('Session expired');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return res.json();
  }

  const get   = p      => request('GET',    p);
  const post  = (p, b) => request('POST',   p, b);
  const put   = (p, b) => request('PUT',    p, b);
  const patch = (p, b) => request('PATCH',  p, b);
  const del   = p      => request('DELETE', p);

  return {
    // Auth
    login:  body => post('/auth/login', body),
    logout: ()   => post('/auth/logout', {}),
    me:     ()   => get('/auth/me'),

    // Users
    getUsers:   ()                  => get('/users/'),
    createUser: body                => post('/users/', body),
    updateUser: (id, body)          => put(`/users/${id}`, body),
    changePin:  (id, pin)           => patch(`/users/${id}/pin`, { new_pin: pin }),
    changeRole: (id, role)          => patch(`/users/${id}/role?role=${role}`),
    toggleUser: id                  => patch(`/users/${id}/toggle`),

    // Menu
    getMenu:         () => get('/menu/'),
    getMenuAll:      () => get('/menu/all'),
    getCategories:   () => get('/menu/categories'),
    createCategory:  b  => post('/menu/categories', b),
    updateCategory:  (id,b) => put(`/menu/categories/${id}`, b),
    deleteCategory:  id => del(`/menu/categories/${id}`),
    createItem:      b  => post('/menu/items', b),
    updateItem:      (id,b) => put(`/menu/items/${id}`, b),
    toggleItem:      id => patch(`/menu/items/${id}/toggle`),
    deleteItem:      id => del(`/menu/items/${id}`),

    // Tables
    getTables:    ()       => get('/tables/'),
    createTable:  body     => post('/tables/', body),
    updateTable:  (id, b)  => put(`/tables/${id}`, b),
    deleteTable:  id       => del(`/tables/${id}`),

    // Orders
    getOrders:    qs  => get('/orders/' + (qs ? '?' + qs : '')),
    getOrder:     id  => get(`/orders/${id}`),
    createOrder:  async body => {
      try {
        return await post('/orders/', body);
      } catch(e) {
        const oid = 'OFF-' + Date.now().toString(36).toUpperCase();
        const sub = body.items.reduce((s,i)=>s+i.qty*i.unit_price,0);
        const tax = Math.round(sub*0.16*100)/100;
        const pl  = {...body, id:oid, subtotal:sub, tax, total:sub+tax, created_at:new Date().toISOString()};
        await DB.enqueue('create_order', pl);
        return {order_id:oid, total:pl.total, status:'pending', offline:true};
      }
    },
    updateStatus: (id, status) => patch(`/orders/${id}/status`, { status }),
    voidOrder:    (id, reason) => post(`/orders/${id}/void`, { reason }),
    voidItem:     (orderId, itemId) => post(`/orders/${orderId}/void-item/${itemId}`),
    editOrder:    (id, body)   => patch(`/orders/${id}/edit`, body),
    addManualItem:(id, body)   => post(`/orders/${id}/manual-item`, body),

    // Receipts
    getReceipt: (oid, type) => get(`/receipts/${oid}/${type}`),

    // Payments
    recordPayment: (oid, body) => post(`/payments/${oid}`, body),

    // Inventory
    getInventory:  ()        => get('/inventory/'),
    getLowStock:   ()        => get('/inventory/low-stock'),
    createStock:   body      => post('/inventory/', body),
    updateStock:   (id, b)   => put(`/inventory/${id}`, b),
    stockAction:   (id, b)   => post(`/inventory/${id}/stock`, b),
    deleteStock:   id        => del(`/inventory/${id}`),

    // Reports
    reportSummary:  (p) => get('/reports/sales/summary' + _qs(p)),
    reportByDay:    (p) => get('/reports/sales/by-day'  + _qs(p)),
    reportByMonth:  (p) => get('/reports/sales/by-month'+ _qs(p)),
    reportByYear:   ()  => get('/reports/sales/by-year'),
    reportOrders:   (p) => get('/reports/orders'        + _qs(p)),
    reportWaiters:  (p) => get('/reports/waiters'       + _qs(p)),
    reportKitchen:  (p) => get('/reports/kitchen'       + _qs(p)),
    reportBar:      (p) => get('/reports/bar'           + _qs(p)),
    reportTopItems: (p) => get('/reports/top-items'     + _qs(p)),
    reportPayments: (p) => get('/reports/payments'      + _qs(p)),
    reportVoids:    (p) => get('/reports/voids'         + _qs(p)),
    reportInventory:()  => get('/reports/inventory'),

    // Sync
    syncQueue: async () => {
      const q = await DB.getQueue();
      if (!q.length) return {synced:0};
      const r = await post('/sync/push', {actions: q});
      await DB.clearQueue();
      return r;
    },
  };

  function _qs(p) {
    if (!p) return '';
    const q = Object.entries(p).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>`${k}=${v}`).join('&');
    return q ? '?' + q : '';
  }
})();
