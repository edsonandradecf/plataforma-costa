// ═══════════════ ATENÇÃO (só admin) ═══════════════
// Contas/tarefas recorrentes + previsão de estoque do Full (ML e Shopee).
// Dados:
//   /atencaoFull.json    -> gravado pelo Claude sob demanda: { data:'AAAA-MM-DD', ml:[...], shopee:[...], obs:{ml,shopee} }
//                           item: { cod, nome, v30, disp, r7?, r30?, obs? }
//   /atencaoContas/<id>  -> contas/tarefas: { nome, valor, repete:'mensal'|'semanal'|'diaria'|'unica', dia?, semana?, data?, desde, pagoAte?, historico? }
// Esta página grava SÓ em /atencaoContas/<id>.json. Nunca em /data.json.

var AT_DIAS_META = 60, AT_DIAS_ALERTA = 30;
var _atFull = null, _atContas = null, _atOrd = 'zerado', _atEditId = null, _atCarregando = false;
var AT_SEM = ['domingo','segunda','terça','quarta','quinta','sexta','sábado'];

function atEsc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function atHoje() { var d = new Date(); d.setHours(0,0,0,0); return d; }
function atIso(d) { var z = function(n){ return String(n).padStart(2,'0'); }; return d.getFullYear() + '-' + z(d.getMonth()+1) + '-' + z(d.getDate()); }
function atData(iso) { return iso ? new Date(iso + 'T00:00:00') : null; }
function atFmtD(d) { return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }); }

