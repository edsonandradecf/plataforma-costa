// --- TABELA NUTRICIONAL -------------------------------------------------------
var _tnEdit = null; // id do item sendo editado

function tnDefaultForm() {
  return {
    nome: '', descricao: '', porcao: '30g', porcoes: '10',
    vce_energia: '100', energia: '100',
    carboidratos: '20', carboidratos_vd: '7',
    acucares: '5', acucares_ad: '',
    gorduras_totais: '3', gorduras_totais_vd: '4',
    gorduras_sat: '1', gorduras_sat_vd: '5',
    gorduras_trans: '0',
    fibras: '1', fibras_vd: '4',
    sodio: '50', sodio_vd: '2',
    proteinas: '2', proteinas_vd: '3',
    ingredientes: '', alergicos: '',
    peso: '300g', validade: '12 meses', lote: '',
    cnpj: '', sac: '',
    ean: '',
  };
}

var _tnData = tnDefaultForm();

function renderTabNutri() {
  var tab = (typeof _tnTab !== 'undefined') ? _tnTab : 'biblioteca';
  var tabBib = tab === 'biblioteca';

  // -- Tab bar --
  var tabBar = '<div style="display:flex;gap:0;margin-bottom:1.5rem;border-bottom:2px solid var(--border)">' +
    '<button onclick="tnSetTab(\'biblioteca\')" style="padding:0.65rem 1.5rem;background:none;border:none;border-bottom:' + (tabBib ? '3px solid var(--green);color:var(--green);font-weight:600' : 'none;color:var(--text2)') + ';cursor:pointer;font-size:0.95rem;margin-bottom:-2px;transition:all 0.15s">📚 Biblioteca</button>' +
    '<button onclick="tnSetTab(\'criar\')" style="padding:0.65rem 1.5rem;background:none;border:none;border-bottom:' + (!tabBib ? '3px solid var(--green);color:var(--green);font-weight:600' : 'none;color:var(--text2)') + ';cursor:pointer;font-size:0.95rem;margin-bottom:-2px;transition:all 0.15s">' + (_tnEdit !== null ? '✏️ Editando' : '➕ Criar Tabela') + '</button>' +
  '</div>';

  if (tabBib) {
    // -- BIBLIOTECA --
    var searchVal = (typeof _tnSearch !== 'undefined') ? _tnSearch.toLowerCase() : '';
    var saved = state.tabnutri;
    var filtered = saved.map(function(item, i){ return { item: item, i: i }; })
      .filter(function(x){ return !searchVal || x.item.nome.toLowerCase().indexOf(searchVal) !== -1; });

    var savedHtml = '';
    // Search bar
    savedHtml += '<div style="margin-bottom:1rem;position:relative">' +
      '<input id="tn-search-input" type="text" class="tn-input" placeholder="🔍  Buscar por nome do produto..." ' +
      'value="' + esc(searchVal) + '" oninput="tnSearchFilter(this.value)" ' +
      'style="padding-left:2.2rem;font-size:0.95rem">' +
      '<svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--text3)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
    '</div>';

    if (!saved.length) {
      savedHtml += '<div class="empty-state">' + iconEmpty() + '<p>Nenhuma tabela salva ainda. Clique em "Criar Tabela" para começar.</p></div>';
    } else if (!filtered.length) {
      savedHtml += '<div class="empty-state">' + iconEmpty() + '<p>Nenhum produto encontrado para "<b>' + esc(searchVal) + '</b>".</p></div>';
    } else {
      savedHtml += '<div style="font-size:0.8rem;color:var(--text3);margin-bottom:0.75rem">' + filtered.length + ' produto(s) encontrado(s)</div>';
      savedHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem">';
      filtered.forEach(function(x) {
        var item = x.item, i = x.i;
        savedHtml += '<div class="card" style="padding:1rem">' +
          '<div style="font-size:1rem;font-weight:600;margin-bottom:4px">' + esc(item.nome) + '</div>' +
          '<div style="font-size:0.8rem;color:var(--text3);margin-bottom:10px">' +
            esc(item.porcao || '--') + ' &bull; ' + (item.ean ? 'EAN: ' + esc(item.ean) : 'Sem EAN') +
            (item.peso ? ' &bull; ' + esc(item.peso) : '') +
          '</div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-sm" style="flex:1" onclick="tnLoad(' + i + ')">✏️ Editar</button>' +
            '<button class="btn btn-sm btn-green" style="flex:1" onclick="tnPrint(' + i + ')">⬇ PDF</button>' +
            '<button class="btn btn-sm btn-red" onclick="tnDelete(' + i + ')">x</button>' +
          '</div>' +
        '</div>';
      });
      savedHtml += '</div>';
    }
    return tabBar + savedHtml;
  }

  // -- CRIAR / EDITAR --
  var formTitle = _tnEdit !== null ? ('Editando: ' + (state.tabnutri[_tnEdit] ? state.tabnutri[_tnEdit].nome : '')) : 'Nova Tabela Nutricional';

  var formHtml =
    '<div style="display:grid;grid-template-columns:1fr 360px;gap:1.5rem;align-items:start">' +

    // Left col: form
    '<div class="card">' +
      '<div class="card-header"><span class="card-title" id="tn-form-title">' + formTitle + '</span>' +
      (_tnEdit !== null ? '<button class="btn btn-sm" onclick="tnReset()">+ Nova</button>' : '') +
      '</div>' +

      '<div class="tn-section">Produto</div>' +
      '<div class="tn-form-grid" style="margin-bottom:8px">' +
        '<div><label class="tn-label">Nome do Produto *</label><input class="tn-input" id="tn-nome" placeholder="Ex: Granola Crunchy" oninput="tnLiveUpdate()"></div>' +
        '<div><label class="tn-label">Descrição</label><input class="tn-input" id="tn-descricao" placeholder="Ex: Com mel e castanhas" oninput="tnLiveUpdate()"></div>' +
      '</div>' +
      '<div class="tn-form-grid-3" style="margin-bottom:8px">' +
        '<div><label class="tn-label">Porção (ex: 30g)</label><input class="tn-input" id="tn-porcao" value="30g" oninput="tnLiveUpdate()"></div>' +
        '<div><label class="tn-label">Porções por emb.</label><input class="tn-input" id="tn-porcoes" value="10" oninput="tnLiveUpdate()"></div>' +
        '<div><label class="tn-label">Peso Líquido</label><input class="tn-input" id="tn-peso" value="300g" oninput="tnLiveUpdate()"></div>' +
      '</div>' +

      '<div class="tn-section">Informação Nutricional (por porção)</div>' +
      '<div style="background:var(--bg3);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:0.78rem;color:var(--text3)">Preencha os valores para 100g e por porção. %VD = % do Valor Diário de Referência.</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;font-size:0.7rem;font-weight:700;color:var(--text3);padding:0 2px">' +
        '<span>Nutriente</span><span style="text-align:center">100g</span><span style="text-align:center">Porção</span><span style="text-align:center">%VD</span>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0">Valor Energético (kcal)</label>' +
        '<input class="tn-input" id="tn-kcal100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-energia" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-vce_energia" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0">Carboidratos (g)</label>' +
        '<input class="tn-input" id="tn-carb100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-carboidratos" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-carboidratos_vd" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0;padding-left:8px">Açúcares Totais (g)</label>' +
        '<input class="tn-input" id="tn-acucar100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-acucares" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-acucar_vd" placeholder="**" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0;padding-left:16px">Açúcares Adicionados (g)</label>' +
        '<input class="tn-input" id="tn-acucar_ad100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-acucares_ad" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-acucar_ad_vd" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0">Proteínas (g)</label>' +
        '<input class="tn-input" id="tn-prot100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-proteinas" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-proteinas_vd" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0">Gorduras Totais (g)</label>' +
        '<input class="tn-input" id="tn-gord100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-gorduras_totais" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-gorduras_totais_vd" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0;padding-left:8px">Gorduras Saturadas (g)</label>' +
        '<input class="tn-input" id="tn-gordsat100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-gorduras_sat" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-gorduras_sat_vd" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0;padding-left:8px">Gorduras Trans (g)</label>' +
        '<input class="tn-input" id="tn-gordtrans100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-gorduras_trans" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<span style="font-size:0.75rem;color:var(--text3);text-align:center">**</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:4px;align-items:center">' +
        '<label class="tn-label" style="margin:0">Fibra Alimentar (g)</label>' +
        '<input class="tn-input" id="tn-fibra100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-fibras" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-fibras_vd" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 0.8fr;gap:4px;margin-bottom:12px;align-items:center">' +
        '<label class="tn-label" style="margin:0">Sódio (mg)</label>' +
        '<input class="tn-input" id="tn-sodio100" placeholder="100g" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-sodio" placeholder="porção" oninput="tnLiveUpdate()" style="margin:0">' +
        '<input class="tn-input" id="tn-sodio_vd" placeholder="%VD" oninput="tnLiveUpdate()" style="margin:0">' +
      '</div>' +

      '<div class="tn-section">Ingredientes e Alérgenos</div>' +
      '<div style="margin-bottom:8px"><label class="tn-label">Ingredientes</label><textarea class="tn-input" id="tn-ingredientes" rows="3" placeholder="Aveia, mel, amendoim..." oninput="tnLiveUpdate()" style="resize:vertical"></textarea></div>' +
      '<div style="margin-bottom:8px"><label class="tn-label">Alérgenos / Contém / Pode conter</label><textarea class="tn-input" id="tn-alergicos" rows="2" placeholder="Contém glúten, amendoim. Pode conter soja." oninput="tnLiveUpdate()" style="resize:vertical"></textarea></div>' +

      '<div class="tn-section">Validade, Lote e Rastreabilidade</div>' +
      '<div class="tn-form-grid" style="margin-bottom:8px">' +
        '<div><label class="tn-label">Validade</label><input class="tn-input" id="tn-validade" value="12 meses" oninput="tnLiveUpdate()"></div>' +
        '<div><label class="tn-label">Lote (opcional)</label><input class="tn-input" id="tn-lote" placeholder="LOT001" oninput="tnLiveUpdate()"></div>' +
      '</div>' +

      '<div class="tn-section">Empresa e Contato</div>' +
      '<div class="tn-form-grid" style="margin-bottom:8px">' +
        '<div><label class="tn-label">CNPJ</label><input class="tn-input" id="tn-cnpj" placeholder="00.000.000/0001-00" oninput="tnLiveUpdate()"></div>' +
        '<div><label class="tn-label">SAC (WhatsApp)</label><input class="tn-input" id="tn-sac" placeholder="(11) 99999-9999" oninput="tnLiveUpdate()"></div>' +
      '</div>' +

      '<div class="tn-section">Código de Barras e QR Code</div>' +
      '<div style="margin-bottom:1rem"><label class="tn-label">Código EAN (8 ou 13 dígitos)</label><input class="tn-input" id="tn-ean" placeholder="7891234567890" oninput="tnLiveUpdate()"></div>' +
      '<div style="margin-bottom:1rem">' +
        '<label class="tn-label">Link para QR Code</label>' +
        '<input class="tn-input" id="tn-url" placeholder="https://costanaturelife.com.br/produto/..." oninput="tnLiveUpdate()">' +
        '<div style="font-size:0.75rem;color:var(--text3);margin-top:4px">O QR Code na etiqueta vai apontar para este link. Se vazio, usa o site da loja.</div>' +
      '</div>' +

      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-green" style="flex:1;padding:0.7rem" onclick="tnSave()">💾 Salvar Tabela</button>' +
        '<button class="btn btn-green" style="flex:1;padding:0.7rem" onclick="tnGeneratePDF()">⬇ Baixar PDF</button>' +
      '</div>' +
      '<div id="tn-status" style="color:var(--text2);font-size:0.82rem;text-align:center;margin-top:8px;min-height:1.2em"></div>' +
    '</div>' +

    // Right col: live preview
    '<div class="card" style="position:sticky;top:1rem">' +
      '<div class="card-header"><span class="card-title">Prévia (100×150mm)</span></div>' +
      '<div style="overflow:auto;display:flex;justify-content:center;padding:4px 0">' +
        '<div id="tn-preview-box" class="tn-preview-wrap"></div>' +
      '</div>' +
      '<div style="margin-top:10px;display:none" id="tn-barcode-wrap"><svg id="tn-barcode-svg"></svg></div>' +
      '<div style="margin-top:6px;display:none" id="tn-qr-wrap"><div id="tn-qr-div"></div></div>' +
    '</div>' +

  '</div>';

  return tabBar + formHtml;
}

