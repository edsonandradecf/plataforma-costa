// --- ESTOQUE ------------------------------------------------------------------
var _estoqueTab = 'estoque';
var _estoqueOrdem = 'nome';
var _estoqueBusca = '';
var _estoqueOrdemAberto = false;
var _estoqueHistProduto = null;
var _estoqueHistOrdemAlfa = false;
var _estoqueCustoProdSel = null;
var _estoqueCustoCarregando = false;

// ─────────────────────────────────────────────────────────────
// MAPEAMENTO SKU → palavras-chave no histórico de preços
// Para adicionar um novo produto:
//   1. Adicione o objeto em PRODUTOS_CUSTO (nome, sku, peso)
//   2. Adicione o SKU aqui com as palavras que aparecem no nome
//      do produto no histórico de compras (matéria-prima)
// ─────────────────────────────────────────────────────────────
var SKU_HIST_KEYWORDS = {
  // SKU (sem número)  → palavras que identificam a matéria-prima no histórico
  'chia':       ['chia'],
  'aveia':      ['aveia'],
  'oleo':       ['oleo', 'óleo', 'coco'],          // óleo de coco
  'psy':        ['psyll', 'psyllium'],
  'nozes':      ['nozes', 'noz'],
  'linhaca':    ['linha', 'linhaca', 'linhaça'],
  'beterraba':  ['beter', 'beterraba'],
  'abobora':    ['abob', 'abóbora', 'abobora'],
  'frutas':     ['fruta', 'tropical', 'mix de fruta'],
  'chips':      ['vegetal', 'chips vegeta'],        // chips vegetais
  'sal':        ['flor de sal', 'sal'],
  'caju':       ['caju', 'castanha'],
  'uva':        ['uva', 'passa'],
  'coco':       ['coco chips', 'chips de coco'],    // chips de coco (≠ óleo)
  'arroz':      ['arroz'],
  'cacau':      ['cacau'],
};

// Associa um SKU a um nome de produto do histórico
// Retorna true se o nome contém alguma das palavras-chave do SKU base
function skuMatchHist(sku, nomeLow) {
  // Extrai a "raiz" do SKU (remove números do final: chia100→chia, oleo3→oleo)
  var base = sku.replace(/[0-9]+$/, '');
  var keywords = SKU_HIST_KEYWORDS[base];
  if (!keywords) return false;
  // Casos especiais: coco e oleo compartilham "coco" — diferenciar
  if (base === 'coco' && nomeLow.indexOf('oleo') !== -1) return false;
  if (base === 'oleo' && nomeLow.indexOf('chips') !== -1) return false;
  if (base === 'sal'  && nomeLow.indexOf('flor') === -1 && nomeLow.indexOf('sal') !== -1 &&
      (nomeLow.indexOf('abob') !== -1 || nomeLow.indexOf('semi') !== -1)) return false;
  return keywords.some(function(kw){ return nomeLow.indexOf(kw) !== -1; });
}

// Catálogo fixo de produtos com SKU para custo
// PRODUTOS_CUSTO agora é gerado dinamicamente a partir de state.produtos
// Mantém compatibilidade com todo o código existente (Radar, Estoque, etc.)
// Os 33 produtos originais servem como fallback enquanto o Firebase não carregou
var PRODUTOS_CUSTO_FALLBACK = [
  {nome:'Óleo de coco - 3 Litros - Full',    sku:'oleo3',       peso:2700},
  {nome:'Óleo de coco - 1000 mL',            sku:'oleo1',       peso:900},
  {nome:'Óleo de coco - 500 mL',             sku:'oleo500',     peso:450},
  {nome:'Aveia - Flocos Finos (500g)',        sku:'aveia500',    peso:500},
  {nome:'Aveia - Flocos Finos (1Kg)',         sku:'aveia1',      peso:1000},
  {nome:'Chips de Vegetais (50g)',            sku:'chips50',     peso:50},
  {nome:'Chips de Vegetais (500g)',           sku:'chips500',    peso:500},
  {nome:'Semente de Chia (100g)',             sku:'chia100',     peso:100},
  {nome:'Semente de Chia (1Kg)',             sku:'chia1',       peso:1000},
  {nome:'Castanha de Caju - Banda (100g)',    sku:'caju100',     peso:100},
  {nome:'Castanha de Caju - Banda (1Kg)',     sku:'caju1',       peso:1000},
  {nome:'Uva Passa Preta (100g)',             sku:'uva100',      peso:100},
  {nome:'Uva Passa Preta (1kg)',              sku:'uva1',        peso:1000},
  {nome:'Flor de Sal (100g)',                 sku:'sal100',      peso:100},
  {nome:'Flor de Sal (1kg)',                  sku:'sal1',        peso:1000},
  {nome:'Frutas Tropicais (50g)',             sku:'frutas50',    peso:50},
  {nome:'Frutas Tropicais (500g)',            sku:'frutas500',   peso:500},
  {nome:'Psyllium (100g)',                    sku:'psy100',      peso:100},
  {nome:'Psyllium (1kg)',                     sku:'psy1',        peso:1000},
  {nome:'Nozes Quartz (100g)',                sku:'nozes100',    peso:100},
  {nome:'Nozes Quartz (1Kg)',                 sku:'nozes1',      peso:1000},
  {nome:'Linhaça Dourada (100g)',             sku:'linhaca100',  peso:100},
  {nome:'Linhaça Dourada (1Kg)',              sku:'linhaca1',    peso:1000},
  {nome:'Beterraba em pó (100g)',             sku:'beterraba100',peso:100},
  {nome:'Beterraba em pó (1Kg)',              sku:'beterraba1',  peso:1000},
  {nome:'Semente de abóbora (100g)',          sku:'abobora100',  peso:100},
  {nome:'Semente de abóbora (1Kg)',           sku:'abobora1',    peso:1000},
  {nome:'Flocos de Arroz Natural (200g)',     sku:'arroz200',    peso:200},
  {nome:'Flocos de Arroz Natural (400g)',     sku:'arroz400',    peso:400},
  {nome:'Flocos de Arroz Cacau (200g)',       sku:'cacau200',    peso:200},
  {nome:'Flocos de Arroz Cacau (500g)',       sku:'cacau500',    peso:500},
  {nome:'Chips de Coco (400g)',               sku:'coco400',     peso:400},
  {nome:'Chips de Coco (100g)',               sku:'coco100',     peso:100},
];

// Getter dinâmico: usa state.produtos se já carregado, senão usa fallback
Object.defineProperty(window, 'PRODUTOS_CUSTO', {
  get: function() {
    var prods = (typeof state !== 'undefined' && state.produtos && state.produtos.length)
      ? state.produtos.filter(function(p) { return p.ativo !== false; })
      : PRODUTOS_CUSTO_FALLBACK;
    return prods;
  },
  configurable: true,
});

function isAdmin() {
  return state.currentUser && state.currentUser.role === 'admin';
}