function atCss() {
  if (document.getElementById('at-css')) return;
  var st = document.createElement('style'); st.id = 'at-css';
  st.textContent = [
    '.at{--a-bg:rgba(15,23,42,.62);--a-bg2:rgba(30,41,82,.45);--a-bd:rgba(96,165,250,.18);--a-tx:#e5ecff;--a-sub:#93a4c8;--a-az:#3b82f6;--a-az2:#60a5fa;',
    '--a-v:#f87171;--a-a:#fbbf24;--a-g:#34d399;--a-tr:rgba(148,163,184,.16);color:var(--a-tx);display:grid;grid-template-columns:1fr 340px;grid-template-rows:auto minmax(0,1fr);gap:12px;height:calc(100vh - 110px);min-height:520px;font-size:13px}',
    '.at-card{background:var(--a-bg);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--a-bd);border-radius:14px;padding:12px 14px;min-height:0;display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(2,6,23,.35)}',
    '.at-esq{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto}',
    '.at-h2{margin:0;font-size:14px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px}',
    '.at-cab{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}',
    '.at-barra-top{grid-column:1/-1;display:flex;flex-direction:row;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 14px}',
    '.at-ord{display:flex;align-items:center;gap:3px;background:rgba(59,130,246,.12);border:1px solid var(--a-bd);border-radius:10px;padding:3px}',
    '.at-ord span{font-size:11px;color:var(--a-sub);padding:0 6px}',
    '.at-ord button{border:0;background:transparent;color:var(--a-sub);font:inherit;font-size:12px;font-weight:600;padding:4px 10px;border-radius:7px;cursor:pointer}',
    '.at-ord button.on{background:var(--a-az);color:#fff}',
    '.at-upd{font-size:11px;color:var(--a-sub)} .at-upd b{color:var(--a-tx)}',
    '.at-chips{display:flex;gap:6px}',
    '.at-chip{font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px}',
    '.at-chip.v{background:rgba(248,113,113,.15);color:var(--a-v)}.at-chip.a{background:rgba(251,191,36,.14);color:var(--a-a)}.at-chip.g{background:rgba(52,211,153,.14);color:var(--a-g)}',
    '.at-row{display:grid;grid-template-columns:minmax(130px,1.4fr) 2fr 82px 66px 86px;gap:10px;align-items:center;padding:4px 0;border-top:1px solid rgba(148,163,184,.08)}',
    '.at-row.h{border-top:0;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--a-sub);font-weight:700;padding-top:0}',
    '.at-nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}',
    '.at-t{font-weight:700;font-size:11px;margin-left:4px}.at-t.up{color:var(--a-v)}.at-t.down{color:var(--a-g)}',
    '.at-bar{position:relative;height:7px;background:var(--a-tr);border-radius:4px}',
    '.at-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px}',
    '.at-bar b{position:absolute;left:50%;top:-3px;bottom:-3px;width:2px;background:var(--a-az2);opacity:.85}',
    '.at-num{text-align:right;font-variant-numeric:tabular-nums;color:var(--a-sub)}.at-num b{color:var(--a-tx)}',
    '.at-dur{text-align:right;font-weight:700;white-space:nowrap}.at-dur.v{color:var(--a-v)}.at-dur.a{color:var(--a-a)}.at-dur.g{color:var(--a-g)}',
    '.at-env{text-align:right;font-weight:600;color:var(--a-az2);white-space:nowrap}.at-env.z{color:rgba(148,163,184,.4);font-weight:400}',
    '.at-rod{font-size:11px;color:var(--a-sub);margin-top:6px}',
    '.at-vazio{color:var(--a-sub);font-size:12px;padding:12px 0}',
    '.at-lista{flex:1;min-height:0;overflow:auto;margin-top:8px;display:flex;flex-direction:column;gap:6px}',
    '.at-tk{border:1px solid var(--a-bd);background:var(--a-bg2);border-radius:10px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px}',
    '.at-tk b{display:block;font-size:13px}.at-tk span{font-size:11px;color:var(--a-sub)}',
    '.at-tk.atr{border-left:4px solid var(--a-v)}.at-tk.hoje{border-left:4px solid var(--a-a)}',
    '.at-tk.dest{background:linear-gradient(135deg,rgba(59,130,246,.35),rgba(37,99,235,.18));border-color:rgba(96,165,250,.5);padding:12px}',
    '.at-tk.dest b{font-size:15px;color:#fff}.at-tk.dest span{color:#c7d6f5}',
    '.at-q{display:inline-block;background:var(--a-az);color:#fff;font-weight:800;font-size:11px;padding:1px 8px;border-radius:10px;margin-bottom:4px}',
    '.at-tk.dest.hoje .at-q{background:var(--a-a);color:#1e293b}.at-tk.dest.atr .at-q{background:var(--a-v);color:#fff}',
    '.at-ac{display:flex;gap:4px}',
    '.at-btn{border:0;border-radius:7px;padding:6px 10px;font:inherit;font-weight:600;font-size:12px;cursor:pointer;background:var(--a-az);color:#fff;white-space:nowrap}',
    '.at-btn:hover{background:#2563eb}.at-btn.sec{background:rgba(59,130,246,.15);color:var(--a-az2)}.at-btn.ic{background:transparent;color:var(--a-sub);padding:6px 8px}',
    '.at-form{border:1px dashed rgba(96,165,250,.35);border-radius:10px;padding:10px;margin-top:8px;display:grid;gap:6px;background:rgba(15,23,42,.4)}',
    '.at-form label{font-size:11px;color:var(--a-sub);font-weight:600;display:grid;gap:3px}',
    '.at-form input,.at-form select{font:inherit;padding:6px 8px;border:1px solid var(--a-bd);border-radius:7px;background:rgba(15,23,42,.6);color:var(--a-tx)}',
    '.at-duas{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '@media(max-width:900px){.at{grid-template-columns:1fr;height:auto}}'
  ].join('\n');
  document.head.appendChild(st);
}

// ---------- RENDER ----------
function renderAtencao() {
  if (!state.currentUser || state.currentUser.role !== 'admin')
    return '<div class="empty-state"><p>Acesso restrito a administradores.</p></div>';
  atCss();
  setTimeout(atCarregar, 0);
  return '<div class="at" id="at-root">' + atHtml() + '</div>';
}

function atHtml() {
  var f = _atFull;
  var top = '<div class="at-card at-barra-top"><div class="at-ord"><span>Ordenar Full:</span>' +
    [['vendas','Mais vendas'],['zerado','Zerado'],['saudavel','Saudável']].map(function(o){
      return '<button class="' + (_atOrd === o[0] ? 'on' : '') + '" onclick="atOrdenar(\'' + o[0] + '\')">' + o[1] + '</button>'; }).join('') +
    '</div><span class="at-upd">' + (f && f.data ? 'Full atualizado em <b>' + atFmtD(atData(f.data)) + '</b> · para atualizar, peça ao Claude' : (f === null ? 'Carregando…' : 'Full ainda sem dados')) + '</span></div>';
  var esq = '<div class="at-esq">' +
    '<div class="at-card">' + atBloco('📦 Full Mercado Livre', f && f.ml, f && f.obs && f.obs.ml) + '</div>' +
    '<div class="at-card">' + atBloco('📦 Full Shopee', f && f.shopee, f && f.obs && f.obs.shopee) + '</div></div>';
  var dir = '<div class="at-card"><div class="at-cab"><span class="at-h2">💳 Contas e tarefas</span>' +
    '<button class="at-btn sec" onclick="atAbrirForm()">+ Nova</button></div>' +
    '<div id="at-form">' + (_atEditId !== null ? atFormHtml() : '') + '</div>' +
    '<div class="at-lista">' + atListaHtml() + '</div></div>';
  return top + esq + dir;
}

