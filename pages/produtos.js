// --- PRODUTOS ------------------------------------------------------------------
// Cadastro dinâmico de produtos finais (substitui PRODUTOS_CUSTO fixo)

var _prodTab     = 'lista';  // 'lista' | 'form' | 'custo' | 'historico'
var _prodSel     = null;     // SKU do produto sendo editado (null = novo)
var _prodLoading = false;
var _prodCarregado = false;
var _prodOrdem   = 'az';     // 'az' | 'mps'
var _prodEditSku = false;    // permite editar o SKU mesmo em modo edição

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
  if (!prod.materiasPrimas || !prod.materiasPrimas.length) return null;

  var hist = (state.estoque.historicoManual || []).concat(
    (state.estoque.movimentacoes || []).filter(function(m) { return m.tipo === 'entrada' && m.totalKg > 0; })
  );

  var totalIngrediente = 0;
  var algumSemHistorico = false;

  for (var i = 0; i < prod.materiasPrimas.length; i++) {
    var mp = prod.materiasPrimas[i];
    // Para mix: cada matéria-prima contribui com prod.peso / qtd_mps gramas
    // Para produto simples (1 MP): contribui com prod.peso inteiro
    var pesoUsado = prod.peso / prod.materiasPrimas.length;

    // Busca o último preço/kg da matéria-prima no histórico
    var nomeBusca = (mp.estoqueNome || '').toLowerCase();
    var maisRecente = null;
    hist.forEach(function(r) {
      if (!r.totalKg) return;
      var nomeLow = (r.produto || '').toLowerCase();
      // Testa se o nome do histórico contém o nome da MP (ou vice-versa)
      if (nomeLow.indexOf(nomeBusca.substring(0, Math.min(8, nomeBusca.length))) !== -1 ||
          nomeBusca.indexOf(nomeLow.substring(0, Math.min(8, nomeLow.length))) !== -1) {
        if (!maisRecente || (r.dataISO || '') > (maisRecente.dataISO || '')) maisRecente = r;
      }
    });

    if (maisRecente) {
      totalIngrediente += parseFloat(maisRecente.totalKg) * pesoUsado / 1000;
    } else {
      algumSemHistorico = true;
    }
  }

  if (algumSemHistorico && totalIngrediente === 0) return null; // nenhuma MP encontrada no histórico

  var total = totalIngrediente + (parseFloat(prod.embalagem) || 0) + (parseFloat(prod.caixa) || 0);
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

  // Ordenação
  if (_prodOrdem === 'az') {
    produtos.sort(function(a, b) { return a.nome.localeCompare(b.nome); });
  } else if (_prodOrdem === 'mps') {
    produtos.sort(function(a, b) { return (b.materiasPrimas||[]).length - (a.materiasPrimas||[]).length; });
  }

  function btnOrd(id, label) {
    var ativo = _prodOrdem === id;
    return '<button onclick="_prodOrdem=\'' + id + '\';prodSetTab(\'lista\')" ' +
      'style="padding:4px 10px;border-radius:6px;font-size:0.78rem;cursor:pointer;border:0.5px solid var(--border2);' +
      (ativo ? 'background:var(--green);color:#fff;border-color:var(--green);font-weight:600' : 'background:none;color:var(--text2)') +
      '">' + label + '</button>';
  }

  var tabBar =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:10px">' +
      '<div style="display:flex;gap:4px;border-bottom:1.5px solid var(--border);padding-bottom:0">' +
        '<button class="fin-tab' + (_prodTab === 'lista' || _prodTab === 'form' ? ' active' : '') + '" onclick="prodSetTab(\'lista\')" style="font-size:0.88rem">📦 Produtos</button>' +
        '<button class="fin-tab' + (_prodTab === 'historico' ? ' active' : '') + '" onclick="prodSetTab(\'historico\')" style="font-size:0.88rem">📈 Histórico de Preços</button>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:0.78rem;color:var(--text3)">Ordenar:</span>' +
        btnOrd('az', 'A → Z') +
        btnOrd('mps', 'Qtd. matérias-primas') +
        (isAdmin() ? '<button class="btn btn-green" onclick="prodAbrirForm(null)" style="font-size:0.85rem;margin-left:6px">+ Novo Produto</button>' : '') +
      '</div>' +
    '</div>';

  if (!produtos.length) {
    return tabBar + '<div class="empty-state">' + iconEmpty() + '<p>Nenhum produto cadastrado ainda.<br>Clique em "+ Novo Produto" para começar.</p></div>';
  }

  var rows = produtos.map(function(p) {
    var custo = prodCustoAtual(p);
    var mpNomes = (p.materiasPrimas || []).map(function(mp) { return mp.estoqueNome; }).join(', ');
    var mpQtd = (p.materiasPrimas || []).length;
    return '<tr style="border-bottom:0.5px solid var(--border);cursor:pointer" onclick="prodAbrirForm(\'' + esc(p.sku) + '\')">' +
      '<td style="padding:10px 14px;font-weight:500">' + esc(p.nome) + '</td>' +
      '<td style="padding:10px 10px;font-family:monospace;font-size:0.8rem;color:var(--text3)">' + esc(p.sku) + '</td>' +
      '<td style="padding:10px 10px;text-align:right">' + p.peso + 'g</td>' +
      '<td style="padding:10px 10px;font-size:0.8rem;color:var(--text2)">' +
        (mpQtd ? '<span style="font-size:0.7rem;background:var(--bg3);border-radius:4px;padding:1px 6px;margin-right:5px">' + mpQtd + '</span>' + esc(mpNomes) : '<span style="color:var(--text3)">—</span>') +
      '</td>' +
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
  _prodEditSku = false;
  _prodTab = 'form';
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderProdutos();
}

function prodHabilitarEditSku() {
  _prodEditSku = true;
  var inp = document.getElementById('prod-sku');
  if (inp) {
    inp.removeAttribute('readonly');
    inp.style.background = 'var(--bg)';
    inp.style.color = 'var(--text)';
    inp.focus();
  }
  var btn = document.getElementById('prod-sku-edit-btn');
  if (btn) btn.style.display = 'none';
  var aviso = document.getElementById('prod-sku-aviso');
  if (aviso) aviso.textContent = '⚠ Alterar o SKU pode quebrar integrações (Radar, Tarifas, Histórico). Confirme antes de salvar.';
}

function renderProdutosForm() {
  var isEdit = !!_prodSel;
  var prod = isEdit ? (state.produtos || []).find(function(p) { return p.sku === _prodSel; }) : null;

  var itensEstoque = (state.estoque.produtos || []).slice().sort(function(a, b) { return a.nome.localeCompare(b.nome); });
  var mpsAtuais = prod ? (prod.materiasPrimas || []) : [];

  var mpRows = mpsAtuais.map(function(mp, i) {
    return prodMpRow(i, mp.estoqueNome, itensEstoque);
  }).join('');
  if (!mpRows) mpRows = prodMpRow(0, '', itensEstoque);

  // Campo SKU: readonly por padrão em edição, mas com botão para habilitar edição
  var skuField = '';
  if (isEdit && !_prodEditSku) {
    skuField =
      '<input id="prod-sku" type="text" value="' + esc(prod.sku) + '" readonly ' +
        'style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg3);color:var(--text3);font-size:0.88rem;box-sizing:border-box">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">' +
        '<button id="prod-sku-edit-btn" onclick="prodHabilitarEditSku()" style="background:none;border:none;color:var(--blue);cursor:pointer;font-size:0.72rem;padding:0;text-decoration:underline">✏️ Editar SKU</button>' +
        '<span id="prod-sku-aviso" style="font-size:0.7rem;color:var(--text3)"></span>' +
      '</div>';
  } else {
    skuField =
      '<input id="prod-sku" type="text" value="' + esc(prod ? prod.sku : '') + '" placeholder="Ex: beterraba100" ' +
        'style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.88rem;box-sizing:border-box">' +
      (isEdit ? '<span id="prod-sku-aviso" style="font-size:0.7rem;color:var(--amber)">⚠ Alterar o SKU pode quebrar integrações. Confirme antes de salvar.</span>' : '');
  }

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
        skuField +
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
        '<button onclick="prodAdicionarMp()" style="background:none;border:0.5px solid var(--border2);border-radius:6px;padding:3px 10px;font-size:0.78rem;color:var(--text2);cursor:pointer">+ Adicionar</button>' +
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

// Linha de matéria-prima: só dropdown, sem campo de peso
function prodMpRow(idx, estoqueNome, itensEstoque) {
  var opts = (itensEstoque || state.estoque.produtos || []).map(function(item) {
    var sel = item.nome === estoqueNome ? ' selected' : '';
    return '<option value="' + esc(item.nome) + '"' + sel + '>' + esc(item.nome) + '</option>';
  }).join('');

  return '<div id="prod-mp-row-' + idx + '" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
    '<select id="prod-mp-nome-' + idx + '" style="flex:1;padding:7px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--bg);color:var(--text);font-size:0.85rem">' +
      '<option value="">Selecione um item do estoque...</option>' + opts +
    '</select>' +
    '<button onclick="prodRemoverMp(' + idx + ')" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1.1rem;padding:0 4px">×</button>' +
  '</div>';
}

function prodAdicionarMp() {
  var container = document.getElementById('prod-mps');
  if (!container) return;
  var rows = container.querySelectorAll('[id^="prod-mp-row-"]');
  var idx = rows.length;
  var div = document.createElement('div');
  div.innerHTML = prodMpRow(idx, '', state.estoque.produtos || []);
  container.appendChild(div.firstElementChild);
}

function prodRemoverMp(idx) {
  var row = document.getElementById('prod-mp-row-' + idx);
  if (row) row.remove();
}

// ── Salvar produto ────────────────────────────────────────────────────────────

function prodSalvar() {
  var nome     = (document.getElementById('prod-nome')  || {}).value || '';
  var skuNovo  = ((document.getElementById('prod-sku')  || {}).value || '').trim().toLowerCase();
  var peso     = parseFloat((document.getElementById('prod-peso')  || {}).value || 0);
  var emb      = parseFloat((document.getElementById('prod-emb')   || {}).value || 0);
  var caixa    = parseFloat((document.getElementById('prod-caixa') || {}).value || 0);
  var isEdit   = !!_prodSel;
  var skuAntigo = _prodSel || skuNovo;

  var status = document.getElementById('prod-status');
  function setStatus(msg, cor) { if (status) { status.textContent = msg; status.style.color = cor || 'var(--text3)'; } }

  if (!nome.trim())  return setStatus('⚠ Informe o nome do produto.', 'var(--red)');
  if (!skuNovo)      return setStatus('⚠ Informe o SKU.', 'var(--red)');
  if (!peso)         return setStatus('⚠ Informe o peso do produto.', 'var(--red)');
  if (!/^[a-zA-Z0-9_-]+$/.test(skuNovo)) return setStatus('⚠ SKU só pode ter letras, números, _ ou -.', 'var(--red)');

  // Verifica duplicidade só se SKU mudou
  if (skuNovo !== skuAntigo && (state.produtos || []).some(function(p) { return p.sku === skuNovo; })) {
    return setStatus('⚠ SKU já existe. Escolha outro.', 'var(--red)');
  }
  if (!isEdit && (state.produtos || []).some(function(p) { return p.sku === skuNovo; })) {
    return setStatus('⚠ SKU já existe. Escolha outro.', 'var(--red)');
  }

  // Lê matérias-primas (sem campo de peso)
  var mps = [];
  var container = document.getElementById('prod-mps');
  if (container) {
    container.querySelectorAll('[id^="prod-mp-row-"]').forEach(function(row) {
      var m = row.id.match(/prod-mp-row-(\d+)/);
      if (!m) return;
      var mpNome = (document.getElementById('prod-mp-nome-' + m[1]) || {}).value || '';
      if (mpNome) mps.push({ estoqueNome: mpNome });
    });
  }
  if (!mps.length) return setStatus('⚠ Adicione pelo menos uma matéria-prima.', 'var(--red)');

  var novoProd = {
    nome:           nome.trim(),
    sku:            skuNovo,
    peso:           peso,
    embalagem:      emb,
    caixa:          caixa,
    materiasPrimas: mps,
    ativo:          true,
    criadoEm:       isEdit ? ((state.produtos.find(function(p){ return p.sku===skuAntigo; }) || {}).criadoEm || new Date().toISOString()) : new Date().toISOString(),
  };

  if (!state.produtos) state.produtos = [];

  if (isEdit) {
    var idx = state.produtos.findIndex(function(p) { return p.sku === skuAntigo; });
    if (idx !== -1) {
      state.produtos[idx] = novoProd;
      // Se o SKU mudou, remove o registro antigo
      if (skuNovo !== skuAntigo) {
        state.produtos = state.produtos.filter(function(p) { return p.sku !== skuAntigo; });
        state.produtos.push(novoProd);
      }
    }
  } else {
    state.produtos.push(novoProd);
  }

  setStatus('Salvando...', 'var(--text3)');
  prodSaveFirebase().then(function() {
    addLog((isEdit ? 'Editou' : 'Cadastrou') + ' produto: ' + novoProd.nome + ' (' + novoProd.sku + ')');
    _prodTab = 'lista';
    _prodSel = null;
    _prodEditSku = false;
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
