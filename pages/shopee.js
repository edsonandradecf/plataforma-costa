// --- SHOPEE -------------------------------------------------------------------
const SHOPEE_PARTNER_ID  = 2033820;
const SHOPEE_SHOP_ID     = 1577798856;
const SHOPEE_PROXY       = 'https://shopee-proxy.costanaturelife.workers.dev';
const SHOPEE_REDIRECT    = 'https://edsonandradecf.github.io/plataforma-costa';

var _shopeeToken = null; // { access_token, refresh_token, expires_at, shop_id }
var _vendaTab    = 'ml'; // 'ml' | 'shopee'
var _mlCache     = null;
var _shopeeCache = null;
var _CACHE_TTL   = 23 * 60 * 60 * 1000; // 23 horas

function vendaCacheValido(cache) {
  return cache && cache.loadedAt && (Date.now() - cache.loadedAt) < _CACHE_TTL;
}

async function vendaSalvarCache(chave, cache) {
  // Salva no localStorage local (instantâneo)
  try { localStorage.setItem(chave, JSON.stringify(cache)); } catch(e) {}
  // Salva no Firebase (compartilhado entre todos os usuários)
  try {
    await fetch(FIREBASE_URL + '/vendas_cache/' + chave + '.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cache),
    });
  } catch(e) {}
}

async function vendaCarregarCacheFirebase(chave) {
  // Tenta localStorage primeiro (mais rápido)
  try {
    var local = localStorage.getItem(chave);
    if (local) {
      var c = JSON.parse(local);
      if (vendaCacheValido(c)) return c;
    }
  } catch(e) {}
  // Tenta Firebase
  try {
    var resp = await fetch(FIREBASE_URL + '/vendas_cache/' + chave + '.json');
    if (resp.ok) {
      var c2 = await resp.json();
      if (c2 && vendaCacheValido(c2)) {
        // Salva no localStorage para próxima vez
        try { localStorage.setItem(chave, JSON.stringify(c2)); } catch(e) {}
        return c2;
      }
    }
  } catch(e) {}
  return null;
}

// Restaura caches ao iniciar (localStorage -- Firebase é carregado sob demanda)
(function() {
  try {
    var ml = localStorage.getItem('costa_ml_cache');
    if (ml) { var c = JSON.parse(ml); if (vendaCacheValido(c)) _mlCache = c; }
  } catch(e) {}
  try {
    var sh = localStorage.getItem('costa_shopee_cache');
    if (sh) { var c2 = JSON.parse(sh); if (vendaCacheValido(c2)) _shopeeCache = c2; }
  } catch(e) {}
})();

function shopeeLoadToken() {
  if (_shopeeToken) return _shopeeToken;
  try { _shopeeToken = JSON.parse(localStorage.getItem('shopee_token')); } catch(e) {}
  if (!_shopeeToken && state.shopeeToken) _shopeeToken = state.shopeeToken;
  return _shopeeToken;
}
function shopeeSaveToken(t) {
  _shopeeToken = t;
  localStorage.setItem('shopee_token', JSON.stringify(t));
  state.shopeeToken = t;
  saveState();
}
function shopeeTokenValid() {
  var t = shopeeLoadToken();
  return t && t.access_token && Date.now() < (t.expires_at || 0);
}
async function shopeeRefreshToken() {
  var t = shopeeLoadToken();
  if (!t || !t.refresh_token) throw new Error('Sem refresh token Shopee');
  var resp = await fetch(SHOPEE_PROXY + '?action=refresh_token&refresh_token=' + encodeURIComponent(t.refresh_token) + '&shop_id=' + SHOPEE_SHOP_ID);
  var data = await resp.json();
  if (!data.access_token) throw new Error('Falha ao renovar token Shopee');
  shopeeSaveToken({ access_token: data.access_token, refresh_token: data.refresh_token || t.refresh_token, expires_at: Date.now() + ((data.expire_in || 14400) * 1000), shop_id: SHOPEE_SHOP_ID });
}
async function shopeeGet(path, params) {
  if (!shopeeTokenValid()) await shopeeRefreshToken();
  var t = shopeeLoadToken();
  var q = new URLSearchParams(params || {});
  var url = SHOPEE_PROXY + '?action=api&path=' + encodeURIComponent(path) + '&access_token=' + encodeURIComponent(t.access_token) + '&shop_id=' + SHOPEE_SHOP_ID + '&' + q.toString();
  var resp = await fetch(url);
  if (!resp.ok) throw new Error('Shopee API erro ' + resp.status);
  return await resp.json();
}

// Wraps a URL through the CORS proxy
function mlProxyUrl(url) {
  return ML_PROXY + '?url=' + encodeURIComponent(url);
}

let _mlToken = null;   // { access_token, refresh_token, expires_at }

function mlSaveToken(t) {
  _mlToken = t;
  localStorage.setItem('ml_token', JSON.stringify(t));
  // Also save to shared Firebase state so all users can use it
  state.mlToken = t;
  saveState();
}
function mlLoadToken() {
  if (_mlToken) return _mlToken;
  // Try localStorage first
  try { _mlToken = JSON.parse(localStorage.getItem('ml_token')); } catch(e) {}
  // Fall back to shared Firebase state (set by admin on their device)
  if (!_mlToken && state.mlToken) _mlToken = state.mlToken;
  return _mlToken;
}
function mlTokenValid() {
  var t = mlLoadToken();
  return t && t.access_token && Date.now() < (t.expires_at || 0);
}