function atRender() { var r = document.getElementById('at-root'); if (r) r.innerHTML = atHtml(); }

function atCarregar() {
  if (_atCarregando) return; _atCarregando = true;
  var u = FIREBASE_URL;
  Promise.all([
    fetch(u + '/atencaoFull.json?x=' + Date.now()).then(function(r){ return r.json(); }).catch(function(){ return false; }),
    fetch(u + '/atencaoContas.json?x=' + Date.now()).then(function(r){ return r.json(); }).catch(function(){ return undefined; })
  ]).then(function(res) {
    _atCarregando = false;
    _atFull = res[0] || false;
    if (res[1] !== undefined) _atContas = res[1] || {};
    // não re-renderiza com o formulário aberto (perderia o que está sendo digitado)
    if (_atEditId === null) atRender();
  });
}

// ---------- FULL ----------
function atCalc(it) {
  var dia = (Number(it.v30) || 0) / 30, fator = 1, tend = null;
  if (it.r7 && it.r30) { tend = it.r7 / it.r30 - 1; fator = Math.min(1.2, Math.max(0.8, 1 + tend / 2)); }
  var ritmo = dia * fator, disp = Number(it.disp) || 0;
  var meta = Math.ceil(ritmo * AT_DIAS_META);
  var dura = ritmo > 0 ? disp / ritmo : Infinity;
  return { cod: it.cod, nome: it.nome, v30: Number(it.v30) || 0, disp: disp, ritmo: ritmo, meta: meta, dura: dura, tend: tend, enviar: Math.max(0, meta - disp) };
}
function atCor(d) { return d < AT_DIAS_ALERTA ? 'v' : d < AT_DIAS_META ? 'a' : 'g'; }
function atDur(i) { return i.disp < 1 ? 'zerado' : i.dura > 365 ? '+1 ano' : '~' + Math.round(i.dura) + ' d'; }
function atOrdenar(o) { _atOrd = o; atRender(); }

function atBloco(titulo, itens, rodape) {
  var cab = '<div class="at-cab"><span class="at-h2">' + titulo + '</span>';
  if (!itens || !itens.length) return cab + '</div><div class="at-vazio">' + (_atFull === null ? 'Carregando…' : 'Sem dados ainda.') + '</div>';
  var ord = {
    vendas:   function(a,b){ return (b.v30 - a.v30) || ((a.dura - b.dura) || 0); },
    zerado:   function(a,b){ return ((a.dura - b.dura) || 0) || (b.v30 - a.v30); },
    saudavel: function(a,b){ return ((b.dura - a.dura) || 0) || (b.v30 - a.v30); }
  }[_atOrd];
  var L = itens.filter(function(i){ return (Number(i.v30) || 0) > 0 || (Number(i.disp) || 0) > 0; }).map(atCalc).sort(ord);
  var n = function(k){ return L.filter(function(i){ return atCor(i.dura) === k; }).length; };
  return cab + '<div class="at-chips"><span class="at-chip v">' + n('v') + ' &lt; 1 mês</span><span class="at-chip a">' + n('a') + ' 1–2 meses</span><span class="at-chip g">' + n('g') + ' ok</span></div></div>' +
    '<div class="at-row h"><span>Produto</span><span>Estoque × meta 2 meses (traço = 1 mês)</span><span class="at-num">Tem/meta</span><span style="text-align:right">Dura</span><span style="text-align:right">Enviar</span></div>' +
    L.map(function(i) {
      var c = atCor(i.dura), pct = Math.min(100, i.meta ? i.disp / i.meta * 100 : 100);
      var corBar = c === 'v' ? 'var(--a-v)' : c === 'a' ? 'var(--a-a)' : 'var(--a-g)';
      var t = i.tend == null ? '' : '<span class="at-t ' + (i.tend > 0 ? 'up' : 'down') + '" title="últimos 7 dias vs 30">' + (i.tend > 0 ? '▲' : '▼') + Math.abs(Math.round(i.tend * 100)) + '%</span>';
      return '<div class="at-row" title="' + atEsc(i.cod) + ' · ' + i.v30 + ' vendas em 30 dias (' + i.ritmo.toFixed(1) + '/dia)">' +
        '<span class="at-nm">' + atEsc(i.nome) + t + '</span>' +
        '<div class="at-bar"><i style="width:' + pct + '%;background:' + corBar + '"></i><b></b></div>' +
        '<span class="at-num"><b>' + i.disp + '</b>/' + i.meta + '</span>' +
        '<span class="at-dur ' + c + '">' + atDur(i) + '</span>' +
        '<span class="at-env ' + (i.enviar ? '' : 'z') + '">' + (i.enviar ? '+' + i.enviar + ' un.' : '—') + '</span></div>';
    }).join('') + (rodape ? '<div class="at-rod">' + atEsc(rodape) + '</div>' : '');
}