function renderEstoque() {
  var tab = _estoqueTab;
  var isEst  = tab === 'estoque';
  var isMov  = tab === 'movimentacao';
  var isHist = tab === 'historico';
  var isCust = tab === 'custo';

  function tabBtn(id, label, active) {
    return '<button onclick="estoqueSetTab(\'' + id + '\')" style="padding:0.65rem 1.25rem;background:none;border:none;border-bottom:' + (active ? '3px solid var(--green);color:var(--green);font-weight:600' : 'none;color:var(--text2)') + ';cursor:pointer;font-size:0.92rem;margin-bottom:-2px;transition:all 0.15s">' + label + '</button>';
  }

  var tabBar =
    '<div style="display:flex;border-bottom:2px solid var(--border);margin-bottom:1.5rem">' +
      tabBtn('estoque',      '📦 Estoque',              isEst)  +
      tabBtn('movimentacao', '↕ Entrada / Saída',       isMov)  +
    '</div>';

  if (isEst)   return tabBar + renderEstoqueCards();
  if (isMov)   return tabBar + renderEstoqueMovimentacao();
  if (isHist)  return tabBar + (isAdmin() ? renderEstoqueHistorico() : '<div class="empty-state">'+iconEmpty()+'<p>Acesso restrito.</p></div>');
  if (isCust)  return tabBar + (isAdmin() ? renderEstoqueCusto() : '<div class="empty-state">'+iconEmpty()+'<p>Acesso restrito.</p></div>');
  return tabBar + renderEstoqueCards();
}