async function mlExchangeCode(code) {
  var resp = await fetch(mlProxyUrl('https://api.mercadolibre.com/oauth/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      code: code,
      redirect_uri: ML_REDIRECT_URI,
    })
  });
  if (!resp.ok) {
    var eb = ''; try { var ej = await resp.json(); eb = ej.message || ej.error || JSON.stringify(ej); } catch(e2) {}
    throw new Error('Erro ao obter token (' + resp.status + '): ' + eb);
  }
  var data = await resp.json();
  mlSaveToken({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in * 1000) });
  return data;
}

async function mlRefreshToken() {
  var t = mlLoadToken();
  if (!t || !t.refresh_token) throw new Error('Sem refresh token');
  var resp = await fetch(mlProxyUrl('https://api.mercadolibre.com/oauth/token'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      refresh_token: t.refresh_token,
    })
  });
  if (!resp.ok) {
    var rb = ''; try { var rj = await resp.json(); rb = rj.message || rj.error || JSON.stringify(rj); } catch(e2) {}
    // Clear bad token so next login shows connect button
    localStorage.removeItem('ml_token'); _mlToken = null; state.mlToken = null;
    throw new Error('Token expirado (' + resp.status + '). Reconecte o Mercado Livre.');
  }
  var data = await resp.json();
  mlSaveToken({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + (data.expires_in * 1000) });
  return data;
}

async function mlGet(path) {
  if (!mlTokenValid()) await mlRefreshToken();
  var t = mlLoadToken();
  var resp = await fetch(mlProxyUrl('https://api.mercadolibre.com' + path), {
    headers: { 'Authorization': 'Bearer ' + t.access_token }
  });
  if (resp.status === 401) {
    await mlRefreshToken();
    t = mlLoadToken();
    resp = await fetch(mlProxyUrl('https://api.mercadolibre.com' + path), {
      headers: { 'Authorization': 'Bearer ' + t.access_token }
    });
  }
  if (!resp.ok) {
    var errBody = '';
    try { var errJson = await resp.json(); errBody = errJson.message || errJson.error || ''; } catch(e2) {}
    throw new Error('ML API erro ' + resp.status + (errBody ? ': ' + errBody : ''));
  }
  return await resp.json();
}

function mlUpdateProgress(pct, loaded, total) {
  // Update progress in both vendas page and inicio
  var els = ['vendas-progress', 'inicio-progress'];
  els.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text3);margin-bottom:4px">' +
        '<span>Carregando pedidos do mês...</span>' +
        '<span>' + loaded + ' / ' + total + '</span>' +
      '</div>' +
      '<div style="background:var(--bg3);border-radius:99px;height:6px">' +
        '<div style="background:var(--green);border-radius:99px;height:6px;width:' + pct + '%;transition:width 0.3s"></div>' +
      '</div>';
    el.style.display = pct >= 100 ? 'none' : 'block';
  });
}

async function mlFetchVendas() {
  var me = await mlGet('/users/me');
  var userId = me.id;
  var now = new Date();

  function toMLDate(d) {
    return d.toISOString().slice(0,19) + '.000Z';
  }

  // Today
  var dayStart = new Date(now); dayStart.setHours(0,0,0,0);
  var dayEnd   = new Date(now); dayEnd.setHours(23,59,59,999);
  var dayFrom  = toMLDate(dayStart);
  var dayTo    = toMLDate(dayEnd);

  // This month
  var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  var monthEnd   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23, 59, 59);
  var monthFrom  = toMLDate(monthStart);
  var monthTo    = toMLDate(monthEnd);

  // Fetch today orders (max 51)
  var dayData = await mlGet('/orders/search?seller=' + userId +
    '&order.date_created.from=' + encodeURIComponent(dayFrom) +
    '&order.date_created.to='   + encodeURIComponent(dayTo) +
    '&order.status=paid&sort=date_desc&limit=50');

  // Fetch ALL month orders paginated
  var allMonthOrders = [];
  var monthTotal = 0;
  var offset = 0;
  var maxPages = 150; // 150 × 50 = 7500 pedidos máximos
  for (var page = 0; page < maxPages; page++) {
    var monthData = await mlGet('/orders/search?seller=' + userId +
      '&order.date_created.from=' + encodeURIComponent(monthFrom) +
      '&order.date_created.to='   + encodeURIComponent(monthTo) +
      '&order.status=paid&sort=date_asc&limit=50&offset=' + offset);
    var results = monthData.results || [];
    if (page === 0) monthTotal = monthData.paging ? monthData.paging.total : results.length;
    allMonthOrders = allMonthOrders.concat(results);
    offset += results.length;
    // Update progress bar if visible
    var pct = monthTotal > 0 ? Math.round((allMonthOrders.length / monthTotal) * 100) : 0;
    mlUpdateProgress(pct, allMonthOrders.length, monthTotal);
    if (results.length === 0 || allMonthOrders.length >= monthTotal) break;
    await new Promise(function(r){ setTimeout(r, 150); });
  }

  return {
    orders:      dayData.results || [],
    totalDay:    dayData.paging  ? dayData.paging.total : 0,
    ordersMonth: allMonthOrders,
    totalMonth:  monthTotal,
    me: me,
  };
}

async function shopeeExchangeCode(code, shopId) {
  var resp = await fetch(SHOPEE_PROXY + '?action=get_token&code=' + encodeURIComponent(code) + '&shop_id=' + shopId);
  var data = await resp.json();
  if (!data.access_token) throw new Error('Falha ao obter token Shopee: ' + JSON.stringify(data));
  shopeeSaveToken({
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at:    Date.now() + ((data.expire_in || 14400) * 1000),
    shop_id:       parseInt(shopId),
  });
  addLog('Shopee conectada com sucesso');
  return data;
}

function shopeeDesconectar() {
  _shopeeToken = null;
  state.shopeeToken = null;
  localStorage.removeItem('shopee_token');
  saveState();
  navigate('margemviva');
}