// ---------- CONTAS / TAREFAS ----------
function atProxVenc(t) {
  var base = t.pagoAte ? atData(t.pagoAte) : atData(t.desde) || atHoje();
  if (t.pagoAte) base.setDate(base.getDate() + 1);
  if (t.repete === 'unica') return t.pagoAte ? null : atData(t.data);
  if (t.repete === 'diaria') return base;
  var d = new Date(base);
  for (var k = 0; k < 400; k++) {
    var ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if ((t.repete === 'mensal' && d.getDate() === Math.min(Number(t.dia) || 1, ult)) || (t.repete === 'semanal' && d.getDay() === Number(t.semana))) return d;
    d.setDate(d.getDate() + 1);
  }
  return null;
}
function atRegra(t) {
  return t.repete === 'mensal' ? 'todo dia ' + t.dia : t.repete === 'semanal' ? 'toda ' + AT_SEM[t.semana] :
         t.repete === 'diaria' ? 'todo dia' : 'em ' + (t.data ? atFmtD(atData(t.data)) : '?');
}
function atListaHtml() {
  if (_atContas === null) return '<div class="at-vazio">Carregando…</div>';
  var hoje = atHoje();
  var L = Object.keys(_atContas).map(function(id){ var t = _atContas[id]; return Object.assign({ id: id }, t, { venc: atProxVenc(t) }); })
    .filter(function(t){ return t.venc; }).sort(function(a,b){ return a.venc - b.venc; });
  if (!L.length) return '<div class="at-vazio">Nenhuma conta ou tarefa. Clique em “+ Nova”.</div>';
  return L.map(function(t, ix) {
    var d = Math.round((t.venc - hoje) / 864e5), cls = d < 0 ? 'atr' : d === 0 ? 'hoje' : '';
    var quando = d < 0 ? 'atrasada ' + (-d) + ' dia' + (d < -1 ? 's' : '') : d === 0 ? 'vence hoje' : d === 1 ? 'amanhã' : 'em ' + d + ' dias · ' + atFmtD(t.venc);
    var val = Number(t.valor) ? ' · R$ ' + Number(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    var acoes = '<div class="at-ac"><button class="at-btn' + (ix === 0 || cls ? '' : ' sec') + '" onclick="atFeito(\'' + t.id + '\')">Feito</button>' +
      '<button class="at-btn ic" title="Editar" onclick="atAbrirForm(\'' + t.id + '\')">✎</button></div>';
    if (ix === 0) return '<div class="at-tk dest ' + cls + '"><div><div class="at-q">' + quando + '</div><b>' + atEsc(t.nome) + '</b><span>' + atRegra(t) + val + '</span></div>' + acoes + '</div>';
    return '<div class="at-tk ' + cls + '"><div><b>' + atEsc(t.nome) + '</b><span>' + quando + ' · ' + atRegra(t) + val + '</span></div>' + acoes + '</div>';
  }).join('');
}

function atGravar(id, obj) {
  // grava SÓ o item: /atencaoContas/<id>.json
  return fetch(FIREBASE_URL + '/atencaoContas/' + encodeURIComponent(id) + '.json', {
    method: obj === null ? 'DELETE' : 'PUT', body: obj === null ? undefined : JSON.stringify(obj)
  }).then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); })
    .catch(function(e){ alert('Não foi possível salvar: ' + e.message); atCarregar(); });
}

