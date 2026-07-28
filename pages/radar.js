// --- MARGEM EM TEMPO REAL --------------------------------------------------------
var _mgvLoading = false;
var _mgvDados = null;       // { sku: { ml: preco|null, shopee: preco|null, tiktok: preco|null } }
var _mgvErro = '';
var _mgvAtualizadoEm = null;

// Variáveis globais do Financeiro/Marketplaces (declaradas aqui pois radar.js é carregado antes)
if (typeof _finLoaded === 'undefined')  window._finLoaded  = false;
if (typeof _finMesSel === 'undefined')  window._finMesSel  = '';
var _mgvPrecosTt = {};      // { sku: preco } -- preços manuais TikTok, persistidos no Firebase
var _mgvTab = 'resumo'; // 'resumo' | 'ml' | 'shopee' | 'tiktok'
var _mgvDebug = [];

function mgvAplicaImposto() { return 10; } // 10% fixo, conforme solicitado

function mgvSalvarFirebase() {
  fetch(FIREBASE_URL + '/radar.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dados: _mgvDados, atualizadoEm: _mgvAtualizadoEm ? _mgvAtualizadoEm.toISOString() : null, precosTt: _mgvPrecosTt })
  }).catch(function(){});
}

function mgvCarregarFirebase() {
  return fetch(FIREBASE_URL + '/radar.json')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (data && data.dados) {
        _mgvDados = data.dados;
        _mgvAtualizadoEm = data.atualizadoEm ? new Date(data.atualizadoEm) : null;
      }
      if (data && data.precosTt) _mgvPrecosTt = data.precosTt;
    })
    .catch(function(){});
}

function mgvSalvarPrecoTt(sku, valor) {
  var v = parseFloat(String(valor).replace(',', '.')) || 0;
  if (v > 0) _mgvPrecosTt[sku] = v;
  else delete _mgvPrecosTt[sku];
  mgvSalvarFirebase();
  // Atualiza também _mgvDados.tiktok para refletir imediatamente
  if (_mgvDados) {
    if (v > 0) _mgvDados.tiktok[sku] = v;
    else delete _mgvDados.tiktok[sku];
  }
  var c = document.getElementById('page-content');
  if (c && state.currentPage === 'margemviva') c.innerHTML = renderMargemViva();
}

// Busca todos os preços ativos no Mercado Livre (paginado) e retorna { sku: preco }
async function mgvBuscarPrecosML() {
  var out = {};
  if (!mlTokenValid()) return out;
  var me = await mlGet('/users/me');
  var sellerId = me.id;
  var offset = 0, limit = 50, total = 1;
  var ids = [];
  while (offset < total) {
    var r = await mlGet('/users/' + sellerId + '/items/search?status=active&offset=' + offset + '&limit=' + limit);
    total = r.paging ? r.paging.total : 0;
    ids = ids.concat(r.results || []);
    offset += limit;
    if (!r.results || !r.results.length) break;
  }
  _mgvDebug.push('ML: ' + ids.length + ' anúncios ativos encontrados na conta.');
  _mgvDebug.push('ML: usando preço de venda real (sale_price), já considerando promoções ativas.');
  var semSku = 0;

  // Busca o valor do atributo SELLER_SKU dentro de um array de attributes
  function getSellerSkuAttr(attrs) {
    if (!attrs || !attrs.length) return '';
    var found = attrs.find(function(a){ return a.id === 'SELLER_SKU'; });
    return found && found.value_name ? found.value_name.toString().trim().toLowerCase() : '';
  }

  // 1ª etapa: descobre o SKU de cada item/variação (sem se importar com o preço ainda)
  var itemsParaPreco = []; // [{ sku, itemId, variationId|null }]
  for (var i = 0; i < ids.length; i += 20) {
    var batch = ids.slice(i, i+20);
    var multi = await mlGet('/items?ids=' + batch.join(',') + '&attributes=id,price,attributes,seller_custom_field,variations');
    multi.forEach(function(entry) {
      var item = entry.body || entry;
      if (!item) return;
      var sku = getSellerSkuAttr(item.attributes);
      if (!sku) sku = (item.seller_custom_field || '').toString().trim().toLowerCase();

      var achouVariacao = false;
      if (item.variations && item.variations.length) {
        item.variations.forEach(function(v) {
          var vsku = getSellerSkuAttr(v.attributes) || (v.seller_custom_field || v.seller_sku || '').toString().trim().toLowerCase();
          if (vsku) { itemsParaPreco.push({ sku: vsku, itemId: item.id, variationId: v.id, fallbackPrice: v.price }); achouVariacao = true; }
        });
      }
      if (!sku && !achouVariacao) semSku++;
      if (sku) itemsParaPreco.push({ sku: sku, itemId: item.id, variationId: null, fallbackPrice: item.price });
    });
  }

  // 2ª etapa: busca o preço REAL de venda (já considerando promoções) via /items/{id}/sale_price
  // Processa em lotes pequenos para não sobrecarregar o proxy
  var skuParaItems = {}; // diagnóstico: sku -> [{id, price}]
  var loteSize = 8;
  for (var j = 0; j < itemsParaPreco.length; j += loteSize) {
    var lote = itemsParaPreco.slice(j, j+loteSize);
    await Promise.all(lote.map(async function(entry) {
      var precoFinal = entry.fallbackPrice;
      try {
        var sp = await mlGet('/items/' + entry.itemId + '/sale_price?context=channel_marketplace');
        if (sp && typeof sp.amount === 'number') precoFinal = sp.amount;
      } catch(e) {
        // se a chamada falhar (ex: item sem sale_price disponível), mantém o fallback (price normal)
      }
      if (precoFinal) {
        out[entry.sku] = precoFinal;
        if (!skuParaItems[entry.sku]) skuParaItems[entry.sku] = [];
        skuParaItems[entry.sku].push({ id: entry.itemId, price: precoFinal });
      }
    }));
  }

  // Diagnóstico: alerta se o mesmo SKU aparecer em mais de um anúncio (preço pode estar sendo sobrescrito)
  Object.keys(skuParaItems).forEach(function(sku){
    var lista = skuParaItems[sku];
    if (lista.length > 1) {
      var detalhe = lista.map(function(x){ return x.id + ' (R$ ' + x.price.toFixed(2) + ')'; }).join(', ');
      _mgvDebug.push('⚠ ML: SKU "' + sku + '" aparece em ' + lista.length + ' anúncios diferentes: ' + detalhe + ' — usando o último: R$ ' + out[sku].toFixed(2));
    }
  });
  if (semSku > 0) _mgvDebug.push('ML: ' + semSku + ' anúncio(s) sem SKU preenchido no ML — não entram no cálculo.');
  var skusEncontrados = Object.keys(out);
  if (skusEncontrados.length) _mgvDebug.push('ML: SKUs lidos: ' + skusEncontrados.join(', '));
  var noCatalogo = skusEncontrados.filter(function(s){ return !PRODUTOS_CUSTO.some(function(p){ return p.sku===s; }); });
  if (noCatalogo.length) _mgvDebug.push('ML: SKUs encontrados mas fora do catálogo: ' + noCatalogo.join(', '));

  // 3ª etapa: busca a tarifa de venda (% comissão) para cada item via listing_prices
  // Usamos listing_type_id e category_id de cada item, que já vieram na 1ª etapa
  var tarifasML = {}; // { sku: pctComissao }
  var itemsMeta = {}; // { itemId: { listing_type_id, category_id, price } }
  for (var i2 = 0; i2 < ids.length; i2 += 20) {
    var batch2 = ids.slice(i2, i2+20);
    var multi2 = await mlGet('/items?ids=' + batch2.join(',') + '&attributes=id,listing_type_id,category_id,price,attributes,seller_custom_field,variations');
    multi2.forEach(function(entry) {
      var item = entry.body || entry;
      if (!item) return;
      itemsMeta[item.id] = { listing_type_id: item.listing_type_id, category_id: item.category_id, price: item.price };
    });
  }

  // Para cada SKU, busca a taxa usando o listing_type_id e category_id do anúncio correspondente
  for (var j2 = 0; j2 < itemsParaPreco.length; j2++) {
    var entry2 = itemsParaPreco[j2];
    var meta = itemsMeta[entry2.itemId];
    if (!meta || !entry2.sku || tarifasML[entry2.sku] !== undefined) continue;
    var precoParaTaxa = out[entry2.sku] || meta.price;
    if (!precoParaTaxa) continue;
    try {
      var fees = await mlGet('/sites/MLB/listing_prices?price=' + precoParaTaxa +
        '&listing_type_id=' + meta.listing_type_id +
        '&category_id=' + meta.category_id);
      var pct = (fees.sale_fee_details && fees.sale_fee_details.percentage_fee !== undefined)
        ? fees.sale_fee_details.percentage_fee
        : fees.sale_fee_amount / precoParaTaxa * 100;
      tarifasML[entry2.sku] = parseFloat(pct) || 0;
    } catch(e) {
      _mgvDebug.push('⚠ ML: erro ao buscar tarifa para ' + entry2.sku + ': ' + e.message);
    }
    await new Promise(function(r){ setTimeout(r, 100); }); // pequeno delay
  }
  _mgvDebug.push('ML: tarifas de venda carregadas para ' + Object.keys(tarifasML).length + ' SKU(s).');

  return { precos: out, tarifas: tarifasML };
}

// Calcula a tarifa de venda da Shopee pela tabela de faixas (CNPJ, vigente 28/02/2026)
function mgvTarifaShopee(preco) {
  if (!preco) return { pct: 0, fixo: 0 };
  if (preco <= 79.99)  return { pct: 20, fixo: 4  };
  if (preco <= 99.99)  return { pct: 14, fixo: 16 };
  if (preco <= 199.99) return { pct: 14, fixo: 20 };
  if (preco <= 499.99) return { pct: 14, fixo: 26 };
  return                      { pct: 14, fixo: 26 };
}


// Busca todos os preços ativos na Shopee e retorna { sku: preco }
async function mgvBuscarPrecosShopee() {
  var out = {};
  if (!shopeeTokenValid()) return out;
  var offset = 0, pageSize = 50, hasMore = true;
  var itemIds = [];
  while (hasMore) {
    var r = await shopeeGet('/api/v2/product/get_item_list', {
      offset: offset, page_size: pageSize, item_status: 'NORMAL'
    });
    var resp = r.response || {};
    (resp.item || []).forEach(function(it){ itemIds.push(it.item_id); });
    hasMore = resp.has_next_page;
    offset += pageSize;
    if (!resp.item || !resp.item.length) break;
  }
  _mgvDebug.push('Shopee: ' + itemIds.length + ' anúncios ativos encontrados na conta.');
  var semSkuSp = 0;
  var itemsComVariacao = []; // TODOS os item_id que têm model_list (variações) -- sempre vão para get_model_list
  var skuParaItemsSp = {}; // diagnóstico: sku -> [{id, price}]

  function registrarPreco(sku, preco, itemId) {
    if (!sku || !preco) return;
    out[sku] = preco;
    if (!skuParaItemsSp[sku]) skuParaItemsSp[sku] = [];
    skuParaItemsSp[sku].push({ id: itemId, price: preco });
  }

  for (var i = 0; i < itemIds.length; i += 50) {
    var batch = itemIds.slice(i, i+50);
    var det = await shopeeGet('/api/v2/product/get_item_base_info', { item_id_list: batch.join(',') });
    var lista = (det.response || {}).item_list || [];
    lista.forEach(function(item) {
      var temModelos = item.has_model || (item.model_list && item.model_list.length);
      // Item COM variações: o preço de cada variação NUNCA vem completo aqui.
      // Sempre buscar via get_model_list, que é o endpoint correto para isso.
      if (temModelos) {
        itemsComVariacao.push(item.item_id);
        return;
      }
      // Item SEM variações: usa o preço simples do item (já com desconto, se houver)
      var sku = (item.item_sku || '').toString().trim().toLowerCase();
      var preco = null;
      if (item.price_info && item.price_info.length) preco = item.price_info[0].current_price;
      if (!sku) semSkuSp++;
      if (sku && preco) registrarPreco(sku, preco, item.item_id);
    });
  }

  // Busca o preço real de cada variação via get_model_list (endpoint dedicado)
  if (itemsComVariacao.length) {
    _mgvDebug.push('Shopee: ' + itemsComVariacao.length + ' produto(s) com variação -- buscando preços via get_model_list.');
    for (var k = 0; k < itemsComVariacao.length; k++) {
      var itemId = itemsComVariacao[k];
      try {
        var modelResp = await shopeeGet('/api/v2/product/get_model_list', { item_id: itemId });
        var modelos = (modelResp.response || {}).model || [];
        if (!modelos.length) {
          _mgvDebug.push('Shopee: item ' + itemId + ' marcado com variação mas get_model_list não retornou modelos.');
        }
        modelos.forEach(function(m) {
          var msku = (m.model_sku || '').toString().trim().toLowerCase();
          var mpreco = null;
          if (m.price_info && m.price_info.length) mpreco = m.price_info[0].current_price;
          else if (m.price !== undefined && m.price !== null) mpreco = m.price;
          if (!msku) semSkuSp++;
          if (msku && mpreco) registrarPreco(msku, mpreco, itemId);
        });
      } catch(e) {
        _mgvDebug.push('Shopee: erro ao buscar variações do item ' + itemId + ': ' + e.message);
      }
    }
  }

  // Diagnóstico: alerta se o mesmo SKU aparecer em mais de um anúncio
  Object.keys(skuParaItemsSp).forEach(function(sku){
    var listaSp = skuParaItemsSp[sku];
    if (listaSp.length > 1) {
      var detalheSp = listaSp.map(function(x){ return x.id + ' (R$ ' + x.price.toFixed(2) + ')'; }).join(', ');
      _mgvDebug.push('⚠ Shopee: SKU "' + sku + '" aparece em ' + listaSp.length + ' anúncios/variações diferentes: ' + detalheSp + ' — usando o último: R$ ' + out[sku].toFixed(2));
    }
  });

  if (semSkuSp > 0) _mgvDebug.push('Shopee: ' + semSkuSp + ' variação/anúncio sem SKU preenchido na Shopee — não entram no cálculo.');
  var noCatalogoSp = Object.keys(out).filter(function(s){ return !PRODUTOS_CUSTO.some(function(p){ return p.sku===s; }); });
  if (noCatalogoSp.length) _mgvDebug.push('Shopee: SKUs encontrados mas fora do catálogo: ' + noCatalogoSp.join(', '));
  return out;
}

async function mgvAtualizarPrecos() {
  if (_mgvLoading) return;
  _mgvLoading = true;
  _mgvErro = '';
  _mgvDebug = [];
  var c = document.getElementById('page-content');
  if (c && state.currentPage === 'margemviva') c.innerHTML = renderMargemViva();

  // Força recarregar custos e tarifas atualizadas (não usa cache da primeira carga da página)
  try {
    await finLoadFirebase();
    _mgvDebug.push('Custos e tarifas recarregados do Firebase.');
  } catch(e) {
    _mgvDebug.push('⚠ Não foi possível recarregar custos/tarifas: ' + e.message);
  }

  var precosMl = {}, tarifasMl = {}, precosSp = {};
  try {
    if (mlTokenValid()) {
      var resultML = await mgvBuscarPrecosML();
      precosMl = resultML.precos || {};
      tarifasMl = resultML.tarifas || {};
      _mgvDebug.push('ML: ' + Object.keys(precosMl).length + ' SKUs com preço encontrados.');
    } else {
      _mgvDebug.push('ML: token não conectado/inválido (vá em Vendas e conecte).');
    }
  } catch(e) { _mgvErro += 'Mercado Livre: ' + e.message + '. '; }

  try {
    if (shopeeTokenValid()) {
      precosSp = await mgvBuscarPrecosShopee();
      _mgvDebug.push('Shopee: ' + Object.keys(precosSp).length + ' SKUs com preço encontrados.');
    } else {
      _mgvDebug.push('Shopee: token não conectado/inválido (vá em Vendas e conecte).');
    }
  } catch(e) { _mgvErro += 'Shopee: ' + e.message + '. '; }

  // TikTok: usa preços cadastrados manualmente no Radar
  var precosTt = {};
  Object.keys(_mgvPrecosTt).forEach(function(sku) {
    if (_mgvPrecosTt[sku] > 0) precosTt[sku] = _mgvPrecosTt[sku];
  });
  _mgvDebug.push('TikTok: ' + Object.keys(precosTt).length + ' SKUs com preço manual cadastrado.');

  _mgvDados = { ml: precosMl, shopee: precosSp, tiktok: precosTt, tarifasMl: tarifasMl };
  _mgvAtualizadoEm = new Date();
  _mgvLoading = false;
  mgvSalvarFirebase();

  var c2 = document.getElementById('page-content');
  if (c2 && state.currentPage === 'margemviva') c2.innerHTML = renderMargemViva();
}

var _mgvCarregado = false;

// Calcula o custo unitário atual de um produto SEMPRE com base na compra mais recente
// registrada no estoque (não depende do botão "Salvar" em Produtos ter sido clicado de novo).
// Se houver custo manual cadastrado (custoManual !== undefined), esse tem prioridade.
function mgvCustoAtual(sku) {
  var c = (state.financeiro.custoProdutos || {})[sku];
  if (c && c.custoManual !== undefined && c.custoManual !== null && c.custoManual !== '') {
    return parseFloat(c.custoManual) || 0; // custo manual sempre tem prioridade, não recalcula
  }
  var prod = PRODUTOS_CUSTO.find(function(p){ return p.sku === sku; });
  if (!prod) return null;
  var emb   = c ? (parseFloat(c.embalagem) || 0) : 0;
  var caixa = c ? (parseFloat(c.caixa) || 0) : 0;

  var hist = (state.estoque.historicoManual||[]).concat(
    (state.estoque.movimentacoes||[]).filter(function(m){ return m.tipo==='entrada' && m.totalKg>0; })
  );
  var maisRecente = null;
  hist.forEach(function(r){
    if (!r.totalKg) return;
    var nomeLow = (r.produto||'').toLowerCase();
    if (skuMatchHist(sku, nomeLow) && (!maisRecente || (r.dataISO||'') > (maisRecente.dataISO||''))) maisRecente = r;
  });
  if (maisRecente) {
    var precoKg = parseFloat(maisRecente.totalKg) || 0;
    return round4((precoKg * prod.peso / 1000) + emb + caixa);
  }
  // Sem histórico de compra: usa o custoFinal salvo, se existir, como último recurso
  return c && c.custoFinal !== undefined ? (parseFloat(c.custoFinal) || 0) : null;
}

