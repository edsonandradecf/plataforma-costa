// --- PRODUTOS ------------------------------------------------------------------
// Cadastro dinâmico de produtos finais (substitui PRODUTOS_CUSTO fixo)

var _prodTab     = 'lista';  // 'lista' | 'form' | 'custo' | 'historico'
var _prodSel     = null;     // SKU do produto sendo editado (null = novo)
var _prodLoading = false;
var _prodCarregado = false;

// ── Firebase ────────────────────────────────────────────────────────────────

function prodLoadFirebase() {
  return fetch(FIREBASE_URL + '/produtos.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && typeof data === 'object') {
        state.produtos = Object.values(data).filter(Boolean);
      }
      _prodCarregado = true;
    })
    .catch(function() { _prodCarregado = true; });
}

function prodSaveFirebase() {
  // Salva como objeto indexado por SKU
  var obj = {};
  (state.produtos || []).forEach(function(p) { obj[p.sku] = p; });
  return fetch(FIREBASE_URL + '/produtos.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  }).catch(function() {});
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Calcula custo dinâmico de um produto final
function prodCustoAtual(prod) {
  if (!prod) return null;
  var total = 0;
  var mps = prod.materiasPrimas || [];
  for (var i = 0; i < mps.length; i++) {
    var mp = mps[i];
    // Busca o item no estoque pelo id (nome do item a granel)
    var item = (state.estoque.produtos || []).find(function(p) { return p.nome === mp.estoqueNome; });
    if (!item) continue;
    // Pega o último preço/kg do histórico de compras
    var hist = (state.estoque.historicoManual || []).concat(
      (state.estoque.movimentacoes || []).filter(function(m) { return m.tipo === 'entrada' && m.totalKg > 0; })
    );
    var maisRecente = null;
    hist.forEach(function(r) {
      if (!r.totalKg) return;
      var nomeLow = (r.produto || '').toLowerCase();
      if (nomeLow.indexOf(item.nome.toLowerCase().substring(0, 6)) !== -1) {
        if (!maisRecente || (r.dataISO || '') > (maisRecente.dataISO || '')) maisRecente = r;
      }
    });
    if (maisRecente) {
      total += parseFloat(maisRecente.totalKg) * mp.pesoUsado / 1000;
    }
  }
  total += parseFloat(prod.embalagem) || 0;
  total += parseFloat(prod.caixa) || 0;
  return round4(total);
}

// ── Renderização principal ───────────────────────────────────────────────────

function renderProdutos() {
  // Carrega dados do Firebase se ainda não carregou
  if (!_prodCarregado) {
    prodLoadFirebase().then(function() {
      var c = document.getElementById('page-content');
      if (c && state.currentPage === 'produtos') c.innerHTML = renderProdutos();
    });
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem;gap:1rem">' +
      '<div style="width:40px;height:40px;border:3px solid var(--border);border-top-color:var(--green);border-radius:50%;animation:spin 0.7s linear infinite"></div>' +
      '<div style="color:var(--text2);font-size:0.9rem">Carregando produtos...</div>' +
    '</div>';
  }

  if (!_finLoaded) {
    _finLoaded = true;
    finLoadFirebase().then(function() {
      var c = document.getElementById('page-content');
      if (c && state.currentPage === 'produtos') c.innerHTML = renderProdutos();
    });
  }

  if (_prodTab === 'form')      return renderProdutosForm();
  if (_prodTab === 'custo')     return renderProdutosLista() + renderEstoqueCusto();
  if (_prodTab === 'historico') return renderProdutosLista() + renderEstoqueHistorico();
  return renderProdutosLista();
}

function prodSetTab(t) {
  _prodTab = t;
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderProdutos();
}

// ── Lista de produtos ────────────────────────────────────────────────────────

function renderProdutosLista() {
  var produtos = (state.produtos || []).filter(function(p) { return p.ativo !== false; });
  produtos.sort(function(a, b) { return a.nome.localeCompare(b.nome); });

  var tabBar =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">' +
      '<div style="display:flex;gap:4px;border-bottom:1.5px solid var(--border);padding-bottom:0">' +
        '<button class="fin-tab' + (_prodTab === 'lista' || _prodTab === 'form' ? ' active' : '') + '" onclick="prodSetTab(\'lista\')" style="font-size:0.88rem">📦 Produtos</button>' +
        '<button class="fin-tab' + (_prodTab === 'historico' ? ' active' : '') + '" onclick="prodSetTab(\'historico\')" style="font-size:0.88rem">📈 Histórico de Preços</button>' +
      '</div>' +
      (isAdmin() ? '<button class="btn btn-green" onclick="prodAbrirForm(null)" style="font-size:0.85rem">+ Novo Produto</button>' : '') +
    '</div>';

  if (!produtos.length) {
    return tabBar + '<div class="empty-state">' + iconEmpty() + '<p>Nenhum produto cadastrado ainda.<br>Clique em "+ Novo Produto" para começar.</p></div>';
  }

  var rows = produtos.map(function(p) {
    var custo = prodCustoAtual(p);
    var mpNomes = (p.materiasPrimas || []).map(function(mp) { return mp.estoqueNome + ' (' + mp.pesoUsado + 'g)'; }).join(', ');
    return '<tr style="border-bottom:0.5px solid var(--border);cursor:pointer" onclick="prodAbrirForm(\'' + esc(p.sku) + '\')">' +
      '<td style="padding:10px 14px;font-weight:500">' + esc(p.nome) + '</td>' +
      '<td style="padding:10px 10px;font-family:monospace;font-size:0.8rem;color:var(--text3)">' + esc(p.sku) + '</td>' +
      '<td style="padding:10px 10px;text-align:right">' + p.peso + 'g</td>' +
      '<td style="padding:10px 10px;font-size:0.8rem;color:var(--text2)">' + esc(mpNomes) + '</td>' +
      '<td style="padding:10px 10px;text-align:right">' + (custo !== null ? 'R$ ' + custo.toFixed(2).replace('.', ',') : '—') + '</td>' +
      (isAdmin() ?
        '<td style="padding:10px 14px;text-align:right">' +
          '<button onclick="event.stopPropagation();prodExcluir(\'' + esc(p.sku) + '\')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:0.8rem">Excluir</button>' +
        '</td>' : '<td></td>') +
    '</tr>';
  }).join('');

  return tabBar +
    '<div class="card" style="padding:0;overflow:auto">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.88rem">' +
        '<thead><tr style="border-bottom:1.5px solid var(--border)">' +
          '<th style="text-align:left;padding:10px 14px">Nome</th>' +
          '<th style="text-align:left;padding:10px 10px">SKU</th>' +
          '<th style="text-align:right;padding:10px 10px">Peso</th>' +
          '<th style="text-align:left;padding:10px 10px">Matéria-prima</th>' +
          '<th style="text-align:right;padding:10px 10px">Custo Atual</th>' +
          '<th style="padding:10px 14px"></th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
}

// ── Formulário de cadastro/edição ────────────────────────────────────────────

function prodAbrirForm(sku) {
  _prodSel = sku;
  _prodTab = 'form';
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderProdutos();
}

function renderProdutosForm() {
  var isEdit = !!_prodSel;
  var prod = isEdit ? (state.produtos || []).find(function(p) { return p.sku === _prodSel; }) : null;

  // Itens disponíveis no estoque (matérias-primas)
  var itensEstoque = (state.estoque.produtos || []).slice().sort(function(a, b) { return a.nome.localeCompare(b.nome); });

  // Matérias-primas atuais do produto (para edição)
  var mpsAtuais = prod ? (prod.materiasPrimas || []) : [];

  var mpRows = mpsAtuais.map(function(mp, i) {
    return prodMpRow(i, mp.estoqueNome, mp.pesoUsado, itensEstoque);
  }).join('');

  // Se não tem nenhuma, começa com 1 linha vazia
  if (!mpRows) mpRows = prodMpRow(0, '', '', itensEstoque);

  return '<button onclick="prodSetTab(\'lista\')" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:1.25rem;background:none;border:0.5px solid var(--border2);border-radius:8px;padding:6px 14px;color:var(--text2);cursor:pointer;font-size:0.85rem">← Voltar</button>' +
  '<div class="card" style="max-width:600px;padding:1.5rem">' +
    '<div style="font-size:1rem;font-weight:700;margin-bottom:1.5rem">' + (isEdit ? '✏️ Editar Produto' : '➕ Novo Produto') + '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;color:var(--text3);margin-bottom:4px">Nome do Produto *</label>' +
        '<input id="prod-nome" type="text" value="' + esc(prod ? prod.nome : '') + '" placeholder="Ex: Beterraba em Pó 100g" ' +
          'style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.88rem;box-sizing:border-box">' +
      '</div>' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;color:var(--text3);margin-bottom:4px">SKU *</label>' +
        '<input id="prod-sku" type="text" value="' + esc(prod ? prod.sku : '') + '" placeholder="Ex: beterraba100" ' +
          (isEdit ? 'readonly style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg3);color:var(--text3);font-size:0.88rem;box-sizing:border-box"' :
                    'style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.88rem;box-sizing:border-box"') + '>' +
        (isEdit ? '<div style="font-size:0.7rem;color:var(--text3);margin-top:2px">SKU não pode ser alterado após o cadastro</div>' : '') +
      '</div>' +
    '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1.5rem">' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;color:var(--text3);margin-bottom:4px">Peso do produto (g) *</label>' +
        '<input id="prod-peso" type="number" min="1" value="' + (prod ? prod.peso : '') + '" placeholder="Ex: 100" ' +
          'style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.88rem;box-sizing:border-box">' +
      '</div>' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;color:var(--text3);margin-bottom:4px">Embalagem (R$)</label>' +
        '<input id="prod-emb" type="number" min="0" step="0.01" value="' + (prod ? (prod.embalagem || '') : '') + '" placeholder="1.17" ' +
          'style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.88rem;box-sizing:border-box">' +
      '</div>' +
      '<div>' +
        '<label style="display:block;font-size:0.8rem;color:var(--text3);margin-bottom:4px">Caixa (R$)</label>' +
        '<input id="prod-caixa" type="number" min="0" step="0.01" value="' + (prod ? (prod.caixa || '') : '') + '" placeholder="0.87" ' +
          'style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.88rem;box-sizing:border-box">' +
      '</div>' +
    '</div>' +

    '<div style="margin-bottom:1rem">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">' +
        '<label style="font-size:0.8rem;color:var(--text3)">Matéria(s)-prima(s) *</label>' +
        '<button onclick="prodAdicionarMp(' + JSON.stringify(itensEstoque) + ')" style="background:none;border:0.5px solid var(--border2);border-radius:6px;padding:3px 10px;font-size:0.78rem;color:var(--text2);cursor:pointer">+ Adicionar</button>' +
      '</div>' +
      '<div id="prod-mps">' + mpRows + '</div>' +
    '</div>' +

    '<div style="display:flex;gap:10px;margin-top:1.5rem">' +
      '<button onclick="prodSalvar()" class="btn btn-green" style="flex:1">✓ Salvar Produto</button>' +
      '<button onclick="prodSetTab(\'lista\')" class="btn" style="flex:0 0 auto">Cancelar</button>' +
    '</div>' +
    '<div id="prod-status" style="margin-top:0.75rem;font-size:0.82rem;text-align:center"></div>' +
  '</div>';
}

function prodMpRow(idx, estoqueNome, pesoUsado, itensEstoque) {
  var opts = (itensEstoque || state.estoque.produtos || []).map(function(item) {
    var sel = item.nome === estoqueNome ? ' selected' : '';
    return '<option value="' + esc(item.nome) + '"' + sel + '>' + esc(item.nome) + '</option>';
  }).join('');

  return '<div id="prod-mp-row-' + idx + '" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
    '<select id="prod-mp-nome-' + idx + '" style="flex:1;padding:7px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.85rem">' +
      '<option value="">Selecione um item do estoque...</option>' + opts +
    '</select>' +
    '<input id="prod-mp-peso-' + idx + '" type="number" min="1" value="' + (pesoUsado || '') + '" placeholder="Peso (g)" ' +
      'style="width:100px;padding:7px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.85rem">' +
    '<button onclick="prodRemoverMp(' + idx + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1.1rem;padding:0 4px">×</button>' +
  '</div>';
}

function prodAdicionarMp(itensEstoque) {
  var container = document.getElementById('prod-mps');
  if (!container) return;
  var rows = container.querySelectorAll('[id^="prod-mp-row-"]');
  var idx = rows.length;
  var div = document.createElement('div');
  div.innerHTML = prodMpRow(idx, '', '', itensEstoque || state.estoque.produtos || []);
  container.appendChild(div.firstElementChild);
}

function prodRemoverMp(idx) {
  var row = document.getElementById('prod-mp-row-' + idx);
  if (row) row.remove();
}

// ── Salvar produto ────────────────────────────────────────────────────────────

function prodSalvar() {
  var nome  = (document.getElementById('prod-nome')  || {}).value || '';
  var sku   = (document.getElementById('prod-sku')   || {}).value || '';
  var peso  = parseFloat((document.getElementById('prod-peso')  || {}).value || 0);
  var emb   = parseFloat((document.getElementById('prod-emb')   || {}).value || 0);
  var caixa = parseFloat((document.getElementById('prod-caixa') || {}).value || 0);

  var status = document.getElementById('prod-status');
  function setStatus(msg, cor) { if (status) { status.textContent = msg; status.style.color = cor || 'var(--text3)'; } }

  if (!nome.trim()) return setStatus('⚠ Informe o nome do produto.', 'var(--red)');
  if (!sku.trim())  return setStatus('⚠ Informe o SKU.', 'var(--red)');
  if (!peso)        return setStatus('⚠ Informe o peso do produto.', 'var(--red)');

  // Valida SKU: só letras e números, sem espaço
  if (!/^[a-zA-Z0-9_-]+$/.test(sku.trim())) return setStatus('⚠ SKU só pode ter letras, números, _ ou -.', 'var(--red)');

  // Verifica duplicidade de SKU ao criar
  var isEdit = !!_prodSel;
  if (!isEdit && (state.produtos || []).some(function(p) { return p.sku === sku.trim().toLowerCase(); })) {
    return setStatus('⚠ SKU já existe. Escolha outro.', 'var(--red)');
  }

  // Lê matérias-primas
  var mps = [];
  var container = document.getElementById('prod-mps');
  if (container) {
    var rows = container.querySelectorAll('[id^="prod-mp-row-"]');
    rows.forEach(function(row) {
      var idxMatch = row.id.match(/prod-mp-row-(\d+)/);
      if (!idxMatch) return;
      var i = idxMatch[1];
      var mpNome = (document.getElementById('prod-mp-nome-' + i) || {}).value || '';
      var mpPeso = parseFloat((document.getElementById('prod-mp-peso-' + i) || {}).value || 0);
      if (mpNome && mpPeso > 0) mps.push({ estoqueNome: mpNome, pesoUsado: mpPeso });
    });
  }

  if (!mps.length) return setStatus('⚠ Adicione pelo menos uma matéria-prima.', 'var(--red)');

  var skuFinal = sku.trim().toLowerCase();
  var novoProd = {
    nome:          nome.trim(),
    sku:           skuFinal,
    peso:          peso,
    embalagem:     emb,
    caixa:         caixa,
    materiasPrimas: mps,
    ativo:         true,
    criadoEm:      isEdit ? ((state.produtos.find(function(p){ return p.sku===skuFinal; }) || {}).criadoEm || new Date().toISOString()) : new Date().toISOString(),
  };

  if (!state.produtos) state.produtos = [];

  if (isEdit) {
    var idx = state.produtos.findIndex(function(p) { return p.sku === skuFinal; });
    if (idx !== -1) state.produtos[idx] = novoProd;
  } else {
    state.produtos.push(novoProd);
  }

  setStatus('Salvando...', 'var(--text3)');
  prodSaveFirebase().then(function() {
    addLog((isEdit ? 'Editou' : 'Cadastrou') + ' produto: ' + novoProd.nome + ' (' + novoProd.sku + ')');
    _prodTab = 'lista';
    _prodSel = null;
    var c = document.getElementById('page-content');
    if (c) c.innerHTML = renderProdutos();
  });
}

// ── Excluir produto ───────────────────────────────────────────────────────────

function prodExcluir(sku) {
  var prod = (state.produtos || []).find(function(p) { return p.sku === sku; });
  if (!prod) return;
  if (!confirm('Excluir "' + prod.nome + '"?\n\nEle será removido do Radar, Marketplaces e Tabela Nutricional.')) return;
  state.produtos = (state.produtos || []).filter(function(p) { return p.sku !== sku; });
  prodSaveFirebase().then(function() {
    addLog('Excluiu produto: ' + prod.nome + ' (' + sku + ')');
    var c = document.getElementById('page-content');
    if (c) c.innerHTML = renderProdutos();
  });
}