function atFeito(id) {
  var t = _atContas && _atContas[id]; if (!t) return;
  var v = atProxVenc(t); if (!v) return;
  var hist = Array.isArray(t.historico) ? t.historico.slice(-23) : [];
  hist.push({ venc: atIso(v), em: new Date().toISOString(), por: state.currentUser ? state.currentUser.login : '' });
  t.pagoAte = atIso(v); t.historico = hist;
  atRender(); atGravar(id, t);
}

function atAbrirForm(id) { _atEditId = id || ''; atRender(); }
function atFecharForm() { _atEditId = null; atRender(); }

function atFormHtml() {
  var t = (_atEditId && _atContas && _atContas[_atEditId]) || { nome: '', valor: '', repete: 'mensal', dia: atHoje().getDate(), semana: 1, data: '' };
  var op = function(v, l){ return '<option value="' + v + '"' + (t.repete === v ? ' selected' : '') + '>' + l + '</option>'; };
  return '<div class="at-form">' +
    '<label>Nome<input id="at-f-nome" value="' + atEsc(t.nome) + '" placeholder="Ex.: Energia, Contador, DAS"></label>' +
    '<div class="at-duas"><label>Valor (opcional)<input id="at-f-valor" type="number" step="0.01" value="' + (t.valor || '') + '"></label>' +
    '<label>Repetir<select id="at-f-rep" onchange="atTrocaRep()">' + op('mensal','Todo mês (dia fixo)') + op('semanal','Toda semana') + op('diaria','Todo dia') + op('unica','Uma vez (data)') + '</select></label></div>' +
    '<div id="at-f-extra">' + atExtraHtml(t.repete, t) + '</div>' +
    '<div class="at-ac" style="justify-content:flex-end">' + (_atEditId ? '<button class="at-btn ic" onclick="atExcluir()">Excluir</button>' : '') +
    '<button class="at-btn sec" onclick="atFecharForm()">Cancelar</button><button class="at-btn" onclick="atSalvar()">Salvar</button></div></div>';
}
function atExtraHtml(r, t) {
  if (r === 'mensal') return '<label>Dia do mês<input id="at-f-dia" type="number" min="1" max="31" value="' + (t.dia || atHoje().getDate()) + '"></label>';
  if (r === 'semanal') return '<label>Dia da semana<select id="at-f-sem">' + AT_SEM.map(function(s, i){ return '<option value="' + i + '"' + (Number(t.semana) === i ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>';
  if (r === 'unica') return '<label>Data<input id="at-f-data" type="date" value="' + (t.data || '') + '"></label>';
  return '';
}
function atTrocaRep() {
  var t = (_atEditId && _atContas && _atContas[_atEditId]) || {};
  document.getElementById('at-f-extra').innerHTML = atExtraHtml(document.getElementById('at-f-rep').value, t);
}
function atSalvar() {
  var g = function(id){ var e = document.getElementById(id); return e ? e.value : ''; };
  var v = { nome: g('at-f-nome').trim() || 'Sem nome', valor: Number(g('at-f-valor')) || 0, repete: g('at-f-rep'), desde: atIso(atHoje()) };
  if (v.repete === 'mensal') v.dia = Math.min(31, Math.max(1, Number(g('at-f-dia')) || 1));
  if (v.repete === 'semanal') v.semana = Number(g('at-f-sem')) || 0;
  if (v.repete === 'unica') { v.data = g('at-f-data'); if (!v.data) { alert('Escolha a data.'); return; } }
  if (!_atContas) _atContas = {};
  var id = _atEditId || ('c' + Date.now());
  var antigo = _atContas[id];
  if (antigo && antigo.historico) v.historico = antigo.historico;
  _atContas[id] = v; _atEditId = null; atRender(); atGravar(id, v);
}
function atExcluir() {
  var id = _atEditId; if (!id || !confirm('Excluir esta conta/tarefa?')) return;
  delete _atContas[id]; _atEditId = null; atRender(); atGravar(id, null);
}