function renderEstoqueCards() {
  var busca = (typeof _estoqueBusca !== 'undefined') ? _estoqueBusca.toLowerCase() : '';
  var ordem = (typeof _estoqueOrdem !== 'undefined') ? _estoqueOrdem : 'nome';
  var ordemAberto = (typeof _estoqueOrdemAberto !== 'undefined') ? _estoqueOrdemAberto : false;

  var produtos = state.estoque.produtos.slice();

  // -- Filtro por busca --------------------------------------
  if (busca) produtos = produtos.filter(function(p){ return p.nome.toLowerCase().indexOf(busca) !== -1; });

  // -- Ordenação ---------------------------------------------
  if (ordem === 'qtd-asc')         produtos.sort(function(a,b){ return a.qtd - b.qtd; });
  else if (ordem === 'qtd-desc')   produtos.sort(function(a,b){ return b.qtd - a.qtd; });
  else if (ordem === 'status-asc') produtos.sort(function(a,b){
    function nivel(p){ return p.qtd <= 0 ? 0 : (p.qtd <= (p.minimo||0) ? 1 : 2); }
    return nivel(a) - nivel(b);
  });
  else if (ordem === 'status-desc') produtos.sort(function(a,b){
    function nivel(p){ return p.qtd <= 0 ? 0 : (p.qtd <= (p.minimo||0) ? 1 : 2); }
    return nivel(b) - nivel(a);
  });

  var ordemLabels = { 'nome':'Padrão', 'qtd-asc':'↑ Qtd crescente', 'qtd-desc':'↓ Qtd decrescente', 'status-asc':'🔴→🟢 Zerado p/ OK', 'status-desc':'🟢→🔴 OK p/ Zerado' };

  // -- Header ------------------------------------------------
  var html =
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:1.25rem">' +
      // Busca
      '<div style="flex:1;min-width:180px;position:relative">' +
        '<input id="est-busca" type="text" placeholder="🔍 Buscar produto..." value="' + esc(busca) + '" ' +
          'oninput="estoqueSetBusca(this.value)" ' +
          'style="width:100%;padding:0.55rem 0.9rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">' +
      '</div>' +
      // Ordenar dropdown
      '<div style="position:relative">' +
        '<button onclick="estoqueToggleOrdem()" style="display:flex;align-items:center;gap:6px;padding:0.55rem 1rem;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text2);cursor:pointer;font-size:0.88rem;white-space:nowrap">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="9" y2="18"/></svg>' +
          'Ordenar' + (ordem !== 'nome' ? ' <span style="color:var(--green);font-weight:700">*</span>' : '') +
        '</button>' +
        (ordemAberto ?
          '<div style="position:absolute;right:0;top:calc(100% + 6px);background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.22);z-index:999;min-width:210px;overflow:hidden">' +
            ['nome','qtd-asc','qtd-desc','status-asc','status-desc'].map(function(o){
              var ativo = ordem === o;
              return '<div onclick="estoqueSetOrdem(\'' + o + '\')" style="padding:10px 16px;cursor:pointer;font-size:0.87rem;display:flex;align-items:center;justify-content:space-between;gap:8px;color:' + (ativo?'var(--green)':'var(--text)') + ';font-weight:' + (ativo?'700':'400') + ';border-bottom:1px solid var(--border)">' +
                '<span>' + ordemLabels[o] + '</span>' +
                (ativo ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="width:14px;height:14px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
              '</div>';
            }).join('') +
          '</div>'
        : '') +
      '</div>' +
      // Contador + Novo Produto
      '<div style="font-size:0.82rem;color:var(--text3);white-space:nowrap">' + produtos.length + (busca ? ' resultado(s)' : ' produto(s)') + '</div>' +
      (isAdmin() ? '<button class="btn btn-green" onclick="estoqueAbrirModalProduto(null)" style="white-space:nowrap">+ Novo Produto</button>' : '') +
    '</div>';

  if (!state.estoque.produtos.length) {
    return html + '<div class="empty-state">' + iconEmpty() + '<p>' + (isAdmin() ? 'Nenhum produto cadastrado. Clique em "+ Novo Produto" para começar.' : 'Nenhum produto no estoque.') + '</p></div>';
  }
  if (!produtos.length) {
    return html + '<div class="empty-state">' + iconEmpty() + '<p>Nenhum produto encontrado para "<b>' + esc(busca) + '</b>".</p></div>';
  }

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem">';
  produtos.forEach(function(p) {
    // Busca índice real no array original (para passar ao modal/excluir)
    var i = state.estoque.produtos.indexOf(p);
    var baixo = p.qtd > 0 && p.qtd <= (p.minimo || 0);
    var zerado = p.qtd <= 0;
    var cor = zerado ? 'var(--red)' : (baixo ? 'var(--amber)' : 'var(--green)');
    var badge = zerado ? '🔴 Zerado' : (baixo ? '🟡 Baixo' : '🟢 OK');
    html +=
      '<div class="card" style="padding:1rem;display:flex;flex-direction:column;gap:0">' +
        // Linha do topo: nome + botões lado a lado
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:2px">' +
          '<div style="font-size:0.95rem;font-weight:700;line-height:1.3;flex:1;min-width:0;word-break:break-word">' + esc(p.nome) + '</div>' +
          (isAdmin() ?
            '<div style="display:flex;gap:4px;flex-shrink:0">' +
              '<button class="btn btn-sm" onclick="estoqueAbrirModalProduto(' + i + ')" title="Editar" style="padding:4px 7px">✏️</button>' +
              '<button class="btn btn-sm btn-red" onclick="estoqueExcluirProduto(' + i + ')" title="Excluir" style="padding:4px 7px">x</button>' +
            '</div>'
          : '') +
        '</div>' +
        // Unidade
        (p.unidade ? '<div style="font-size:0.75rem;color:var(--text3);margin-bottom:10px">' + esc(p.unidade) + '</div>' : '<div style="margin-bottom:10px"></div>') +
        // Quantidade + badge
        '<div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:10px">' +
          '<div>' +
            '<div style="font-size:2rem;font-weight:800;line-height:1;color:' + cor + '">' + p.qtd + '</div>' +
            '<div style="font-size:0.7rem;color:var(--text3);margin-top:2px">em estoque' + (p.minimo ? ' . mín. ' + p.minimo : '') + '</div>' +
          '</div>' +
          '<div style="font-size:0.72rem;font-weight:600;color:' + cor + ';background:' + cor + '18;padding:3px 8px;border-radius:20px;white-space:nowrap">' + badge + '</div>' +
        '</div>' +
        // Botões entrada/saída
        '<div style="display:flex;gap:6px">' +
          (isAdmin() ? '<button class="btn btn-sm btn-green" style="flex:1" onclick="estoqueAbrirModalMov(' + i + ',\'entrada\')">＋ Entrada</button>' : '') +
          '<button class="btn btn-sm btn-red" style="flex:1" onclick="estoqueAbrirModalMov(' + i + ',\'saida\')">－ Saída</button>' +
        '</div>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

function renderEstoqueMovimentacao() {
  var produtos = state.estoque.produtos;
  var movs = state.estoque.movimentacoes;
  var isAdm = isAdmin();
  var html = '';

  // Formulário de movimentação
  html +=
    '<div class="card" style="padding:1.25rem;margin-bottom:1.5rem">' +
      '<div class="card-header" style="margin-bottom:1rem"><span class="card-title">Registrar Movimentação</span></div>' +
      '<div style="display:grid;grid-template-columns:' + (isAdm ? '1.5fr 1fr 90px 100px 100px 1fr' : '1fr 100px 1fr') + ';gap:10px;align-items:end">' +
        '<div><label style="font-size:0.78rem;color:var(--text2);margin-bottom:4px;display:block">Produto</label>' +
          '<select id="est-mov-produto" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">' +
            '<option value="">Selecione...</option>' +
            produtos.map(function(p,i){ return '<option value="' + i + '">' + esc(p.nome) + ' (' + p.qtd + ' ' + esc(p.unidade||'un') + ')</option>'; }).join('') +
          '</select>' +
        '</div>' +
        (isAdm ?
          '<div><label style="font-size:0.78rem;color:var(--text2);margin-bottom:4px;display:block">Tipo</label>' +
            '<select id="est-mov-tipo" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">' +
              '<option value="entrada">📥 Entrada</option>' +
              '<option value="saida">📤 Saída</option>' +
            '</select>' +
          '</div>'
        : '<input type="hidden" id="est-mov-tipo" value="saida">') +
        '<div><label style="font-size:0.78rem;color:var(--text2);margin-bottom:4px;display:block">Quantidade</label>' +
          '<input type="number" id="est-mov-qtd" min="1" value="1" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">' +
        '</div>' +
        (isAdm ?
          '<div><label style="font-size:0.78rem;color:var(--text2);margin-bottom:4px;display:block">Custo R$/kg</label>' +
            '<input type="number" id="est-mov-custo" min="0" step="0.01" placeholder="0,00" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">' +
          '</div>' +
          '<div><label style="font-size:0.78rem;color:var(--text2);margin-bottom:4px;display:block">Frete R$/kg</label>' +
            '<input type="number" id="est-mov-frete" min="0" step="0.01" placeholder="0,00" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">' +
          '</div>'
        : '') +
        '<div><label style="font-size:0.78rem;color:var(--text2);margin-bottom:4px;display:block">Observação</label>' +
          '<input type="text" id="est-mov-obs" placeholder="Opcional" style="width:100%;padding:0.6rem 0.8rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:10px;display:flex;gap:8px;align-items:center">' +
        '<button class="btn btn-green" onclick="estoqueRegistrarMov()">✓ Registrar</button>' +
        '<span id="est-mov-status" style="font-size:0.85rem;color:var(--text2)"></span>' +
      '</div>' +
    '</div>';

  // Lista de movimentações
  html += '<div class="card" style="padding:1.25rem">';
  html += '<div class="card-header"><span class="card-title">Histórico de Movimentações</span>';
  if (movs.length) html += '<button class="btn btn-sm btn-red" onclick="estoqueLimparHistorico()">Limpar histórico</button>';
  html += '</div>';

  if (!movs.length) {
    html += '<div class="empty-state" style="padding:2rem 0">' + iconEmpty() + '<p>Nenhuma movimentação registrada ainda.</p></div>';
  } else {
    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.82rem">' +
      '<thead><tr style="background:var(--bg3);border-bottom:2px solid var(--border)">' +
        '<th style="text-align:left;padding:8px 10px">Data/Hora</th>' +
        '<th style="text-align:left;padding:8px 10px">Produto</th>' +
        '<th style="text-align:center;padding:8px 10px">Tipo</th>' +
        '<th style="text-align:center;padding:8px 10px">Qtd</th>' +
        '<th style="text-align:left;padding:8px 10px">Saldo</th>' +
        '<th style="text-align:left;padding:8px 10px">Usuário</th>' +
        '<th style="text-align:left;padding:8px 10px">Obs.</th>' +
      '</tr></thead><tbody>';
    movs.slice().reverse().forEach(function(m, ri) {
      var isEnt = m.tipo === 'entrada';
      html += '<tr style="border-bottom:1px solid var(--border)' + (ri % 2 === 1 ? ';background:var(--bg3)' : '') + '">' +
        '<td style="padding:7px 10px;color:var(--text3);white-space:nowrap">' + esc(m.data) + '</td>' +
        '<td style="padding:7px 10px;font-weight:600">' + esc(m.produto) + '</td>' +
        '<td style="padding:7px 10px;text-align:center">' +
          '<span style="padding:2px 8px;border-radius:12px;font-size:0.75rem;font-weight:700;background:' + (isEnt ? 'var(--green)' : 'var(--red)') + '18;color:' + (isEnt ? 'var(--green)' : 'var(--red)') + '">' +
            (isEnt ? '📥 Entrada' : '📤 Saída') +
          '</span>' +
        '</td>' +
        '<td style="padding:7px 10px;text-align:center;font-weight:700;color:' + (isEnt ? 'var(--green)' : 'var(--red)') + '">' + (isEnt ? '+' : '-') + m.qtd + '</td>' +
        '<td style="padding:7px 10px;color:var(--text2)">' + (m.saldoApos !== undefined ? m.saldoApos : '--') + '</td>' +
        '<td style="padding:7px 10px;color:var(--text3)">' + esc(m.usuario || '--') + '</td>' +
        '<td style="padding:7px 10px;color:var(--text2)">' + esc(m.obs || '--') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  return html;
}

function renderEstoqueHistorico() {
  // Entradas reais com custo + registros manuais
  var movs = (state.estoque.movimentacoes || []).filter(function(m) {
    return m.tipo === 'entrada' && m.totalKg > 0;
  });
  var manuais = state.estoque.historicoManual || [];

  // Agrupa por produto
  var porProduto = {};
  function addReg(r) {
    if (!porProduto[r.produto]) porProduto[r.produto] = [];
    porProduto[r.produto].push(r);
  }
  movs.forEach(addReg);
  manuais.forEach(addReg);

  // Todos os produtos do estoque aparecem na lista mesmo sem histórico
  (state.estoque.produtos || []).forEach(function(p) {
    if (!porProduto[p.nome]) porProduto[p.nome] = [];
  });

  var nomes = Object.keys(porProduto);
  if (_estoqueHistOrdemAlfa) {
    nomes.sort(function(a,b){ return a.localeCompare(b,'pt-BR'); });
  } else {
    nomes.sort(function(a,b){
      var ta = porProduto[a].length, tb = porProduto[b].length;
      if (ta && !tb) return -1; if (!ta && tb) return 1;
      return a.localeCompare(b,'pt-BR');
    });
  }

  // ── DETALHE de um produto ──────────────────────────────────
  if (_estoqueHistProduto !== null) {
    var nomeProd = _estoqueHistProduto;
    var regsAll  = (porProduto[nomeProd] || []).slice().sort(function(a,b){
      return (a.dataISO||'') < (b.dataISO||'') ? -1 : 1;
    });

    // ── Form de compra manual ────────────────────────────────
    var formManual =
      '<div class="card" style="padding:1.25rem;margin-bottom:1.25rem">' +
        '<div style="font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text3);margin-bottom:1rem">+ Registrar compra histórica</div>' +
        '<div style="display:grid;grid-template-columns:1fr 120px 120px 120px auto;gap:8px;align-items:end;flex-wrap:wrap">' +
          '<div><label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:3px">Data da compra</label>' +
            '<input type="date" id="hist-data" style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem"></div>' +
          '<div><label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:3px">Qtd (kg)</label>' +
            '<input type="number" id="hist-qtd" min="0" step="0.1" placeholder="0" style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem"></div>' +
          '<div><label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:3px">Custo R$/kg</label>' +
            '<input type="number" id="hist-custo" min="0" step="0.01" placeholder="0,00" style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem"></div>' +
          '<div><label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:3px">Frete R$/kg</label>' +
            '<input type="number" id="hist-frete" min="0" step="0.01" placeholder="0,00" style="width:100%;padding:8px 10px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem"></div>' +
          '<button onclick="estoqueHistSalvarManual()" style="padding:8px 18px;background:var(--green);color:#fff;border:none;border-radius:8px;font-size:0.88rem;font-weight:600;cursor:pointer;white-space:nowrap;height:36px">Salvar</button>' +
        '</div>' +
        '<div id="hist-status" style="font-size:0.82rem;color:var(--text3);margin-top:6px"></div>' +
      '</div>';

    // ── Gráfico SVG ─────────────────────────────────────────
    var chartHtml = '';
    if (regsAll.length > 0) {
      var vals = regsAll.map(function(r){ return r.totalKg || 0; });
      var minV = Math.min.apply(null, vals);
      var maxV = Math.max.apply(null, vals);
      var range = maxV - minV || 1;
      var W = 620, H = 190, padL = 58, padR = 20, padT = 24, padB = 38;
      var chartW = W - padL - padR, chartH = H - padT - padB;
      var n = vals.length;
      function px(i){ return padL + (n < 2 ? chartW/2 : (i/(n-1))*chartW); }
      function py(v){ return padT + chartH - ((v-minV)/range)*chartH; }

      var yLabels = '';
      for (var yi = 0; yi <= 4; yi++) {
        var yv = minV + (range/4)*yi;
        var yy = padT + chartH - (yi/4)*chartH;
        yLabels += '<text x="'+(padL-6)+'" y="'+(yy+4)+'" text-anchor="end" font-size="10" fill="var(--text3)">R$'+yv.toFixed(2)+'</text>';
        yLabels += '<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="var(--border2)" stroke-dasharray="3,3"/>';
      }
      var pts = regsAll.map(function(r,i){ return px(i)+','+py(r.totalKg); }).join(' ');
      var area = 'M'+px(0)+','+(padT+chartH)+' L'+regsAll.map(function(r,i){ return px(i)+','+py(r.totalKg); }).join(' L')+' L'+px(n-1)+','+(padT+chartH)+' Z';
      var dots = '', xLabs = '';
      regsAll.forEach(function(r,i){
        var x=px(i), y=py(r.totalKg);
        var isManu = r.manual ? ' opacity="0.7"' : '';
        dots += '<circle cx="'+x+'" cy="'+y+'" r="5" fill="var(--green)" stroke="var(--card)" stroke-width="2"'+isManu+'/>';
        dots += '<text x="'+x+'" y="'+(y-11)+'" text-anchor="middle" font-size="10" fill="var(--text2)" font-weight="600">R$'+r.totalKg.toFixed(2)+'</text>';
        if (n<=10 || i%Math.ceil(n/10)===0 || i===n-1) {
          var lbl = (r.dataISO||'').slice(5).replace('-','/');
          xLabs += '<text x="'+x+'" y="'+(H-4)+'" text-anchor="middle" font-size="10" fill="var(--text3)">'+lbl+'</text>';
        }
      });
      chartHtml =
        '<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:1rem;margin-bottom:1.25rem">'+
          '<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto;display:block;overflow:visible">'+
            yLabels+
            '<path d="'+area+'" fill="var(--green)" opacity="0.08"/>'+
            '<polyline points="'+pts+'" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linejoin="round"/>'+
            dots+xLabs+
          '</svg>'+
        '</div>';
    }

    // ── KPIs ────────────────────────────────────────────────
    var kpis = '';
    if (regsAll.length) {
      var vals2 = regsAll.map(function(r){ return r.totalKg||0; });
      var minK = Math.min.apply(null,vals2), maxK = Math.max.apply(null,vals2);
      var avgK = vals2.reduce(function(s,v){return s+v;},0)/vals2.length;
      var ultimo = regsAll[regsAll.length-1];
      kpis =
        '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:1.25rem">'+
          '<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px 16px;min-width:100px">'+
            '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Menor</div>'+
            '<div style="font-size:1.1rem;font-weight:800;color:var(--green)">R$ '+minK.toFixed(2)+'</div>'+
          '</div>'+
          '<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px 16px;min-width:100px">'+
            '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Maior</div>'+
            '<div style="font-size:1.1rem;font-weight:800;color:var(--red)">R$ '+maxK.toFixed(2)+'</div>'+
          '</div>'+
          '<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px 16px;min-width:100px">'+
            '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Média</div>'+
            '<div style="font-size:1.1rem;font-weight:800;color:var(--text)">R$ '+avgK.toFixed(2)+'</div>'+
          '</div>'+
          '<div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px 16px;min-width:100px">'+
            '<div style="font-size:0.68rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px">Último</div>'+
            '<div style="font-size:1.1rem;font-weight:800;color:var(--green)">R$ '+(ultimo.totalKg||0).toFixed(2)+'</div>'+
            '<div style="font-size:0.68rem;color:var(--text3)">'+(ultimo.dataISO||'')+'</div>'+
          '</div>'+
        '</div>';
    }

    // ── Tabela de registros ──────────────────────────────────
    var tabela = '';
    if (regsAll.length) {
      tabela =
        '<table style="width:100%;border-collapse:collapse;font-size:0.83rem">'+
          '<thead><tr style="background:var(--bg3);border-bottom:2px solid var(--border)">'+
            '<th style="padding:8px 10px;text-align:left">Data</th>'+
            '<th style="padding:8px 10px;text-align:right">Qtd</th>'+
            '<th style="padding:8px 10px;text-align:right">Custo R$/kg</th>'+
            '<th style="padding:8px 10px;text-align:right">Frete R$/kg</th>'+
            '<th style="padding:8px 10px;text-align:right;color:var(--green)">Total R$/kg</th>'+
            '<th style="padding:8px 10px;text-align:center">Tipo</th>'+
            '<th style="padding:8px 10px"></th>'+
          '</tr></thead><tbody>'+
          regsAll.slice().reverse().map(function(r,ri){
            var isManu = !!r.manual;
            return '<tr style="border-bottom:1px solid var(--border)'+(ri%2===1?';background:var(--bg3)':'')+'">' +
              '<td style="padding:7px 10px;color:var(--text3)">'+(r.dataISO||r.data||'')+'</td>'+
              '<td style="padding:7px 10px;text-align:right">'+(r.qtd||'—')+'</td>'+
              '<td style="padding:7px 10px;text-align:right">R$ '+(r.custoKg||0).toFixed(2)+'</td>'+
              '<td style="padding:7px 10px;text-align:right">R$ '+(r.freteKg||0).toFixed(2)+'</td>'+
              '<td style="padding:7px 10px;text-align:right;font-weight:700;color:var(--green)">R$ '+(r.totalKg||0).toFixed(2)+'</td>'+
              '<td style="padding:7px 10px;text-align:center"><span style="font-size:0.7rem;padding:2px 7px;border-radius:12px;background:'+(isManu?'rgba(186,117,23,0.12)':'rgba(26,138,74,0.1)')+';color:'+(isManu?'var(--amber)':'var(--green)')+';">'+(isManu?'Manual':'Entrada')+'</span></td>'+
              '<td style="padding:7px 10px;text-align:center">'+(isManu?'<button onclick="estoqueHistExcluirManual(\''+r.id+'\')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:0.85rem" title="Excluir">🗑</button>':'')+'</td>'+
            '</tr>';
          }).join('')+
        '</tbody></table>';
    } else {
      tabela = '<div style="text-align:center;padding:2rem;color:var(--text3);font-size:0.9rem">Nenhuma compra registrada ainda. Use o formulário acima.</div>';
    }

    return '' +
      '<button onclick="_estoqueHistProduto=null;var c=document.getElementById(\'page-content\');if(c)c.innerHTML=(state.currentPage===\'produtos\'?renderProdutos():renderEstoque());" '+
        'style="display:inline-flex;align-items:center;gap:6px;margin-bottom:1.25rem;background:none;border:0.5px solid var(--border2);border-radius:8px;padding:6px 14px;color:var(--text2);cursor:pointer;font-size:0.85rem">← Voltar</button>' +
      '<div style="font-size:1.1rem;font-weight:700;margin-bottom:1.25rem">' + esc(nomeProd) + '</div>' +
      formManual +
      '<div class="card" style="padding:1.5rem">' +
        kpis + chartHtml + tabela +
      '</div>';
  }

  // ── LISTA de produtos (formato lista, não cards) ────────────
  var alfaAtivo = _estoqueHistOrdemAlfa;
  var html =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:8px">' +
      '<div style="font-size:0.82rem;color:var(--text3)">' + nomes.length + ' produto(s)</div>' +
      '<button onclick="_estoqueHistOrdemAlfa=!' + alfaAtivo + ';var c=document.getElementById(\'page-content\');if(c)c.innerHTML=(state.currentPage===\'produtos\'?renderProdutos():renderEstoque());" ' +
        'style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border:0.5px solid var(--border2);border-radius:8px;background:var(--card);color:' + (alfaAtivo?'var(--green)':'var(--text2)') + ';cursor:pointer;font-size:0.85rem">' +
        'A → Z' + (alfaAtivo?' ✓':'') +
      '</button>' +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.88rem">' +
        '<thead><tr style="background:var(--bg3);border-bottom:2px solid var(--border)">' +
          '<th style="padding:10px 16px;text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Produto</th>' +
          '<th style="padding:10px 16px;text-align:center;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Compras</th>' +
          '<th style="padding:10px 16px;text-align:right;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Último preço</th>' +
          '<th style="padding:10px 16px;text-align:right;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Variação</th>' +
          '<th style="padding:10px 16px;width:48px"></th>' +
        '</tr></thead><tbody>';

  nomes.forEach(function(nome, ni) {
    var regs = (porProduto[nome]||[]).slice().sort(function(a,b){
      return (a.dataISO||'') < (b.dataISO||'') ? -1 : 1;
    });
    var temHist = regs.length > 0;
    var ultimo  = temHist ? regs[regs.length-1] : null;
    var primeiro = temHist ? regs[0] : null;
    var variacao = (regs.length > 1) ? ((ultimo.totalKg - primeiro.totalKg) / primeiro.totalKg * 100) : null;
    var corVar  = variacao === null ? 'var(--text3)' : (variacao > 0 ? 'var(--red)' : 'var(--green)');
    var sinalVar = variacao === null ? '—' : ((variacao > 0 ? '▲ ' : '▼ ') + Math.abs(variacao).toFixed(1) + '%');

    html += '<tr style="border-bottom:0.5px solid var(--border);cursor:pointer;transition:background 0.12s" ' +
      'onclick="_estoqueHistProduto=\'' + esc(nome) + '\';var c=document.getElementById(\'page-content\');if(c)c.innerHTML=(state.currentPage===\'produtos\'?renderProdutos():renderEstoque());" ' +
      'onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="padding:12px 16px;font-weight:500">' + esc(nome) + '</td>' +
      '<td style="padding:12px 16px;text-align:center">' +
        (temHist
          ? '<span style="font-size:0.8rem;padding:2px 8px;border-radius:12px;background:rgba(26,138,74,0.1);color:var(--green);font-weight:600">' + regs.length + '</span>'
          : '<span style="font-size:0.8rem;color:var(--text3)">—</span>') +
      '</td>' +
      '<td style="padding:12px 16px;text-align:right;font-weight:700;color:' + (temHist?'var(--green)':'var(--text3)') + '">' +
        (temHist ? 'R$ ' + (ultimo.totalKg||0).toFixed(2) + '<span style="font-size:0.7rem;font-weight:400;color:var(--text3)">/kg</span>' : '—') +
      '</td>' +
      '<td style="padding:12px 16px;text-align:right;font-weight:600;font-size:0.85rem;color:' + corVar + '">' + sinalVar + '</td>' +
      '<td style="padding:12px 16px;text-align:right" onclick="event.stopPropagation()">' +
        '<button onclick="estoqueHistExcluirProduto(\'' + esc(nome) + '\')" ' +
          'style="background:none;border:0.5px solid var(--border2);border-radius:6px;color:var(--text3);cursor:pointer;padding:4px 8px;font-size:0.75rem;transition:all 0.15s" ' +
          'onmouseover="this.style.borderColor=\'var(--red)\';this.style.color=\'var(--red)\'" ' +
          'onmouseout="this.style.borderColor=\'var(--border2)\';this.style.color=\'var(--text3)\'">🗑</button>' +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function estoqueHistSalvarManual() {
  var dataEl  = document.getElementById('hist-data');
  var qtdEl   = document.getElementById('hist-qtd');
  var custoEl = document.getElementById('hist-custo');
  var freteEl = document.getElementById('hist-frete');
  var status  = document.getElementById('hist-status');

  var dataISO = dataEl  ? dataEl.value.trim()                          : '';
  var qtd     = qtdEl   ? parseFloat(qtdEl.value.replace(',','.')) ||0 : 0;
  var custo   = custoEl ? parseFloat(custoEl.value.replace(',','.'))||0 : 0;
  var frete   = freteEl ? parseFloat(freteEl.value.replace(',','.'))||0 : 0;

  if (!dataISO) { if(status) status.textContent='⚠ Informe a data.'; return; }
  if (custo<=0 && frete<=0) { if(status) status.textContent='⚠ Informe ao menos custo ou frete.'; return; }

  if (!state.estoque.historicoManual) state.estoque.historicoManual = [];
  state.estoque.historicoManual.push({
    id: 'hm_'+Date.now(),
    produto: _estoqueHistProduto,
    dataISO: dataISO,
    qtd: qtd||null,
    custoKg: custo,
    freteKg: frete,
    totalKg: custo + frete,
    manual: true,
  });

  saveState();
  // Salva também no nó separado do Firebase para persistência garantida
  estoqueHistPushFirebase();
  if(status){ status.textContent='✓ Compra salva!'; setTimeout(function(){ status.textContent=''; },2000); }
  var c = document.getElementById('page-content');
  if(c) c.innerHTML = (state.currentPage==='produtos'?renderProdutos():renderEstoque());
}

function estoqueHistExcluirManual(id) {
  if (!confirm('Remover este registro?')) return;
  state.estoque.historicoManual = (state.estoque.historicoManual||[]).filter(function(r){ return r.id !== id; });
  saveState();
  estoqueHistPushFirebase();
  var c = document.getElementById('page-content');
  if(c) c.innerHTML = (state.currentPage==='produtos'?renderProdutos():renderEstoque());
}

function estoqueHistExcluirProduto(nome) {
  if (!confirm('Remover TODO o histórico de "' + nome + '"?\nIsso não afeta o estoque.')) return;
  state.estoque.historicoManual = (state.estoque.historicoManual||[]).filter(function(r){ return r.produto !== nome; });
  saveState();
  estoqueHistPushFirebase();
  var c = document.getElementById('page-content');
  if(c) c.innerHTML = (state.currentPage==='produtos'?renderProdutos():renderEstoque());
}

function estoqueHistPushFirebase() {
  var data = state.estoque.historicoManual || [];
  fetch(FIREBASE_URL + '/historicoManual.json', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).catch(function(e){ console.warn('[HistoricoPush] erro:', e); });
}

function estoqueHistLoadFirebase() {
  fetch(FIREBASE_URL + '/historicoManual.json')
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!Array.isArray(data) || data.length === 0) return;
      // Mescla sem duplicar
      var existentes = state.estoque.historicoManual || [];
      var ids = new Set(existentes.map(function(r){ return r.id; }));
      var novos = data.filter(function(r){ return !ids.has(r.id); });
      if (novos.length > 0) {
        state.estoque.historicoManual = existentes.concat(novos);
        console.log('[HistoricoLoad] Carregados ' + novos.length + ' registros do Firebase separado');
      }
    })
    .catch(function(e){ console.warn('[HistoricoLoad] erro:', e); });
}

function renderEstoqueCusto() {
  var custos = state.financeiro.custoProdutos || {};

  // Se custoProdutos estiver vazio, tenta carregar do Firebase
  if (Object.keys(custos).length === 0 && !_estoqueCustoCarregando) {
    _estoqueCustoCarregando = true;
    fetch(FIREBASE_URL + '/financeiro/meta.json')
      .then(function(r){ return r.json(); })
      .then(function(meta){
        _estoqueCustoCarregando = false;
        if (meta && meta.custoProdutos) {
          state.financeiro.custoProdutos = meta.custoProdutos;
          if (meta.despesas) {
            var raw = meta.despesas;
            state.financeiro.despesas = Array.isArray(raw) ? {'sem-mes': raw} : (raw || {});
          }
          if (meta.aliquota !== undefined) state.financeiro.aliquota = meta.aliquota;
          var c = document.getElementById('page-content');
          if (c && state.currentPage === 'produtos') c.innerHTML = renderProdutos();
          else if (c && _estoqueTab === 'custo') c.innerHTML = renderEstoque();
        }
      })
      .catch(function(){ _estoqueCustoCarregando = false; });
  }
  var sel = _estoqueCustoProdSel;

  // ── DETALHE: formulário de edição ───────────────────────────
  if (sel) {
    var prod = PRODUTOS_CUSTO.find(function(p){ return p.sku === sel; });
    if (!prod) { _estoqueCustoProdSel = null; }
    else {
      var c = custos[sel] || {};
      // Busca último preço do kg deste produto no histórico
      var ultimoKg = '';
      var hist = (state.estoque.historicoManual || []).concat(
        (state.estoque.movimentacoes||[]).filter(function(m){ return m.tipo==='entrada'&&m.totalKg>0; })
      );
      // tenta associar por nome do produto no histórico — heurística por palavras-chave do SKU
      var skuWords = sel.replace(/[0-9]/g,'').split(/(?=[A-Z])/).join(' ').toLowerCase();
      var maisRecente = null;
      hist.forEach(function(r){
        if (!r.totalKg) return;
        var nomeLow = (r.produto||'').toLowerCase();
        var match = skuMatchHist(sel, nomeLow);
        if (match) {
          if (!maisRecente || (r.dataISO||'') > (maisRecente.dataISO||'')) maisRecente = r;
        }
      });
      if (maisRecente) ultimoKg = maisRecente.totalKg;

      // Custo calculado automaticamente se preço/kg disponível
      var ultimoKgNum = parseFloat(ultimoKg) || 0;
      var custoProduto = c.custoManual !== undefined ? parseFloat(c.custoManual) :
        (ultimoKgNum ? round4((ultimoKgNum * prod.peso / 1000) + (parseFloat(c.embalagem)||0) + (parseFloat(c.caixa)||0)) : '');

      return '' +
        '<button onclick="_estoqueCustoProdSel=null;var el=document.getElementById(\'page-content\');if(el)el.innerHTML=(state.currentPage===\'produtos\'?renderProdutos():renderEstoque());" ' +
          'style="display:inline-flex;align-items:center;gap:6px;margin-bottom:1.25rem;background:none;border:0.5px solid var(--border2);border-radius:8px;padding:6px 14px;color:var(--text2);cursor:pointer;font-size:0.85rem">← Voltar</button>' +
        '<div class="card" style="padding:1.5rem;max-width:520px">' +
          '<div style="font-size:1rem;font-weight:700;margin-bottom:1.5rem">' + esc(prod.nome) + ' <span style="font-size:0.75rem;color:var(--text3);font-weight:400">SKU: '+prod.sku+'</span></div>' +
          (ultimoKgNum ? '<div style="background:rgba(26,138,74,0.08);border:0.5px solid rgba(26,138,74,0.2);border-radius:8px;padding:10px 14px;margin-bottom:1.25rem;font-size:0.83rem;color:var(--text2)">'+
            '📈 Último preço/kg no histórico: <strong style="color:var(--green)">'+finFmt(ultimoKgNum)+'/kg</strong> → custo ingrediente: <strong>'+finFmt(ultimoKgNum*prod.peso/1000)+'</strong> ('+prod.peso+'g)'+
            (custoProduto !== '' ? '<br>💰 Custo final do produto (ingrediente + embalagem + caixa): <strong style="color:var(--green);font-size:0.95rem">'+finFmt(custoProduto)+'</strong>' : '') +
          '</div>' : '<div style="background:rgba(186,117,23,0.08);border:0.5px solid rgba(186,117,23,0.2);border-radius:8px;padding:10px 14px;margin-bottom:1.25rem;font-size:0.83rem;color:var(--text2)">'+
            '⚠️ Nenhum preço/kg encontrado no Histórico de Preços para este produto. Informe o custo manualmente.'+
          '</div>') +
          '<div style="display:flex;flex-direction:column;gap:12px">' +
            '<div><label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:4px">Embalagem (R$)</label>' +
              '<input type="number" id="cp-emb" min="0" step="0.01" value="'+(c.embalagem||'')+'" placeholder="0,00" '+
              'style="width:100%;padding:9px 12px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">'+
            '</div>' +
            '<div><label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:4px">Caixa / Rateio (R$)</label>' +
              '<input type="number" id="cp-caixa" min="0" step="0.01" value="'+(c.caixa||'')+'" placeholder="0,00" '+
              'style="width:100%;padding:9px 12px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">'+
            '</div>' +
            '<div><label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:4px">Custo do produto (R$) <span style="color:var(--text3);font-weight:400">— deixe em branco para calcular automaticamente</span></label>' +
              '<input type="number" id="cp-custo" min="0" step="0.0001" value="'+(c.custoManual !== undefined ? c.custoManual : '')+'" placeholder="Calculado automaticamente" '+
              'style="width:100%;padding:9px 12px;border:0.5px solid var(--border2);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.9rem">'+
            '</div>' +
          '</div>' +
          '<div id="cp-status" style="font-size:0.82rem;margin-top:10px;min-height:1.2em"></div>' +
          '<button onclick="estoqueSalvarCusto(\''+sel+'\')" ' +
            'style="margin-top:1rem;width:100%;padding:10px;background:var(--green);color:#fff;border:none;border-radius:9px;font-size:0.9rem;font-weight:600;cursor:pointer">Salvar</button>' +
        '</div>';
    }
  }

  // ── LISTA de produtos ────────────────────────────────────────
  var custoProdTotal = 0;
  var comCusto = 0;
  PRODUTOS_CUSTO.forEach(function(p){
    var custoDin = mgvCustoAtual(p.sku);
    if (custoDin !== null) { custoProdTotal += custoDin; comCusto++; }
  });

  var html =
    '<div style="margin-bottom:1rem;font-size:0.82rem;color:var(--text3)">' +
      comCusto + ' de ' + PRODUTOS_CUSTO.length + ' produtos com custo cadastrado' +
    '</div>' +
    '<div class="card" style="padding:0;overflow:hidden">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.87rem">' +
        '<thead><tr style="background:var(--bg3);border-bottom:2px solid var(--border)">' +
          '<th style="padding:10px 16px;text-align:left;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Produto</th>' +
          '<th style="padding:10px 16px;text-align:center;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">SKU</th>' +
          '<th style="padding:10px 16px;text-align:right;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Embalagem</th>' +
          '<th style="padding:10px 16px;text-align:right;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3)">Caixa</th>' +
          '<th style="padding:10px 16px;text-align:right;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.5px;color:var(--text3);color:var(--green)">Custo Unit.</th>' +
          '<th style="padding:10px 16px;width:40px"></th>' +
        '</tr></thead><tbody>';

  PRODUTOS_CUSTO.forEach(function(p) {
    var c = custos[p.sku] || {};
    var custoDinamico = mgvCustoAtual(p.sku);
    html += '<tr style="border-bottom:0.5px solid var(--border);cursor:pointer;transition:background 0.12s" '+
      'onclick="_estoqueCustoProdSel=\''+p.sku+'\';var el=document.getElementById(\'page-content\');if(el)el.innerHTML=(state.currentPage===\'produtos\'?renderProdutos():renderEstoque());" '+
      'onmouseover="this.style.background=\'var(--bg3)\'" onmouseout="this.style.background=\'\'">'+
      '<td style="padding:11px 16px;font-weight:500">'+esc(p.nome)+'</td>'+
      '<td style="padding:11px 16px;text-align:center;font-size:0.78rem;color:var(--text3);font-family:monospace">'+p.sku+'</td>'+
      '<td style="padding:11px 16px;text-align:right;color:var(--text2)">'+(c.embalagem !== undefined ? 'R$ '+parseFloat(c.embalagem).toFixed(2) : '—')+'</td>'+
      '<td style="padding:11px 16px;text-align:right;color:var(--text2)">'+(c.caixa !== undefined ? 'R$ '+parseFloat(c.caixa).toFixed(2) : '—')+'</td>'+
      '<td style="padding:11px 16px;text-align:right;font-weight:700;color:'+(custoDinamico!==null?'var(--green)':'var(--text3)')+'">'+(custoDinamico!==null ? finFmt(custoDinamico) : '—')+'</td>'+
      '<td style="padding:11px 16px;text-align:right;color:var(--text3);font-size:0.8rem">→</td>'+
    '</tr>';
  });

  html += '</tbody></table></div>';
  return html;
}

function estoqueSalvarCusto(sku) {
  var embEl   = document.getElementById('cp-emb');
  var caixaEl = document.getElementById('cp-caixa');
  var custoEl = document.getElementById('cp-custo');
  var status  = document.getElementById('cp-status');

  var emb   = parseFloat((embEl  ?embEl.value:'').replace(',','.'))||0;
  var caixa = parseFloat((caixaEl?caixaEl.value:'').replace(',','.'))||0;
  var custoManualStr = (custoEl?custoEl.value:'').trim();
  var custoManual = custoManualStr !== '' ? parseFloat(custoManualStr.replace(',','.'))||0 : undefined;

  if (!state.financeiro.custoProdutos) state.financeiro.custoProdutos = {};

  // Calcula custo final: manual ou automático
  var prod = PRODUTOS_CUSTO.find(function(p){ return p.sku === sku; });
  var custoFinal = custoManual;
  if (custoFinal === undefined) {
    // tenta pegar do histórico
    var hist = (state.estoque.historicoManual||[]).concat(
      (state.estoque.movimentacoes||[]).filter(function(m){ return m.tipo==='entrada'&&m.totalKg>0; })
    );
    var maisRecente = null;
    hist.forEach(function(r){
      if (!r.totalKg) return;
      var nomeLow = (r.produto||'').toLowerCase();
      var match = skuMatchHist(sku, nomeLow);
      if (match && (!maisRecente||(r.dataISO||'')>(maisRecente.dataISO||''))) maisRecente = r;
    });
    if (maisRecente && prod) {
      custoFinal = maisRecente.totalKg * prod.peso / 1000 + emb + caixa;
    }
  }

  state.financeiro.custoProdutos[sku] = {
    embalagem: emb,
    caixa: caixa,
    custoManual: custoManual,
    custoFinal: custoFinal !== undefined ? round4(custoFinal) : undefined,
  };

  finSaveFirebase().then(function(){
    if(status){ status.textContent='✓ Salvo!'; status.style.color='var(--green)'; setTimeout(function(){ status.textContent=''; },2000); }
  });
}

function round4(v){ return Math.round(v*10000)/10000; }

function setupEstoque() {}

function estoqueSetTab(tab) {
  _estoqueTab = tab;
  _estoqueOrdemAberto = false;
  navigate('estoque');
}

function estoqueSetOrdem(ordem) {
  _estoqueOrdem = ordem;
  _estoqueOrdemAberto = false;
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderEstoque();
}

function estoqueToggleOrdem() {
  _estoqueOrdemAberto = !_estoqueOrdemAberto;
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderEstoque();
  // Fecha se clicar fora
  if (_estoqueOrdemAberto) {
    setTimeout(function() {
      document.addEventListener('click', function fechar(e) {
        if (!e.target.closest || !e.target.closest('[data-est-ordem]')) {
          _estoqueOrdemAberto = false;
          var c2 = document.getElementById('page-content');
          if (c2) c2.innerHTML = renderEstoque();
          document.removeEventListener('click', fechar);
        }
      });
    }, 50);
  }
}

function estoqueSetBusca(val) {
  _estoqueBusca = val || '';
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderEstoque();
  var inp = document.getElementById('est-busca');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function estoqueRegistrarMov() {
  var idxEl   = document.getElementById('est-mov-produto');
  var tipoEl  = document.getElementById('est-mov-tipo');
  var qtdEl   = document.getElementById('est-mov-qtd');
  var obsEl   = document.getElementById('est-mov-obs');
  var custoEl = document.getElementById('est-mov-custo');
  var freteEl = document.getElementById('est-mov-frete');
  var status  = document.getElementById('est-mov-status');

  var idx   = idxEl  ? parseInt(idxEl.value)  : -1;
  var tipo  = tipoEl ? tipoEl.value           : 'saida';
  var qtd   = qtdEl  ? parseInt(qtdEl.value)  : 0;
  var obs   = obsEl  ? obsEl.value.trim()     : '';
  var custo = custoEl ? parseFloat(custoEl.value.replace(',','.')) || 0 : 0;
  var frete = freteEl ? parseFloat(freteEl.value.replace(',','.')) || 0 : 0;

  if (isNaN(idx) || idx < 0 || !state.estoque.produtos[idx]) { if(status) status.textContent = '⚠ Selecione um produto.'; return; }
  if (!qtd || qtd < 1) { if(status) status.textContent = '⚠ Informe uma quantidade válida.'; return; }

  var p = state.estoque.produtos[idx];
  if (tipo === 'saida' && qtd > p.qtd) { if(status) status.textContent = '⚠ Quantidade maior que o estoque (' + p.qtd + ').'; return; }

  var anterior = p.qtd;
  p.qtd = tipo === 'entrada' ? p.qtd + qtd : p.qtd - qtd;

  var now = new Date();
  var dataStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
  var dataISO = now.toISOString().slice(0,10); // para o gráfico

  var mov = {
    id: Date.now(),
    data: dataStr,
    dataISO: dataISO,
    produto: p.nome,
    tipo: tipo,
    qtd: qtd,
    saldoApos: p.qtd,
    usuario: state.currentUser ? state.currentUser.login : '--',
    obs: obs,
  };
  if (tipo === 'entrada' && (custo > 0 || frete > 0)) {
    mov.custoKg  = custo;
    mov.freteKg  = frete;
    mov.totalKg  = custo + frete;
  }

  state.estoque.movimentacoes.push(mov);
  addLog((tipo === 'entrada' ? 'Entrada' : 'Saída') + ' de estoque: ' + qtd + 'x ' + p.nome + ' (antes: ' + anterior + ' → agora: ' + p.qtd + ')');
  saveState();
  if (status) { status.textContent = '✓ Registrado!'; setTimeout(function(){ status.textContent=''; }, 2000); }
  navigate('estoque');
}

function estoqueAbrirModalMov(idx, tipo) {
  _estoqueTab = 'movimentacao';
  navigate('estoque');
  setTimeout(function() {
    var idxEl  = document.getElementById('est-mov-produto');
    var tipoEl = document.getElementById('est-mov-tipo');
    if (idxEl)  idxEl.value  = idx;
    if (tipoEl) tipoEl.value = tipo;
    var qtdEl = document.getElementById('est-mov-qtd');
    if (qtdEl) { qtdEl.focus(); qtdEl.select(); }
  }, 80);
}

function estoqueAbrirModalProduto(idx) {
  var p = idx !== null ? state.estoque.produtos[idx] : null;
  var modal = document.getElementById('modal');
  var modalContent = document.getElementById('modal-content');
  if (!modal || !modalContent) return;
  modalContent.innerHTML =
    '<div style="padding:1.5rem;min-width:300px;max-width:400px">' +
      '<div style="font-size:1.1rem;font-weight:700;margin-bottom:1.25rem">' + (p ? '✏️ Editar Produto' : '+ Novo Produto') + '</div>' +
      '<div style="margin-bottom:10px"><label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:4px">Nome do Produto *</label>' +
        '<input id="est-p-nome" class="tn-input" placeholder="Ex: Granola Crunchy" value="' + esc(p ? p.nome : '') + '" style="width:100%;margin:0"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:4px">Unidade</label>' +
          '<input id="est-p-unidade" class="tn-input" placeholder="Ex: kg, un, cx" value="' + esc(p ? (p.unidade||'') : '') + '" style="width:100%;margin:0"></div>' +
        '<div><label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:4px">Qtd. Inicial</label>' +
          '<input id="est-p-qtd" type="number" class="tn-input" min="0" value="' + (p ? p.qtd : '0') + '" style="width:100%;margin:0"></div>' +
      '</div>' +
      '<div style="margin-bottom:1.25rem"><label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:4px">Estoque Mínimo (alerta)</label>' +
        '<input id="est-p-minimo" type="number" class="tn-input" min="0" value="' + (p ? (p.minimo||0) : '0') + '" style="width:100%;margin:0"></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn" style="flex:1" onclick="closeModal()">Cancelar</button>' +
        '<button class="btn btn-green" style="flex:1" onclick="estoqueSalvarProduto(' + (idx !== null ? idx : 'null') + ')">💾 Salvar</button>' +
      '</div>' +
      '<div id="est-p-status" style="font-size:0.82rem;color:var(--red);text-align:center;margin-top:8px;min-height:1.2em"></div>' +
    '</div>';
  modal.style.display = 'flex';
  setTimeout(function(){ var el = document.getElementById('est-p-nome'); if(el) el.focus(); }, 50);
}

function estoqueSalvarProduto(idx) {
  var nome   = (document.getElementById('est-p-nome')    ||{}).value || '';
  var unidade= (document.getElementById('est-p-unidade') ||{}).value || '';
  var qtd    = parseInt((document.getElementById('est-p-qtd')    ||{}).value) || 0;
  var minimo = parseInt((document.getElementById('est-p-minimo') ||{}).value) || 0;
  var status = document.getElementById('est-p-status');

  if (!nome.trim()) { if(status) status.textContent = 'Informe o nome do produto.'; return; }

  if (idx === null || idx === 'null') {
    state.estoque.produtos.push({ nome: nome.trim(), unidade: unidade.trim(), qtd: qtd, minimo: minimo });
    addLog('Cadastrou produto no estoque: "' + nome.trim() + '"');
  } else {
    var p = state.estoque.produtos[idx];
    p.nome = nome.trim(); p.unidade = unidade.trim(); p.minimo = minimo;
    // Só atualiza qtd se mudou (não registra movimentação automática na edição)
    p.qtd = qtd;
    addLog('Editou produto no estoque: "' + nome.trim() + '"');
  }
  saveState();
  closeModal();
  navigate('estoque');
}

function estoqueExcluirProduto(idx) {
  var p = state.estoque.produtos[idx];
  if (!p) return;
  if (!confirm('Excluir "' + p.nome + '" do estoque? Esta ação não pode ser desfeita.')) return;
  addLog('Excluiu produto do estoque: "' + p.nome + '"');
  state.estoque.produtos.splice(idx, 1);
  saveState();
  navigate('estoque');
}

function estoqueLimparHistorico() {
  if (!confirm('Limpar todo o histórico de movimentações?')) return;
  state.estoque.movimentacoes = [];
  addLog('Limpou histórico de movimentações do estoque');
  saveState();
  navigate('estoque');
}