var _tnTab = 'biblioteca';
var _etqTab = 'zpl'; // 'zpl' or 'transportadora'
var _tnSearch = '';

function tnSearchFilter(val) {
  _tnSearch = val || '';
  // Re-render only the biblioteca content without full navigate (keeps focus)
  var c = document.getElementById('page-content');
  if (c) c.innerHTML = renderTabNutri();
  // Restore focus to search input
  var inp = document.getElementById('tn-search-input');
  if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function tnSetTab(tab) {
  _tnTab = tab;
  if (tab !== 'criar') _tnEdit = null;
  if (tab === 'biblioteca') _tnSearch = '';
  navigate('tabnutri');
}

function bindTabNutri() {
  setupTabNutri();
}

function setupTabNutri() {
  if (_tnTab === 'biblioteca') return;
  if (_tnEdit !== null) {
    var d = state.tabnutri[_tnEdit];
    if (d) {
      Object.keys(d).forEach(function(k) {
        var el = document.getElementById('tn-' + k);
        if (el) el.value = d[k];
      });
      var titleEl = document.getElementById('tn-form-title');
      if (titleEl) titleEl.textContent = 'Editando: ' + d.nome;
    }
  }
  tnLiveUpdate();
}

function tnGetFormData() {
  var fields = ['nome','descricao','porcao','porcoes','peso',
    'kcal100','energia','vce_energia',
    'carb100','carboidratos','carboidratos_vd',
    'acucar100','acucares','acucar_vd',
    'acucar_ad100','acucares_ad','acucar_ad_vd',
    'prot100','proteinas','proteinas_vd',
    'gord100','gorduras_totais','gorduras_totais_vd',
    'gordsat100','gorduras_sat','gorduras_sat_vd',
    'gordtrans100','gorduras_trans',
    'fibra100','fibras','fibras_vd',
    'sodio100','sodio','sodio_vd',
    'ingredientes','alergicos','validade','lote','cnpj','sac','ean','url'];
  var data = {};
  fields.forEach(function(f) {
    var el = document.getElementById('tn-' + f);
    data[f] = el ? el.value.trim() : '';
  });
  return data;
}

function tnLiveUpdate() {
  var d = tnGetFormData();
  var box = document.getElementById('tn-preview-box');
  if (!box) return;

  // Usa o mesmo buildEtiquetaHTML mas escalado para caber na prévia (~640px de largura)
  var scale = 640 / 850;

  function nv(v) { return (String(v||'').trim()) || '--'; }
  function esc2(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function row(label, v100, vPorc, vd, bold, indent) {
    var fw = 'font-weight:700';
    var ind = indent ? 'padding-left:14px' : '';
    return '<tr style="border-bottom:0.5px solid #aaa">'+
      '<td style="'+fw+';'+ind+';padding:3px 5px;font-size:13px">'+label+'</td>'+
      '<td style="'+fw+';text-align:center;padding:3px 5px;font-size:13px">'+nv(v100)+'</td>'+
      '<td style="'+fw+';text-align:center;padding:3px 5px;font-size:13px">'+nv(vPorc)+'</td>'+
      '<td style="'+fw+';text-align:right;padding:3px 5px;font-size:13px">'+nv(vd)+'</td>'+
    '</tr>';
  }

  var W = 850, H = 567;
  var html =
    '<div style="width:'+W+'px;height:'+H+'px;background:#fff;font-family:helvetica,arial,sans-serif;display:flex;flex-direction:column;border:3px solid #000;box-sizing:border-box;overflow:hidden">'+
      '<div style="border-bottom:3px solid #000;text-align:center;padding:6px 0;font-size:18px;font-weight:700;letter-spacing:3px">COSTA NATURE LIFE</div>'+
      '<div style="display:flex;flex:1;overflow:hidden">'+
        '<div style="width:530px;border-right:3px solid #000;display:flex;flex-direction:column;padding:10px 12px 8px 12px;box-sizing:border-box">'+
          '<div style="text-align:center;margin-bottom:6px">'+
            '<div style="font-size:16px;font-weight:700">'+esc2(d.nome||'Nome do Produto')+'</div>'+
            (d.descricao?'<div style="font-size:11px;color:#444;margin-top:2px">'+esc2(d.descricao)+'</div>':'')+
          '</div>'+
          '<div style="border-top:1px solid #000;margin-bottom:4px"></div>'+
          '<div style="border:2px solid #000;flex:1">'+
            '<div style="border-bottom:2px solid #000;padding:4px 6px;font-size:14px;font-weight:700">INFORMAÇÃO NUTRICIONAL</div>'+
            '<div style="padding:3px 6px;font-size:12px;font-weight:700;border-bottom:1px solid #aaa">Porções por embalagem: '+nv(d.porcoes)+'</div>'+
            '<div style="padding:3px 6px;font-size:12px;font-weight:700;border-bottom:1.5px solid #000">Porção: '+nv(d.porcao)+'</div>'+
            '<table style="width:100%;border-collapse:collapse">'+
              '<thead><tr style="border-bottom:1.5px solid #000">'+
                '<th style="text-align:left;padding:2px 6px;font-size:12px;font-weight:700"></th>'+
                '<th style="text-align:center;padding:2px 4px;font-size:12px;font-weight:700;width:60px;border-left:1px solid #aaa">100g</th>'+
                '<th style="text-align:center;padding:2px 4px;font-size:12px;font-weight:700;width:90px;border-left:1px solid #aaa">'+esc2(d.porcao||'--')+'</th>'+
                '<th style="text-align:right;padding:2px 6px;font-size:12px;font-weight:700;width:50px;border-left:1px solid #aaa">%VD*</th>'+
              '</tr></thead>'+
              '<tbody>'+
                row('Valor Energético (kcal)', d.kcal100, d.energia, nv(d.vce_energia)+'%', true, false)+
                row('Carboidratos (g)', d.carb100, d.carboidratos, nv(d.carboidratos_vd)+'%', true, false)+
                row('Açúcares Totais (g)', d.acucar100, d.acucares, '--', false, true)+
                row('Açúcares Adicionados (g)', d.acucar_ad100, d.acucares_ad, nv(d.acucar_ad_vd)+'%', false, true)+
                row('Proteínas (g)', d.prot100, d.proteinas, nv(d.proteinas_vd)+'%', true, false)+
                row('Gorduras Totais (g)', d.gord100, d.gorduras_totais, nv(d.gorduras_totais_vd)+'%', true, false)+
                row('Gorduras Saturadas (g)', d.gordsat100, d.gorduras_sat, nv(d.gorduras_sat_vd)+'%', false, true)+
                row('Gorduras Trans (g)', d.gordtrans100, d.gorduras_trans, '--', false, true)+
                row('Fibras Alimentares (g)', d.fibra100, d.fibras, nv(d.fibras_vd)+'%', true, false)+
                row('Sódio (mg)', d.sodio100, d.sodio, nv(d.sodio_vd)+'%', true, false)+
              '</tbody>'+
            '</table>'+
          '</div>'+
          '<div style="font-size:8px;color:#555;margin-top:4px">*% Valores Diários com base em dieta de 2000kcal.</div>'+
          '<div style="text-align:center;margin-top:6px">'+
            '<svg id="tn-prev-bc" style="height:40px;max-width:200px;display:block;margin:0 auto"></svg>'+
            (d.ean?'<div style="font-size:9px;margin-top:2px">'+esc2(d.ean)+'</div>':'')+
          '</div>'+
        '</div>'+
        '<div style="flex:1;display:flex;flex-direction:column;padding:10px 12px 8px 12px;box-sizing:border-box">'+
          '<div style="font-size:12px;font-weight:700;margin-bottom:3px">INGREDIENTES</div>'+
          '<div style="border-bottom:1px solid #000;margin-bottom:6px"></div>'+
          '<div style="font-size:10px;margin-bottom:8px">'+esc2(d.ingredientes||'')+'</div>'+
          '<div style="border-top:1px solid #aaa;margin-bottom:6px"></div>'+
          '<div style="font-size:12px;font-weight:700;margin-bottom:3px">ALÉRGENOS</div>'+
          '<div style="border-bottom:1px solid #000;margin-bottom:6px"></div>'+
          '<div style="font-size:10px;margin-bottom:8px">'+esc2(d.alergicos||'')+'</div>'+
          '<div style="border-top:1px solid #aaa;margin-bottom:8px"></div>'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
            '<div style="border:2px solid #000;border-radius:4px;padding:8px;text-align:center">'+
              '<div style="font-size:9px;font-weight:700;letter-spacing:1px">PESO LÍQ.</div>'+
              '<div style="font-size:20px;font-weight:700;margin-top:4px">'+esc2(d.peso||'--')+'</div>'+
            '</div>'+
            '<div style="border:2px solid #000;border-radius:4px;padding:8px;text-align:center">'+
              '<div style="font-size:9px;font-weight:700;letter-spacing:1px">VALIDADE</div>'+
              '<div style="font-size:20px;font-weight:700;margin-top:4px">'+esc2(d.validade||'--')+'</div>'+
            '</div>'+
          '</div>'+
          '<div style="border-top:1px solid #aaa;margin-bottom:8px"></div>'+
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:10px">'+
            '<div id="tn-prev-qr" style="width:80px;height:80px"></div>'+
            '<div style="font-size:11px;font-weight:700;text-align:center;line-height:1.4;max-width:180px">Saiba mais sobre o seu produto lendo o QR Code</div>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div style="border-top:2px solid #000;display:flex;justify-content:space-between;padding:4px 12px;font-size:9px">'+
        '<span>'+(d.cnpj?'CNPJ: '+esc2(d.cnpj):'')+'</span>'+
        '<span>'+(d.sac?'SAC: '+esc2(d.sac):'')+'</span>'+
      '</div>'+
    '</div>';

  // Wrapper escalado para caber na prévia
  box.innerHTML = '<div style="transform:scale('+scale.toFixed(3)+');transform-origin:top left;width:'+W+'px;height:'+H+'px">'+html+'</div>';
  box.style.width  = Math.round(W * scale) + 'px';
  box.style.height = Math.round(H * scale) + 'px';
  box.style.overflow = 'hidden';

  // Barcode na prévia
  try {
    var svgPrev = document.getElementById('tn-prev-bc');
    if (svgPrev && d.ean && d.ean.length >= 8)
      JsBarcode(svgPrev, d.ean, { format: d.ean.length===8?'EAN8':'EAN13', width:1.5, height:35, displayValue:false, margin:2 });
  } catch(e) {}

  // QR na prévia
  try {
    var qrPrev = document.getElementById('tn-prev-qr');
    if (qrPrev) {
      qrPrev.innerHTML = '';
      var qrLink = (d.url && d.url.trim()) ? d.url.trim() : 'https://costanaturelife.com.br/';
      new QRCode(qrPrev, { text: qrLink, width: 80, height: 80, correctLevel: QRCode.CorrectLevel.M });
    }
  } catch(e) {}
}

function tnSave() {
  var d = tnGetFormData();
  if (!d.nome) { document.getElementById('tn-status').textContent = 'Informe o nome do produto.'; return; }
  if (_tnEdit !== null) {
    state.tabnutri[_tnEdit] = d;
    addLog('Atualizou tabela nutricional: "' + d.nome + '"');
  } else {
    state.tabnutri.push(d);
    addLog('Salvou tabela nutricional: "' + d.nome + '"');
  }
  saveState();
  _tnEdit = null;
  _tnTab = 'biblioteca';
  document.getElementById('tn-status').textContent = 'v Tabela salva com sucesso!';
  setTimeout(function(){ navigate('tabnutri'); }, 800);
}

function tnLoad(i) {
  _tnEdit = i;
  _tnTab = 'criar';
  navigate('tabnutri');
}

function tnDelete(i) {
  if (!confirm('Excluir esta tabela nutricional?')) return;
  addLog('Excluiu tabela nutricional: "' + state.tabnutri[i].nome + '"');
  state.tabnutri.splice(i, 1);
  saveState();
  navigate('tabnutri');
}

function tnReset() {
  _tnEdit = null;
  _tnTab = 'criar';
  navigate('tabnutri');
}

function tnPrint(i) {
  _tnEdit = i;
  _tnTab = 'criar';
  navigate('tabnutri');
  setTimeout(function(){ tnAskQtdPDF(); }, 400);
}

function tnAskQtdPDF() {
  var modal = document.getElementById('modal');
  var modalContent = document.getElementById('modal-content');
  if (!modal || !modalContent) { tnGeneratePDF(1); return; }
  modalContent.innerHTML =
    '<div style="padding:1.5rem;max-width:340px">' +
      '<div style="font-size:1.1rem;font-weight:700;margin-bottom:1rem">🖨️ Gerar Etiquetas</div>' +
      '<div style="font-size:0.9rem;color:var(--text2);margin-bottom:1rem">Quantas etiquetas deseja gerar?</div>' +
      '<input type="number" id="tn-qtd-input" value="1" min="1" max="999" ' +
        'style="width:100%;padding:0.7rem 1rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:1.1rem;text-align:center;margin-bottom:1rem">' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn" style="flex:1" onclick="closeModal()">Cancelar</button>' +
        '<button class="btn btn-green" style="flex:1" onclick="tnConfirmarQtdPDF()">⬇ Gerar PDF</button>' +
      '</div>' +
    '</div>';
  modal.style.display = 'flex';
  setTimeout(function(){ var inp = document.getElementById('tn-qtd-input'); if(inp){inp.focus();inp.select();} }, 50);
}

function tnConfirmarQtdPDF() {
  var inp = document.getElementById('tn-qtd-input');
  var qtd = inp ? (parseInt(inp.value) || 1) : 1;
  if (qtd < 1) qtd = 1;
  if (qtd > 999) qtd = 999;
  closeModal();
  tnGeneratePDF(qtd);
}

function tnGeneratePDF(qtdEtiquetas) {
  qtdEtiquetas = qtdEtiquetas || 1;
  var d = tnGetFormData();
  if (!d.nome) { document.getElementById('tn-status').textContent = 'Preencha o nome do produto.'; return; }
  var status = document.getElementById('tn-status');

  // Monta o HTML da etiqueta e usa html2canvas para converter em PDF
  // Dimensões: 150x100mm paisagem. Scale 3 = 1701x1134px a 96dpi
  // 150×100mm a 144dpi (scale:2 × 72dpi base)
  var W_PX = 850, H_PX = 567;

  function nv(v) { return (String(v||'').trim()) || '--'; }

  function buildEtiquetaHTML() {
    var porção = nv(d.porcao);
    var qrSrc = (d.url && d.url.trim()) ? d.url.trim() : 'https://costanaturelife.com.br/';

    function row(label, v100, vPorc, vd, bold, indent) {
      var fw = 'font-weight:700';
      var ind = indent ? 'padding-left:14px' : '';
      return '<tr style="border-bottom:0.5px solid #aaa">'+
        '<td style="'+fw+';'+ind+';padding:3px 5px;font-size:13px">'+label+'</td>'+
        '<td style="'+fw+';text-align:center;padding:3px 5px;font-size:13px">'+nv(v100)+'</td>'+
        '<td style="'+fw+';text-align:center;padding:3px 5px;font-size:13px">'+nv(vPorc)+'</td>'+
        '<td style="'+fw+';text-align:right;padding:3px 5px;font-size:13px">'+nv(vd)+'</td>'+
      '</tr>';
    }

    return '<div style="width:'+W_PX+'px;height:'+H_PX+'px;background:#fff;font-family:helvetica,arial,sans-serif;display:flex;flex-direction:column;border:3px solid #000;box-sizing:border-box;overflow:hidden;position:relative">'+

      // TOPO: marca
      '<div style="border-bottom:3px solid #000;text-align:center;padding:6px 0;font-size:18px;font-weight:700;letter-spacing:3px">COSTA NATURE LIFE</div>'+

      // CORPO: duas colunas
      '<div style="display:flex;flex:1;overflow:hidden">'+

        // ── COLUNA ESQUERDA ──
        '<div style="width:530px;border-right:3px solid #000;display:flex;flex-direction:column;padding:10px 12px 8px 12px;box-sizing:border-box">'+

          // Nome + descrição
          '<div style="text-align:center;margin-bottom:6px">'+
            '<div style="font-size:16px;font-weight:700">'+esc(d.nome)+'</div>'+
            (d.descricao ? '<div style="font-size:11px;color:#444;margin-top:2px">'+esc(d.descricao)+'</div>' : '')+
          '</div>'+
          '<div style="border-top:1px solid #000;margin-bottom:4px"></div>'+

          // Tabela nutricional
          '<div style="border:2px solid #000;flex:1">'+
            // Header
            '<div style="border-bottom:2px solid #000;padding:4px 6px;font-size:14px;font-weight:700">INFORMAÇÃO NUTRICIONAL</div>'+
            '<div style="padding:3px 6px;font-size:12px;font-weight:700;border-bottom:1px solid #aaa">Porções por embalagem: '+nv(d.porcoes)+'</div>'+
            '<div style="padding:3px 6px;font-size:12px;font-weight:700;border-bottom:1.5px solid #000">Porção: '+nv(d.porcao)+'</div>'+
            '<table style="width:100%;border-collapse:collapse">'+
              '<thead>'+
                '<tr style="border-bottom:1.5px solid #000">'+
                  '<th style="text-align:left;padding:2px 6px;font-size:12px;font-weight:700"></th>'+
                  '<th style="text-align:center;padding:2px 4px;font-size:12px;font-weight:700;width:60px;border-left:1px solid #aaa">100g</th>'+
                  '<th style="text-align:center;padding:2px 4px;font-size:12px;font-weight:700;width:90px;border-left:1px solid #aaa">'+porção+'</th>'+
                  '<th style="text-align:right;padding:2px 6px;font-size:12px;font-weight:700;width:50px;border-left:1px solid #aaa">%VD*</th>'+
                '</tr>'+
              '</thead>'+
              '<tbody style="border-left:1px solid #aaa;border-right:1px solid #aaa">'+
                row('Valor Energético (kcal)', d.kcal100, d.energia, nv(d.vce_energia)+'%', true, false)+
                row('Carboidratos (g)',         d.carb100, d.carboidratos, nv(d.carboidratos_vd)+'%', true, false)+
                row('Açúcares Totais (g)',       d.acucar100, d.acucares, '--', false, true)+
                row('Açúcares Adicionados (g)',  d.acucar_ad100, d.acucares_ad, nv(d.acucar_ad_vd)+'%', false, true)+
                row('Proteínas (g)',             d.prot100, d.proteinas, nv(d.proteinas_vd)+'%', true, false)+
                row('Gorduras Totais (g)',        d.gord100, d.gorduras_totais, nv(d.gorduras_totais_vd)+'%', true, false)+
                row('Gorduras Saturadas (g)',     d.gordsat100, d.gorduras_sat, nv(d.gorduras_sat_vd)+'%', false, true)+
                row('Gorduras Trans (g)',         d.gordtrans100, d.gorduras_trans, '--', false, true)+
                row('Fibras Alimentares (g)',     d.fibra100, d.fibras, nv(d.fibras_vd)+'%', true, false)+
                row('Sódio (mg)',                 d.sodio100, d.sodio, nv(d.sodio_vd)+'%', true, false)+
              '</tbody>'+
            '</table>'+
          '</div>'+

          // Nota %VD
          '<div style="font-size:8px;color:#555;margin-top:4px">*% Valores Diários com base em dieta de 2000kcal.</div>'+

          // Barcode placeholder (img injetada depois via id)
          '<div style="text-align:center;margin-top:6px">'+
            '<img id="tn-bc-img" style="height:50px;max-width:220px;display:block;margin:0 auto">'+
            (d.ean ? '<div style="font-size:9px;margin-top:2px">'+esc(d.ean)+'</div>' : '')+
          '</div>'+

        '</div>'+

        // ── COLUNA DIREITA ──
        '<div style="flex:1;display:flex;flex-direction:column;padding:10px 12px 8px 12px;box-sizing:border-box">'+

          // Ingredientes
          '<div style="font-size:12px;font-weight:700;margin-bottom:3px">INGREDIENTES</div>'+
          '<div style="border-bottom:1px solid #000;margin-bottom:6px"></div>'+
          '<div style="font-size:10px;margin-bottom:8px">'+esc(d.ingredientes||'')+'</div>'+

          '<div style="border-top:1px solid #aaa;margin-bottom:6px"></div>'+

          // Alérgenos
          '<div style="font-size:12px;font-weight:700;margin-bottom:3px">ALÉRGENOS</div>'+
          '<div style="border-bottom:1px solid #000;margin-bottom:6px"></div>'+
          '<div style="font-size:10px;margin-bottom:8px">'+esc(d.alergicos||'')+'</div>'+

          '<div style="border-top:1px solid #aaa;margin-bottom:8px"></div>'+

          // Grid: Peso + Validade
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">'+
            '<div style="border:2px solid #000;border-radius:4px;padding:8px;text-align:center">'+
              '<div style="font-size:9px;font-weight:700;letter-spacing:1px">PESO LÍQ.</div>'+
              '<div style="font-size:20px;font-weight:700;margin-top:4px">'+esc(d.peso||'--')+'</div>'+
            '</div>'+
            '<div style="border:2px solid #000;border-radius:4px;padding:8px;text-align:center">'+
              '<div style="font-size:9px;font-weight:700;letter-spacing:1px">VALIDADE</div>'+
              '<div style="font-size:20px;font-weight:700;margin-top:4px">'+esc(d.validade||'--')+'</div>'+
            '</div>'+
          '</div>'+

          '<div style="border-top:1px solid #aaa;margin-bottom:8px"></div>'+

          // QR + "Saiba mais"
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:8px">'+
            '<img id="tn-qr-img" style="width:90px;height:90px">'+
            '<div style="font-size:11px;font-weight:700;text-align:center;line-height:1.4;max-width:200px">Saiba mais sobre o seu produto lendo o QR Code</div>'+
          '</div>'+

        '</div>'+
      '</div>'+

      // RODAPÉ
      '<div style="border-top:2px solid #000;display:flex;justify-content:space-between;padding:4px 12px;font-size:9px">'+
        '<span>'+(d.cnpj ? 'CNPJ: '+esc(d.cnpj) : '')+'</span>'+
        '<span>'+(d.sac ? 'SAC: '+esc(d.sac) : '')+'</span>'+
      '</div>'+

    '</div>';
  }

  (async function() {
    try {
      status.textContent = 'Preparando etiqueta...';

      var jsPDFLib = window.jspdf || window.jsPDF;
      if (!jsPDFLib) throw new Error('jsPDF não carregado. Recarregue a página.');
      if (!jsPDFLib.jsPDF) jsPDFLib = { jsPDF: jsPDFLib };

      // Gerar QR Code
      var qrDataURL = null;
      try {
        var qrDiv = document.createElement('div');
        qrDiv.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(qrDiv);
        var qrLink = (d.url && d.url.trim()) ? d.url.trim() : 'https://costanaturelife.com.br/';
        new QRCode(qrDiv, { text: qrLink, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
        await new Promise(r => setTimeout(r, 300));
        var qrImg = qrDiv.querySelector('img');
        if (qrImg && qrImg.src) {
          var loader = new Image();
          await new Promise(function(res) {
            loader.onload = res; loader.onerror = res;
            loader.src = qrImg.src;
          });
          var qc = document.createElement('canvas'); qc.width = 200; qc.height = 200;
          var ctx = qc.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,200); ctx.drawImage(loader,0,0,200,200);
          qrDataURL = qc.toDataURL('image/png');
        }
        document.body.removeChild(qrDiv);
      } catch(e) {}

      // Gerar Barcode
      var bcDataURL = null;
      if (d.ean && d.ean.length >= 8) {
        try {
          var svgEl = document.createElementNS('http://www.w3.org/2000/svg','svg');
          document.body.appendChild(svgEl);
          JsBarcode(svgEl, d.ean, { format: d.ean.length===8?'EAN8':'EAN13', width:2, height:60, displayValue:false, margin:2, background:'#ffffff' });
          var svgURL = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svgEl)], {type:'image/svg+xml;charset=utf-8'}));
          var bcImg = new Image();
          await new Promise(function(res) { bcImg.onload = res; bcImg.onerror = res; bcImg.src = svgURL; });
          var bc = document.createElement('canvas');
          bc.width = svgEl.viewBox.baseVal.width||300; bc.height = svgEl.viewBox.baseVal.height||70;
          var bctx = bc.getContext('2d'); bctx.fillStyle='#fff'; bctx.fillRect(0,0,bc.width,bc.height); bctx.drawImage(bcImg,0,0);
          bcDataURL = bc.toDataURL('image/png');
          document.body.removeChild(svgEl); URL.revokeObjectURL(svgURL);
        } catch(e) {}
      }

      var doc = new jsPDFLib.jsPDF({ orientation: 'landscape', unit: 'mm', format: [150, 100] });

      for (var n = 1; n <= qtdEtiquetas; n++) {
        status.textContent = 'Gerando '+n+'/'+qtdEtiquetas+'...';
        if (n > 1) doc.addPage([150, 100], 'landscape');

        // Montar HTML da etiqueta
        var container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:0;width:'+W_PX+'px;height:'+H_PX+'px;overflow:hidden;background:#fff';
        container.innerHTML = buildEtiquetaHTML();
        document.body.appendChild(container);

        // Injetar QR e barcode nas imagens do HTML
        if (qrDataURL) { var qrEl = container.querySelector('#tn-qr-img'); if(qrEl) qrEl.src = qrDataURL; }
        if (bcDataURL) { var bcEl = container.querySelector('#tn-bc-img'); if(bcEl) bcEl.src = bcDataURL; }

        await new Promise(r => setTimeout(r, 150));

        try {
          var canvas = await html2canvas(container.firstChild, {
            scale: 2,
            backgroundColor: '#fff',
            logging: false,
            width:  W_PX,
            height: H_PX,
            windowWidth:  W_PX,
            windowHeight: H_PX,
            x: 0,
            y: 0,
            scrollX: 0,
            scrollY: 0,
            useCORS: true,
          });
          var imgData = canvas.toDataURL('image/jpeg', 0.95);
          doc.addImage(imgData, 'JPEG', 0, 0, 150, 100);
        } catch(e) {
          console.error('html2canvas erro:', e);
          status.textContent = 'Erro: '+e.message;
          document.body.removeChild(container);
          return;
        }
        document.body.removeChild(container);
      }

      doc.save('etiqueta-'+(d.nome||'produto').replace(/\s+/g,'-').toLowerCase()+'.pdf');
      addLog('PDF tabela nutricional: "'+d.nome+'" ('+qtdEtiquetas+'x)');
      status.textContent = '\u2713 '+qtdEtiquetas+' etiqueta(s) gerada(s)!';
      setTimeout(function(){ status.textContent=''; }, 4000);

    } catch(err) {
      console.error('Erro PDF:', err);
      status.textContent = 'Erro: '+err.message;
    }
  })();
}