function shopeeAuthHtml() {
  return '<div class="card" style="max-width:480px;margin:0 auto;text-align:center;padding:2.5rem">' +
    '<div style="font-size:2.5rem;margin-bottom:1rem">🛒</div>' +
    '<h3 style="margin-bottom:0.5rem">Conectar Shopee</h3>' +
    '<p style="color:var(--text2);font-size:0.9rem;margin-bottom:1.5rem">Clique abaixo para autorizar a Plataforma Costa a acessar seus pedidos da Shopee.</p>' +
    '<button onclick="shopeeIniciarAuth()" class="btn btn-green" style="padding:0.75rem 2rem;font-size:1rem">🔗 Conectar com Shopee</button>' +
  '</div>';
}

async function shopeeIniciarAuth() {
  try {
    var resp = await fetch(SHOPEE_PROXY + '?action=auth_url&redirect_uri=' + encodeURIComponent(SHOPEE_REDIRECT));
    var data = await resp.json();
    if (data.auth_url) window.location.href = data.auth_url;
    else alert('Erro ao gerar link de autorização Shopee');
  } catch(e) {
    alert('Erro: ' + e.message);
  }
}

async function shopeeCarregarVendas(forcar) {
  var el = document.getElementById('shopee-content');
  if (!el) return;

  if (!shopeeTokenValid()) { el.innerHTML = shopeeAuthHtml(); return; }

  // Tenta Firebase se não tem cache local válido
  if (!forcar && !vendaCacheValido(_shopeeCache)) {
    var fbSh = await vendaCarregarCacheFirebase('costa_shopee_cache');
    if (fbSh) _shopeeCache = fbSh;
  }

  if (!forcar && vendaCacheValido(_shopeeCache)) {
    renderShopeeVendas(el, _shopeeCache.data);
    return;
  }

  // Limpa Firebase ao forçar
  if (forcar) {
    _shopeeCache = null;
    localStorage.removeItem('costa_shopee_cache');
    fetch(FIREBASE_URL + '/vendas_cache/costa_shopee_cache.json', { method: 'DELETE' }).catch(function(){});
  }

  el.innerHTML = '<div class="card" style="text-align:center;padding:2rem"><p>⏳ Carregando pedidos da Shopee...</p></div>';

  try {
    var data = await shopeeCarregarDados();
    renderShopeeVendas(el, data);
  } catch(e) {
    var isAuth = e.message.includes('401') || e.message.includes('token');
    if (isAuth) { _shopeeToken = null; state.shopeeToken = null; localStorage.removeItem('shopee_token'); el.innerHTML = shopeeAuthHtml(); }
    else el.innerHTML = '<div class="card" style="border-color:var(--red);text-align:center;padding:2rem"><div style="color:var(--red)">⚠ ' + esc(e.message) + '</div><button class="btn btn-sm" style="margin-top:1rem" onclick="shopeeCarregarVendas(true)">Tentar novamente</button></div>';
  }
}