function renderMargemViva() {
  if (!_mgvCarregado && !_mgvDados) {
    _mgvCarregado = true;
    mgvCarregarFirebase().then(function() {
      var c = document.getElementById('page-content');
      if (c && state.currentPage === 'margemviva') c.innerHTML = renderMargemViva();
    });
  }
  var _tarifasFaltando = Object.keys(state.financeiro.tarifasSku || {}).length === 0;
  if (!_finLoaded || _tarifasFaltando) {
    _finLoaded = true;
    finLoadFirebase().then(function() {
      var c = document.getElementById('page-content');
      if (c && state.currentPage === 'margemviva') c.innerHTML = renderMargemViva();
    });
    if (_tarifasFaltando) return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem;gap:1rem">'+
      '<div style="width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--green);border-radius:50%;animation:spin 0.7s linear infinite"></div>'+
      '<div style="color:var(--text2);font-size:0.9rem">Carregando custos e tarifas...</div>'+
    '</div>';
  }
  var tarifas = state.financeiro.tarifasSku || {};
  var custos  = state.financeiro.custoProdutos || {};
  var imposto = mgvAplicaImposto();

  // Diagnóstico: mostra quantas tarifas estão carregadas
  if (_mgvDados && Object.keys(tarifas).length === 0) {
    _mgvDebug.push('⚠ Tarifas manuais: nenhuma encontrada em state.financeiro.tarifasSku — verifique se o Financeiro carregou.');
  } else if (_mgvDados) {
    var comEnvio = Object.keys(tarifas).filter(function(s){ return tarifas[s] && tarifas[s]['ml'] && tarifas[s]['ml'].envio > 0; }).length;
    _mgvDebug.push('Tarifas carregadas: ' + Object.keys(tarifas).length + ' SKUs (' + comEnvio + ' com envio ML cadastrado).');
  }

  var mlOk = mlTokenValid();
  var spOk = shopeeTokenValid();

  var html = '<div class="card" style="padding:1rem 1.25rem;margin-bottom:1.25rem;display:flex;gap:24px;flex-wrap:wrap;align-items:center">' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem">' +
      '<span style="width:9px;height:9px;border-radius:50%;background:' + (mlOk?'var(--green)':'var(--red)') + '"></span>' +
      '<span>Mercado Livre: ' + (mlOk ? 'conectado' : 'desconectado') + '</span>' +
      (!mlOk ? '<a href="https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=' + ML_CLIENT_ID + '&redirect_uri=' + encodeURIComponent(ML_REDIRECT_URI) + '" class="btn btn-sm" style="padding:4px 10px;font-size:0.75rem;text-decoration:none">Conectar</a>' : '<button onclick="mlDesconectar()" class="btn btn-sm" style="padding:4px 10px;font-size:0.75rem">Desconectar</button>') +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem">' +
      '<span style="width:9px;height:9px;border-radius:50%;background:' + (spOk?'var(--green)':'var(--red)') + '"></span>' +
      '<span>Shopee: ' + (spOk ? 'conectado' : 'desconectado') + '</span>' +
      (!spOk ? '<button onclick="shopeeIniciarAuth()" class="btn btn-sm" style="padding:4px 10px;font-size:0.75rem">Conectar</button>' : '<button onclick="shopeeDesconectar()" class="btn btn-sm" style="padding:4px 10px;font-size:0.75rem">Desconectar</button>') +
    '</div>' +
  '</div>';

  html += '<div style="margin-bottom:1.25rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
    '<div style="font-size:0.85rem;color:var(--text3)">' +
      (_mgvAtualizadoEm ? 'Última atualização: ' + _mgvAtualizadoEm.toLocaleTimeString('pt-BR') : 'Clique em atualizar para buscar os preços atuais') +
    '</div>' +
    '<button class="btn btn-green" onclick="mgvAtualizarPrecos()" ' + (_mgvLoading?'disabled':'') + '>' +
      (_mgvLoading ? '⏳ Buscando preços...' : '🔄 Atualizar Preços') +
    '</button>' +
  '</div>';

  if (_mgvErro) {
    html += '<div style="background:rgba(220,38,38,0.08);border:0.5px solid rgba(220,38,38,0.25);border-radius:8px;padding:10px 14px;margin-bottom:1.25rem;font-size:0.83rem;color:var(--red)">⚠ ' + esc(_mgvErro) + '</div>';
  }

  if (_mgvDebug && _mgvDebug.length) {
    html += '<div style="background:var(--bg3);border:0.5px solid var(--border2);border-radius:8px;padding:10px 14px;margin-bottom:1.25rem;font-size:0.78rem;color:var(--text2);font-family:monospace">' +
      _mgvDebug.map(function(d){ return esc(d); }).join('<br>') +
    '</div>';
  }

  if (!mlOk && !spOk) {
    html += '<div class="empty-state">' + iconEmpty() + '<p>Conecte o Mercado Livre e/ou a Shopee usando os botões acima.</p></div>';
    return html;
  }

  if (!_mgvDados) {
    html += '<div class="empty-state">' + iconEmpty() + '<p>Clique em "Atualizar Preços" para buscar os valores atuais de cada produto.</p></div>';
    return html;
  }

  // Navegação por abas
  function tabBtn(id, label) {
    var active = _mgvTab === id;
    return '<button class="fin-tab' + (active?' active':'') + '" onclick="_mgvTab=\'' + id + '\';var c=document.getElementById(\'page-content\');if(c)c.innerHTML=renderMargemViva();" style="font-size:0.88rem">' + label + '</button>';
  }
  html += '<div class="fin-tabs" style="margin-bottom:1.25rem">' +
    tabBtn('resumo', '📊 Resumo') +
    tabBtn('ml', '🟡 Mercado Livre') +
    tabBtn('shopee', '🟠 Shopee') +
    tabBtn('tiktok', '⚫ TikTok') +
  '</div>';

  function calcMargem(sku, preco, plat) {
    if (!preco) return null;
    var custoUnit = mgvCustoAtual(sku);
    if (custoUnit === null || custoUnit === undefined) return { semCusto: true };

    var taxaVendaPct = 0, envioFixo = 0, tarifaAuto = false;

    if (plat === 'ml') {
      // Taxa de venda: via API (automática) ou fallback manual
      var pctML = _mgvDados && _mgvDados.tarifasMl ? _mgvDados.tarifasMl[sku] : null;
      var tManualML = tarifas[sku] && tarifas[sku]['ml'] ? tarifas[sku]['ml'] : null;
      if (pctML !== undefined && pctML !== null) {
        taxaVendaPct = pctML;
        tarifaAuto = true;
      } else if (tManualML) {
        taxaVendaPct = tManualML.pctVenda || 0;
      }
      // Tarifa de envio: sempre da configuração manual (API não retorna esse valor)
      envioFixo = tManualML ? (tManualML.envio || 0) : 0;
    } else if (plat === 'sp') {
      // Tarifa via tabela de faixas Shopee (CNPJ, vigente 28/02/2026)
      var faixaSp = mgvTarifaShopee(preco);
      taxaVendaPct = faixaSp.pct;
      envioFixo = faixaSp.fixo;
      tarifaAuto = true;
    } else {
      // TikTok: usa tarifa cadastrada manualmente
      var tTt = tarifas[sku] && tarifas[sku]['tt'] ? tarifas[sku]['tt'] : null;
      if (tTt) { taxaVendaPct = tTt.pctVenda || 0; envioFixo = tTt.envio || 0; }
    }

    var tarifaValor = preco * (taxaVendaPct / 100) + envioFixo;
    var impostoValor = preco * (imposto / 100);
    var lucro = preco - tarifaValor - custoUnit - impostoValor;
    var margem = preco > 0 ? (lucro / preco) * 100 : 0;
    return {
      lucro: lucro, margem: margem,
      tarifaValor: tarifaValor, taxaVendaPct: taxaVendaPct, envioFixo: envioFixo,
      impostoValor: impostoValor, custoUnit: custoUnit,
      temTarifa: taxaVendaPct > 0 || envioFixo > 0,
      tarifaAuto: tarifaAuto
    };
  }

  function corMargem(m) {
    if (m === null) return 'var(--text3)';
    if (m > 17) return '#8b5cf6';
    if (m >= 15) return 'var(--green)';
    if (m >= 10) return '#3b82f6';
    return 'var(--red)';
  }

  function fmtR$(v) { return v === null || v === undefined ? '—' : 'R$ ' + v.toFixed(2).replace('.', ','); }
  function fmtPct(v) { return v === null || v === undefined ? '—' : v.toFixed(1).replace('.', ',') + '%'; }

  var linhas = PRODUTOS_CUSTO.map(function(p) {
    var precoMl = (_mgvDados.ml || {})[p.sku] || null;
    var precoSp = (_mgvDados.shopee || {})[p.sku] || null;
    var precoTt = (_mgvPrecosTt[p.sku] || null);
    var mMl = calcMargem(p.sku, precoMl, 'ml');
    var mSp = calcMargem(p.sku, precoSp, 'sp');
    var mTt = calcMargem(p.sku, precoTt, 'tt');
    return { p: p, precoMl: precoMl, precoSp: precoSp, precoTt: precoTt, mMl: mMl, mSp: mSp, mTt: mTt };
  }).filter(function(l) { return l.precoMl || l.precoSp || l.precoTt; });

  if (!linhas.length) {
    html += '<div class="empty-state">' + iconEmpty() + '<p>Nenhum produto com preço encontrado. Verifique se os SKUs cadastrados nos anúncios coincidem com os SKUs da plataforma.</p></div>';
    return html;
  }

  // Abas detalhadas por plataforma (Valor de venda, Taxa, Tarifa de envio, Imposto, Custo, Lucro líquido, Margem)
  if (_mgvTab !== 'resumo') {
    var platMap = { ml: { key:'ml', precoField:'precoMl', mField:'mMl', emoji:'🟡', nome:'Mercado Livre' },
                    shopee: { key:'sp', precoField:'precoSp', mField:'mSp', emoji:'🟠', nome:'Shopee' },
                    tiktok: { key:'tt', precoField:'precoTt', mField:'mTt', emoji:'⚫', nome:'TikTok' } };
    var pm = platMap[_mgvTab];

    // Aba TikTok: mostra campos de edição de preço manual para todos os produtos do catálogo
    if (_mgvTab === 'tiktok') {
      html += '<div class="card" style="padding:1.25rem;margin-bottom:1.25rem">' +
        '<div style="font-size:0.88rem;font-weight:600;margin-bottom:1rem">⚫ Preços de Venda TikTok <span style="font-weight:400;color:var(--text3);font-size:0.8rem">— cadastre o preço atual de cada produto</span></div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">' +
        PRODUTOS_CUSTO.map(function(p) {
          var val = _mgvPrecosTt[p.sku] ? _mgvPrecosTt[p.sku].toFixed(2).replace('.', ',') : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg3);border-radius:8px;border:0.5px solid var(--border)">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-size:0.8rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.nome) + '</div>' +
              '<div style="font-size:0.68rem;color:var(--text3);font-family:monospace">' + p.sku + '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">' +
              '<span style="font-size:0.78rem;color:var(--text3)">R$</span>' +
              '<input type="number" step="0.01" min="0" placeholder="0,00" value="' + esc(val) + '" ' +
                'style="width:72px;padding:4px 6px;border:0.5px solid var(--border2);border-radius:6px;background:var(--bg);color:var(--text);font-size:0.82rem;text-align:right" ' +
                'onchange="mgvSalvarPrecoTt(\'' + p.sku + '\',this.value)" ' +
                'onblur="mgvSalvarPrecoTt(\'' + p.sku + '\',this.value)">' +
            '</div>' +
          '</div>';
        }).join('') +
        '</div>' +
      '</div>';

      // Tabela de margem só para quem tem preço cadastrado
      var linhasPlat = linhas.filter(function(l){ return l.precoTt; });
      if (!linhasPlat.length) {
        html += '<div class="empty-state">' + iconEmpty() + '<p>Cadastre os preços de venda acima para calcular a margem do TikTok.</p></div>';
        return html;
      }

      html += '<div class="card" style="padding:0;overflow:auto">' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.85rem">' +
          '<thead><tr style="border-bottom:1.5px solid var(--border)">' +
            '<th style="text-align:left;padding:10px 14px">Produto</th>' +
            '<th style="text-align:right;padding:10px 10px">Valor de Venda</th>' +
            '<th style="text-align:right;padding:10px 10px">Taxa de Venda</th>' +
            '<th style="text-align:right;padding:10px 10px">Tarifa de Envio</th>' +
            '<th style="text-align:right;padding:10px 10px">Imposto (' + imposto + '%)</th>' +
            '<th style="text-align:right;padding:10px 10px">Custo do Produto</th>' +
            '<th style="text-align:right;padding:10px 10px">Lucro Líquido</th>' +
            '<th style="text-align:right;padding:10px 14px">Margem Líquida</th>' +
          '</tr></thead><tbody>' +
        linhasPlat.map(function(l) {
          var preco = l.precoTt;
          var m = l.mTt;
          if (!m || m.semCusto) {
            return '<tr style="border-bottom:0.5px solid var(--border)">' +
              '<td style="padding:10px 14px;font-weight:500">' + esc(l.p.nome) + '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">' + l.p.sku + '</div></td>' +
              '<td style="text-align:right;padding:10px 10px">' + fmtR$(preco) + '</td>' +
              '<td colspan="6" style="text-align:center;color:var(--red);font-size:0.78rem">sem custo cadastrado</td>' +
            '</tr>';
          }
          return '<tr style="border-bottom:0.5px solid var(--border)">' +
            '<td style="padding:10px 14px;font-weight:500">' + esc(l.p.nome) + '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">' + l.p.sku + '</div></td>' +
            '<td style="text-align:right;padding:10px 10px">' + fmtR$(preco) + '</td>' +
            '<td style="text-align:right;padding:10px 10px;color:var(--red)">−' + fmtR$(preco * (m.taxaVendaPct||0) / 100) + '<div style="font-size:0.62rem;color:var(--text3)">manual</div></td>' +
            '<td style="text-align:right;padding:10px 10px;color:var(--red)">' + (m.envioFixo ? '−'+fmtR$(m.envioFixo) : '—') + '</td>' +
            '<td style="text-align:right;padding:10px 10px;color:var(--red)">−' + fmtR$(m.impostoValor) + '</td>' +
            '<td style="text-align:right;padding:10px 10px;color:var(--red)">−' + fmtR$(m.custoUnit) + '</td>' +
            '<td style="text-align:right;padding:10px 10px;font-weight:700;color:' + (m.lucro>=0?'var(--green)':'var(--red)') + '">' + fmtR$(m.lucro) + '</td>' +
            '<td style="text-align:right;padding:10px 14px;font-weight:700;color:' + corMargem(m.margem) + '">' + fmtPct(m.margem) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>' +
      '</div>' +
      '<div style="margin-top:1rem;font-size:0.78rem;color:var(--text3)">' +
        'Taxa de venda e tarifa de envio TikTok: use as tarifas cadastradas em Marketplaces → Tarifas. ' +
        '<span style="color:#8b5cf6">●</span> &gt;17% excelente · <span style="color:var(--green)">●</span> ≥15% boa · <span style="color:#3b82f6">●</span> ≥10% ok · <span style="color:var(--red)">●</span> &lt;10% atenção' +
      '</div>';
      return html;
    }

    var linhasPlat = linhas.filter(function(l){ return l[pm.precoField]; });

    if (!linhasPlat.length) {
      html += '<div class="empty-state">' + iconEmpty() + '<p>Nenhum produto com preço encontrado em ' + pm.nome + '.</p></div>';
      return html;
    }

    html += '<div class="card" style="padding:0;overflow:auto">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.85rem">' +
        '<thead><tr style="border-bottom:1.5px solid var(--border)">' +
          '<th style="text-align:left;padding:10px 14px">Produto</th>' +
          '<th style="text-align:right;padding:10px 10px">Valor de Venda</th>' +
          '<th style="text-align:right;padding:10px 10px">Taxa de Venda</th>' +
          '<th style="text-align:right;padding:10px 10px">Tarifa de Envio</th>' +
          '<th style="text-align:right;padding:10px 10px">Imposto (' + imposto + '%)</th>' +
          '<th style="text-align:right;padding:10px 10px">Custo do Produto</th>' +
          '<th style="text-align:right;padding:10px 10px">Lucro Líquido</th>' +
          '<th style="text-align:right;padding:10px 14px">Margem Líquida</th>' +
        '</tr></thead><tbody>' +
      linhasPlat.map(function(l) {
        var preco = l[pm.precoField];
        var m = l[pm.mField];
        if (!m || m.semCusto) {
          return '<tr style="border-bottom:0.5px solid var(--border)">' +
            '<td style="padding:10px 14px;font-weight:500">' + esc(l.p.nome) + '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">' + l.p.sku + '</div></td>' +
            '<td style="text-align:right;padding:10px 10px">' + fmtR$(preco) + '</td>' +
            '<td colspan="6" style="text-align:center;padding:10px 10px;color:var(--red);font-size:0.78rem">sem custo cadastrado — não foi possível calcular</td>' +
          '</tr>';
        }
        var autoLabel = m.tarifaAuto
          ? '<div style="font-size:0.62rem;color:var(--green)">automático</div>'
          : '<div style="font-size:0.62rem;color:var(--text3)">manual</div>';
        return '<tr style="border-bottom:0.5px solid var(--border)">' +
          '<td style="padding:10px 14px;font-weight:500">' + esc(l.p.nome) + '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">' + l.p.sku + '</div></td>' +
          '<td style="text-align:right;padding:10px 10px">' + fmtR$(preco) + '</td>' +
          '<td style="text-align:right;padding:10px 10px;color:var(--red)">−' + fmtR$(preco * (m.taxaVendaPct||0) / 100) + autoLabel + '</td>' +
          '<td style="text-align:right;padding:10px 10px;color:var(--red)">' + (m.envioFixo ? '−'+fmtR$(m.envioFixo) : '—') + '</td>' +
          '<td style="text-align:right;padding:10px 10px;color:var(--red)">−' + fmtR$(m.impostoValor) + '</td>' +
          '<td style="text-align:right;padding:10px 10px;color:var(--red)">−' + fmtR$(m.custoUnit) + '</td>' +
          '<td style="text-align:right;padding:10px 10px;font-weight:700;color:' + (m.lucro>=0?'var(--green)':'var(--red)') + '">' + fmtR$(m.lucro) + '</td>' +
          '<td style="text-align:right;padding:10px 14px;font-weight:700;color:' + corMargem(m.margem) + '">' + fmtPct(m.margem) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table>' +
    '</div>' +
    '<div style="margin-top:1rem;font-size:0.78rem;color:var(--text3)">' +
      'Lucro Líquido = Valor de Venda − Taxa de Venda − Tarifa de Envio − Imposto − Custo do Produto. ' +
      'ML: taxa buscada via API por anúncio (Clássico/Premium/categoria). ' +
      'Shopee: taxa calculada por faixas de preço (tabela CNPJ vigente 28/02/2026). ' +
      (pm.key === 'tt' ? 'TikTok usa o preço médio do último mês importado no Financeiro. ' : '') +
      '<span style="color:#8b5cf6">●</span> &gt;17% excelente · <span style="color:var(--green)">●</span> ≥15% boa · <span style="color:#3b82f6">●</span> ≥10% ok · <span style="color:var(--red)">●</span> &lt;10% atenção' +
    '</div>';

    return html;
  }

  html += '<div class="card" style="padding:0;overflow:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.85rem">' +
      '<thead><tr style="border-bottom:1.5px solid var(--border)">' +
        '<th style="text-align:left;padding:10px 14px">Produto</th>' +
        '<th style="text-align:center;padding:10px 10px">🟡 Preço ML</th>' +
        '<th style="text-align:center;padding:10px 10px">🟡 Margem ML</th>' +
        '<th style="text-align:center;padding:10px 10px">🟠 Preço Shopee</th>' +
        '<th style="text-align:center;padding:10px 10px">🟠 Margem Shopee</th>' +
        '<th style="text-align:center;padding:10px 10px">⚫ Preço TikTok</th>' +
        '<th style="text-align:center;padding:10px 10px">⚫ Margem TikTok</th>' +
      '</tr></thead><tbody>' +
    linhas.map(function(l) {
      function cel(m) {
        if (!m) return '<span style="color:var(--text3)">—</span>';
        if (m.semCusto) return '<span style="color:var(--text3)">—</span><div style="font-size:0.65rem;color:var(--red)">sem custo cadastrado</div>';
        return '<span style="font-weight:700;color:' + corMargem(m.margem) + '">' + fmtPct(m.margem) + '</span>' +
          (!m.temTarifa ? '<div style="font-size:0.65rem;color:var(--text3)">sem tarifa cadastrada</div>' : '');
      }
      return '<tr style="border-bottom:0.5px solid var(--border)">' +
        '<td style="padding:10px 14px;font-weight:500">' + esc(l.p.nome) + '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">' + l.p.sku + '</div></td>' +
        '<td style="text-align:center;padding:10px 10px">' + fmtR$(l.precoMl) + '</td>' +
        '<td style="text-align:center;padding:10px 10px">' + cel(l.mMl) + '</td>' +
        '<td style="text-align:center;padding:10px 10px">' + fmtR$(l.precoSp) + '</td>' +
        '<td style="text-align:center;padding:10px 10px">' + cel(l.mSp) + '</td>' +
        '<td style="text-align:center;padding:10px 10px">' + fmtR$(l.precoTt) + '</td>' +
        '<td style="text-align:center;padding:10px 10px">' + cel(l.mTt) + '</td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>' +
  '</div>' +
  '<div style="margin-top:1rem;font-size:0.78rem;color:var(--text3)">' +
    'Margem = Preço − Tarifa (cadastrada em Marketplaces → Tarifas) − Custo do produto − ' + imposto + '% de imposto. ' +
    'TikTok usa o preço médio do último mês importado no Financeiro (sem API de tempo real disponível). ' +
    '<span style="color:#8b5cf6">●</span> &gt;17% excelente · <span style="color:var(--green)">●</span> ≥15% boa · <span style="color:#3b82f6">●</span> ≥10% ok · <span style="color:var(--red)">●</span> &lt;10% atenção' +
  '</div>';

  return html;
}


function renderMarketplaces() {
  var tarifas = state.financeiro.tarifasSku  || {};
  var custos  = state.financeiro.custoProdutos || {};
  var aliq    = parseFloat(state.financeiro.aliquota) || 0;

  // Carregar financeiro se tarifas ainda não vieram
  var _tarifasFaltando = Object.keys(tarifas).length === 0;
  if (!_finLoaded || _tarifasFaltando) {
    _finLoaded = true;
    finLoadFirebase().then(function(){
      var c = document.getElementById('page-content');
      if (c && state.currentPage === 'marketplaces') c.innerHTML = renderMarketplaces();
    });
    if (_tarifasFaltando) return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem;gap:1rem">'+
      '<div style="width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--green);border-radius:50%;animation:spin 0.7s linear infinite"></div>'+
      '<div style="color:var(--text2);font-size:0.9rem">Carregando dados...</div>'+
    '</div>';
  }

  var meses     = state.financeiro.meses || {};
  var mesKeys   = Object.keys(meses).sort().reverse();
  if (!_mktsMesSel && mesKeys.length) _mktsMesSel = mesKeys[0];
  var mes       = _mktsMesSel ? meses[_mktsMesSel] : null;

  var MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  function mesLbl(k){ var p=k.split('-'); return MONTHS[parseInt(p[1])-1]+'/'+p[0]; }

  // Calcular vendas por SKU por plataforma
  var vendas = {};
  PRODUTOS_CUSTO.forEach(function(p){ vendas[p.sku]={ml:{qty:0,fat:0},sp:{qty:0,fat:0},tt:{qty:0,fat:0}}; });

  if (mes) {
    var ML_INV = ['Cancelada pelo comprador','Venda cancelada. Não envie.','Cancelada. Não despache','O seu comprador quer cancelar','Devolução em preparação','Devolução a caminho'];
    if (mes.ml) mes.ml.forEach(function(r){
      var estado = String(r['Estado']||'');
      if (ML_INV.some(function(x){ return estado.indexOf(x)!==-1; })) return;
      if (estado.indexOf('Pacote de')!==-1) return;
      var sku = String(r['SKU']||'').trim().toLowerCase();
      if (!sku || !vendas[sku]) return;
      var uni   = parseFloat(String(r['Unidades']||'').replace(',','.'))||0;
      var preco = parseFloat(String(r['Preço unitário de venda do anúncio (BRL)']||'').replace(',','.'))||0;
      vendas[sku].ml.qty += uni;
      vendas[sku].ml.fat += preco * uni;
    });
    if (mes.sp) mes.sp.forEach(function(r){
      if (String(r['Status do pedido']||'')==='Cancelado') return;
      var sku = String(r['Número de referência SKU']||'').trim().toLowerCase();
      if (!sku || !vendas[sku]) return;
      var qty = parseInt(r['Quantidade'])||0;
      var vt  = parseFloat(r['Valor Total'])||0;
      vendas[sku].sp.qty += qty;
      vendas[sku].sp.fat += vt;
    });
    if (mes.tt) {
      var ttSeen = {};
      mes.tt.forEach(function(r){
        var st = String(r['Order Status']||'');
        if (st==='Cancelado'||st==='Não pago') return;
        var sku = String(r['Seller SKU']||'').trim().toLowerCase();
        var oid = String(r['Order ID']||'');
        var key = oid+'|'+sku;
        if (ttSeen[key]||!sku||!vendas[sku]) return;
        ttSeen[key]=true;
        var qty = parseInt(r['Quantity'])||0;
        var before=finParseBRL(r['SKU Subtotal Before Discount']);
        var pd=finParseBRL(r['SKU Platform Discount']);
        var sd=finParseBRL(r['SKU Seller Discount']);
        var val=(before-pd-sd)||finParseBRL(r['SKU Subtotal After Discount']);
        vendas[sku].tt.qty+=qty;
        vendas[sku].tt.fat+=val;
      });
    }
  }

  function calcPlat(sku, plat, v) {
    var t = (tarifas[sku]||{})[plat] || {};
    var c2 = custos[sku];
    var custoUnit = (c2 && c2.custoFinal !== undefined) ? c2.custoFinal : null;
    var qty = v.qty;
    if (qty === 0) return null;
    var precoUnit = v.fat / qty;
    var pctTar = t.pctVenda || 0;
    var envioFix = t.envio || 0;
    if (!t.pctVenda && !t.envio && plat==='tt') { pctTar=12; envioFix=4; }
    var valorTarifa  = precoUnit * (pctTar/100);
    var valorEnvio   = envioFix;
    var valorImposto = precoUnit * (aliq/100);
    var lucroPorUni  = custoUnit !== null ? precoUnit - valorTarifa - valorEnvio - custoUnit - valorImposto : null;
    var lucroLiq     = lucroPorUni !== null ? lucroPorUni * qty : null;
    var margem       = (lucroLiq !== null && v.fat > 0) ? lucroLiq * 100 / v.fat : null;
    return { precoUnit, pctTar, valorTarifa, envioFix, valorEnvio, custoUnit, valorImposto, lucroPorUni, qty, lucroLiq, margem };
  }

  var platCfg = [
    { id:'ml', label:'Mercado Livre', emoji:'🟡', color:'#EAB308', bg:'rgba(234,179,8,0.06)' },
    { id:'sp', label:'Shopee',        emoji:'🟠', color:'#F97316', bg:'rgba(249,115,22,0.06)' },
    { id:'tt', label:'TikTok Shop',   emoji:'⚫', color:'#1a1a1a', bg:'rgba(26,26,26,0.04)' },
    { id:'tarifas', label:'Tarifas por Produto', emoji:'🏷️', color:'var(--text2)', bg:'' },
  ];

  // Tabs HTML — gerado antes de qualquer branch
  var tabsHtml =
    '<div style="display:flex;gap:4px;border-bottom:1.5px solid var(--border);margin-bottom:1.5rem;padding-bottom:0">'+
      platCfg.map(function(p){
        var ativo = p.id === _mktsTab;
        return '<button onclick="mktsSetTab(\''+p.id+'\')" style="padding:9px 20px;background:none;border:none;border-bottom:3px solid '+(ativo?p.color:'transparent')+';color:'+(ativo?p.color:'var(--text2)')+';font-weight:'+(ativo?'700':'400')+';font-size:0.9rem;cursor:pointer;transition:all 0.15s;margin-bottom:-2px">'+
          p.emoji+' '+p.label+
        '</button>';
      }).join('')+
    '</div>';

  // Seletor de mês
  var mesDrop = mesKeys.length ?
    '<div style="position:relative;display:inline-block" id="mkts-mes-wrap">'+
      '<button onclick="mktsToggleMes()" style="display:flex;align-items:center;gap:8px;padding:7px 14px 7px 12px;background:var(--card);border:0.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:0.88rem;font-weight:600;color:var(--text);backdrop-filter:blur(16px)">'+
        '<span>📅</span><span>'+(_mktsMesSel?mesLbl(_mktsMesSel):'Selecionar mês')+'</span><span style="color:var(--text3);font-size:0.7rem">▾</span>'+
      '</button>'+
      '<div id="mkts-mes-drop" style="display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:999;background:var(--card);border:0.5px solid var(--border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.15);backdrop-filter:blur(20px);min-width:150px;overflow:hidden">'+
        mesKeys.map(function(k){
          var act = k===_mktsMesSel;
          return '<button onclick="mktsSelMes(\''+k+'\')" style="display:block;width:100%;text-align:left;padding:10px 16px;background:'+(act?'rgba(26,138,74,0.1)':'transparent')+';border:none;color:'+(act?'var(--green)':'var(--text)')+';font-weight:'+(act?'700':'400')+';font-size:0.88rem;cursor:pointer;font-family:inherit;border-bottom:0.5px solid var(--border2)">'+(act?'✓ ':'')+mesLbl(k)+'</button>';
        }).join('')+
      '</div>'+
    '</div>'
  : '<span style="font-size:0.82rem;color:var(--amber)">Nenhum mês importado</span>';

  // Aba Tarifas — retorna imediatamente sem processar dados de venda
  if (_mktsTab === 'tarifas') {
    return '<div style="display:flex;align-items:center;margin-bottom:1.25rem">'+mesDrop+'</div>'+
      tabsHtml + renderFinTarifas();
  }

  var plat = platCfg.find(function(p){ return p.id===_mktsTab; }) || platCfg[0];

  function fmtN(v){ if(v===null||v===undefined) return '<span style="color:var(--text3)">—</span>'; return (v>=0?'':'− ')+'R$ '+Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtPct(v){ if(v===null||v===undefined) return '<span style="color:var(--text3)">—</span>'; return (v>=0?'':'− ')+Math.abs(v).toFixed(1)+'%'; }
  function corMargem(v){ if(v===null||v===undefined) return ''; if(v>17) return 'color:#8b5cf6'; if(v>=15) return 'color:var(--green)'; if(v>=10) return 'color:#3b82f6'; return 'color:var(--red)'; }
  function cor(v){ return v===null?'':(v>=0?'color:var(--green)':'color:var(--red)'); }

  // Filtrar SKUs com venda na plataforma atual (ou todos)
  var skusVisiveis = PRODUTOS_CUSTO.filter(function(p){
    if (_mktsVerTodos) return true;
    return vendas[p.sku][_mktsTab].qty > 0;
  });

  // Totais da plataforma ativa
  var totQty=0, totLucro=0, totFat=0, totSemCusto=0;
  PRODUTOS_CUSTO.forEach(function(p){
    var v = vendas[p.sku][_mktsTab];
    var d = calcPlat(p.sku, _mktsTab, v);
    if (d) {
      totQty  += d.qty;
      totFat  += v.fat;
      if (d.lucroLiq !== null) totLucro += d.lucroLiq;
      else totSemCusto++;
    }
  });
  var totMargem = totFat > 0 ? totLucro * 100 / totFat : null;

  // Cards de resumo
  var resumo =
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem">'+
      '<div class="card" style="padding:1rem;border-left:4px solid '+plat.color+'">'+
        '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Faturamento</div>'+
        '<div style="font-size:1.3rem;font-weight:800;margin-top:4px">'+finFmt(totFat)+'</div>'+
        '<div style="font-size:0.75rem;color:var(--text3);margin-top:2px">'+totQty+' unidades vendidas</div>'+
      '</div>'+
      '<div class="card" style="padding:1rem;border-left:4px solid var(--amber)">'+
        '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Ticket médio</div>'+
        '<div style="font-size:1.3rem;font-weight:800;margin-top:4px">'+(totQty>0?finFmt(totFat/totQty):'—')+'</div>'+
        '<div style="font-size:0.75rem;color:var(--text3);margin-top:2px">por unidade</div>'+
      '</div>'+
      '<div class="card" style="padding:1rem;border-left:4px solid '+(totLucro>=0?'var(--green)':'var(--red)')+'">'+
        '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Lucro líquido</div>'+
        '<div style="font-size:1.3rem;font-weight:800;margin-top:4px;'+(totLucro>=0?'color:var(--green)':'color:var(--red)')+'">'+finFmt(Math.abs(totLucro))+'</div>'+
        (totSemCusto>0?'<div style="font-size:0.72rem;color:var(--amber)">⚠ '+totSemCusto+' SKU(s) sem custo</div>':'')+
      '</div>'+
      '<div class="card" style="padding:1rem;border-left:4px solid #8b5cf6">'+
        '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Margem</div>'+
        '<div style="font-size:1.3rem;font-weight:800;margin-top:4px;'+(totMargem!==null?(totMargem>=15?'color:var(--green)':totMargem>=10?'color:#3b82f6':'color:var(--red)'):'')+'">'+
          (totMargem!==null?totMargem.toFixed(1)+'%':'—')+
        '</div>'+
        '<div style="font-size:0.75rem;color:var(--text3);margin-top:2px">sobre faturamento</div>'+
      '</div>'+
    '</div>';

  // Tabela de SKUs
  var tabelaHtml = skusVisiveis.length === 0 ?
    '<div class="card" style="padding:3rem;text-align:center;color:var(--text3)">'+
      '<div style="font-size:2rem;margin-bottom:8px">'+plat.emoji+'</div>'+
      '<div>Nenhuma venda em '+plat.label+' neste mês</div>'+
      '<div style="font-size:0.82rem;margin-top:6px">Importe a planilha ou clique em "Mostrar todos os SKUs"</div>'+
    '</div>'
  :
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<table style="width:100%;border-collapse:collapse;font-size:0.82rem">'+
        '<thead><tr style="background:var(--bg3);border-bottom:2px solid var(--border)">'+
          '<th style="padding:9px 14px;text-align:left;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Produto</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Preço médio</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--amber)">Ingrediente</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--amber)">Tarifa</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--amber)">Envio</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:#8b5cf6">Custo total</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:#0ea5e9">Imposto</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--green)">Lucro/un</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Qtd</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--green)">Lucro líq.</th>'+
          '<th style="padding:9px 10px;text-align:right;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:#8b5cf6">Margem</th>'+
        '</tr></thead>'+
        '<tbody>'+
          skusVisiveis.map(function(p, idx){
            var v = vendas[p.sku][_mktsTab];
            var d = calcPlat(p.sku, _mktsTab, v);
            // Custo ingrediente = custoFinal - embalagem - caixa
            var c2 = custos[p.sku];
            var ingrediente = (c2 && c2.custoFinal !== undefined)
              ? c2.custoFinal - (c2.embalagem||0) - (c2.caixa||0)
              : null;
            if (!d) {
              return '<tr style="opacity:0.45;'+(idx%2===1?'background:var(--bg3)':'')+'">'+
                '<td style="padding:8px 14px">'+
                  '<div style="font-weight:500">'+esc(p.nome)+'</div>'+
                  '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">'+p.sku+'</div>'+
                '</td>'+
                '<td colspan="10" style="text-align:center;color:var(--text3);font-size:0.75rem">Sem vendas</td>'+
              '</tr>';
            }
            return '<tr style="border-bottom:0.5px solid var(--border);'+(idx%2===1?'background:var(--bg3)':'')+'">'+
              '<td style="padding:8px 14px">'+
                '<div style="font-weight:600">'+esc(p.nome)+'</div>'+
                '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">'+p.sku+'</div>'+
              '</td>'+
              '<td style="padding:8px 10px;text-align:right">'+finFmt(d.precoUnit)+'</td>'+
              '<td style="padding:8px 10px;text-align:right;color:var(--amber)">'+(ingrediente!==null?finFmt(ingrediente):'<span style="color:var(--amber);font-size:0.75rem">⚠</span>')+'</td>'+
              '<td style="padding:8px 10px;text-align:right;color:var(--amber)">'+finFmt(d.valorTarifa)+'<br><span style="font-size:0.68rem;color:var(--text3)">'+d.pctTar+'%</span></td>'+
              '<td style="padding:8px 10px;text-align:right;color:var(--amber)">'+finFmt(d.valorEnvio)+'</td>'+
              '<td style="padding:8px 10px;text-align:right;color:#8b5cf6">'+(d.custoUnit!==null?finFmt(d.custoUnit):'<span style="color:var(--amber);font-size:0.75rem">⚠</span>')+'</td>'+
              '<td style="padding:8px 10px;text-align:right;color:#0ea5e9">'+finFmt(d.valorImposto)+'</td>'+
              '<td style="padding:8px 10px;text-align:right;font-weight:700;'+cor(d.lucroPorUni)+'">'+fmtN(d.lucroPorUni)+'</td>'+
              '<td style="padding:8px 10px;text-align:right;font-weight:600;color:var(--text2)">'+d.qty+'</td>'+
              '<td style="padding:8px 10px;text-align:right;font-weight:700;'+cor(d.lucroLiq)+'">'+fmtN(d.lucroLiq)+'</td>'+
              '<td style="padding:8px 10px;text-align:right;font-weight:700;'+corMargem(d.margem)+'">'+fmtPct(d.margem)+'</td>'+
            '</tr>';
          }).join('')+
          // Linha de total
          '<tr style="background:var(--bg3);border-top:2px solid var(--border);font-weight:700">'+
            '<td style="padding:9px 14px">Total</td>'+
            '<td style="padding:9px 10px;text-align:right">'+finFmt(totQty>0?totFat/totQty:0)+'</td>'+
            '<td colspan="5"></td>'+
            '<td></td>'+
            '<td style="padding:9px 10px;text-align:right">'+totQty+'</td>'+
            '<td style="padding:9px 10px;text-align:right;'+(totLucro>=0?'color:var(--green)':'color:var(--red)')+';font-size:0.95rem">'+finFmt(Math.abs(totLucro))+'</td>'+
            '<td style="padding:9px 10px;text-align:right;'+(totMargem!==null?(totMargem>=15?'color:var(--green)':totMargem>=10?'color:#3b82f6':'color:var(--red)'):'')+'">'+(totMargem!==null?totMargem.toFixed(1)+'%':'—')+'</td>'+
          '</tr>'+
        '</tbody>'+
      '</table>'+
    '</div>';

  return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:8px">'+
    mesDrop+
    (_mktsTab !== 'tarifas' ?
      '<button onclick="_mktsVerTodos=!_mktsVerTodos;var c=document.getElementById(\'page-content\');if(c)c.innerHTML=renderMarketplaces()" '+
        'style="padding:6px 14px;border:0.5px solid var(--border2);border-radius:8px;background:var(--card);color:var(--text2);font-size:0.8rem;cursor:pointer">'+
        (_mktsVerTodos?'👁 Só com vendas':'👁 Todos os SKUs')+
      '</button>'
    : '')+
  '</div>'+
  tabsHtml +
  (_mktsTab === 'tarifas' ? renderFinTarifas() : resumo + tabelaHtml);
}

function mktsSetTab(t) {
  _mktsTab = t;
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderMarketplaces();
}

function mktsSelMes(k) {
  _mktsMesSel = k;
  var drop = document.getElementById('mkts-mes-drop');
  if (drop) drop.style.display = 'none';
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderMarketplaces();
}

function mktsToggleMes() {
  var drop = document.getElementById('mkts-mes-drop');
  if (!drop) return;
  drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
  if (drop.style.display === 'block') {
    setTimeout(function(){
      document.addEventListener('click', function fechar(e){
        var wrap = document.getElementById('mkts-mes-wrap');
        if (!wrap || !wrap.contains(e.target)) { drop.style.display='none'; document.removeEventListener('click',fechar); }
      });
    }, 10);
  }
}

function renderFinMarketplaces() {
  var tarifas = state.financeiro.tarifasSku || {};
  var custos  = state.financeiro.custoProdutos || {};
  var aliq    = parseFloat(state.financeiro.aliquota)||0;
  var mes     = _finMesSel ? (state.financeiro.meses||{})[_finMesSel] : null;

  // Calcular vendas por SKU por plataforma a partir da planilha
  var vendas = {}; // vendas[sku] = { ml:{qty, fat}, sp:{qty, fat}, tt:{qty, fat} }
  PRODUTOS_CUSTO.forEach(function(p){ vendas[p.sku] = { ml:{qty:0,fat:0}, sp:{qty:0,fat:0}, tt:{qty:0,fat:0} }; });

  if (mes) {
    var ML_INV = ['Cancelada pelo comprador','Venda cancelada. Não envie.','Cancelada. Não despache','O seu comprador quer cancelar','Devolução em preparação','Devolução a caminho'];
    if (mes.ml) mes.ml.forEach(function(r){
      var estado = String(r['Estado']||'');
      if (ML_INV.some(function(x){ return estado.indexOf(x)!==-1; })) return;
      if (estado.indexOf('Pacote de')!==-1) return;
      var sku = String(r['SKU']||'').trim().toLowerCase();
      if (!sku || !vendas[sku]) return;
      var uni = parseFloat(String(r['Unidades']||'').replace(',','.'))||0;
      var preco = parseFloat(String(r['Preço unitário de venda do anúncio (BRL)']||'').replace(',','.'))||0;
      vendas[sku].ml.qty += uni;
      vendas[sku].ml.fat += preco * uni;
    });
    if (mes.sp) mes.sp.forEach(function(r){
      if (String(r['Status do pedido']||'')==='Cancelado') return;
      var sku = String(r['Número de referência SKU']||'').trim().toLowerCase();
      if (!sku || !vendas[sku]) return;
      var qty = parseInt(r['Quantidade'])||0;
      var vt  = parseFloat(r['Valor Total'])||0;
      vendas[sku].sp.qty += qty;
      vendas[sku].sp.fat += vt;
    });
    if (mes.tt) {
      var ttSeen = {};
      mes.tt.forEach(function(r){
        var st = String(r['Order Status']||'');
        if (st==='Cancelado'||st==='Não pago') return;
        var sku = String(r['Seller SKU']||'').trim().toLowerCase();
        var oid = String(r['Order ID']||'');
        var key = oid+'|'+sku;
        if (ttSeen[key] || !sku || !vendas[sku]) return;
        ttSeen[key] = true;
        var qty = parseInt(r['Quantity'])||0;
        var before = finParseBRL(r['SKU Subtotal Before Discount']);
        var pd = finParseBRL(r['SKU Platform Discount']);
        var sd = finParseBRL(r['SKU Seller Discount']);
        var val = (before-pd-sd) || finParseBRL(r['SKU Subtotal After Discount']);
        vendas[sku].tt.qty += qty;
        vendas[sku].tt.fat += val;
      });
    }
  }

  // Calcula lucro por unidade e total para um SKU numa plataforma
  function calcPlat(sku, plat, v) {
    var t = (tarifas[sku]||{})[plat] || {};
    var c = custos[sku];
    var custoUnit = (c && c.custoFinal !== undefined) ? c.custoFinal : null;
    var qty = v.qty;
    if (qty === 0) return null;
    // Preço médio por unidade
    var precoUnit = qty > 0 ? v.fat / qty : 0;
    // Tarifa: usa custom se disponível
    var pctTar = t.pctVenda || 0;
    var envioFix = t.envio || 0;
    // Se não tiver tarifa custom para TikTok, usa padrão 12% + R$4
    if (!t.pctVenda && !t.envio && plat === 'tt') { pctTar = 12; envioFix = 4; }
    var valorTarifa = precoUnit * (pctTar/100);
    var valorEnvio  = envioFix;
    var valorImposto = precoUnit * (aliq/100);
    var lucroPorUni = custoUnit !== null
      ? precoUnit - valorTarifa - valorEnvio - custoUnit - valorImposto
      : null;
    var lucroLiq = lucroPorUni !== null ? lucroPorUni * qty : null;
    var margem   = (lucroLiq !== null && v.fat > 0) ? lucroLiq * 100 / v.fat : null;
    return { precoUnit, pctTar, valorTarifa, envioFix, valorEnvio, custoUnit, valorImposto, lucroPorUni, qty, lucroLiq, margem };
  }

  var fmt = finFmt;
  var fmtN = function(v, dec) {
    if (v === null || v === undefined) return '<span style="color:var(--text3)">—</span>';
    return (v >= 0 ? '' : '− ') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR',{minimumFractionDigits:dec||2, maximumFractionDigits:dec||2});
  };
  var fmtPct = function(v) {
    if (v === null || v === undefined) return '<span style="color:var(--text3)">—</span>';
    return (v >= 0 ? '' : '− ') + Math.abs(v).toFixed(1) + '%';
  };
  var cor = function(v) { return v === null ? '' : (v >= 0 ? 'color:var(--green)' : 'color:var(--red)'); };

  var platCfg = [
    { id:'ml', label:'Mercado Livre', emoji:'🟡', color:'#EAB308' },
    { id:'sp', label:'Shopee',        emoji:'🟠', color:'#F97316' },
    { id:'tt', label:'TikTok Shop',   emoji:'⚫', color:'#1a1a1a' },
  ];

  // Filtro: mostrar só SKUs com pelo menos uma venda no mês (ou todos)
  var _mktsVerTodos = window._mktsVerTodos || false;

  var skusVisiveis = PRODUTOS_CUSTO.filter(function(p){
    if (_mktsVerTodos) return true;
    var v = vendas[p.sku];
    return v && (v.ml.qty > 0 || v.sp.qty > 0 || v.tt.qty > 0);
  });

  var html =
    '<style>'+
      '.mkt-card{background:var(--card);backdrop-filter:blur(16px);border:0.5px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:1.25rem}'+
      '.mkt-card-header{padding:12px 16px;border-bottom:2px solid var(--border);display:flex;align-items:center;justify-content:space-between}'+
      '.mkt-table{width:100%;border-collapse:collapse;font-size:0.8rem}'+
      '.mkt-table td,.mkt-table th{padding:8px 12px;border-bottom:0.5px solid var(--border)}'+
      '.mkt-table tr:last-child td{border-bottom:none}'+
      '.mkt-table th{font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);text-align:right;background:var(--bg3);font-weight:600}'+
      '.mkt-table th:first-child{text-align:left}'+
      '.mkt-table td:first-child{font-weight:600}'+
      '.mkt-table td{text-align:right;color:var(--text2)}'+
      '.mkt-zero{opacity:0.45}'+
    '</style>'+

    // Controles do topo
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:8px">'+
      '<div style="font-size:0.82rem;color:var(--text3)">'+
        (mes ? 'Dados do mês <strong>'+_finMesSel+'</strong> · imposto '+aliq+'%' : '<span style="color:var(--amber)">Selecione um mês no topo para ver os dados</span>')+
      '</div>'+
      '<button onclick="window._mktsVerTodos='+(!_mktsVerTodos)+';var c=document.getElementById(\'page-content\');if(c){c.innerHTML=renderFinanceiro();bindFinanceiro()}" '+
        'style="padding:6px 14px;border:0.5px solid var(--border2);border-radius:8px;background:var(--card);color:var(--text2);font-size:0.8rem;cursor:pointer">'+
        (_mktsVerTodos ? '👁 Mostrar só com vendas' : '👁 Mostrar todos os SKUs')+
      '</button>'+
    '</div>'+

    (skusVisiveis.length === 0 ?
      '<div class="card" style="padding:3rem;text-align:center;color:var(--text3)">'+
        '<div style="font-size:2rem;margin-bottom:8px">📊</div>'+
        '<div>Nenhuma venda encontrada neste mês.</div>'+
        '<div style="font-size:0.82rem;margin-top:6px">Importe as planilhas ou clique em "Mostrar todos os SKUs".</div>'+
      '</div>'
    :
      skusVisiveis.map(function(p){
        var v = vendas[p.sku];
        var c = custos[p.sku];
        var custoDisp = (c && c.custoFinal !== undefined) ? finFmt(c.custoFinal) : '<span style="color:var(--amber)">sem custo</span>';

        var rows = platCfg.map(function(plat){
          var vp = v[plat.id];
          var d  = calcPlat(p.sku, plat.id, vp);
          if (!d) {
            return '<tr class="mkt-zero">'+
              '<td><span style="color:'+plat.color+'">'+plat.emoji+'</span> '+plat.label+'</td>'+
              '<td colspan="8" style="text-align:center;color:var(--text3);font-size:0.75rem">Sem vendas neste mês</td>'+
            '</tr>';
          }
          return '<tr>'+
            '<td><span style="color:'+plat.color+'">'+plat.emoji+'</span> '+plat.label+'</td>'+
            '<td>'+finFmt(d.precoUnit)+'</td>'+
            '<td>'+finFmt(d.valorTarifa)+'<br><span style="font-size:0.7rem;color:var(--text3)">'+d.pctTar+'%</span></td>'+
            '<td>'+finFmt(d.valorEnvio)+'</td>'+
            '<td>'+(d.custoUnit!==null?finFmt(d.custoUnit):'<span style="color:var(--amber)">—</span>')+'</td>'+
            '<td>'+finFmt(d.valorImposto)+'<br><span style="font-size:0.7rem;color:var(--text3)">'+aliq+'%</span></td>'+
            '<td style="font-weight:700;'+cor(d.lucroPorUni)+'">'+fmtN(d.lucroPorUni)+'</td>'+
            '<td style="font-weight:600">'+d.qty+' un</td>'+
            '<td style="font-weight:700;'+cor(d.lucroLiq)+'">'+fmtN(d.lucroLiq)+'</td>'+
            '<td style="font-weight:700;'+corMargem(d.margem)+'">'+fmtPct(d.margem)+'</td>'+
          '</tr>';
        }).join('');

        // Totalizador cross-platform
        var totalQty = 0, totalLucro = 0, totalFat = 0;
        platCfg.forEach(function(plat){
          var d = calcPlat(p.sku, plat.id, v[plat.id]);
          if (d && d.lucroLiq !== null) { totalLucro += d.lucroLiq; totalQty += d.qty; totalFat += v[plat.id].fat; }
        });
        var margemTotal = totalFat > 0 ? totalLucro * 100 / totalFat : null;

        return '<div class="mkt-card">'+
          '<div class="mkt-card-header">'+
            '<div>'+
              '<div style="font-weight:700;font-size:0.95rem">'+esc(p.nome)+'</div>'+
              '<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">'+
                'SKU: <code style="background:var(--bg3);padding:1px 6px;border-radius:4px">'+p.sku+'</code>'+
                ' · Custo: '+custoDisp+
              '</div>'+
            '</div>'+
            '<div style="text-align:right">'+
              '<div style="font-size:0.72rem;color:var(--text3)">Lucro total · '+totalQty+' un</div>'+
              '<div style="font-size:1.1rem;font-weight:800;'+(totalLucro>=0?'color:var(--green)':'color:var(--red)')+'">'+
                (totalLucro>=0?'':'-')+finFmt(Math.abs(totalLucro))+
              '</div>'+
              (margemTotal!==null?'<div style="font-size:0.75rem;color:var(--text3)">Margem: '+margemTotal.toFixed(1)+'%</div>':'')+
            '</div>'+
          '</div>'+
          '<table class="mkt-table">'+
            '<thead><tr>'+
              '<th style="text-align:left">Plataforma</th>'+
              '<th>Preço médio</th>'+
              '<th>Tarifa</th>'+
              '<th>Envio</th>'+
              '<th>Custo</th>'+
              '<th>Imposto</th>'+
              '<th>Lucro/un</th>'+
              '<th>Qtd</th>'+
              '<th>Lucro líq.</th>'+
              '<th>Margem</th>'+
            '</tr></thead>'+
            '<tbody>'+rows+'</tbody>'+
          '</table>'+
        '</div>';
      }).join('')
    );

  return html;
}

function renderFinTarifas() {
  var tarifas = state.financeiro.tarifasSku || {};
  var custos  = state.financeiro.custoProdutos || {};

  var html =
    '<style>'+
      '.tar-table{width:100%;border-collapse:collapse;font-size:0.82rem}'+
      '.tar-table th{padding:9px 10px;text-align:center;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);background:var(--bg3);border-bottom:2px solid var(--border)}'+
      '.tar-table th.left{text-align:left}'+
      '.tar-table td{padding:7px 8px;border-bottom:0.5px solid var(--border);text-align:center;vertical-align:middle}'+
      '.tar-input{width:72px;padding:5px 7px;border:0.5px solid var(--border2);border-radius:6px;background:var(--input-bg);color:var(--text);font-size:0.8rem;text-align:center;font-family:inherit}'+
      '.tar-input:focus{border-color:var(--green);outline:none}'+
      '.tar-plat-header{display:flex;align-items:center;justify-content:center;gap:4px;font-weight:700}'+
    '</style>'+

    '<div style="margin-bottom:1rem;font-size:0.82rem;color:var(--text3)">'+
      'Configure a tarifa de venda (%) e taxa de envio (R$) de cada produto por plataforma. '+
      'Se preenchido, substitui os valores da planilha. Deixe em branco para usar os valores da planilha.'+
    '</div>'+

    '<div class="card" style="padding:0;overflow:hidden;margin-bottom:1rem">'+
      '<table class="tar-table">'+
        '<thead>'+
          '<tr>'+
            '<th class="left" style="padding:9px 14px;min-width:180px">Produto / SKU</th>'+
            '<th style="min-width:70px">Custo unit.</th>'+
            /* ML */
            '<th colspan="2" style="border-left:2px solid var(--border);padding:6px 8px">'+
              '<div class="tar-plat-header" style="margin-bottom:6px"><span style="color:#EAB308">🟡</span> Mercado Livre</div>'+
              '<div style="display:flex;gap:4px;justify-content:center">'+
                '<input id="tar-all-ml-pct" type="number" min="0" max="100" step="0.1" placeholder="%" style="width:52px;padding:4px 5px;border:0.5px solid var(--border2);border-radius:5px;background:var(--input-bg);color:var(--text);font-size:0.75rem;text-align:center">'+
                '<input id="tar-all-ml-env" type="number" min="0" step="0.01" placeholder="R$" style="width:52px;padding:4px 5px;border:0.5px solid var(--border2);border-radius:5px;background:var(--input-bg);color:var(--text);font-size:0.75rem;text-align:center">'+
                '<button onclick="finAplicarColuna(\'ml\')" style="padding:4px 8px;background:var(--green);color:#fff;border:none;border-radius:5px;font-size:0.72rem;cursor:pointer;white-space:nowrap">✓ Todos</button>'+
              '</div>'+
            '</th>'+
            /* Shopee */
            '<th colspan="2" style="border-left:2px solid var(--border);padding:6px 8px">'+
              '<div class="tar-plat-header" style="margin-bottom:6px"><span style="color:#F97316">🟠</span> Shopee</div>'+
              '<div style="display:flex;gap:4px;justify-content:center">'+
                '<input id="tar-all-sp-pct" type="number" min="0" max="100" step="0.1" placeholder="%" style="width:52px;padding:4px 5px;border:0.5px solid var(--border2);border-radius:5px;background:var(--input-bg);color:var(--text);font-size:0.75rem;text-align:center">'+
                '<input id="tar-all-sp-env" type="number" min="0" step="0.01" placeholder="R$" style="width:52px;padding:4px 5px;border:0.5px solid var(--border2);border-radius:5px;background:var(--input-bg);color:var(--text);font-size:0.75rem;text-align:center">'+
                '<button onclick="finAplicarColuna(\'sp\')" style="padding:4px 8px;background:var(--green);color:#fff;border:none;border-radius:5px;font-size:0.72rem;cursor:pointer;white-space:nowrap">✓ Todos</button>'+
              '</div>'+
            '</th>'+
            /* TikTok */
            '<th colspan="2" style="border-left:2px solid var(--border);padding:6px 8px">'+
              '<div class="tar-plat-header" style="margin-bottom:6px">⚫ TikTok</div>'+
              '<div style="display:flex;gap:4px;justify-content:center">'+
                '<input id="tar-all-tt-pct" type="number" min="0" max="100" step="0.1" placeholder="%" style="width:52px;padding:4px 5px;border:0.5px solid var(--border2);border-radius:5px;background:var(--input-bg);color:var(--text);font-size:0.75rem;text-align:center">'+
                '<input id="tar-all-tt-env" type="number" min="0" step="0.01" placeholder="R$" style="width:52px;padding:4px 5px;border:0.5px solid var(--border2);border-radius:5px;background:var(--input-bg);color:var(--text);font-size:0.75rem;text-align:center">'+
                '<button onclick="finAplicarColuna(\'tt\')" style="padding:4px 8px;background:var(--green);color:#fff;border:none;border-radius:5px;font-size:0.72rem;cursor:pointer;white-space:nowrap">✓ Todos</button>'+
              '</div>'+
            '</th>'+
            '<th style="width:60px"></th>'+
          '</tr>'+
          '<tr style="background:var(--bg3)">'+
            '<th class="left" style="padding:5px 14px;font-size:0.65rem;color:var(--text3)">Nome · SKU</th>'+
            '<th style="font-size:0.65rem;color:var(--text3)">R$</th>'+
            '<th style="border-left:2px solid var(--border);font-size:0.65rem">% Venda</th>'+
            '<th style="font-size:0.65rem">Envio R$</th>'+
            '<th style="border-left:2px solid var(--border);font-size:0.65rem">% Venda</th>'+
            '<th style="font-size:0.65rem">Envio R$</th>'+
            '<th style="border-left:2px solid var(--border);font-size:0.65rem">% Venda</th>'+
            '<th style="font-size:0.65rem">Envio R$</th>'+
            '<th></th>'+
          '</tr>'+
        '</thead>'+
        '<tbody>'+
          PRODUTOS_CUSTO.map(function(p, idx) {
            var t   = tarifas[p.sku] || {};
            var ml  = t.ml  || {};
            var sp  = t.sp  || {};
            var tt  = t.tt  || {};
            var c   = custos[p.sku];
            var custoVal = (c && c.custoFinal !== undefined) ? finFmt(c.custoFinal) : '—';
            var bg = idx%2===1 ? 'background:var(--bg3)' : '';
            return '<tr style="'+bg+'">'+
              '<td style="text-align:left;padding:7px 14px">'+
                '<div style="font-weight:500;font-size:0.83rem">'+esc(p.nome)+'</div>'+
                '<div style="font-size:0.7rem;color:var(--text3);font-family:monospace">'+p.sku+'</div>'+
              '</td>'+
              '<td style="font-size:0.8rem;color:var(--green);font-weight:600">'+custoVal+'</td>'+
              /* ML */
              '<td style="border-left:2px solid var(--border)">'+
                '<input class="tar-input" type="number" min="0" max="100" step="0.1" placeholder="%" '+
                  'value="'+(ml.pctVenda||'')+'" '+
                  'onchange="finSalvarTarifa(\''+p.sku+'\',\'ml\',\'pctVenda\',this.value)">'+
              '</td>'+
              '<td>'+
                '<input class="tar-input" type="number" min="0" step="0.01" placeholder="R$" '+
                  'value="'+(ml.envio||'')+'" '+
                  'onchange="finSalvarTarifa(\''+p.sku+'\',\'ml\',\'envio\',this.value)">'+
              '</td>'+
              /* Shopee */
              '<td style="border-left:2px solid var(--border)">'+
                '<input class="tar-input" type="number" min="0" max="100" step="0.1" placeholder="%" '+
                  'value="'+(sp.pctVenda||'')+'" '+
                  'onchange="finSalvarTarifa(\''+p.sku+'\',\'sp\',\'pctVenda\',this.value)">'+
              '</td>'+
              '<td>'+
                '<input class="tar-input" type="number" min="0" step="0.01" placeholder="R$" '+
                  'value="'+(sp.envio||'')+'" '+
                  'onchange="finSalvarTarifa(\''+p.sku+'\',\'sp\',\'envio\',this.value)">'+
              '</td>'+
              /* TikTok */
              '<td style="border-left:2px solid var(--border)">'+
                '<input class="tar-input" type="number" min="0" max="100" step="0.1" placeholder="%" '+
                  'value="'+(tt.pctVenda||'')+'" '+
                  'onchange="finSalvarTarifa(\''+p.sku+'\',\'tt\',\'pctVenda\',this.value)">'+
              '</td>'+
              '<td>'+
                '<input class="tar-input" type="number" min="0" step="0.01" placeholder="R$" '+
                  'value="'+(tt.envio||'')+'" '+
                  'onchange="finSalvarTarifa(\''+p.sku+'\',\'tt\',\'envio\',this.value)">'+
              '</td>'+
              '<td id="tar-status-'+p.sku+'" style="font-size:0.75rem;color:var(--text3)"></td>'+
            '</tr>';
          }).join('')+
        '</tbody>'+
      '</table>'+
    '</div>'+

    '<div style="font-size:0.8rem;color:var(--text3);margin-top:0.75rem">As tarifas são salvas automaticamente ao sair do campo.</div>';

  return html;
}

function finSalvarTarifa(sku, plat, campo, valor) {
  if (!state.financeiro.tarifasSku) state.financeiro.tarifasSku = {};
  if (!state.financeiro.tarifasSku[sku]) state.financeiro.tarifasSku[sku] = {};
  if (!state.financeiro.tarifasSku[sku][plat]) state.financeiro.tarifasSku[sku][plat] = {};
  var v = parseFloat(String(valor).replace(',','.'));
  if (!isNaN(v) && v >= 0) {
    state.financeiro.tarifasSku[sku][plat][campo] = v;
  } else {
    delete state.financeiro.tarifasSku[sku][plat][campo];
  }
  var statusEl = document.getElementById('tar-status-'+sku);
  if (statusEl) { statusEl.textContent = '✓'; statusEl.style.color='var(--green)'; setTimeout(function(){ statusEl.textContent=''; }, 1500); }
  finSaveFirebase();
}

function finAplicarColuna(plat) {
  var pctEl = document.getElementById('tar-all-'+plat+'-pct');
  var envEl = document.getElementById('tar-all-'+plat+'-env');
  if (!pctEl || !envEl) return;
  var pct   = parseFloat(pctEl.value.replace(',','.'));
  var envio = parseFloat(envEl.value.replace(',','.'));
  if (isNaN(pct) && isNaN(envio)) { alert('Preencha ao menos % de venda ou envio R$.'); return; }
  if (!state.financeiro.tarifasSku) state.financeiro.tarifasSku = {};
  PRODUTOS_CUSTO.forEach(function(p) {
    if (!state.financeiro.tarifasSku[p.sku]) state.financeiro.tarifasSku[p.sku] = {};
    if (!state.financeiro.tarifasSku[p.sku][plat]) state.financeiro.tarifasSku[p.sku][plat] = {};
    if (!isNaN(pct))   state.financeiro.tarifasSku[p.sku][plat].pctVenda = pct;
    if (!isNaN(envio)) state.financeiro.tarifasSku[p.sku][plat].envio    = envio;
  });
  finSaveFirebase().then(function(){
    var c = document.getElementById('page-content');
    if (c) {
      if (state.currentPage === 'marketplaces') c.innerHTML = renderMarketplaces();
      else { c.innerHTML = renderFinanceiro(); bindFinanceiro(); }
    }
  });
}

function renderFinanceiro() {
  var meses  = state.financeiro.meses || {};
  var mesKeys = Object.keys(meses).sort().reverse();
  if (!_finMesSel && mesKeys.length) _finMesSel = mesKeys[0];

  var MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  var calc   = finCalcMes();
  var despObj = state.financeiro.despesas || {};
  var desp   = Array.isArray(despObj) ? despObj : (despObj[_finMesSel] || []);
  var aliq   = parseFloat(state.financeiro.aliquota)||0;

  // Se um card estiver selecionado, renderiza página de detalhe
  if (_finCardSel && _finTab === 'visao') {
    return renderFinDetalheCard(calc, desp, aliq, MONTHS);
  }

  /* ── PILL SELETOR DE MÊS ── */
  var mesPills = '';
  mesKeys.forEach(function(k){
    var p=k.split('-'); var lbl=MONTHS[parseInt(p[1])-1]+'/'+p[0];
    var act=k===_finMesSel;
    mesPills += '<button class="fin-mes-pill'+(act?' active':'')+'" onclick="finSelMes(\''+k+'\')">' + lbl + '</button>';
  });

  /* ── PIE CHART SVG ── */
  function pieSVG(fatMl, fatSp, fatTt) {
    var total = fatMl + fatSp + fatTt || 1;
    // Novas cores: amarelo ML, laranja Shopee, preto TikTok
    var segs = [
      { v:fatMl, c:'#EAB308', l:'Mercado Livre', icon:'🟡' },
      { v:fatSp, c:'#F97316', l:'Shopee',        icon:'🟠' },
      { v:fatTt, c:'#1a1a1a', l:'TikTok',        icon:'⚫' },
    ];

    // Donut SVG — maior
    var cx=130, cy=130, rOuter=115, rInner=68, out='', angle=-Math.PI/2;
    segs.forEach(function(s){
      if(s.v<=0) return;
      var a = s.v/total*2*Math.PI;
      var x1o=cx+rOuter*Math.cos(angle),  y1o=cy+rOuter*Math.sin(angle);
      var x2o=cx+rOuter*Math.cos(angle+a),y2o=cy+rOuter*Math.sin(angle+a);
      var x1i=cx+rInner*Math.cos(angle+a),y1i=cy+rInner*Math.sin(angle+a);
      var x2i=cx+rInner*Math.cos(angle),  y2i=cy+rInner*Math.sin(angle);
      var lg=a>Math.PI?1:0;
      // Label no meio do segmento
      var midA = angle + a/2;
      var lx = cx + (rInner+rOuter)/2*Math.cos(midA);
      var ly = cy + (rInner+rOuter)/2*Math.sin(midA);
      var pct = (s.v/total*100).toFixed(0);
      out += '<path d="M'+x1o.toFixed(1)+' '+y1o.toFixed(1)+
              ' A'+rOuter+' '+rOuter+' 0 '+lg+' 1 '+x2o.toFixed(1)+' '+y2o.toFixed(1)+
              ' L'+x1i.toFixed(1)+' '+y1i.toFixed(1)+
              ' A'+rInner+' '+rInner+' 0 '+lg+' 0 '+x2i.toFixed(1)+' '+y2i.toFixed(1)+
              ' Z" fill="'+s.c+'" stroke="var(--card)" stroke-width="2.5"/>';
      if (a > 0.35) {
        out += '<text x="'+lx.toFixed(1)+'" y="'+ly.toFixed(1)+'" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="#fff">'+pct+'%</text>';
      }
      angle += a;
    });
    // Centro do donut
    out += '<circle cx="'+cx+'" cy="'+cy+'" r="'+rInner+'" fill="var(--card)"/>'+
           '<text x="'+cx+'" y="'+(cy-8)+'" text-anchor="middle" font-size="10" fill="var(--text3)" font-weight="500">TOTAL</text>'+
           '<text x="'+cx+'" y="'+(cy+10)+'" text-anchor="middle" font-size="12" fill="var(--text)" font-weight="800">'+finFmt(total).replace('R$\u00a0','').replace('R$ ','')+'</text>';

    // Barras horizontais de composição de lucro
    var itensBar = [
      { l:'Taxas',     v:calc.taxas,     c:'var(--amber)', pct: calc.fat>0?(calc.taxas/calc.fat*100):0 },
      { l:'Custo',     v:calc.custoProd, c:'#8b5cf6',      pct: calc.fat>0?(calc.custoProd/calc.fat*100):0 },
      { l:'Desp.',     v:calc.despesas,  c:'var(--red)',    pct: calc.fat>0?(calc.despesas/calc.fat*100):0 },
      { l:'Imposto',   v:calc.imposto,   c:'#0ea5e9',      pct: calc.fat>0?(calc.imposto/calc.fat*100):0 },
      { l:'Lucro',     v:Math.max(0,calc.lucro), c:'var(--green)', pct: calc.fat>0?(Math.max(0,calc.lucro)/calc.fat*100):0 },
    ];

    var barsHtml = '<div style="margin-top:1rem">'+
      '<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:8px">Composição do faturamento</div>'+
      // Barra empilhada
      '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;gap:1px;margin-bottom:10px">'+
        itensBar.map(function(b){ return b.pct>0 ? '<div style="width:'+b.pct.toFixed(1)+'%;background:'+b.c+'" title="'+b.l+': '+b.pct.toFixed(1)+'%"></div>' : ''; }).join('')+
      '</div>'+
      itensBar.map(function(b){
        return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'+
          '<div style="width:8px;height:8px;border-radius:2px;flex-shrink:0;background:'+b.c+'"></div>'+
          '<span style="font-size:0.75rem;color:var(--text2);flex:1">'+b.l+'</span>'+
          '<span style="font-size:0.75rem;color:var(--text3)">'+b.pct.toFixed(1)+'%</span>'+
          '<span style="font-size:0.75rem;font-weight:700;color:var(--text)">'+finFmt(b.v)+'</span>'+
        '</div>';
      }).join('')+
    '</div>';

    // Legenda por plataforma
    var legPlat = '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:0.75rem">'+
      segs.map(function(s){
        var pct = total>0?(s.v/total*100).toFixed(1):'0.0';
        return '<div style="display:flex;align-items:center;gap:7px">'+
          '<div style="width:10px;height:10px;border-radius:2px;background:'+s.c+';flex-shrink:0"></div>'+
          '<span style="font-size:0.78rem;color:var(--text2);flex:1">'+s.l+'</span>'+
          '<span style="font-size:0.78rem;color:var(--text3)">'+pct+'%</span>'+
          '<span style="font-size:0.78rem;font-weight:700;color:var(--text)">'+finFmt(s.v)+'</span>'+
        '</div>';
      }).join('')+
    '</div>';

    return '<div style="display:flex;flex-direction:column;gap:1rem;width:100%">'+
      '<svg viewBox="0 0 260 260" style="width:100%;max-width:260px;height:auto;display:block;margin:0 auto">'+out+'</svg>'+
      '<div>'+
        '<div style="font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);margin-bottom:8px">Por plataforma</div>'+
        legPlat+
        barsHtml+
      '</div>'+
    '</div>';
  }

  /* ── VISÃO GERAL ── */
  var lucroColor = calc.lucro>=0?'var(--green)':'var(--red)';
  var visaoHtml =
    /* ROW 1 — 6 cards (grid 3×2) + gráfico lado direito, mesma altura */
    '<div style="display:grid;grid-template-columns:1fr 420px;gap:1.25rem;margin-bottom:1.25rem;align-items:stretch">'+

      /* Esquerda: 6 cards em grid 2 linhas × 3 colunas */
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;grid-template-rows:1fr 1fr;gap:0.7rem">'+

        /* Card 1 — Lucro */
        '<div class="fin-kpi" style="border-left:4px solid '+(calc.lucro>=0?'var(--green)':'var(--red)')+';cursor:pointer;display:flex;flex-direction:column;justify-content:center" onclick="finAbrirDetalhe(\'lucro\')">'+
          '<div class="fin-kpi-label">📈 Lucro Líquido <span style="font-size:0.6rem;color:var(--text3)">↗</span></div>'+
          '<div class="fin-kpi-val" style="color:'+lucroColor+'">'+(calc.lucro<0?'− ':'')+finFmt(Math.abs(calc.lucro))+'</div>'+
          '<div class="fin-kpi-sub">Fat − Taxas − Desp − Imp − Custo</div>'+
        '</div>'+

        /* Card 2 — Faturamento */
        '<div class="fin-kpi" style="border-left:4px solid var(--green);cursor:pointer;display:flex;flex-direction:column;justify-content:center" onclick="finAbrirDetalhe(\'fat\')">'+
          '<div class="fin-kpi-label">💰 Faturamento <span style="font-size:0.6rem;color:var(--text3)">↗</span></div>'+
          '<div class="fin-kpi-val">'+finFmt(calc.fat)+'</div>'+
          '<div class="fin-kpi-sub">ML + Shopee + TikTok</div>'+
        '</div>'+

        /* Card 3 — Taxas */
        '<div class="fin-kpi" style="border-left:4px solid var(--amber);cursor:pointer;display:flex;flex-direction:column;justify-content:center" onclick="finAbrirDetalhe(\'taxas\')">'+
          '<div class="fin-kpi-label">🏦 Taxas de Venda <span style="font-size:0.6rem;color:var(--text3)">↗</span></div>'+
          '<div class="fin-kpi-val" style="color:var(--amber)">− '+finFmt(calc.taxas)+'</div>'+
          '<div class="fin-kpi-sub">ML '+finFmt(calc.taxas_ml)+' · SP '+finFmt(calc.taxas_sp)+'</div>'+
        '</div>'+

        /* Card 4 — Custo */
        '<div class="fin-kpi" style="border-left:4px solid #8b5cf6;cursor:pointer;display:flex;flex-direction:column;justify-content:center" onclick="finAbrirDetalhe(\'custo\')">'+
          '<div class="fin-kpi-label">📦 Custo Produtos <span style="font-size:0.6rem;color:var(--text3)">↗</span></div>'+
          '<div class="fin-kpi-val" style="color:#8b5cf6">− '+finFmt(calc.custoProd)+'</div>'+
          '<div class="fin-kpi-sub">'+(calc.custoProd===0?'Configure em Estoque':'SKU × unidades')+'</div>'+
        '</div>'+

        /* Card 5 — Despesas */
        '<div class="fin-kpi" style="border-left:4px solid var(--red);cursor:pointer;display:flex;flex-direction:column;justify-content:center" onclick="finAbrirDetalhe(\'despesas\')">'+
          '<div class="fin-kpi-label">💸 Despesas <span style="font-size:0.6rem;color:var(--text3)">↗</span></div>'+
          '<div class="fin-kpi-val" style="color:var(--red)">− '+finFmt(calc.despesas)+'</div>'+
          '<div class="fin-kpi-sub">'+(desp.length)+' lançamento(s)</div>'+
        '</div>'+

        /* Card 6 — Imposto */
        '<div class="fin-kpi" style="border-left:4px solid #0ea5e9;cursor:pointer;display:flex;flex-direction:column;justify-content:center" onclick="finEditAliquota()">'+
          '<div class="fin-kpi-label">🧾 Imposto <span style="font-size:0.6rem;color:var(--text3)">✏️ '+aliq+'%</span></div>'+
          '<div class="fin-kpi-val" style="color:#0ea5e9">− '+finFmt(calc.imposto)+'</div>'+
          '<div class="fin-kpi-sub">'+aliq+'% sobre faturamento</div>'+
        '</div>'+

      '</div>'+

      /* Direita: gráfico ocupa toda a altura dos 6 cards */
      '<div class="fin-kpi" style="display:flex;flex-direction:column;justify-content:center;padding:1.25rem">'+
        pieSVG(calc.fat_ml, calc.fat_sp, calc.fat_tt)+
      '</div>'+

    '</div>'+
    /* ROW 2 */
    '<div style="display:grid;grid-template-columns:1fr 1.5fr;gap:1.25rem">'+
      /* Left: 3 plat cards */
      '<div style="display:flex;flex-direction:column;gap:0.7rem">'+
        (function(){
          var cards=[
            {icon:'🟡',l:'Mercado Livre',v:calc.fat_ml,c:'#EAB308'},
            {icon:'🟠',l:'Shopee',v:calc.fat_sp,c:'#F97316'},
            {icon:'⚫',l:'TikTok Shop',v:calc.fat_tt,c:'#1a1a1a'},
          ];
          return cards.map(function(c){
            var pct=calc.fat>0?(c.v/calc.fat*100).toFixed(1):0;
            return '<div class="fin-kpi">'+
              '<div class="fin-kpi-label">'+c.icon+' '+c.l+'<span style="margin-left:auto;font-weight:500;color:var(--text3)">'+pct+'%</span></div>'+
              '<div class="fin-kpi-val" style="color:'+c.c+'">'+finFmt(c.v)+'</div>'+
              '<div class="fin-plat-bar"><div class="fin-plat-fill" style="width:'+pct+'%;background:'+c.c+'"></div></div>'+
            '</div>';
          }).join('');
        })() +
      '</div>'+
      /* Right: ranking */
      '<div class="fin-kpi" style="padding:1rem">'+
        '<div style="font-size:0.8rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:0.75rem">🏆 Ranking de Produtos (unidades)</div>'+
        '<div class="fin-rank-row" style="font-size:0.7rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.3px;border-bottom:2px solid var(--border)">'+
          '<span>Produto</span><span style="text-align:center">🟠ML</span><span style="text-align:center">🔴SP</span><span style="text-align:center">⚫TT</span><span style="text-align:center;font-weight:800">Total</span>'+
        '</div>'+
        '<div style="max-height:260px;overflow-y:auto">'+
          (calc.skus.length===0?'<div style="text-align:center;padding:2rem;color:var(--text3);font-size:0.85rem">Importe as planilhas para ver o ranking</div>':
          calc.skus.slice(0,25).map(function(s,i){
            var medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':'';
            return '<div class="fin-rank-row">'+
              '<span style="font-size:0.8rem;color:var(--text);font-weight:'+(i<3?700:400)+'">'+medal+' '+s.name+'</span>'+
              '<span style="text-align:center;font-size:0.82rem;color:'+(s.ml?'#f97316':'var(--text3)')+';font-weight:600">'+(s.ml||'—')+'</span>'+
              '<span style="text-align:center;font-size:0.82rem;color:'+(s.shopee?'#EE4D2D':'var(--text3)')+';font-weight:600">'+(s.shopee||'—')+'</span>'+
              '<span style="text-align:center;font-size:0.82rem;color:'+(s.tiktok?'#6366f1':'var(--text3)')+';font-weight:600">'+(s.tiktok||'—')+'</span>'+
              '<span style="text-align:center;font-size:0.85rem;font-weight:800;color:var(--text)">'+s.total+'</span>'+
            '</div>';
          }).join(''))+
        '</div>'+
      '</div>'+
    '</div>';

  /* ── UPLOAD ── */
  var uploadHtml =
    '<style>'+
      '.fin-drop-zone{border:1.5px dashed var(--border2);border-radius:14px;padding:24px 16px;text-align:center;cursor:pointer;transition:all 0.18s;background:var(--bg3);position:relative}'+
      '.fin-drop-zone:hover,.fin-drop-zone.drag-over{border-color:var(--green);background:rgba(26,138,74,0.06)}'+
      '.fin-drop-zone input[type=file]{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}'+
      '.fin-drop-icon{font-size:1.75rem;margin-bottom:6px}'+
      '.fin-drop-label{font-size:0.82rem;font-weight:600;color:var(--text2)}'+
      '.fin-drop-sub{font-size:0.72rem;color:var(--text3);margin-top:3px}'+
      '.fin-drop-sel{font-size:0.75rem;color:var(--green);font-weight:600;margin-top:6px;min-height:1rem}'+
      '.fin-mes-badge{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:0.5px solid var(--border)}'+
      '.fin-mes-badge:last-child{border-bottom:none}'+
      '.fin-plat-dot{display:inline-flex;align-items:center;gap:4px;font-size:0.72rem;padding:2px 8px;border-radius:99px;margin-right:4px}'+
    '</style>'+

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem">'+

      // Coluna seletor de mês
      '<div class="card" style="padding:1.25rem;display:flex;flex-direction:column;gap:1rem">'+
        '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3)">📅 Mês de referência</div>'+
        '<input type="month" id="fin-mes-input" style="width:100%;padding:11px 14px;border:0.5px solid var(--border2);border-radius:10px;background:var(--input-bg);color:var(--text);font-size:0.95rem;font-weight:600;outline:none;transition:border 0.2s">'+
        '<div style="font-size:0.78rem;color:var(--text3)">Selecione o mês antes de importar as planilhas. Importações anteriores do mesmo mês serão substituídas.</div>'+
      '</div>'+

      // Coluna status / importar
      '<div style="display:flex;flex-direction:column;gap:10px">'+
        '<div id="fin-upload-status" style="font-size:0.83rem;color:var(--text2);min-height:2rem;padding:8px 12px;background:var(--bg3);border-radius:8px;border:0.5px solid var(--border)"></div>'+
        '<button id="fin-upload-btn" style="width:100%;padding:13px;background:var(--green);color:#fff;border:none;border-radius:10px;font-size:0.92rem;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:opacity 0.15s" onmouseover="this.style.opacity=0.88" onmouseout="this.style.opacity=1">'+
          '<span style="font-size:1.1rem">⬆</span> Importar Planilhas'+
        '</button>'+
      '</div>'+
    '</div>'+

    // Drop zones — 3 colunas
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1.5rem">'+

      // ML
      '<div class="fin-drop-zone" id="drop-ml" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" ondrop="finHandleDrop(event,\'fin-ml-file\',\'drop-ml\')">'+
        '<input type="file" id="fin-ml-file" accept=".xlsx,.xls" onchange="finShowDropName(\'fin-ml-file\',\'drop-ml-name\')">'+
        '<div class="fin-drop-icon">🟠</div>'+
        '<div class="fin-drop-label">Mercado Livre</div>'+
        '<div class="fin-drop-sub">Arraste o .xlsx ou clique</div>'+
        '<div class="fin-drop-sel" id="drop-ml-name"></div>'+
      '</div>'+

      // Shopee
      '<div class="fin-drop-zone" id="drop-sp" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" ondrop="finHandleDrop(event,\'fin-sp-file\',\'drop-sp\')">'+
        '<input type="file" id="fin-sp-file" accept=".xlsx,.xls" onchange="finShowDropName(\'fin-sp-file\',\'drop-sp-name\')">'+
        '<div class="fin-drop-icon">🔴</div>'+
        '<div class="fin-drop-label">Shopee</div>'+
        '<div class="fin-drop-sub">Arraste o .xlsx ou clique</div>'+
        '<div class="fin-drop-sel" id="drop-sp-name"></div>'+
      '</div>'+

      // TikTok
      '<div class="fin-drop-zone" id="drop-tt" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" ondrop="finHandleDrop(event,\'fin-tt-file\',\'drop-tt\')">'+
        '<input type="file" id="fin-tt-file" accept=".xlsx,.xls" onchange="finShowDropName(\'fin-tt-file\',\'drop-tt-name\')">'+
        '<div class="fin-drop-icon">⚫</div>'+
        '<div class="fin-drop-label">TikTok Shop</div>'+
        '<div class="fin-drop-sub">Arraste o .xlsx ou clique</div>'+
        '<div class="fin-drop-sel" id="drop-tt-name"></div>'+
      '</div>'+

    '</div>'+

    // Meses importados
    (mesKeys.length?
      '<div class="card" style="padding:0;overflow:hidden">'+
        '<div style="padding:12px 16px;border-bottom:2px solid var(--border);font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3)">📆 Meses importados</div>'+
        mesKeys.map(function(k){
          var p=k.split('-'); var lbl=MONTHS[parseInt(p[1])-1]+'/'+p[0];
          var mes=meses[k];
          return '<div class="fin-mes-badge">'+
            '<div>'+
              '<div style="font-weight:600;font-size:0.9rem;margin-bottom:5px">'+lbl+'</div>'+
              '<div>'+
                '<span class="fin-plat-dot" style="background:'+(mes.ml?'rgba(249,115,22,0.12)':'var(--bg3)')+';color:'+(mes.ml?'#f97316':'var(--text3)')+'">'+
                  (mes.ml?'✓':'○')+' ML'+
                '</span>'+
                '<span class="fin-plat-dot" style="background:'+(mes.sp?'rgba(238,77,45,0.12)':'var(--bg3)')+';color:'+(mes.sp?'#EE4D2D':'var(--text3)')+'">'+
                  (mes.sp?'✓':'○')+' Shopee'+
                '</span>'+
                '<span class="fin-plat-dot" style="background:'+(mes.tt?'rgba(99,102,241,0.12)':'var(--bg3)')+';color:'+(mes.tt?'#6366f1':'var(--text3)')+'">'+
                  (mes.tt?'✓':'○')+' TikTok'+
                '</span>'+
              '</div>'+
            '</div>'+
            '<button onclick="finExcluirMes(\''+k+'\')" style="background:none;border:0.5px solid var(--border2);border-radius:8px;padding:6px 14px;color:var(--red);cursor:pointer;font-size:0.8rem;font-weight:600">🗑 Excluir</button>'+
          '</div>';
        }).join('')+
      '</div>'
    :'');

  /* ── DESPESAS ── */
  var despObj2   = state.financeiro.despesas || {};
  var todosMeses = Array.isArray(despObj2) ? [] : Object.keys(despObj2).sort().reverse();
  var MONTHS_D   = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  function getMesLabel(k) {
    if (!k || k === 'sem-mes') return 'Sem mês';
    var p = k.split('-');
    return (MONTHS_D[parseInt(p[1])-1]||p[1])+'/'+p[0];
  }
  function despIcon(desc) {
    var d = (desc||'').toLowerCase();
    if (/frete|transport|envio|correio|logist/.test(d))   return '🚚';
    if (/embal|caixa|sacol|papel|plast/.test(d))          return '📦';
    if (/fornec|compra|matéria|insumo/.test(d))           return '🛒';
    if (/aluguel|imóvel|armazém|galpão/.test(d))          return '🏭';
    if (/market|anúncio|publicid|tráfego/.test(d))        return '📣';
    if (/salário|funcionár|rh|colabor/.test(d))           return '👥';
    if (/conta|luz|água|energia|internet/.test(d))        return '⚡';
    if (/imposto|taxa|tribut|contab/.test(d))             return '🧾';
    return '💳';
  }

  // Mês selecionado nas despesas
  var despMesSel  = _despMesSel || (todosMeses[0] || '');
  var despMesArr  = despMesSel ? (despObj2[despMesSel] || []) : [];
  var despMesTot  = despMesArr.reduce(function(s,d){ return s+(d.valor||0); }, 0);
  var despMax     = despMesArr.length ? Math.max.apply(null, despMesArr.map(function(d){ return d.valor||0; })) : 1;

  // Totais histórico
  var despResumo = todosMeses.map(function(m) {
    var arr = despObj2[m] || [];
    return { key:m, label:getMesLabel(m), total:arr.reduce(function(s,d){return s+(d.valor||0);},0), qtd:arr.length };
  });
  var despTotalGeral = despResumo.reduce(function(s,m){ return s+m.total; }, 0);

  var despHtml =
    '<style>'+
      /* Sidebar de meses */
      '.desp-sidebar{display:flex;flex-direction:column;gap:4px}'+
      '.desp-mes-btn{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:9px;cursor:pointer;transition:background 0.13s;border:0.5px solid transparent;text-align:left;width:100%;font-family:inherit;font-size:0.85rem;background:transparent}'+
      '.desp-mes-btn:hover{background:var(--bg3)}'+
      '.desp-mes-btn.ativo{background:rgba(192,57,43,0.07);border-color:rgba(192,57,43,0.2);color:var(--red)}'+
      /* Items */
      '.desp-row{display:flex;align-items:center;gap:12px;padding:13px 16px;border-bottom:0.5px solid var(--border);transition:background 0.12s}'+
      '.desp-row:hover{background:var(--bg3)}'+
      '.desp-row:last-child{border-bottom:none}'+
      '.desp-ico{width:36px;height:36px;border-radius:9px;background:rgba(192,57,43,0.07);display:flex;align-items:center;justify-content:center;font-size:1.05rem;flex-shrink:0}'+
      '.desp-prog{height:3px;background:var(--border);border-radius:2px;margin-top:4px}'+
      '.desp-prog-fill{height:3px;background:rgba(192,57,43,0.45);border-radius:2px}'+
      /* Form */
      '.desp-field label{display:block;font-size:0.72rem;color:var(--text3);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}'+
      '.desp-field input{width:100%;padding:9px 12px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem;outline:none;font-family:inherit;transition:border 0.15s}'+
      '.desp-field input:focus{border-color:var(--red);box-shadow:0 0 0 3px rgba(192,57,43,0.08)}'+
    '</style>'+

    /* ══════════════════════════════════════════════════
       LAYOUT: sidebar de meses (esquerda) + conteúdo (direita)
    ══════════════════════════════════════════════════ */
    '<div style="display:flex;flex-direction:column;gap:1rem">'+

      /* Dropdown de mês exclusivo da aba despesas */
      (function(){
        var despObj4 = state.financeiro.despesas || {};
        var dKeys = Array.isArray(despObj4) ? [] : Object.keys(despObj4).sort().reverse();
        mesKeys.forEach(function(k){ if(dKeys.indexOf(k)===-1) dKeys.push(k); });
        dKeys.sort().reverse();
        if (!dKeys.length) return '<button onclick="despAbrirNovoMes()" style="padding:6px 16px;margin-bottom:0.25rem;border-radius:10px;font-size:0.82rem;cursor:pointer;border:1px dashed var(--border2);background:none;color:var(--text3);font-family:inherit">+ Criar primeiro mês</button>';
        function dLbl(k){ if(k==='sem-mes') return 'Sem mês'; var p=k.split('-'); return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(p[1])-1]+'/'+p[0]; }
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:0.25rem">'+
          '<div style="position:relative" id="desp-mes-wrap-desp">'+
            '<button onclick="despToggleMesDropDesp()" style="display:flex;align-items:center;gap:8px;padding:7px 16px 7px 12px;background:var(--card);border:0.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:0.88rem;font-weight:600;color:var(--text);backdrop-filter:blur(16px);box-shadow:var(--shadow)">'+
              '<span style="font-size:1rem">📅</span>'+
              '<span>'+(despMesSel?dLbl(despMesSel):'Selecionar mês')+'</span>'+
              '<span style="color:var(--text3);font-size:0.7rem">▾</span>'+
            '</button>'+
            '<div id="desp-mes-drop-desp" style="display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:999;background:var(--card);border:0.5px solid var(--border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.15);backdrop-filter:blur(20px);min-width:160px;overflow:hidden">'+
              dKeys.map(function(k){
                var act=k===despMesSel;
                return '<button onclick="despVerMes(\''+k+'\');despToggleMesDropDesp(true)" style="display:block;width:100%;text-align:left;padding:10px 16px;background:'+(act?'rgba(192,57,43,0.08)':'transparent')+';border:none;color:'+(act?'var(--red)':'var(--text)')+';font-weight:'+(act?'700':'400')+';font-size:0.88rem;cursor:pointer;font-family:inherit;border-bottom:0.5px solid var(--border2)">'+(act?'✓ ':'')+dLbl(k)+'</button>';
              }).join('')+
            '</div>'+
          '</div>'+
          '<button onclick="despAbrirNovoMes()" style="padding:7px 12px;border-radius:10px;font-size:0.82rem;cursor:pointer;border:0.5px solid var(--border2);background:none;color:var(--text3);font-family:inherit">+ Novo</button>'+
        '</div>';
      })()+

      /* ── CONTEÚDO (sem sidebar) ── */
      '<div style="display:flex;flex-direction:column;gap:1rem">'+

        /* Formulário compacto no topo */
        '<div class="card" style="padding:1.25rem">'+
          '<div id="desp-novo-mes-wrap" style="display:none;margin-bottom:1rem;padding:10px 14px;background:var(--bg3);border-radius:8px;border:0.5px solid var(--border2)">'+
            '<div style="font-size:0.72rem;color:var(--text3);margin-bottom:6px;font-weight:600;text-transform:uppercase">Criar novo mês</div>'+
            '<div style="display:flex;gap:8px;align-items:center">'+
              '<input type="month" id="fin-desp-novo-mes" style="flex:1;padding:7px 10px;border:0.5px solid var(--border2);border-radius:7px;background:var(--input-bg);color:var(--text);font-size:0.85rem;outline:none">'+
              '<button onclick="despConfirmarNovoMes()" style="padding:7px 14px;background:var(--green);color:#fff;border:none;border-radius:7px;font-size:0.82rem;font-weight:600;cursor:pointer">Criar</button>'+
              '<button onclick="despFecharNovoMes()" style="padding:7px 12px;background:none;border:0.5px solid var(--border2);border-radius:7px;font-size:0.82rem;color:var(--text3);cursor:pointer">✕</button>'+
            '</div>'+
          '</div>'+
          '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:12px">'+
            '➕ Nova despesa'+(despMesSel?' — '+getMesLabel(despMesSel):'')+
          '</div>'+
          '<input type="hidden" id="fin-desp-mes" value="'+(despMesSel||'')+'">'+
          '<div style="display:grid;grid-template-columns:1fr 1fr 120px auto;gap:10px;align-items:end">'+
            '<div class="desp-field">'+
              '<label>Descrição</label>'+
              '<input type="text" id="fin-desp-desc" placeholder="Ex: Embalagens, Frete...">'+
            '</div>'+
            '<div class="desp-field">'+
              '<label>Valor (R$)</label>'+
              '<input type="number" id="fin-desp-val" placeholder="0,00" min="0" step="0.01">'+
            '</div>'+
            '<div class="desp-field">'+
              '<label>Data</label>'+
              '<div style="position:relative">'+
                '<input type="text" id="fin-desp-data" placeholder="dd/mm/aaaa" maxlength="10" oninput="despMascaraData(this)" style="width:100%;padding:9px 36px 9px 12px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem;outline:none;font-family:inherit;transition:border 0.15s">'+
                '<input type="date" id="fin-desp-data-pick" onchange="despPickData(this.value)" tabindex="-1" style="position:absolute;right:0;top:0;width:32px;height:100%;opacity:0;cursor:pointer;border:none">'+
                '<span onclick="document.getElementById(\'fin-desp-data-pick\').showPicker()" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:0.9rem;color:var(--text3);pointer-events:all">📅</span>'+
              '</div>'+
            '</div>'+
            '<button onclick="finAddDespesa()" style="padding:9px 20px;background:var(--green);color:#fff;border:none;border-radius:8px;font-size:0.88rem;font-weight:700;cursor:pointer;white-space:nowrap;height:36px">+ Adicionar</button>'+
          '</div>'+
          '<div id="desp-add-status" style="font-size:0.8rem;margin-top:8px;min-height:1rem"></div>'+
        '</div>'+

        /* Lista de lançamentos do mês */
        (despMesSel?
          '<div class="card" style="padding:0;overflow:hidden">'+
            /* Header do card */
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:2px solid var(--border)">'+
              '<div>'+
                '<div style="font-weight:700;font-size:0.95rem">'+getMesLabel(despMesSel)+'</div>'+
                '<div style="font-size:0.75rem;color:var(--text3);margin-top:1px">'+despMesArr.length+' lançamento'+(despMesArr.length!==1?'s':'')+'</div>'+
              '</div>'+
              '<div style="font-size:1.25rem;font-weight:800;color:var(--red)">− '+finFmt(despMesTot)+'</div>'+
            '</div>'+
            /* Itens */
            (despMesArr.length===0?
              '<div style="padding:3rem;text-align:center;color:var(--text3)">'+
                '<div style="font-size:1.8rem;margin-bottom:8px">💸</div>'+
                '<div style="font-size:0.9rem">Nenhuma despesa em '+getMesLabel(despMesSel)+'</div>'+
              '</div>'
            :
              despMesArr.slice().map(function(d,i){return {d:d,i:i};})
                .sort(function(a,b){return (b.d.valor||0)-(a.d.valor||0);})
                .map(function(item){
                  var d=item.d, i=item.i;
                  var pct=despMax>0?Math.round(((d.valor||0)/despMax)*100):0;
                  return '<div class="desp-row">'+
                    '<div class="desp-ico">'+despIcon(d.desc)+'</div>'+
                    '<div style="flex:1;min-width:0">'+
                      '<div style="font-size:0.9rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(d.desc)+'</div>'+
                      '<div class="desp-prog"><div class="desp-prog-fill" style="width:'+pct+'%"></div></div>'+
                      (d.data?'<div style="font-size:0.72rem;color:var(--text3);margin-top:3px">'+esc(d.data)+'</div>':'')+
                    '</div>'+
                    '<div style="font-size:0.95rem;font-weight:700;color:var(--red);white-space:nowrap;margin:0 12px">− '+finFmt(d.valor)+'</div>'+
                    '<button onclick="finDelDespesa('+i+')" style="width:30px;height:30px;background:none;border:0.5px solid var(--border2);border-radius:7px;color:var(--text3);cursor:pointer;font-size:0.85rem;display:flex;align-items:center;justify-content:center;transition:all 0.15s" onmouseover="this.style.borderColor=\'var(--red)\';this.style.color=\'var(--red)\'" onmouseout="this.style.borderColor=\'var(--border2)\';this.style.color=\'var(--text3)\'">🗑</button>'+
                  '</div>';
                }).join('')
            )+
          '</div>'
        :
          '<div class="card" style="padding:3rem;text-align:center;color:var(--text3)">'+
            '<div style="font-size:2rem;margin-bottom:10px">📅</div>'+
            '<div style="font-size:0.95rem;font-weight:500;color:var(--text2)">Selecione um mês acima</div>'+
            '<div style="font-size:0.82rem;margin-top:4px">ou clique em "+ Novo" para criar</div>'+
          '</div>'
        )+
      '</div>'+
    '</div>';

    /* ── EMPTY STATE ── */
  if (mesKeys.length===0 && _finTab==='visao') {
    visaoHtml = '<div class="card" style="text-align:center;padding:3.5rem;color:var(--text3)">'+
      '<div style="font-size:3rem;margin-bottom:1rem">📊</div>'+
      '<div style="font-size:1.1rem;font-weight:700;color:var(--text);margin-bottom:0.5rem">Nenhum dado importado</div>'+
      '<div style="font-size:0.9rem;margin-bottom:1.5rem">Importe as planilhas para ver o painel financeiro</div>'+
      '<button class="btn btn-green" onclick="finSetTab(\'upload\')" style="padding:0.65rem 1.5rem">📁 Importar Planilhas</button>'+
    '</div>';
  }

  /* ── PILL MÊS STYLE ── */
  var pillStyle = '<style>.fin-mes-pill{padding:4px 14px;border-radius:99px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:0.8rem;cursor:pointer;font-family:inherit;transition:all 0.15s}.fin-mes-pill.active{background:var(--green);border-color:var(--green);color:#fff;font-weight:600}.fin-mes-pill:hover:not(.active){background:var(--bg3)}</style>';

  return pillStyle+
    '<div class="fin-tabs" id="fin-tabs">'+
      '<button class="fin-tab'+(_finTab==='visao'?' active':'')+'" data-tab="visao" onclick="finSetTab(\'visao\')">📊 Visão Geral</button>'+
      '<button class="fin-tab'+(_finTab==='upload'?' active':'')+'" data-tab="upload" onclick="finSetTab(\'upload\')">📁 Importar Planilhas</button>'+
      '<button class="fin-tab'+(_finTab==='despesas'?' active':'')+'" data-tab="despesas" onclick="finSetTab(\'despesas\')">💸 Despesas</button>'+
                '</div>'+
    '<div id="fin-visao"  style="display:'+(_finTab==='visao'?'':'none')+'">'+
      (mesKeys.length>0?(function(){
        function mL(k){var p=k.split('-');return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(p[1])-1]+'/'+p[0];}
        return '<div style="position:relative;display:inline-block;margin-bottom:1.25rem" id="fin-mes-wrap-visao">'
          +'<button onclick="finToggleMesDropVisao()" style="display:flex;align-items:center;gap:8px;padding:7px 16px 7px 12px;background:var(--card);border:0.5px solid var(--border);border-radius:10px;cursor:pointer;font-size:0.88rem;font-weight:600;color:var(--text);backdrop-filter:blur(16px);box-shadow:var(--shadow)">'
          +'<span style="font-size:1rem">📅</span>'
          +'<span>'+(_finMesSel?mL(_finMesSel):'Selecionar mês')+'</span>'
          +'<span style="color:var(--text3);font-size:0.7rem">▾</span>'
          +'</button>'
          +'<div id="fin-mes-drop-visao" style="display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:999;background:var(--card);border:0.5px solid var(--border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.15);backdrop-filter:blur(20px);min-width:160px;overflow:hidden">'
          +mesKeys.map(function(k){var act=k===_finMesSel;return '<button data-mes="'+k+'" onclick="finSelMesVisao(this.getAttribute(\'data-mes\'))" style="display:block;width:100%;text-align:left;padding:10px 16px;background:'+(act?'rgba(26,138,74,0.1)':'transparent')+';border:none;color:'+(act?'var(--green)':'var(--text)')+';font-weight:'+(act?'700':'400')+';font-size:0.88rem;cursor:pointer;font-family:inherit;border-bottom:0.5px solid var(--border2)">'+(act?'\u2713 ':'')+mL(k)+'</button>';}).join('')
          +'</div></div>';
      })():'')+visaoHtml+
    '</div>'+
    '<div id="fin-upload" style="display:'+(_finTab==='upload'?'':'none')+'">'+uploadHtml+'</div>'+
    '<div id="fin-despesas" style="display:'+(_finTab==='despesas'?'':'none')+'">'+despHtml+'</div>'+
    '';
}

// _finLoaded é declarado globalmente no index.html — não redeclarar aqui
function bindFinanceiro() {
  var mesInp = document.getElementById('fin-mes-input');
  if (mesInp && !mesInp.value) {
    var now = new Date();
    mesInp.value = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  }
  var btn = document.getElementById('fin-upload-btn');
  if (btn) btn.onclick = finImportar;
  // Carrega do Firebase se ainda não carregou OU se os dados estão vazios
  var mesFaltando = Object.keys(state.financeiro.tarifasSku || {}).length === 0;
  if (!_finLoaded || mesFaltando) {
    _finLoaded = true;
    finLoadFirebase().then(function() {
      if (state.currentPage === 'financeiro') {
        var c = document.getElementById('page-content');
        if (c) { c.innerHTML = renderFinanceiro(); bindFinanceiro(); }
      }
    });
  }
}

function finSelMes(k) {
  _finMesSel = k;
  navigate('financeiro');
}

function finExcluirMes(k) {
  if (!confirm('Excluir dados de '+k+'?')) return;
  delete state.financeiro.meses[k];
  if (_finMesSel===k) _finMesSel='';
  finSaveFirebase().then(function(){ navigate('financeiro'); });
}

function despRenderMesBtn(m, despMesSel) {
  var isAtivo = m.key === despMesSel;
  var el = document.createElement('button');
  el.className = 'desp-mes-btn' + (isAtivo ? ' ativo' : '');
  el.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:9px;cursor:pointer;border:0.5px solid '+(isAtivo?'rgba(192,57,43,0.2)':'transparent')+';background:'+(isAtivo?'rgba(192,57,43,0.07)':'transparent')+';width:100%;font-family:inherit;font-size:0.85rem;text-align:left';
  var key = m.key;
  el.onclick = function(){ despVerMes(key); };
  el.innerHTML =
    '<div>'+
      '<div style="font-weight:'+(isAtivo?'700':'500')+'">'+m.label+'</div>'+
      '<div style="font-size:0.72rem;color:'+(isAtivo?'rgba(192,57,43,0.7)':'var(--text3)')+'">'+m.qtd+' lançamento'+(m.qtd!==1?'s':'')+'</div>'+
    '</div>'+
    '<div style="font-weight:700;font-size:0.82rem;color:'+(isAtivo?'var(--red)':'var(--text2)')+'">'+finFmt(m.total)+'</div>';
  return el.outerHTML;
}

function despVerMes(mes) {
  _despMesSel = mes;
  var c = document.getElementById('page-content');
  if (c) { c.innerHTML = renderFinanceiro(); bindFinanceiro(); }
}

function despFecharNovoMes() {
  var w = document.getElementById('desp-novo-mes-wrap');
  if (w) w.style.display = 'none';
}

function despAbrirNovoMes() {
  var w = document.getElementById('desp-novo-mes-wrap');
  if (w) w.style.display = w.style.display === 'none' ? 'block' : 'none';
  var inp = document.getElementById('fin-desp-novo-mes');
  if (inp && !inp.value) {
    var now = new Date();
    inp.value = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
  }
}

function despConfirmarNovoMes() {
  var inp = document.getElementById('fin-desp-novo-mes');
  if (!inp || !inp.value) { alert('Selecione um mês.'); return; }
  var mes = inp.value;
  if (!state.financeiro.despesas || Array.isArray(state.financeiro.despesas)) state.financeiro.despesas = {};
  if (!state.financeiro.despesas[mes]) state.financeiro.despesas[mes] = [];
  _despMesSel = mes;
  var c = document.getElementById('page-content');
  if (c) { c.innerHTML = renderFinanceiro(); bindFinanceiro(); }
}

function despSetMes(mes) {
  _despMesSel = mes;
  // Atualiza o input hidden e o botão sem re-render completo
  var inp = document.getElementById('fin-desp-mes');
  if (inp) inp.value = mes;
  var btn = document.querySelector('#desp-mes-wrap > button > span:first-child');
  if (btn) {
    var p = mes.split('-');
    var lbl = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][parseInt(p[1])-1]+'/'+p[0];
    btn.textContent = lbl;
  }
  despToggleMesDrop(true);
  // Atualiza a lista de lançamentos abaixo
  var c = document.getElementById('page-content');
  if (c) { c.innerHTML = renderFinanceiro(); bindFinanceiro(); }
}

function despToggleMesDrop(forceClose) {
  var drop = document.getElementById('desp-mes-drop');
  if (!drop) return;
  var isOpen = drop.style.display !== 'none';
  if (forceClose || isOpen) {
    drop.style.display = 'none';
  } else {
    drop.style.display = 'block';
    setTimeout(function(){
      document.addEventListener('click', function fechar(e){
        var wrap = document.getElementById('desp-mes-wrap');
        if (!wrap || !wrap.contains(e.target)) {
          drop.style.display = 'none';
          document.removeEventListener('click', fechar);
        }
      });
    }, 10);
  }
}

function finHandleDrop(event, inputId, zoneId) {
  event.preventDefault();
  var zone = document.getElementById(zoneId);
  if (zone) zone.classList.remove('drag-over');
  var files = event.dataTransfer.files;
  if (!files || !files[0]) return;
  var inp = document.getElementById(inputId);
  if (!inp) return;
  // Atribui o arquivo ao input via DataTransfer
  var dt = new DataTransfer();
  dt.items.add(files[0]);
  inp.files = dt.files;
  var nameId = zoneId.replace('drop-','drop-') + '-name';
  var nameEl = document.getElementById(zoneId + '-name');
  if (nameEl) {
    nameEl.textContent = '✓ ' + files[0].name;
    nameEl.style.color = 'var(--green)';
  }
  if (zone) { zone.style.borderColor = 'var(--green)'; zone.style.background = 'rgba(26,138,74,0.06)'; }
}

function finShowDropName(inputId, nameElId) {
  var inp = document.getElementById(inputId);
  var nameEl = document.getElementById(nameElId);
  if (!inp || !nameEl) return;
  if (inp.files && inp.files[0]) {
    nameEl.textContent = '✓ ' + inp.files[0].name;
    nameEl.style.color = 'var(--green)';
    var zone = inp.parentElement;
    if (zone) { zone.style.borderColor = 'var(--green)'; zone.style.background = 'rgba(26,138,74,0.06)'; }
  }
}

function finVerDesp(mes) {
  _despMesSel = mes;
  finSetTab('despesas');
}

function despMascaraData(inp) {
  var v = inp.value.replace(/\D/g, '').slice(0, 8);
  if (v.length >= 5)      v = v.slice(0,2)+'/'+v.slice(2,4)+'/'+v.slice(4);
  else if (v.length >= 3) v = v.slice(0,2)+'/'+v.slice(2);
  inp.value = v;
}

function despPickData(isoDate) {
  // isoDate = "2026-05-13" → converte para "13/05/2026"
  if (!isoDate) return;
  var p = isoDate.split('-');
  if (p.length === 3) {
    var inp = document.getElementById('fin-desp-data');
    if (inp) inp.value = p[2]+'/'+p[1]+'/'+p[0];
  }
}

function finSelMesVisao(k) {
  finSelMes(k);
  finToggleMesDropVisao(true);
}

function finToggleMesDropVisao(forceClose) {
  var drop = document.getElementById('fin-mes-drop-visao');
  if (!drop) return;
  var isOpen = drop.style.display !== 'none';
  if (forceClose || isOpen) {
    drop.style.display = 'none';
  } else {
    drop.style.display = 'block';
    setTimeout(function(){
      document.addEventListener('click', function fechar(e){
        var wrap = document.getElementById('fin-mes-wrap-visao');
        if (!wrap || !wrap.contains(e.target)) {
          drop.style.display = 'none';
          document.removeEventListener('click', fechar);
        }
      });
    }, 10);
  }
}

function despToggleMesDropDesp(forceClose) {
  var drop = document.getElementById('desp-mes-drop-desp');
  if (!drop) return;
  var isOpen = drop.style.display !== 'none';
  if (forceClose || isOpen) {
    drop.style.display = 'none';
  } else {
    drop.style.display = 'block';
    setTimeout(function(){
      document.addEventListener('click', function fechar(e){
        var wrap = document.getElementById('desp-mes-wrap-desp');
        if (!wrap || !wrap.contains(e.target)) {
          drop.style.display = 'none';
          document.removeEventListener('click', fechar);
        }
      });
    }, 10);
  }
}

function finEditAliquota() {
  var atual = state.financeiro.aliquota||0;
  var novo = prompt('Alíquota de imposto (% sobre o faturamento bruto):', atual);
  if (novo===null) return;
  var val = parseFloat(String(novo).replace(',','.'));
  if (isNaN(val)||val<0||val>100) { alert('Valor inválido. Informe um número entre 0 e 100.'); return; }
  state.financeiro.aliquota = val;
  finSaveFirebase().then(function(){ navigate('financeiro'); });
}

function finAddDespesa() {
  var descEl = document.getElementById('fin-desp-desc');
  var valEl  = document.getElementById('fin-desp-val');
  var dataEl = document.getElementById('fin-desp-data');
  var desc = descEl ? descEl.value.trim() : '';
  var val  = valEl  ? parseFloat(valEl.value.replace(',','.')) : 0;
  var data = (dataEl && dataEl.value.trim()) ? dataEl.value.trim() : new Date().toLocaleDateString('pt-BR');
  if (!desc) { alert('Informe a descrição.'); return; }
  if (!val||val<=0) { alert('Informe um valor válido.'); return; }
  var mesEl2 = document.getElementById('fin-desp-mes');
  var mes = (mesEl2 && mesEl2.value) ? mesEl2.value : (_despMesSel || '');
  if (!mes) { alert('Selecione o mês de referência.'); return; }
  if (!state.financeiro.despesas || Array.isArray(state.financeiro.despesas)) state.financeiro.despesas={};
  if (!state.financeiro.despesas[mes]) state.financeiro.despesas[mes] = [];
  state.financeiro.despesas[mes].push({ desc:desc, valor:val, data:data });
  // Atualiza _finMesSel para o mês recém-adicionado
  _despMesSel = mes;
  // Limpa campos
  if (descEl) descEl.value = '';
  if (valEl)  valEl.value  = '';
  var statusEl = document.getElementById('desp-add-status');
  if (statusEl) { statusEl.textContent = '✓ Adicionado!'; statusEl.style.color='var(--green)'; setTimeout(function(){ statusEl.textContent=''; },2000); }
  finSaveFirebase().then(function(){ var c=document.getElementById('page-content'); if(c) c.innerHTML=renderFinanceiro(); bindFinanceiro(); });
}

function finDelDespesa(i) {
  if (!confirm('Remover esta despesa?')) return;
  var despObj = state.financeiro.despesas || {};
  var mes = _despMesSel || 'sem-mes';
  var arr = Array.isArray(despObj) ? despObj : (despObj[mes] || []);
  arr.splice(i, 1);
  if (!Array.isArray(despObj)) state.financeiro.despesas[mes] = arr;
  finSaveFirebase().then(function(){
    var c = document.getElementById('page-content');
    if (c) { c.innerHTML = renderFinanceiro(); bindFinanceiro(); }
  });
}


// ── Comprime planilha para só os campos necessários ──────────────────────
function finComprimirML(rows) {
  return (rows||[]).map(function(r){
    return {
      e: String(r['Estado']||''),
      s: String(r['SKU']||''),
      u: parseFloat(r['Unidades'])||0,
      f: parseFloat(r['Preço unitário de venda do anúncio (BRL)'])||0,
      t: parseFloat(r['Tarifa de venda e impostos (BRL)'])||0,
      v: parseFloat(r['Tarifas de envio (BRL)'])||0,
    };
  });
}
function finComprimirSP(rows) {
  return (rows||[]).map(function(r){
    return {
      st: String(r['Status do pedido']||''),
      sk: String(r['Número de referência SKU']||''),
      q:  parseInt(r['Quantidade'])||0,
      v:  parseFloat(r['Valor Total'])||0,
      c:  parseFloat(r['Taxa de comissão bruta'])||0,
      s:  parseFloat(r['Taxa de serviço bruta'])||0,
    };
  });
}
function finComprimirTT(rows) {
  var seen = {};
  var out  = [];
  (rows||[]).forEach(function(r){
    var oid = String(r['Order ID']||'');
    var sku = String(r['Seller SKU']||'');
    var key = oid+'|'+sku;
    if (seen[key]) return;
    seen[key] = true;
    out.push({
      os: String(r['Order Status']||''),
      sk: sku,
      oid: oid,
      q:  parseInt(r['Quantity'])||0,
      v:  finParseBRL(r['SKU Subtotal After Discount']),
      vb: finParseBRL(r['SKU Subtotal Before Discount']),
      dp: finParseBRL(r['SKU Platform Discount']),
      ds: finParseBRL(r['SKU Seller Discount']),
    });
  });
  return out;
}

// ── Expansores: transforma formato comprimido de volta para o formato que finCalcMes usa
function finExpandirML(rows) {
  return (rows||[]).map(function(r){
    return {
      'Estado': r.e||'',
      'SKU':    r.s||'',
      'Unidades': r.u||0,
      'Preço unitário de venda do anúncio (BRL)': r.f||0,
      'Tarifa de venda e impostos (BRL)': r.t||0,
      'Tarifas de envio (BRL)': r.v||0,
    };
  });
}
function finExpandirSP(rows) {
  return (rows||[]).map(function(r){
    return {
      'Status do pedido': r.st||'',
      'Número de referência SKU': r.sk||'',
      'Quantidade': r.q||0,
      'Valor Total': r.v||0,
      'Taxa de comissão bruta': r.c||0,
      'Taxa de serviço bruta': r.s||0,
    };
  });
}
function finExpandirTT(rows) {
  return (rows||[]).map(function(r){
    return {
      'Order Status':  r.os||'',
      'Seller SKU':    r.sk||'',
      'Order ID':      r.oid||'',
      'Quantity':      r.q||0,
      'SKU Subtotal After Discount':  'BRL ' + String(r.v||0).replace('.',','),
      'SKU Subtotal Before Discount': 'BRL ' + String(r.vb||0).replace('.',','),
      'SKU Platform Discount':        'BRL ' + String(r.dp||0).replace('.',','),
      'SKU Seller Discount':          'BRL ' + String(r.ds||0).replace('.',','),
    };
  });
}

async function finSaveFirebase() {
  try {
    var meses = state.financeiro.meses || {};

    // 1. Salva metadados (despesas + alíquota) — pequeno, vai junto
    var meta = {
      despesas:      state.financeiro.despesas || {},
      aliquota:      state.financeiro.aliquota || 0,
      mesKeys:       Object.keys(meses),
      custoProdutos: state.financeiro.custoProdutos || {},
      tarifasSku:    state.financeiro.tarifasSku    || {},
    };
    var r1 = await fetch(FIREBASE_URL + '/financeiro/meta.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
    if (!r1.ok) throw new Error('HTTP ' + r1.status + ' (meta)');

    // 2. Salva cada mês comprimido num nó próprio
    for (var mesKey in meses) {
      var mes = meses[mesKey];
      var payload = {
        ml: mes.ml ? finComprimirML(mes.ml) : null,
        sp: mes.sp ? finComprimirSP(mes.sp) : null,
        tt: mes.tt ? finComprimirTT(mes.tt) : null,
      };
      var safeKey = mesKey.replace('-','_'); // Firebase não aceita hífen em chave de path
      var r2 = await fetch(FIREBASE_URL + '/financeiro/meses/' + safeKey + '.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r2.ok) throw new Error('HTTP ' + r2.status + ' (mes ' + mesKey + ')');
    }
    console.log('Financeiro salvo no Firebase OK');
  } catch(e) {
    console.error('finSaveFirebase error:', e);
    alert('Erro ao salvar no servidor: ' + e.message);
  }
}

async function finLoadFirebase() {
  try {
    // 1. Carrega meta
    var r1 = await fetch(FIREBASE_URL + '/financeiro/meta.json');
    if (!r1.ok) return;
    var meta = await r1.json();
    if (!meta) return;
    // Compatibilidade: se vier array (formato antigo), migra para objeto
    var rawDesp = meta.despesas;
    if (Array.isArray(rawDesp)) {
      var migrado = {};
      if (rawDesp.length) migrado['sem-mes'] = rawDesp;
      state.financeiro.despesas = migrado;
    } else {
      state.financeiro.despesas = rawDesp || {};
    }
    state.financeiro.aliquota      = meta.aliquota || 0;
    state.financeiro.custoProdutos = meta.custoProdutos || {};
    state.financeiro.tarifasSku    = meta.tarifasSku    || {};

    // 2. Carrega cada mês — usa mesKeys se existir, senão busca /financeiro/meses diretamente
    var mesKeys = meta.mesKeys || [];
    if (!mesKeys.length) {
      // Tenta descobrir meses listando o nó /financeiro/meses
      var rMeses = await fetch(FIREBASE_URL + '/financeiro/meses.json?shallow=true');
      if (rMeses.ok) {
        var mesesShallow = await rMeses.json();
        if (mesesShallow && typeof mesesShallow === 'object') {
          // chaves são no formato 2025_06, converter para 2025-06
          mesKeys = Object.keys(mesesShallow).map(function(k){ return k.replace('_','-'); });
        }
      }
    }

    state.financeiro.meses = {};
    for (var i = 0; i < mesKeys.length; i++) {
      var k = mesKeys[i];
      var safeKey = k.replace('-','_');
      var r2 = await fetch(FIREBASE_URL + '/financeiro/meses/' + safeKey + '.json');
      if (!r2.ok) continue;
      var mesData = await r2.json();
      if (!mesData) continue;
      state.financeiro.meses[k] = {
        ml: mesData.ml ? finExpandirML(mesData.ml) : null,
        sp: mesData.sp ? finExpandirSP(mesData.sp) : null,
        tt: mesData.tt ? finExpandirTT(mesData.tt) : null,
      };
    }
    console.log('Financeiro carregado OK. meses:', Object.keys(state.financeiro.meses), '| tarifas:', Object.keys(state.financeiro.tarifasSku).length, 'SKUs');
  } catch(e) {
    console.error('finLoadFirebase error:', e);
  }
}
async function finImportar() {
  var mesInp = document.getElementById('fin-mes-input');
  var mlInp  = document.getElementById('fin-ml-file');
  var spInp  = document.getElementById('fin-sp-file');
  var ttInp  = document.getElementById('fin-tt-file');
  var status = document.getElementById('fin-upload-status');
  var btn    = document.getElementById('fin-upload-btn');

  var mes = mesInp ? mesInp.value : '';
  if (!mes) { if(status) status.textContent='⚠ Selecione o mês.'; return; }
  if ((!mlInp||!mlInp.files.length) && (!spInp||!spInp.files.length) && (!ttInp||!ttInp.files.length)) {
    if(status) status.textContent='⚠ Selecione ao menos uma planilha.'; return;
  }

  if(btn) btn.disabled=true;
  if(status) status.innerHTML='<span style="color:var(--blue)">⏳ Carregando biblioteca Excel...</span>';

  try {
    if (typeof XLSX==='undefined') {
      await new Promise(function(res,rej){
        var s=document.createElement('script');
        s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload=res; s.onerror=rej; document.head.appendChild(s);
      });
    }

    if (!state.financeiro.meses) state.financeiro.meses={};
    if (!state.financeiro.meses[mes]) state.financeiro.meses[mes]={};

    function readSheet(file, sheetName, skipRows) {
      return new Promise(function(resolve,reject){
        var reader=new FileReader();
        reader.onerror=reject;
        reader.onload=function(e){
          try {
            var wb=XLSX.read(new Uint8Array(e.target.result),{type:'array'});
            var wsName=sheetName||wb.SheetNames[0];
            var ws=wb.Sheets[wsName];
            if(!ws){ wsName=wb.SheetNames[0]; ws=wb.Sheets[wsName]; }
            var json=XLSX.utils.sheet_to_json(ws,{range:skipRows||0,defval:'',raw:false});
            resolve(json);
          } catch(err){ reject(err); }
        };
        reader.readAsArrayBuffer(file);
      });
    }

    var msgs=[];

    if (mlInp && mlInp.files.length) {
      if(status) status.innerHTML='<span style="color:var(--blue)">⏳ Processando Mercado Livre...</span>';
      var mlData=await readSheet(mlInp.files[0],'Vendas BR',5);
      state.financeiro.meses[mes].ml=mlData;
      msgs.push('✅ ML: '+mlData.length+' linhas');
    }
    if (spInp && spInp.files.length) {
      if(status) status.innerHTML='<span style="color:var(--blue)">⏳ Processando Shopee...</span>';
      var spData=await readSheet(spInp.files[0],'orders',0);
      state.financeiro.meses[mes].sp=spData;
      msgs.push('✅ Shopee: '+spData.length+' linhas');
    }
    if (ttInp && ttInp.files.length) {
      if(status) status.innerHTML='<span style="color:var(--blue)">⏳ Processando TikTok...</span>';
      var ttRaw=await readSheet(ttInp.files[0],'OrderSKUList',0);
      // Remove description row (first row with non-numeric Order ID)
      var ttData=ttRaw.filter(function(r){
        return /^\d{15,}/.test(String(r['Order ID']||''));
      });
      state.financeiro.meses[mes].tt=ttData;
      msgs.push('✅ TikTok: '+ttData.length+' pedidos');
    }

    _finMesSel=mes;
    if(status) status.innerHTML='<span style="color:var(--blue)">⏳ Salvando no servidor...</span>';
    await finSaveFirebase();
    if(status) status.innerHTML='<span style="color:var(--green)">'+msgs.join(' · ')+' — Concluído!</span>';
    if(btn) btn.disabled=false;
    setTimeout(function(){ _finTab='visao'; navigate('financeiro'); },1200);
  } catch(e) {
    if(status) status.innerHTML='<span style="color:var(--red)">❌ Erro: '+e.message+'</span>';
    if(btn) btn.disabled=false;
    console.error('finImportar error:',e);
  }
}