function renderShopeeVendas(el, data) {
  var nomesMes  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var mesNome   = nomesMes[new Date().getMonth()];
  var diasNoMes = new Date().getDate();

  var totalPedidos = data.totalPedidos, totalFaturado = data.totalFaturado;
  var pedidosHoje  = data.pedidosHoje,  faturadoHoje  = data.faturadoHoje;
  var pedidosPorDia = data.pedidosPorDia || {};
  var prodRanking   = data.prodRanking   || {};

  var top5 = Object.keys(prodRanking).map(function(n){ return { nome:n, qtd:prodRanking[n].qtd, receita:prodRanking[n].receita }; });
  top5.sort(function(a,b){ return b.qtd - a.qtd; });
  top5 = top5.slice(0, 5);

  var html =
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:1.25rem">' +
      '<span style="font-size:0.85rem;color:var(--text3)">🧡 Shopee * Loja conectada</span>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-sm" onclick="shopeeCarregarVendas(true)">🔄 Atualizar</button>' +
        '<button class="btn btn-sm btn-red" onclick="shopeeDesconectar()">Desconectar</button>' +
      '</div>' +
    '</div>' +

    '<div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:0.5rem">Hoje</div>' +
    '<div class="stats-grid" style="margin-bottom:1.25rem">' +
      '<div class="stat-card"><div class="stat-label">🧡 Pedidos Shopee Hoje</div><div class="stat-value" style="color:#f4630a">' + pedidosHoje + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">💰 Faturado Hoje</div><div class="stat-value">R$ ' + faturadoHoje.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' +
    '</div>' +

    '<div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:0.5rem">' + mesNome + '</div>' +
    '<div class="stats-grid" style="margin-bottom:1.5rem">' +
      '<div class="stat-card"><div class="stat-label">📅 Pedidos no Mês</div><div class="stat-value">' + totalPedidos + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">💵 Faturado no Mês</div><div class="stat-value">R$ ' + totalFaturado.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">🎯 Ticket Médio</div><div class="stat-value">R$ ' + (totalPedidos > 0 ? (totalFaturado/totalPedidos).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '0,00') + '</div></div>' +
    '</div>' +

    '<div class="card" style="padding:1.25rem;margin-bottom:1.25rem">' +
      '<div style="font-weight:700;font-size:0.9rem;margin-bottom:1rem">📈 Pedidos por Dia -- ' + mesNome + '</div>' +
      '<div style="position:relative;height:160px;display:flex;align-items:flex-end;gap:3px;padding-bottom:20px">';

  var maxDia = Math.max.apply(null, Object.values(pedidosPorDia).concat([1]));
  for (var d2 = 1; d2 <= diasNoMes; d2++) {
    var qtdDia = pedidosPorDia[d2] || 0;
    var pct    = Math.round((qtdDia / maxDia) * 130);
    var isHoje = d2 === new Date().getDate();
    html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0">' +
      (qtdDia > 0 ? '<div style="font-size:0.55rem;color:var(--text3)">' + qtdDia + '</div>' : '<div style="font-size:0.55rem;color:transparent">0</div>') +
      '<div style="width:100%;height:' + pct + 'px;background:' + (isHoje?'var(--amber)':'#f4630a') + ';border-radius:3px 3px 0 0;opacity:' + (isHoje?'1':'0.8') + ';min-height:2px"></div>' +
      '<div style="font-size:0.55rem;color:var(--text3);margin-top:2px">' + d2 + '</div>' +
    '</div>';
  }

  html += '</div></div>' +
    (top5.length > 0 ?
      '<div class="card" style="padding:1.25rem">' +
        '<div style="font-weight:700;font-size:0.9rem;margin-bottom:1rem">🏆 Top Produtos -- ' + mesNome + '</div>' +
        top5.map(function(p, i) {
          var medalhas = ['🥇','🥈','🥉','4️⃣','5️⃣'];
          var pctBar = top5[0].qtd > 0 ? Math.round((p.qtd / top5[0].qtd) * 100) : 0;
          return '<div style="margin-bottom:12px">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
              '<div style="font-size:0.82rem;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + medalhas[i] + ' ' + esc(p.nome) + '</div>' +
              '<div style="font-size:0.78rem;color:var(--text2);margin-left:8px;flex-shrink:0">' + p.qtd + ' un</div>' +
            '</div>' +
            '<div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">' +
              '<div style="height:100%;width:' + pctBar + '%;background:#f4630a;border-radius:3px"></div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>'
    : '');

  el.innerHTML = html;
}

function renderVendas() {
  var tab = _vendaTab || 'ml';
  var mlConectado     = mlTokenValid();
  var shopeeConectado = shopeeTokenValid();

  var dotML     = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#FFE600;border:1.5px solid #e0c900;flex-shrink:0"></span>';
  var dotShopee = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f4630a;border:1.5px solid #d4530a;flex-shrink:0"></span>';
  var dotComb   = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,#FFE600 50%,#f4630a 50%);border:1.5px solid #ccc;flex-shrink:0"></span>';

  function tabStyle(t) {
    var ativo = tab === t;
    var cor   = t === 'ml' ? 'var(--green)' : t === 'shopee' ? '#f4630a' : 'var(--blue)';
    return 'display:flex;align-items:center;gap:6px;padding:0.65rem 1.25rem;background:none;border:none;border-bottom:' +
      (ativo ? '3px solid ' + cor + ';color:' + cor + ';font-weight:600' : 'none;color:var(--text2)') +
      ';cursor:pointer;font-size:0.9rem;margin-bottom:-2px';
  }

  return '<div id="vendas-content">' +
    '<div style="display:flex;border-bottom:2px solid var(--border);margin-bottom:1.5rem">' +
      '<button onclick="vendasSetTab(\'ml\')" style="' + tabStyle('ml') + '">' + dotML + ' Mercado Livre</button>' +
      '<button onclick="vendasSetTab(\'shopee\')" style="' + tabStyle('shopee') + '">' + dotShopee + ' Shopee</button>' +
      ((mlConectado && shopeeConectado) ?
        '<button onclick="vendasSetTab(\'combinado\')" style="' + tabStyle('combinado') + '">' + dotComb + ' Combinado</button>' : '') +
    '</div>' +
    '<div id="ml-tab-content"' + (tab === 'ml' ? '' : ' style="display:none"') + '>' +
      '<div class="card" style="text-align:center;padding:2rem"><p style="color:var(--text2)">Carregando Mercado Livre...</p></div>' +
    '</div>' +
    '<div id="shopee-content"' + (tab === 'shopee' ? '' : ' style="display:none"') + '>' +
      '<div class="card" style="text-align:center;padding:2rem"><p style="color:var(--text2)">Carregando Shopee...</p></div>' +
    '</div>' +
    '<div id="combinado-content"' + (tab === 'combinado' ? '' : ' style="display:none"') + '>' +
      '<div class="card" style="text-align:center;padding:2rem"><p style="color:var(--text2)">Carregando dados combinados...</p></div>' +
    '</div>' +
  '</div>';
}

function vendasSetTab(tab) {
  _vendaTab = tab;
  navigate('vendas');
}

function mlAtualizar() {
  _mlCache = null;
  localStorage.removeItem('costa_ml_cache');
  // Limpa também no Firebase
  fetch(FIREBASE_URL + '/vendas_cache/costa_ml_cache.json', { method: 'DELETE' }).catch(function(){});
  navigate('vendas');
}

async function bindVendas() {
  var tab = _vendaTab || 'ml';

  // Tenta carregar cache do Firebase se não tem local válido
  if (!vendaCacheValido(_mlCache)) {
    var fbMl = await vendaCarregarCacheFirebase('costa_ml_cache');
    if (fbMl) _mlCache = fbMl;
  }
  if (!vendaCacheValido(_shopeeCache)) {
    var fbSh = await vendaCarregarCacheFirebase('costa_shopee_cache');
    if (fbSh) _shopeeCache = fbSh;
  }

  // ML
  var mlEl = document.getElementById('ml-tab-content');
  if (mlEl) {
    if (!mlTokenValid()) {
      mlEl.innerHTML = mlAuthHtml();
    } else if (vendaCacheValido(_mlCache)) {
      mlEl.innerHTML = mlDashHtml(_mlCache.data);
    } else if (tab === 'ml') {
      mlEl.innerHTML = '<div class="card" style="text-align:center;padding:2rem"><p style="color:var(--text2);margin-bottom:1rem">Carregando pedidos...</p><div id="vendas-progress"></div><div id="vendas-loading" style="color:var(--text3);font-size:0.85rem"></div></div>';
      try {
        var result = await mlFetchVendas();
        _mlCache = { data: result, loadedAt: Date.now() }; vendaSalvarCache('costa_ml_cache', _mlCache);
        mlEl.innerHTML = mlDashHtml(result);
      } catch(e) {
        var isAuthError = e.message.includes('401') || e.message.includes('token');
        if (isAuthError) { localStorage.removeItem('ml_token'); _mlToken = null; state.mlToken = null; mlEl.innerHTML = mlAuthHtml(); }
        else mlEl.innerHTML = mlErrorHtml('Erro: ' + e.message);
      }
    } else {
      mlFetchVendas().then(function(result) {
        _mlCache = { data: result, loadedAt: Date.now() }; vendaSalvarCache('costa_ml_cache', _mlCache);
        var el = document.getElementById('ml-tab-content');
        if (el) el.innerHTML = mlDashHtml(result);
      }).catch(function(){});
    }
  }

  if (tab === 'shopee')    shopeeCarregarVendas(false);
  if (tab === 'combinado') vendasCarregarCombinado(false);
}

async function vendasCarregarCombinado(forcar) {
  var el = document.getElementById('combinado-content');
  if (!el) return;

  var mlOk     = mlTokenValid();
  var shopeeOk = shopeeTokenValid();

  if (!mlOk && !shopeeOk) {
    el.innerHTML = '<div class="card" style="text-align:center;padding:2rem">Conecte ao menos uma plataforma.</div>';
    return;
  }

  // Usa cache se ambos válidos
  if (!forcar && vendaCacheValido(_mlCache) && (!shopeeOk || vendaCacheValido(_shopeeCache))) {
    renderCombinado(el);
    return;
  }

  el.innerHTML = '<div class="card" style="text-align:center;padding:2rem"><p style="color:var(--text2)">Carregando dados combinados...</p></div>';

  try {
    if (mlOk && !vendaCacheValido(_mlCache)) {
      var r = await mlFetchVendas();
      _mlCache = { data: r, loadedAt: Date.now() }; vendaSalvarCache('costa_ml_cache', _mlCache);
    }
    if (shopeeOk && !vendaCacheValido(_shopeeCache)) {
      await shopeeCarregarDados();
    }
    renderCombinado(el);
  } catch(e) {
    el.innerHTML = '<div class="card" style="text-align:center;padding:2rem;color:var(--red)">⚠ ' + esc(e.message) + '</div>';
  }
}

function renderCombinado(el) {
  var nomesMes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var mesNome  = nomesMes[new Date().getMonth()];
  var diasNoMes = new Date().getDate();

  var mlOk     = mlTokenValid() && vendaCacheValido(_mlCache);
  var shopeeOk = shopeeTokenValid() && vendaCacheValido(_shopeeCache);

  var mlData     = mlOk     ? _mlCache.data     : null;
  var shopeeData = shopeeOk ? _shopeeCache.data  : null;

  var mlHoje    = mlData     ? (mlData.totalPedidosDia  || 0) : 0;
  var shHoje    = shopeeData ? (shopeeData.pedidosHoje   || 0) : 0;
  var mlMes     = mlData     ? (mlData.totalPedidosMes  || 0) : 0;
  var shMes     = shopeeData ? (shopeeData.totalPedidos  || 0) : 0;
  var mlFat     = mlData     ? (mlData.totalVendidoMes  || 0) : 0;
  var shFat     = shopeeData ? (shopeeData.totalFaturado || 0) : 0;
  var mlFatHoje = mlData     ? (mlData.totalVendidoDia  || 0) : 0;
  var shFatHoje = shopeeData ? (shopeeData.faturadoHoje  || 0) : 0;

  var totalMes    = mlMes + shMes;
  var totalFatMes = mlFat + shFat;
  var totalHoje   = mlHoje + shHoje;
  var totalFatH   = mlFatHoje + shFatHoje;

  var dotML     = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#FFE600;margin-right:4px"></span>';
  var dotSh     = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f4630a;margin-right:4px"></span>';

  var html =
    '<div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:1.25rem">' +
      '<button class="btn btn-sm" onclick="vendasCarregarCombinado(true)">🔄 Atualizar</button>' +
    '</div>' +

    // Cards hoje
    '<div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:0.5rem">Hoje</div>' +
    '<div class="stats-grid" style="margin-bottom:1.25rem">' +
      (mlOk ? '<div class="stat-card"><div class="stat-label">' + dotML + 'Pedidos ML Hoje</div><div class="stat-value" style="color:var(--green)">' + mlHoje + '</div><div style="font-size:0.78rem;color:var(--text3)">R$ ' + mlFatHoje.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' : '') +
      (shopeeOk ? '<div class="stat-card"><div class="stat-label">' + dotSh + 'Pedidos Shopee Hoje</div><div class="stat-value" style="color:#f4630a">' + shHoje + '</div><div style="font-size:0.78rem;color:var(--text3)">R$ ' + shFatHoje.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' : '') +
      '<div class="stat-card"><div class="stat-label">🛒 Total Hoje</div><div class="stat-value">' + totalHoje + '</div><div style="font-size:0.78rem;color:var(--text3)">R$ ' + totalFatH.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' +
    '</div>' +

    // Cards mês
    '<div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:0.5rem">' + mesNome + '</div>' +
    '<div class="stats-grid" style="margin-bottom:1.5rem">' +
      (mlOk ? '<div class="stat-card"><div class="stat-label">' + dotML + 'Pedidos ML</div><div class="stat-value" style="color:var(--green)">' + mlMes + '</div><div style="font-size:0.78rem;color:var(--text3)">R$ ' + mlFat.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' : '') +
      (shopeeOk ? '<div class="stat-card"><div class="stat-label">' + dotSh + 'Pedidos Shopee</div><div class="stat-value" style="color:#f4630a">' + shMes + '</div><div style="font-size:0.78rem;color:var(--text3)">R$ ' + shFat.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' : '') +
      '<div class="stat-card"><div class="stat-label">📦 Total Mês</div><div class="stat-value">' + totalMes + '</div><div style="font-size:0.78rem;color:var(--text3)">R$ ' + totalFatMes.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">🎯 Ticket Médio</div><div class="stat-value">R$ ' + (totalMes > 0 ? (totalFatMes/totalMes).toLocaleString('pt-BR',{minimumFractionDigits:2}) : '0,00') + '</div></div>' +
    '</div>' +

    // Gráfico combinado
    '<div class="card" style="padding:1.25rem;margin-bottom:1.25rem">' +
      '<div style="font-weight:700;font-size:0.9rem;margin-bottom:0.5rem">📈 Pedidos por Dia -- ' + mesNome + '</div>' +
      '<div style="display:flex;gap:12px;margin-bottom:0.75rem;font-size:0.75rem">' +
        (mlOk ? '<span>' + dotML + 'ML</span>' : '') +
        (shopeeOk ? '<span>' + dotSh + 'Shopee</span>' : '') +
        '<span style="color:var(--text3)">● Total</span>' +
      '</div>' +
      '<div style="position:relative;height:160px;display:flex;align-items:flex-end;gap:3px;padding-bottom:20px">';

  // Monta dados por dia combinados
  var mlPorDia    = mlData     ? (mlData.pedidosPorDia     || {}) : {};
  var shopeePorDia = shopeeData ? (shopeeData.pedidosPorDia || {}) : {};
  var combPorDia  = {};
  for (var d = 1; d <= diasNoMes; d++) {
    combPorDia[d] = (mlPorDia[d] || 0) + (shopeePorDia[d] || 0);
  }
  var maxDia = Math.max.apply(null, Object.values(combPorDia).concat([1]));

  for (var d2 = 1; d2 <= diasNoMes; d2++) {
    var total   = combPorDia[d2] || 0;
    var mlQ     = mlPorDia[d2]    || 0;
    var shQ     = shopeePorDia[d2] || 0;
    var pct     = Math.round((total / maxDia) * 130);
    var mlPct   = total > 0 ? Math.round((mlQ / total) * pct) : 0;
    var shPct   = pct - mlPct;
    var isHoje  = d2 === new Date().getDate();
    html +=
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0">' +
        (total > 0 ? '<div style="font-size:0.55rem;color:var(--text3)">' + total + '</div>' : '<div style="font-size:0.55rem;color:transparent">0</div>') +
        '<div style="width:100%;display:flex;flex-direction:column;border-radius:3px 3px 0 0;overflow:hidden;opacity:' + (isHoje?'1':'0.85') + ';min-height:2px">' +
          (mlOk && mlPct > 0 ? '<div style="height:' + mlPct + 'px;background:#FFE600"></div>' : '') +
          (shopeeOk && shPct > 0 ? '<div style="height:' + shPct + 'px;background:#f4630a"></div>' : '') +
          (total === 0 ? '<div style="height:2px;background:var(--border)"></div>' : '') +
        '</div>' +
        '<div style="font-size:0.55rem;color:var(--text3);margin-top:2px">' + d2 + '</div>' +
      '</div>';
  }

  html += '</div></div>';
  el.innerHTML = html;
}

// Extrai e salva dados da Shopee no cache
async function shopeeCarregarDados() {
  var now       = Math.floor(Date.now() / 1000);
  var dtInicio  = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  var inicioMes = Math.floor(dtInicio.getTime() / 1000);
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  var hojeTs = Math.floor(hoje.getTime() / 1000);

  var allOrders = [];
  var cursor = '';
  for (var pg = 0; pg < 20; pg++) {
    var params = { time_range_field:'create_time', time_from:inicioMes, time_to:now, page_size:100, response_optional_fields:'order_status' };
    if (cursor) params.cursor = cursor;
    var resp = await shopeeGet('/api/v2/order/get_order_list', params);
    var list = (resp.response && resp.response.order_list) ? resp.response.order_list : [];
    allOrders = allOrders.concat(list);
    if (!resp.response || !resp.response.more || !resp.response.next_cursor) break;
    cursor = resp.response.next_cursor;
  }

  var totalFaturado = 0, pedidosHoje = 0, faturadoHoje = 0;
  var pedidosPorDia = {}, prodRanking = {};
  var diasNoMes = new Date().getDate();
  for (var d = 1; d <= diasNoMes; d++) pedidosPorDia[d] = 0;

  if (allOrders.length > 0) {
    var chunks = [];
    for (var i = 0; i < allOrders.length; i += 50)
      chunks.push(allOrders.slice(i, i+50).map(function(o){ return o.order_sn; }));
    for (var ci = 0; ci < chunks.length; ci++) {
      var det = await shopeeGet('/api/v2/order/get_order_detail', { order_sn_list: chunks[ci].join(','), response_optional_fields:'total_amount,create_time,item_list' });
      if (!det.response || !det.response.order_list) continue;
      det.response.order_list.forEach(function(o) {
        var val = parseFloat(o.total_amount || 0);
        var ts  = o.create_time || 0;
        totalFaturado += val;
        var dtPed = new Date(ts * 1000);
        if (dtPed.getMonth() === new Date().getMonth() && dtPed.getFullYear() === new Date().getFullYear()) {
          var dia = dtPed.getDate();
          pedidosPorDia[dia] = (pedidosPorDia[dia] || 0) + 1;
        }
        if (ts >= hojeTs) { pedidosHoje++; faturadoHoje += val; }
        if (o.item_list) {
          o.item_list.forEach(function(item) {
            var nome = item.item_name || 'Produto';
            var qtd  = item.model_quantity_purchased || 1;
            if (!prodRanking[nome]) prodRanking[nome] = { qtd: 0, receita: 0 };
            prodRanking[nome].qtd += qtd;
            prodRanking[nome].receita += val;
          });
        }
      });
    }
  }

  var data = { totalPedidos: allOrders.length, totalFaturado, pedidosHoje, faturadoHoje, pedidosPorDia, prodRanking };
  _shopeeCache = { data, loadedAt: Date.now() }; vendaSalvarCache('costa_shopee_cache', _shopeeCache);
  return data;
}

function mlAuthHtml() {
  var authUrl = 'https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=' + ML_CLIENT_ID + '&redirect_uri=' + encodeURIComponent(ML_REDIRECT_URI);
  return '<div class="card" style="max-width:480px;margin:0 auto;text-align:center;padding:2.5rem">' +
    '<div style="font-size:2.5rem;margin-bottom:1rem">🔐</div>' +
    '<h3 style="margin-bottom:0.5rem">Conectar Mercado Livre</h3>' +
    '<p style="color:var(--text2);font-size:0.9rem;margin-bottom:1.5rem">Clique abaixo para autorizar a Plataforma Costa a acessar seus pedidos.</p>' +
    '<a href="' + authUrl + '" class="btn btn-green" style="display:inline-flex;padding:0.75rem 2rem;font-size:1rem;text-decoration:none">🔗 Conectar com Mercado Livre</a>' +
  '</div>';
}

function mlErrorHtml(msg) {
  return '<div class="card" style="border-color:var(--red);text-align:center;padding:2rem">' +
    '<div style="color:var(--red);font-size:0.95rem">⚠ ' + esc(msg) + '</div>' +
    '<button class="btn btn-sm" style="margin-top:1rem" onclick="navigate(\'vendas\')">Tentar novamente</button>' +
  '</div>';
}

function mlProdMap(orders) {
  var map = {};
  orders.forEach(function(o) {
    if (!o.order_items) return;
    o.order_items.forEach(function(item) {
      var title = item.item ? item.item.title : 'Produto';
      map[title] = (map[title] || 0) + (item.quantity || 1);
    });
  });
  return map;
}

function mlDashHtml(result) {
  var orders      = result.orders;
  var ordersMonth = result.ordersMonth;
  var me          = result.me;
  var now         = new Date();
  var monthName   = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  // Day stats
  var totalPedidosDia = result.totalDay;
  var totalVendidoDia = orders.reduce(function(s,o){ return s+(o.total_amount||0); }, 0);
  var totalItensDia   = orders.reduce(function(s,o){
    return s+(o.order_items ? o.order_items.reduce(function(ss,i){ return ss+(i.quantity||0); },0) : 0);
  }, 0);

  // Month stats
  var totalPedidosMes = result.totalMonth;
  var totalVendidoMes = ordersMonth.reduce(function(s,o){ return s+(o.total_amount||0); }, 0);

  // Monthly chart data -- orders per day of month
  var daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
  var chartData = new Array(daysInMonth).fill(0);
  var pedidosPorDia = {};
  ordersMonth.forEach(function(o) {
    if (!o.date_created) return;
    var dt = new Date(o.date_created);
    var d = dt.getDate() - 1;
    if (d >= 0 && d < daysInMonth) chartData[d]++;
    var dia = dt.getDate();
    pedidosPorDia[dia] = (pedidosPorDia[dia] || 0) + 1;
  });

  // Salva no cache com todos os dados para o combinado
  if (_mlCache) {
    _mlCache.data.pedidosPorDia   = pedidosPorDia;
    _mlCache.data.totalPedidosDia = totalPedidosDia;
    _mlCache.data.totalPedidosMes = totalPedidosMes;
    _mlCache.data.totalVendidoMes = totalVendidoMes;
    _mlCache.data.totalVendidoDia = totalVendidoDia;
    vendaSalvarCache('costa_ml_cache', _mlCache);
  }

  var maxVal = Math.max.apply(null, chartData) || 1;

  // Top 5 month products
  var monthProdMap = mlProdMap(ordersMonth);
  var topMes = Object.entries(monthProdMap).sort(function(a,b){ return b[1]-a[1]; }).slice(0,5);
  var maxProd = topMes.length ? topMes[0][1] : 1;

  // Top 5 day products
  var dayProdMap = mlProdMap(orders);
  var topDia = Object.entries(dayProdMap).sort(function(a,b){ return b[1]-a[1]; }).slice(0,5);

  var html = '<div style="margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center">' +
    '<span style="font-size:0.85rem;color:var(--text3)">Olá, <b>' + esc(me.nickname||me.first_name||'') + '</b> . Mercado Livre v</span>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-sm" onclick="mlAtualizar()">🔄 Atualizar</button>' +
      '<button class="btn btn-sm btn-red" onclick="mlDesconectar()">Desconectar</button>' +
    '</div>' +
  '</div>' +

  // Day cards
  '<div style="margin-bottom:0.5rem;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Hoje -- ' + now.toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'}) + '</div>' +
  '<div class="stats-grid" style="margin-bottom:1.25rem">' +
    '<div class="stat-card"><div class="stat-icon">🛍️</div><div class="stat-label">Pedidos Hoje</div><div class="stat-value">' + totalPedidosDia + '</div></div>' +
    '<div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">Faturado Hoje</div><div class="stat-value">R$ ' + totalVendidoDia.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' +
    '<div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">Itens Hoje</div><div class="stat-value">' + totalItensDia + '</div></div>' +
  '</div>' +

  // Month cards
  '<div style="margin-bottom:0.5rem;font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">' + monthName.charAt(0).toUpperCase()+monthName.slice(1) + '</div>' +
  '<div class="stats-grid" style="margin-bottom:1.25rem">' +
    '<div class="stat-card"><div class="stat-icon">📅</div><div class="stat-label">Pedidos no Mês</div><div class="stat-value">' + totalPedidosMes + '</div></div>' +
    '<div class="stat-card"><div class="stat-icon">💵</div><div class="stat-label">Faturado no Mês</div><div class="stat-value">R$ ' + totalVendidoMes.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</div></div>' +
  '</div>' +

  // Monthly chart
  '<div class="card" style="margin-bottom:1.25rem">' +
    '<div class="card-header"><span class="card-title">📈 Pedidos por Dia -- ' + monthName.charAt(0).toUpperCase()+monthName.slice(1) + '</span></div>' +
    '<div style="display:flex;align-items:flex-end;gap:3px;height:100px;padding:8px 0">';

  chartData.forEach(function(val, idx) {
    var barH = Math.round((val / maxVal) * 84);
    var isToday = idx === now.getDate() - 1;
    var color = isToday ? 'var(--green)' : 'var(--blue,#3b82f6)';
    if (barH === 0) barH = 2;
    html += '<div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:2px">' +
      '<div style="font-size:9px;color:var(--text3)">' + (val||'') + '</div>' +
      '<div style="width:100%;background:' + color + ';border-radius:3px 3px 0 0;height:' + barH + 'px;opacity:' + (isToday?'1':'0.7') + '" title="Dia ' + (idx+1) + ': ' + val + ' pedidos"></div>' +
      '<div style="font-size:8px;color:' + (isToday?'var(--green)':'var(--text3)') + ';font-weight:' + (isToday?'700':'400') + '">' + (idx+1) + '</div>' +
    '</div>';
  });

  html += '</div></div>' +

  // Two columns: ranking + orders list
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem;margin-bottom:1.25rem">' +

  // Top 5 month ranking
  '<div class="card">' +
    '<div class="card-header"><span class="card-title">🏆 Top 5 do Mês</span></div>';

  if (!topMes.length) {
    html += '<div class="empty-state" style="padding:1rem">' + iconEmpty() + '<p>Sem dados</p></div>';
  } else {
    var medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    topMes.forEach(function(p, i) {
      var barW = Math.round((p[1]/maxProd)*100);
      html += '<div style="margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
          '<span style="font-size:1rem">' + medals[i] + '</span>' +
          '<span style="flex:1;font-size:0.8rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p[0]) + '">' + esc(p[0]) + '</span>' +
          '<span style="font-size:0.8rem;font-weight:700;color:var(--green);white-space:nowrap">' + p[1] + ' un.</span>' +
        '</div>' +
        '<div style="background:var(--bg3);border-radius:99px;height:6px">' +
          '<div style="background:var(--green);border-radius:99px;height:6px;width:' + barW + '%"></div>' +
        '</div>' +
      '</div>';
    });
  }
  html += '</div>' +

  // Top 5 today
  '<div class="card">' +
    '<div class="card-header"><span class="card-title">⚡ Top 5 Hoje</span></div>';

  if (!topDia.length) {
    html += '<div class="empty-state" style="padding:1rem">' + iconEmpty() + '<p>Sem vendas hoje</p></div>';
  } else {
    var maxDia = topDia[0][1];
    var medalsDia = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    topDia.forEach(function(p, i) {
      var barW = Math.round((p[1]/maxDia)*100);
      html += '<div style="margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
          '<span style="font-size:1rem">' + medalsDia[i] + '</span>' +
          '<span style="flex:1;font-size:0.8rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p[0]) + '">' + esc(p[0]) + '</span>' +
          '<span style="font-size:0.8rem;font-weight:700;color:var(--green);white-space:nowrap">' + p[1] + ' un.</span>' +
        '</div>' +
        '<div style="background:var(--bg3);border-radius:99px;height:6px">' +
          '<div style="background:var(--amber,#f59e0b);border-radius:99px;height:6px;width:' + barW + '%"></div>' +
        '</div>' +
      '</div>';
    });
  }
  html += '</div></div>' +

  // Orders list today
  '<div class="card"><div class="card-header"><span class="card-title">📋 Pedidos de Hoje</span></div>';

  if (!orders.length) {
    html += '<div class="empty-state">' + iconEmpty() + '<p>Nenhum pedido hoje ainda</p></div>';
  } else {
    orders.forEach(function(o) {
      var items = o.order_items ? o.order_items.map(function(i){ return (i.quantity||1)+'x '+(i.item?i.item.title:''); }).join(', ') : '';
      var hora = o.date_created ? new Date(o.date_created).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
      var statusColor = {paid:'var(--green)',cancelled:'var(--red)',pending:'var(--amber)'};
      var statusLabel = {paid:'Pago',cancelled:'Cancelado',pending:'Pendente'};
      var st = o.status||'paid';
      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<span style="font-size:0.75rem;color:var(--text3);min-width:40px">' + hora + '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:0.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(items) + '</div>' +
          '<div style="font-size:0.75rem;color:var(--text3)">Pedido #' + o.id + '</div>' +
        '</div>' +
        '<span style="font-size:0.8rem;font-weight:600;color:' + (statusColor[st]||'var(--text2)') + '">' + (statusLabel[st]||st) + '</span>' +
        '<span style="font-size:0.85rem;font-weight:700;white-space:nowrap">R$ ' + (o.total_amount||0).toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</span>' +
      '</div>';
    });
  }
  html += '</div>';
  return html;
}

function mlDesconectar() {
  localStorage.removeItem('ml_token');
  _mlToken = null;
  state.mlToken = null;
  saveState();
  navigate('margemviva');
}
