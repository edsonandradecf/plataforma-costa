// --- PONTO VIRTUAL ------------------------------------------------------------

var _pontoTab        = 'cards';
var _pontoColabSel   = null;
var _pontoSenhaOk    = false;
var _pontoHistFiltro = '';
var _pontoHistColab  = 'todos';
var _pontoHistMes    = '';

function pontoMesAnoAtual() {
  var n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth()+1).padStart(2,'0');
}

function renderPonto() {
  if (isAdmin()) return renderPontoAdmin();
  return renderPontoPublico();
}

// -- VISÃO PÚBLICA (todos os usuários) ----------------------------------------
function renderPontoPublico() {
  var cols = state.ponto.colaboradores;

  if (_pontoColabSel !== null && cols[_pontoColabSel]) {
    return renderPontoColabAberto(_pontoColabSel);
  }

  var html = '<div style="margin-bottom:1.5rem">' +
    '<div style="font-size:1rem;color:var(--text2);margin-bottom:1.5rem">Selecione seu perfil para registrar ponto:</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:1rem">';

  if (!cols.length) {
    html += '<div class="empty-state" style="width:100%">' + iconEmpty() + '<p>Nenhum colaborador cadastrado ainda.</p></div>';
  } else {
    cols.forEach(function(c, i) {
      var status = pontoStatusHoje(i);
      html += pontoCriarCard(c, i, status);
    });
  }

  html += '</div></div>';
  return html;
}

function pontoCriarCard(c, i, status) {
  var corStatus = status === 'trabalhando' ? 'var(--green)' : (status === 'saiu' ? 'var(--blue)' : 'var(--text3)');
  var labelStatus = status === 'trabalhando' ? '● Trabalhando' : (status === 'saiu' ? 'v Saída efetuada' : '○ Sem registro hoje');
  var inicialLetra = (c.nome || '?')[0].toUpperCase();
  var corAvatar = ['#16a34a','#2563eb','#9333ea','#ea580c','#0891b2','#be185d'][i % 6];

  return '<div onclick="pontoSelecionarColab(' + i + ')" style="width:160px;cursor:pointer;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:1.25rem 1rem;display:flex;flex-direction:column;align-items:center;gap:10px;box-shadow:var(--shadow);transition:transform 0.15s,box-shadow 0.15s" ' +
    'onmouseover="this.style.transform=\'translateY(-3px)\';this.style.boxShadow=\'0 8px 24px rgba(0,0,0,0.13)\'" ' +
    'onmouseout="this.style.transform=\'\';this.style.boxShadow=\'var(--shadow)\'">' +
    // Avatar
    '<div style="width:60px;height:60px;border-radius:50%;background:' + corAvatar + ';display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:700;color:#fff;flex-shrink:0">' + inicialLetra + '</div>' +
    // Nome
    '<div style="font-weight:700;font-size:0.9rem;text-align:center;line-height:1.3;word-break:break-word">' + esc(c.nome) + '</div>' +
    // Cargo
    (c.cargo ? '<div style="font-size:0.75rem;color:var(--text3);text-align:center">' + esc(c.cargo) + '</div>' : '') +
    // Status hoje
    '<div style="font-size:0.72rem;font-weight:600;color:' + corStatus + ';text-align:center">' + labelStatus + '</div>' +
  '</div>';
}

function renderPontoColabAberto(idx) {
  var c = state.ponto.colaboradores[idx];
  if (!c) { _pontoColabSel = null; return renderPontoPublico(); }

  var now      = new Date();
  var mesAtual = now.getMonth();
  var anoAtual = now.getFullYear();
  var stats    = pontoCalcStats(idx, mesAtual, anoAtual);
  var senhaOk  = _pontoSenhaOk;
  var corAvatar    = ['#16a34a','#2563eb','#9333ea','#ea580c','#0891b2','#be185d'][idx % 6];
  var inicialLetra = (c.nome || '?')[0].toUpperCase();
  var nomesMes     = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // -- Jornada: 4 etapas ------------------------------------
  // 0 = Entrada (08h)  1 = Saída Almoço (12h)
  // 2 = Volta Almoço (13h)  3 = Saída (17h)
  var JORNADA = [
    { tipo: 'entrada', label: '> Entrada',      hora: '08:00', cor: '#16a34a', descricao: 'Entrada às 08h00' },
    { tipo: 'saida',   label: '🍽 Saída Almoço', hora: '12:00', cor: '#ea580c', descricao: 'Saída para almoço às 12h00' },
    { tipo: 'entrada', label: '<- Volta Almoço', hora: '13:00', cor: '#2563eb', descricao: 'Volta do almoço às 13h00' },
    { tipo: 'saida',   label: '[] Saída',         hora: '17:00', cor: '#7c3aed', descricao: 'Saída às 17h00' },
  ];

  var hoje = pontoDataHoje();
  var regsHoje = state.ponto.registros.filter(function(r){ return r.colabIdx === idx && r.data === hoje; });
  var etapaAtual = regsHoje.length; // próxima etapa a registrar (0-4)
  if (etapaAtual > 4) etapaAtual = 4;
  var jornadaCompleta = etapaAtual >= 4;

  // Botão habilitado = senha OK e ainda há etapa a registrar
  var btnHabilitado = senhaOk && !jornadaCompleta;
  var proximaEtapa  = JORNADA[etapaAtual] || null;

  // Horário atual para exibição inicial no relógio
  var hh = String(now.getHours()).padStart(2,'0');
  var mm = String(now.getMinutes()).padStart(2,'0');
  var ss = String(now.getSeconds()).padStart(2,'0');

  var html =
    // Botão voltar
    '<button onclick="pontoVoltar()" style="display:flex;align-items:center;gap:6px;background:none;border:none;color:var(--text2);cursor:pointer;font-size:0.88rem;margin-bottom:1.25rem;padding:0">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><polyline points="15 18 9 12 15 6"/></svg> Voltar' +
    '</button>' +

    '<div style="max-width:460px;margin:0 auto">' +

    // Header
    '<div class="card" style="padding:1.25rem 1.5rem;margin-bottom:1rem;display:flex;align-items:center;gap:1rem">' +
      '<div style="width:52px;height:52px;border-radius:50%;background:' + corAvatar + ';display:flex;align-items:center;justify-content:center;font-size:1.4rem;font-weight:700;color:#fff;flex-shrink:0">' + inicialLetra + '</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:1.15rem;font-weight:700">' + esc(c.nome) + '</div>' +
        (c.cargo ? '<div style="font-size:0.8rem;color:var(--text3)">' + esc(c.cargo) + '</div>' : '') +
      '</div>' +
      // Relógio digital
      '<div style="text-align:right">' +
        '<div id="ponto-relogio" style="font-size:1.9rem;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:1px;color:var(--text);line-height:1">' + hh + ':' + mm + ':' + ss + '</div>' +
        '<div id="ponto-data-str" style="font-size:0.72rem;color:var(--text3);margin-top:2px;text-align:right">' + now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'}) + '</div>' +
      '</div>' +
    '</div>' +

    // Stats do mês
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:1rem">' +
      pontoStatCard('⏱', 'Horas ' + nomesMes[mesAtual], stats.horasFormatado) +
      pontoStatCard('📅', 'Dias trabalhados', String(stats.diasTrabalhados)) +
      pontoStatCard('❌', 'Faltas', String(stats.faltas)) +
    '</div>' +

    // Jornada do dia -- linha do tempo
    '<div class="card" style="padding:1.25rem 1.5rem;margin-bottom:1rem">' +
      '<div style="font-weight:700;font-size:0.88rem;color:var(--text2);margin-bottom:1rem;text-transform:uppercase;letter-spacing:0.5px">Jornada de hoje</div>' +
      '<div style="display:flex;align-items:center;gap:0">' +
        JORNADA.map(function(e, i) {
          var feito = i < etapaAtual;
          var atual = i === etapaAtual;
          var cor   = feito ? e.cor : (atual ? e.cor : 'var(--border)');
          var regE  = regsHoje[i];
          return (
            '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;position:relative">' +
              // Linha conectora esquerda
              (i > 0 ? '<div style="position:absolute;left:0;top:16px;width:50%;height:2px;background:' + (i <= etapaAtual ? JORNADA[i-1].cor : 'var(--border)') + '"></div>' : '') +
              // Linha conectora direita
              (i < 3 ? '<div style="position:absolute;right:0;top:16px;width:50%;height:2px;background:' + (i < etapaAtual ? e.cor : 'var(--border)') + '"></div>' : '') +
              // Bolinha
              '<div style="width:32px;height:32px;border-radius:50%;background:' + (feito||atual ? cor : 'var(--bg3)') + ';border:2px solid ' + cor + ';display:flex;align-items:center;justify-content:center;z-index:1;flex-shrink:0;transition:all 0.3s">' +
                (feito ? '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" style="width:14px;height:14px"><polyline points="20 6 9 17 4 12"/></svg>' :
                 atual ? '<div style="width:10px;height:10px;border-radius:50%;background:#fff"></div>' :
                 '<div style="width:8px;height:8px;border-radius:50%;background:var(--border)"></div>') +
              '</div>' +
              '<div style="font-size:0.68rem;font-weight:' + (feito||atual?'700':'400') + ';color:' + (feito ? cor : atual ? cor : 'var(--text3)') + ';text-align:center;line-height:1.2">' + e.hora + '</div>' +
              '<div style="font-size:0.62rem;color:' + (feito ? cor : atual ? cor : 'var(--text3)') + ';text-align:center;line-height:1.1">' +
                (feito && regE ? regE.hora : (i === 0 ? 'Entrada' : i === 1 ? 'Almoço' : i === 2 ? 'Volta' : 'Saída')) +
              '</div>' +
            '</div>'
          );
        }).join('') +
      '</div>' +
    '</div>' + // card jornada

    // Card de registro
    '<div class="card" style="padding:1.5rem">' +

      // Mensagem jornada completa
      (jornadaCompleta ?
        '<div style="text-align:center;padding:1rem 0">' +
          '<div style="font-size:2.5rem;margin-bottom:8px">🎉</div>' +
          '<div style="font-weight:700;font-size:1.1rem;margin-bottom:4px">Jornada completa!</div>' +
          '<div style="font-size:0.85rem;color:var(--text2)">Todos os registros do dia foram efetuados.</div>' +
        '</div>'
      :

      // Próxima ação
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:1.25rem;padding:12px 14px;background:var(--bg3);border-radius:10px;border-left:4px solid ' + (proximaEtapa ? proximaEtapa.cor : 'var(--border)') + '">' +
        '<div>' +
          '<div style="font-size:0.72rem;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Próximo registro</div>' +
          '<div style="font-weight:700;font-size:0.95rem;margin-top:2px">' + (proximaEtapa ? proximaEtapa.descricao : '') + '</div>' +
        '</div>' +
      '</div>' +

      // Campo de senha -- admin não precisa digitar
      (isAdmin() ?
        '<div style="margin-bottom:1.25rem;padding:10px 14px;background:var(--bg3);border-radius:8px;font-size:0.85rem;color:var(--text2)">' +
          '🔑 Modo administrador -- senha dispensada' +
        '</div>'
      :
        '<div style="margin-bottom:1.25rem">' +
          '<label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:6px;font-weight:600">🔒 Senha</label>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<input type="password" id="ponto-senha" placeholder="Digite sua senha" ' +
              'style="flex:1;padding:0.65rem 1rem;border:2px solid ' + (senhaOk?'var(--green)':'var(--border)') + ';border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.95rem;transition:border 0.2s;outline:none" ' +
              'oninput="pontoVerificarSenha(this.value,' + idx + ')" onkeydown="if(event.key===\'Enter\'&&' + (senhaOk?'true':'false') + ')pontoRegistrarEtapa(' + idx + ')">' +
            '<div style="font-size:1.4rem;transition:opacity 0.2s;opacity:' + (senhaOk?'1':'0') + ';color:var(--green)">v</div>' +
          '</div>' +
          '<div style="font-size:0.75rem;margin-top:5px;color:' + (senhaOk?'var(--green)':'var(--text3)') + '">' +
            (senhaOk ? 'Senha correta! Clique no botão abaixo para registrar.' : 'Digite sua senha para liberar o registro.') +
          '</div>' +
        '</div>'
      ) +

      // Botão único -- registra a próxima etapa da jornada
      '<button onclick="pontoRegistrarEtapa(' + idx + ')" ' +
        (!btnHabilitado ? 'disabled ' : '') +
        'style="width:100%;padding:0.9rem;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:' + (btnHabilitado?'pointer':'not-allowed') + ';' +
        'background:' + (btnHabilitado&&proximaEtapa ? proximaEtapa.cor : 'var(--border)') + ';' +
        'color:' + (btnHabilitado?'#fff':'var(--text3)') + ';transition:all 0.2s;' +
        (btnHabilitado ? 'box-shadow:0 4px 12px rgba(0,0,0,0.15)' : '') + '">' +
        (proximaEtapa ? proximaEtapa.label : 'Registrar') +
      '</button>') +

      '<div id="ponto-status" style="font-size:0.85rem;text-align:center;margin-top:10px;min-height:1.2em"></div>' +
    '</div>' + // card registro

    // Registros do dia (visível para admin) com botão de excluir
    (isAdmin() && regsHoje.length > 0 ?
      '<div class="card" style="padding:1.25rem;margin-top:1rem">' +
        '<div style="font-weight:700;font-size:0.9rem;margin-bottom:1rem">🗂 Registros de hoje -- clique em x para excluir</div>' +
        regsHoje.map(function(r, ri) {
          var ETAPA_LABELS = ['> Entrada','🍽 Saída Almoço','<- Volta Almoço','[] Saída'];
          var ETAPA_CORES  = ['var(--green)','#ea580c','#2563eb','#7c3aed'];
          var etIdx = r.etapa !== undefined ? r.etapa : ri;
          var cor   = r.tipo === 'folga' ? '#0891b2' : (ETAPA_CORES[etIdx] || 'var(--text2)');
          var label = r.tipo === 'folga' ? ('🏖 ' + (r.labelEtapa||'Folga')) : (r.labelEtapa || ETAPA_LABELS[etIdx] || r.tipo);
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">' +
            '<div style="display:flex;align-items:center;gap:10px">' +
              '<span style="font-size:0.8rem;font-weight:700;color:' + cor + '">' + label + '</span>' +
              '<span style="font-size:0.8rem;color:var(--text2)">' + esc(r.hora) + '</span>' +
              (r.manual ? '<span style="font-size:0.7rem;background:var(--amber)18;color:var(--amber);border-radius:4px;padding:1px 6px">manual</span>' : '') +
            '</div>' +
            '<button onclick="pontoAdminExcluirRegistro(' + r.id + ')" ' +
              'style="padding:3px 10px;border:1px solid var(--red);border-radius:6px;background:transparent;color:var(--red);cursor:pointer;font-size:0.78rem;font-weight:600">x Excluir</button>' +
          '</div>';
        }).join('') +
      '</div>'
    : '') +

    '</div>'; // max-width

  // Inicia o relógio após o render (seguro, sem tags script inline)
  setTimeout(function() { pontoIniciarRelogio(); }, 0);

  return html;
}

function pontoIniciarRelogio() {
  if (window._pontoRelogioTimer) clearInterval(window._pontoRelogioTimer);
  window._pontoRelogioTimer = setInterval(function() {
    var el = document.getElementById('ponto-relogio');
    if (!el) { clearInterval(window._pontoRelogioTimer); return; }
    var n = new Date();
    el.textContent = String(n.getHours()).padStart(2,'0') + ':' +
                     String(n.getMinutes()).padStart(2,'0') + ':' +
                     String(n.getSeconds()).padStart(2,'0');
  }, 1000);
}

function pontoStatCard(icon, label, valor) {
  return '<div class="card" style="padding:1rem;text-align:center">' +
    '<div style="font-size:1.4rem;margin-bottom:4px">' + icon + '</div>' +
    '<div style="font-size:1.4rem;font-weight:800;color:var(--text)">' + valor + '</div>' +
    '<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">' + label + '</div>' +
  '</div>';
}

// -- VISÃO ADMIN ---------------------------------------------------------------
function renderPontoAdmin() {
  if (_pontoColabSel !== null && state.ponto.colaboradores && state.ponto.colaboradores[_pontoColabSel]) {
    return renderPontoColabAberto(_pontoColabSel);
  }
  var isCards = _pontoTab === 'cards';
  var tabBar =
    '<div style="display:flex;border-bottom:2px solid var(--border);margin-bottom:1.5rem">' +
      '<button onclick="pontoAdminSetTab(\'cards\')" style="padding:0.65rem 1.5rem;background:none;border:none;border-bottom:' + (isCards?'3px solid var(--green);color:var(--green);font-weight:600':'none;color:var(--text2)') + ';cursor:pointer;font-size:0.95rem;margin-bottom:-2px">👥 Colaboradores</button>' +
      '<button onclick="pontoAdminSetTab(\'historico\')" style="padding:0.65rem 1.5rem;background:none;border:none;border-bottom:' + (!isCards?'3px solid var(--green);color:var(--green);font-weight:600':'none;color:var(--text2)') + ';cursor:pointer;font-size:0.95rem;margin-bottom:-2px">📋 Histórico</button>' +
    '</div>';

  if (isCards) return tabBar + renderPontoAdminColabs();
  return tabBar + renderPontoAdminHistorico();
}

function renderPontoAdminColabs() {
  var cols = state.ponto.colaboradores;
  var now  = new Date();

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:1.25rem">' +
    '<div style="font-size:0.85rem;color:var(--text3)">' + cols.length + ' colaborador(es)</div>' +
    '<button class="btn btn-green" onclick="pontoAbrirModalColab(null)">+ Novo Colaborador</button>' +
  '</div>';

  if (!cols.length) {
    return html + '<div class="empty-state">' + iconEmpty() + '<p>Nenhum colaborador cadastrado. Clique em "+ Novo Colaborador" para começar.</p></div>';
  }

  // Resumo geral do mês
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;margin-bottom:1.5rem">';
  cols.forEach(function(c, i) {
    var status = pontoStatusHoje(i);
    var stats  = pontoCalcStats(i, now.getMonth(), now.getFullYear());
    var corStatus = status==='trabalhando'?'var(--green)':(status==='saiu'?'var(--blue)':'var(--text3)');
    var labelStatus = status==='trabalhando'?'● Trabalhando':(status==='saiu'?'v Saída efetuada':'○ Sem registro hoje');
    var corAvatar = ['#16a34a','#2563eb','#9333ea','#ea580c','#0891b2','#be185d'][i % 6];
    var inicialLetra = (c.nome||'?')[0].toUpperCase();

    html += '<div class="card" style="padding:1rem;cursor:pointer;transition:box-shadow 0.15s" onclick="pontoAdminVerColab(' + i + ')" onmouseover="this.style.boxShadow=\'0 4px 16px rgba(0,0,0,0.13)\'" onmouseout="this.style.boxShadow=\'\'">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="width:42px;height:42px;border-radius:50%;background:' + corAvatar + ';display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;color:#fff;flex-shrink:0">' + inicialLetra + '</div>' +
          '<div>' +
            '<div style="font-weight:700;font-size:0.9rem">' + esc(c.nome) + '</div>' +
            (c.cargo ? '<div style="font-size:0.72rem;color:var(--text3)">' + esc(c.cargo) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:4px" onclick="event.stopPropagation()">' +
          '<button class="btn btn-sm" onclick="pontoAbrirModalColab(' + i + ')" title="Editar">✏️</button>' +
          '<button class="btn btn-sm btn-red" onclick="pontoExcluirColab(' + i + ')" title="Excluir">x</button>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px">' +
        '<div style="text-align:center;background:var(--bg3);border-radius:6px;padding:6px">' +
          '<div style="font-size:1rem;font-weight:700">' + stats.horasFormatado + '</div>' +
          '<div style="font-size:0.65rem;color:var(--text3)">Horas/mês</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--bg3);border-radius:6px;padding:6px">' +
          '<div style="font-size:1rem;font-weight:700">' + stats.diasTrabalhados + '</div>' +
          '<div style="font-size:0.65rem;color:var(--text3)">Dias trab.</div>' +
        '</div>' +
        '<div style="text-align:center;background:var(--bg3);border-radius:6px;padding:6px">' +
          '<div style="font-size:1rem;font-weight:700;color:' + (stats.faltas>0?'var(--red)':'var(--text)') + '">' + stats.faltas + '</div>' +
          '<div style="font-size:0.65rem;color:var(--text3)">Faltas</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">' +
        '<div style="font-size:0.75rem;font-weight:600;color:' + corStatus + '">' + labelStatus + '</div>' +
        '<div style="display:flex;gap:4px" onclick="event.stopPropagation()">' +
          '<button onclick="pontoAbrirModalManual(' + i + ')" title="Registrar ponto manualmente" ' +
            'style="display:flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text2);cursor:pointer;font-size:0.75rem" ' +
            'onmouseover="this.style.borderColor=\'var(--amber)\';this.style.color=\'var(--amber)\'" ' +
            'onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--text2)\'">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
            ' Reg. Manual' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function renderPontoAdminHistorico() {
  var registros = state.ponto.registros;
  var cols      = state.ponto.colaboradores;
  var nomesMes  = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var diasSem   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];

  var filtroColab = (typeof _pontoHistColab !== 'undefined') ? _pontoHistColab : 'todos';
  var filtroMes   = (typeof _pontoHistMes   !== 'undefined') ? _pontoHistMes   : pontoMesAnoAtual();

  // Meses disponíveis
  var mesesDisp = {};
  registros.forEach(function(r) {
    var p = r.data.split('/');
    if (p.length < 3) return;
    var chave = p[2] + '-' + p[1];
    mesesDisp[chave] = { ano: p[2], mes: p[1], label: nomesMes[parseInt(p[1])-1] + ' ' + p[2] };
  });
  var ma = new Date();
  var chaveAtual = ma.getFullYear() + '-' + String(ma.getMonth()+1).padStart(2,'0');
  if (!mesesDisp[chaveAtual]) mesesDisp[chaveAtual] = { ano: String(ma.getFullYear()), mes: String(ma.getMonth()+1).padStart(2,'0'), label: nomesMes[ma.getMonth()] + ' ' + ma.getFullYear() };
  var mesesOrdenados = Object.keys(mesesDisp).sort().reverse();

  // Filtros
  var html =
    '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:1.25rem">' +
      '<div>' +
        '<label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:4px;font-weight:600">📅 Mes</label>' +
        '<select onchange="pontoSetHistMes(this.value)" style="padding:0.55rem 0.9rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem">' +
          mesesOrdenados.map(function(k) {
            return '<option value="' + k + '"' + (filtroMes===k?' selected':'') + '>' + mesesDisp[k].label + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div style="flex:1;min-width:180px">' +
        '<label style="font-size:0.75rem;color:var(--text2);display:block;margin-bottom:4px;font-weight:600">👤 Colaborador</label>' +
        '<select onchange="pontoSetHistColab(this.value)" style="width:100%;padding:0.55rem 0.9rem;border:1px solid var(--border);border-radius:8px;background:var(--input-bg);color:var(--text);font-size:0.88rem">' +
          '<option value="todos"' + (filtroColab==='todos'?' selected':'') + '>Todos os colaboradores</option>' +
          cols.map(function(c,i){ return '<option value="'+i+'"'+(filtroColab===String(i)?' selected':'')+'>'+esc(c.nome)+'</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<button class="btn btn-green" onclick="pontoBaixarPDF()" style="display:flex;align-items:center;gap:6px;white-space:nowrap">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>' +
        'Baixar PDF' +
      '</button>' +
      (registros.length ? '<button class="btn btn-sm btn-red" onclick="pontoLimparHistorico()" style="white-space:nowrap">Limpar tudo</button>' : '') +
    '</div>';

  // Filtra e monta dados
  var partesMes = filtroMes.split('-');
  var anoNum = parseInt(partesMes[0]), mesNum = parseInt(partesMes[1]) - 1;
  var diasNoMes = new Date(anoNum, mesNum+1, 0).getDate();

  var lista = registros.filter(function(r) {
    var p = r.data.split('/');
    if (p.length < 3) return false;
    if (p[2] !== partesMes[0] || p[1].padStart(2,'0') !== partesMes[1]) return false;
    if (filtroColab !== 'todos' && String(r.colabIdx) !== filtroColab) return false;
    return true;
  });

  if (!lista.length) {
    return html + '<div class="empty-state">' + iconEmpty() + '<p>Nenhum registro para o periodo selecionado.</p></div>';
  }

  // Determina quais colaboradores mostrar
  var colabsParaMostrar = filtroColab === 'todos'
    ? cols.map(function(c,i){ return i; })
    : [parseInt(filtroColab)];

  // Para cada colaborador, monta o calendário
  colabsParaMostrar.forEach(function(colabIdx) {
    var colab = cols[colabIdx];
    if (!colab) return;

    var regsColab = lista.filter(function(r){ return r.colabIdx === colabIdx; });
    if (!regsColab.length && filtroColab === 'todos') return;

    // Agrupa por dia
    var porDia = {};
    regsColab.forEach(function(r) {
      var dia = parseInt(r.data.split('/')[0]);
      if (!porDia[dia]) porDia[dia] = [];
      porDia[dia].push(r);
    });

    // Stats do colaborador
    var stats = pontoCalcStats(colabIdx, mesNum, anoNum);

    // Header do colaborador
    html += '<div style="background:var(--bg3);border-radius:10px;padding:14px 16px;margin-bottom:12px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<div style="font-weight:700;font-size:1rem">' + esc(colab.nome) +
          (colab.cargo ? '<span style="font-weight:400;color:var(--text3);font-size:0.78rem;margin-left:8px">' + esc(colab.cargo) + '</span>' : '') +
        '</div>' +
        '<div style="display:flex;gap:16px;font-size:0.82rem">' +
          '<span>⏱ <strong>' + stats.horasFormatado + '</strong></span>' +
          '<span>📅 <strong>' + stats.diasTrabalhados + '</strong> dias</span>' +
          (stats.faltas > 0 ? '<span style="color:var(--red)">❌ <strong>' + stats.faltas + '</strong> faltas</span>' : '') +
          (stats.diasFolga > 0 ? '<span style="color:#7c3aed">🏖 <strong>' + stats.diasFolga + '</strong> folgas</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +

    // Grid do calendário -- 7 colunas
    '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:5px;margin-bottom:20px">';

    for (var d = 1; d <= diasNoMes; d++) {
      var dt     = new Date(anoNum, mesNum, d);
      var diaSem = dt.getDay();
      var fimSem = diaSem === 0 || diaSem === 6;
      var regs   = porDia[d] || [];

      // Verifica se tem folga registrada
      var temFolga = regs.some(function(r){ return r.tipo === 'folga'; });
      var regsNorm = regs.filter(function(r){ return r.tipo !== 'folga'; });

      // Horários do dia
      var entrada      = regsNorm.find(function(r){ return r.etapa === 0; });
      var saidaAlmoco  = regsNorm.find(function(r){ return r.etapa === 1; });
      var voltaAlmoco  = regsNorm.find(function(r){ return r.etapa === 2; });
      var saida        = regsNorm.find(function(r){ return r.etapa === 3; });

      // Calcula horas trabalhadas do dia
      var minDia = 0;
      var manha = 0, tarde = 0;
      if (entrada && saidaAlmoco) {
        manha = pontoHoraParaMs(saidaAlmoco.hora) - pontoHoraParaMs(entrada.hora);
        if (manha > 0) minDia += manha;
      }
      if (voltaAlmoco && saida) {
        tarde = pontoHoraParaMs(saida.hora) - pontoHoraParaMs(voltaAlmoco.hora);
        if (tarde > 0) minDia += tarde;
      }
      var hh = Math.floor(minDia/60), mm2 = minDia%60;
      var totalDiaStr = minDia > 0 ? hh + 'h' + String(mm2).padStart(2,'0') : null;

      // Verifica se é falta (dia útil sem registro)
      var hoje = new Date(); hoje.setHours(0,0,0,0);
      var isFalta = !fimSem && !temFolga && regsNorm.length === 0 && dt <= hoje;

      // Classe do card
      var borderColor = '#e5e7eb';
      if (fimSem)    borderColor = '#e5e7eb';
      else if (temFolga)  borderColor = '#6366f1';
      else if (isFalta)   borderColor = '#ef4444';
      else if (totalDiaStr) {
        // Verifica se tem irregularidade
        var irregular = pontoHoraIrregular(entrada, 0) || pontoHoraIrregular(saidaAlmoco, 1) || pontoHoraIrregular(voltaAlmoco, 2) || pontoHoraIrregular(saida, 3);
        borderColor = irregular ? '#f59e0b' : '#22c55e';
      }

      // Função para badge de hora
      function horaBadge(reg, etapaIdx) {
        if (!reg) return '<span style="font-size:0.6rem;font-weight:700;padding:2px 4px;border-radius:4px;text-align:center;background:#f1f5f9;color:#94a3b8">--</span>';
        var irregular2 = pontoHoraIrregular(reg, etapaIdx);
        var bg = irregular2 ? '#fef9c3' : '#dcfce7';
        var cor2 = irregular2 ? '#b45309' : '#16a34a';
        return '<span style="font-size:0.6rem;font-weight:700;padding:2px 4px;border-radius:4px;text-align:center;background:' + bg + ';color:' + cor2 + '">' + reg.hora + '</span>';
      }

      html += '<div style="background:var(--card);border-radius:6px;padding:6px 7px;border:1px solid var(--border);border-top:3px solid ' + borderColor + ';' + (fimSem?'opacity:0.5':'') + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">' +
        '<span style="font-size:0.9rem;font-weight:800;color:var(--text)">' + d + '</span>' +
        '<span style="font-size:0.55rem;color:var(--text3);text-transform:uppercase">' + diasSem[diaSem] + '</span>' +
      '</div>';

      if (fimSem) {
        html += '<div style="text-align:center;font-size:0.6rem;color:var(--text3);padding:5px 0">--</div>';
      } else if (temFolga) {
        html += '<div style="text-align:center;font-size:0.6rem;color:#7c3aed;font-weight:700;padding:5px 0">🏖 Folga</div>';
      } else if (isFalta) {
        html += '<div style="text-align:center;font-size:0.6rem;color:var(--red);font-weight:700;padding:5px 0">Falta</div>';
      } else {
        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px">' +
          horaBadge(entrada, 0) + horaBadge(saidaAlmoco, 1) +
          horaBadge(voltaAlmoco, 2) + horaBadge(saida, 3) +
        '</div>';
        if (totalDiaStr) {
          html += '<div style="font-size:0.58rem;color:var(--text3);margin-top:4px;border-top:1px solid var(--border);padding-top:3px">Hora trabalhada: <strong style="color:var(--text)">' + totalDiaStr + '</strong></div>';
        }
      }

      html += '</div>';
    }

    html += '</div>'; // grid
  });

  // Legenda
  html += '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:0.72rem;color:var(--text3);margin-top:4px">' +
    '<span><span style="display:inline-block;width:10px;height:3px;border-radius:1px;background:#22c55e;margin-right:4px;vertical-align:middle"></span>Horario exato</span>' +
    '<span><span style="display:inline-block;width:10px;height:3px;border-radius:1px;background:#f59e0b;margin-right:4px;vertical-align:middle"></span>Irregularidade</span>' +
    '<span><span style="display:inline-block;width:10px;height:3px;border-radius:1px;background:#ef4444;margin-right:4px;vertical-align:middle"></span>Falta</span>' +
    '<span><span style="display:inline-block;width:10px;height:3px;border-radius:1px;background:#6366f1;margin-right:4px;vertical-align:middle"></span>Folga</span>' +
    '<span style="background:#dcfce7;color:#16a34a;padding:1px 6px;border-radius:3px;font-weight:700">08:00</span> Verde = no horario' +
    '<span style="background:#fef9c3;color:#b45309;padding:1px 6px;border-radius:3px;font-weight:700;margin-left:8px">08:07</span> Amarelo = fora do horario' +
  '</div>';

  return html;
}

// Verifica se um horário está fora do esperado (tolerância zero)
function pontoHoraIrregular(reg, etapaIdx) {
  if (!reg || !reg.hora) return false;
  var esperados = ['08:00', '12:00', '13:00', '17:00'];
  return reg.hora !== esperados[etapaIdx];
}


// -- HELPERS -------------------------------------------------------------------

function pontoDataHoje() {
  var now = new Date();
  return now.toLocaleDateString('pt-BR');
}

function pontoHoraAtual() {
  return new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
}

function pontoStatusHoje(colabIdx) {
  var hoje = pontoDataHoje();
  var regs = state.ponto.registros.filter(function(r){ return r.colabIdx === colabIdx && r.data === hoje; });
  var n = regs.length;
  if (n === 0) return 'livre';
  if (n >= 4)  return 'saiu';
  // etapa 1 = trabalhando, 2 = almoço, 3 = voltou
  return n % 2 === 1 ? 'trabalhando' : 'almocando';
}

function pontoUltimoHoje(colabIdx) {
  var hoje = pontoDataHoje();
  var regs = state.ponto.registros.filter(function(r){ return r.colabIdx === colabIdx && r.data === hoje; });
  if (!regs.length) return null;
  var ultimo = regs[regs.length - 1];
  var labels = ['Entrada','Saída Almoço','Volta Almoço','Saída'];
  var label  = labels[regs.length - 1] || ultimo.tipo;
  return label + ' às ' + ultimo.hora;
}

function pontoCalcStats(colabIdx, mes, ano) {
  var regs = state.ponto.registros.filter(function(r){
    if (r.colabIdx !== colabIdx) return false;
    var partes = r.data.split('/');
    if (partes.length < 3) return false;
    return parseInt(partes[1])-1 === mes && parseInt(partes[2]) === ano;
  });

  // Dias com folga/feriado -- não contam como falta
  var diasFolga = {};
  regs.forEach(function(r){ if (r.tipo === 'folga') diasFolga[r.data] = true; });

  // Agrupa registros de ponto por dia
  var porDia = {};
  regs.forEach(function(r){
    if (r.tipo === 'folga') return; // ignora folgas no cálculo de horas
    if (!porDia[r.data]) porDia[r.data] = [];
    porDia[r.data].push(r);
  });

  var totalMin = 0;
  var diasTrabalhados = 0;

  Object.keys(porDia).forEach(function(dia) {
    var lista = porDia[dia];
    var entradas = lista.filter(function(r){ return r.tipo==='entrada'; });
    var saidas   = lista.filter(function(r){ return r.tipo==='saida';   });
    var pares = Math.min(entradas.length, saidas.length);
    var minDia = 0;
    for (var k = 0; k < pares; k++) {
      var eMs = pontoHoraParaMs(entradas[k].hora);
      var sMs = pontoHoraParaMs(saidas[k].hora);
      if (sMs > eMs) minDia += sMs - eMs;
    }
    if (minDia > 0) { totalMin += minDia; diasTrabalhados++; }
  });

  // Faltas: dias úteis passados sem registro de ponto E sem folga/feriado
  var hoje = new Date();
  var diasUteisPassados = 0;
  var limite = (mes === hoje.getMonth() && ano === hoje.getFullYear()) ? hoje.getDate() : new Date(ano, mes+1, 0).getDate();
  for (var d = 1; d <= limite; d++) {
    var dt = new Date(ano, mes, d);
    var diaSem = dt.getDay();
    if (diaSem === 0 || diaSem === 6) continue;
    var dataStr = String(d).padStart(2,'0') + '/' + String(mes+1).padStart(2,'0') + '/' + ano;
    if (!diasFolga[dataStr]) diasUteisPassados++;
  }
  var faltas = Math.max(0, diasUteisPassados - diasTrabalhados);

  var h = Math.floor(totalMin / 60);
  var m = totalMin % 60;
  return {
    horasFormatado:  h + 'h' + (m > 0 ? String(m).padStart(2,'0') : ''),
    diasTrabalhados: diasTrabalhados,
    diasFolga:       Object.keys(diasFolga).length,
    faltas:          faltas,
    totalMin:        totalMin,
  };
}

function pontoHoraParaMs(hora) {
  var p = hora.split(':');
  return parseInt(p[0]||0)*60 + parseInt(p[1]||0);
}

// -- AÇÕES ---------------------------------------------------------------------

function pontoSelecionarColab(idx) {
  _pontoColabSel = idx;
  _pontoSenhaOk  = false;
  navigate('ponto');
}

function pontoVoltar() {
  _pontoColabSel = null;
  _pontoSenhaOk  = false;
  navigate('ponto');
}

function pontoVerificarSenha(val, idx) {
  var c = state.ponto.colaboradores[idx];
  if (!c) return;
  _pontoSenhaOk = (val === c.senha);
  // Re-render apenas o card aberto
  var el = document.getElementById('page-content');
  if (el) el.innerHTML = renderPontoColabAberto(idx);
  // Restaura foco no input de senha
  var inp = document.getElementById('ponto-senha');
  if (inp) { inp.value = val; inp.focus(); inp.setSelectionRange(val.length, val.length); }
}

function pontoAdminVerColab(idx) {
  _pontoColabSel = idx;
  _pontoSenhaOk  = true; // Admin não precisa digitar senha
  navigate('ponto');
}

function pontoAdminExcluirRegistro(regId) {
  if (!confirm('Excluir este registro de ponto?')) return;
  var idx = state.ponto.registros.findIndex(function(r){ return r.id === regId; });
  if (idx === -1) return;
  var reg = state.ponto.registros[idx];
  addLog('Admin excluiu registro de ponto: ' + reg.labelEtapa + ' de ' + reg.nomeColab + ' em ' + reg.data + ' às ' + reg.hora);
  state.ponto.registros.splice(idx, 1);
  saveState();
  // Re-renderiza a tela do colaborador
  var el = document.getElementById('page-content');
  if (el) el.innerHTML = renderPontoColabAberto(_pontoColabSel);
  pontoIniciarRelogio();
}

function pontoRegistrarEtapa(idx) {
  if (!_pontoSenhaOk) return;
  var c = state.ponto.colaboradores[idx];
  if (!c) return;

  var JORNADA = [
    { tipo: 'entrada', label: 'Entrada' },
    { tipo: 'saida',   label: 'Saída para Almoço' },
    { tipo: 'entrada', label: 'Volta do Almoço' },
    { tipo: 'saida',   label: 'Saída' },
  ];

  var hoje = pontoDataHoje();
  var hora = pontoHoraAtual();
  var regsHoje = state.ponto.registros.filter(function(r){ return r.colabIdx === idx && r.data === hoje; });
  var etapa = regsHoje.length;
  if (etapa >= 4) return;

  var e = JORNADA[etapa];

  // Calcula horas trabalhadas em etapas de saída
  var horasTrabalhadas = null;
  if (e.tipo === 'saida' && regsHoje.length > 0) {
    // Última entrada antes desta saída
    var ultimaEntrada = null;
    for (var k = regsHoje.length - 1; k >= 0; k--) {
      if (regsHoje[k].tipo === 'entrada') { ultimaEntrada = regsHoje[k]; break; }
    }
    if (ultimaEntrada) {
      var difMin = pontoHoraParaMs(hora) - pontoHoraParaMs(ultimaEntrada.hora);
      if (difMin > 0) {
        var hh2 = Math.floor(difMin/60), mm2 = difMin%60;
        horasTrabalhadas = hh2 + 'h' + String(mm2).padStart(2,'0') + 'min';
      }
    }
  }

  state.ponto.registros.push({
    id:               Date.now(),
    colabIdx:         idx,
    nomeColab:        c.nome,
    cargo:            c.cargo || '',
    data:             hoje,
    hora:             hora,
    tipo:             e.tipo,
    etapa:            etapa,
    labelEtapa:       e.label,
    horasTrabalhadas: horasTrabalhadas,
  });

  addLog(e.label + ': ' + c.nome + ' às ' + hora);
  saveState();
  _pontoSenhaOk = false;

  var el = document.getElementById('page-content');
  if (el) el.innerHTML = renderPontoColabAberto(idx);

  var statusEl = document.getElementById('ponto-status');
  if (statusEl) {
    statusEl.style.color = e.tipo === 'entrada' ? 'var(--green)' : 'var(--blue)';
    statusEl.textContent = 'v ' + e.label + ' registrada às ' + hora + (horasTrabalhadas ? ' -- ' + horasTrabalhadas + ' trabalhadas' : '');
    if (etapa === 3) {
      // Jornada completa -- volta automaticamente em 3s
      setTimeout(function(){ pontoVoltar(); }, 3000);
    }
  }
}

function pontoAdminSetTab(tab) {
  _pontoTab = tab;
  _pontoColabSel = null;
  if (tab === 'historico' && !_pontoHistMes) _pontoHistMes = pontoMesAnoAtual();
  navigate('ponto');
}

function pontoSetFiltro(val) {
  _pontoHistFiltro = val;
  var el = document.getElementById('page-content');
  if (el) el.innerHTML = renderPonto();
}

function pontoSetHistMes(val) {
  _pontoHistMes = val;
  var el = document.getElementById('page-content');
  if (el) el.innerHTML = renderPonto();
}

function pontoSetHistColab(val) {
  _pontoHistColab = val;
  var el = document.getElementById('page-content');
  if (el) el.innerHTML = renderPonto();
}

function pontoBaixarPDF() {
  var nomesMes  = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var diasSem   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'];
  var filtroColab = (typeof _pontoHistColab !== 'undefined') ? _pontoHistColab : 'todos';
  var filtroMes   = (typeof _pontoHistMes   !== 'undefined' && _pontoHistMes) ? _pontoHistMes : pontoMesAnoAtual();
  var cols        = state.ponto.colaboradores;
  var registros   = state.ponto.registros;

  var partesMes = filtroMes.split('-');
  var anoNum = parseInt(partesMes[0]), mesNum = parseInt(partesMes[1]) - 1;
  var mesLabel = nomesMes[mesNum] + ' ' + anoNum;
  var diasNoMes = new Date(anoNum, mesNum+1, 0).getDate();

  var colabsParaMostrar = filtroColab === 'todos'
    ? cols.map(function(c,i){ return i; })
    : [parseInt(filtroColab)];

  try {
    var jsPDFLib = window.jspdf;
    var doc = new jsPDFLib.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var PW = 210, PH = 297, px = 10;
    var pageNum = 0;

    // Cores
    var COR_GREEN  = [22,163,74];
    var COR_YELLOW = [245,158,11];
    var COR_RED    = [239,68,68];
    var COR_PURPLE = [99,102,241];
    var COR_GRAY   = [148,163,184];

    function novaPagina(nome, cargo, mesLabel2) {
      if (pageNum > 0) doc.addPage();
      pageNum++;

      // Header verde
      doc.setFillColor(COR_GREEN[0], COR_GREEN[1], COR_GREEN[2]);
      doc.rect(0, 0, PW, 24, 'F');
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica','bold'); doc.setFontSize(12);
      doc.text('COSTA NATURE LIFE -- Relatorio de Ponto', px, 10);
      doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text(mesLabel2 + '  |  ' + nome + (cargo ? ' -- ' + cargo : ''), px, 16);
      doc.text('Gerado em ' + new Date().toLocaleString('pt-BR'), PW - px, 16, { align:'right' });
      doc.setTextColor(0,0,0);
    }

    function horaBadgePDF(doc2, x, y, hora, etapaIdx) {
      var w = 17, h = 4.5;
      var esperados = ['08:00','12:00','13:00','17:00'];
      if (!hora) {
        doc2.setFillColor(241,245,249);
        doc2.roundedRect(x, y, w, h, 1, 1, 'F');
        doc2.setTextColor(148,163,184); doc2.setFontSize(5.5); doc2.setFont('helvetica','normal');
        doc2.text('--', x + w/2, y + h - 1, { align:'center' });
        return;
      }
      var irregular = hora !== esperados[etapaIdx];
      if (irregular) {
        doc2.setFillColor(254,243,199);
        doc2.roundedRect(x, y, w, h, 1, 1, 'F');
        doc2.setTextColor(COR_YELLOW[0],COR_YELLOW[1],COR_YELLOW[2]);
      } else {
        doc2.setFillColor(220,252,231);
        doc2.roundedRect(x, y, w, h, 1, 1, 'F');
        doc2.setTextColor(COR_GREEN[0],COR_GREEN[1],COR_GREEN[2]);
      }
      doc2.setFontSize(5.5); doc2.setFont('helvetica','bold');
      doc2.text(hora, x + w/2, y + h - 1, { align:'center' });
      doc2.setTextColor(0,0,0);
    }

    colabsParaMostrar.forEach(function(colabIdx) {
      var colab = cols[colabIdx];
      if (!colab) return;

      var regsColab = registros.filter(function(r) {
        var p = r.data.split('/');
        if (p.length < 3) return false;
        if (p[2] !== partesMes[0] || p[1].padStart(2,'0') !== partesMes[1]) return false;
        return r.colabIdx === colabIdx;
      });

      novaPagina(colab.nome, colab.cargo || '', mesLabel);

      // Stats
      var stats = pontoCalcStats(colabIdx, mesNum, anoNum);

      // Caixas de stats
      var sboxY = 27, sboxH = 14;
      var sboxes = [
        { label:'Horas trabalhadas', val: stats.horasFormatado, cor: COR_GREEN },
        { label:'Dias trabalhados',  val: String(stats.diasTrabalhados), cor: [37,99,235] },
        { label:'Faltas',            val: String(stats.faltas),          cor: COR_RED },
        { label:'Folgas',            val: String(stats.diasFolga || 0),  cor: COR_PURPLE },
      ];
      var sboxW = (PW - px*2 - 9) / 4;
      sboxes.forEach(function(sb, si) {
        var bx = px + si * (sboxW + 3);
        doc.setFillColor(sb.cor[0], sb.cor[1], sb.cor[2]);
        doc.roundedRect(bx, sboxY, sboxW, sboxH, 2, 2, 'F');
        doc.setTextColor(255,255,255);
        doc.setFont('helvetica','bold'); doc.setFontSize(11);
        doc.text(sb.val, bx + sboxW/2, sboxY + 7.5, { align:'center' });
        doc.setFont('helvetica','normal'); doc.setFontSize(6);
        doc.text(sb.label, bx + sboxW/2, sboxY + 12, { align:'center' });
      });
      doc.setTextColor(0,0,0);

      // Calendário -- 7 colunas
      var calY = sboxY + sboxH + 6;
      var cardW = (PW - px*2 - 6*2) / 7;
      var cardH = 22;
      var col7 = 0;

      // Agrupa registros por dia
      var porDia = {};
      regsColab.forEach(function(r) {
        var dia = parseInt(r.data.split('/')[0]);
        if (!porDia[dia]) porDia[dia] = [];
        porDia[dia].push(r);
      });

      for (var d = 1; d <= diasNoMes; d++) {
        var dt     = new Date(anoNum, mesNum, d);
        var diaSem = dt.getDay();
        var fimSem = diaSem === 0 || diaSem === 6;
        var regs   = porDia[d] || [];

        var temFolga = regs.some(function(r){ return r.tipo === 'folga'; });
        var regsNorm = regs.filter(function(r){ return r.tipo !== 'folga'; });

        var entrada     = regsNorm.find(function(r){ return r.etapa === 0; });
        var saidAlm     = regsNorm.find(function(r){ return r.etapa === 1; });
        var voltAlm     = regsNorm.find(function(r){ return r.etapa === 2; });
        var saida       = regsNorm.find(function(r){ return r.etapa === 3; });

        // Horas do dia
        var minDia2 = 0;
        if (entrada && saidAlm) { var m1 = pontoHoraParaMs(saidAlm.hora) - pontoHoraParaMs(entrada.hora); if (m1>0) minDia2+=m1; }
        if (voltAlm && saida)   { var m2 = pontoHoraParaMs(saida.hora)   - pontoHoraParaMs(voltAlm.hora); if (m2>0) minDia2+=m2; }
        var hhd = Math.floor(minDia2/60), mmd = minDia2%60;
        var totalDia = minDia2 > 0 ? hhd + 'h' + String(mmd).padStart(2,'0') : null;

        var hoje2 = new Date(); hoje2.setHours(0,0,0,0);
        var isFalta = !fimSem && !temFolga && regsNorm.length === 0 && dt <= hoje2;

        // Cor da borda topo
        var borderCor;
        if (fimSem)      borderCor = COR_GRAY;
        else if (temFolga)    borderCor = COR_PURPLE;
        else if (isFalta)     borderCor = COR_RED;
        else if (totalDia) {
          var irreg = (entrada && entrada.hora !== '08:00') || (saidAlm && saidAlm.hora !== '12:00') || (voltAlm && voltAlm.hora !== '13:00') || (saida && saida.hora !== '17:00');
          borderCor = irreg ? COR_YELLOW : COR_GREEN;
        } else borderCor = COR_GRAY;

        var cx = px + col7 * (cardW + 2);
        var cy = calY;

        // Verifica se precisa nova linha
        if (col7 === 7) {
          col7 = 0;
          calY += cardH + 2;
          // Verifica se cabe na página
          if (calY + cardH > PH - 14) {
            doc.setFontSize(6); doc.setTextColor(120,120,120);
            doc.text('Costa Nature Life -- Relatorio de Ponto -- ' + mesLabel, px, PH-5);
            doc.addPage(); pageNum++;
            novaPagina(colab.nome, colab.cargo||'', mesLabel);
            calY = 27 + sboxH + 6;
          }
          cx = px; cy = calY;
        }

        // Fundo do card
        if (fimSem) {
          doc.setFillColor(249,250,251);
        } else {
          doc.setFillColor(255,255,255);
        }
        doc.setDrawColor(229,231,235); doc.setLineWidth(0.2);
        doc.roundedRect(cx, cy, cardW, cardH, 1.5, 1.5, 'FD');

        // Borda top colorida
        doc.setFillColor(borderCor[0], borderCor[1], borderCor[2]);
        doc.roundedRect(cx, cy, cardW, 1.5, 0.5, 0.5, 'F');

        // Dia + dia semana
        doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(26,26,46);
        doc.text(String(d), cx + 2, cy + 6);
        doc.setFont('helvetica','normal'); doc.setFontSize(5); doc.setTextColor(150,150,150);
        doc.text(diasSem[diaSem], cx + cardW - 2, cy + 5.5, { align:'right' });
        doc.setTextColor(0,0,0);

        if (fimSem) {
          doc.setTextColor(180,180,180); doc.setFontSize(6);
          doc.text('--', cx + cardW/2, cy + 14, { align:'center' });
        } else if (temFolga) {
          doc.setTextColor(COR_PURPLE[0], COR_PURPLE[1], COR_PURPLE[2]);
          doc.setFont('helvetica','bold'); doc.setFontSize(6);
          doc.text('Folga', cx + cardW/2, cy + 14, { align:'center' });
        } else if (isFalta) {
          doc.setTextColor(COR_RED[0], COR_RED[1], COR_RED[2]);
          doc.setFont('helvetica','bold'); doc.setFontSize(6);
          doc.text('Falta', cx + cardW/2, cy + 14, { align:'center' });
        } else {
          // 4 badges de hora em 2x2
          var bw = (cardW - 4) / 2, bx1 = cx + 2, bx2 = cx + 2 + bw + 1;
          horaBadgePDF(doc, bx1, cy + 7.5, entrada ? entrada.hora : null, 0);
          horaBadgePDF(doc, bx2, cy + 7.5, saidAlm ? saidAlm.hora : null, 1);
          horaBadgePDF(doc, bx1, cy + 13, voltAlm ? voltAlm.hora : null, 2);
          horaBadgePDF(doc, bx2, cy + 13, saida ? saida.hora : null, 3);

          // Total horas
          if (totalDia) {
            doc.setDrawColor(229,231,235); doc.setLineWidth(0.1);
            doc.line(cx+2, cy+18.5, cx+cardW-2, cy+18.5);
            doc.setFont('helvetica','normal'); doc.setFontSize(4.5); doc.setTextColor(120,120,120);
            doc.text('Hora trabalhada: ', cx + 2, cy + 21);
            doc.setFont('helvetica','bold'); doc.setTextColor(26,26,46);
            doc.text(totalDia, cx + cardW - 2, cy + 21, { align:'right' });
          }
        }

        doc.setTextColor(0,0,0);
        col7++;
      }

      // Legenda
      var legY = calY + cardH + 5;
      if (legY > PH - 20) { doc.addPage(); pageNum++; legY = 20; }
      var items = [
        { cor: COR_GREEN,  label: 'Horario exato' },
        { cor: COR_YELLOW, label: 'Fora do horario' },
        { cor: COR_RED,    label: 'Falta' },
        { cor: COR_PURPLE, label: 'Folga' },
      ];
      var lx = px;
      doc.setFontSize(6); doc.setFont('helvetica','normal');
      items.forEach(function(it) {
        doc.setFillColor(it.cor[0], it.cor[1], it.cor[2]);
        doc.roundedRect(lx, legY, 8, 2.5, 0.5, 0.5, 'F');
        doc.setTextColor(80,80,80);
        doc.text(it.label, lx + 10, legY + 2);
        lx += 40;
      });
    });

    // Rodapé
    doc.setFontSize(6); doc.setTextColor(120,120,120);
    doc.text('Costa Nature Life -- CNPJ 44.168.874/0001-28 -- Relatorio de Ponto -- ' + mesLabel, px, PH-5);

    var colabLabel = filtroColab === 'todos' ? 'todos' : (cols[parseInt(filtroColab)] ? cols[parseInt(filtroColab)].nome.replace(/\s+/g,'-').toLowerCase() : '');
    var nomeArq = 'ponto-' + mesLabel.replace(' ','-').toLowerCase() + (filtroColab!=='todos'?'-'+colabLabel:'') + '.pdf';
    doc.save(nomeArq);
    addLog('Baixou relatorio de ponto: ' + mesLabel + ' / ' + (filtroColab==='todos'?'Todos':colabLabel));
  } catch(err) {
    alert('Erro ao gerar PDF: ' + err.message);
  }
}

function pontoLimparHistorico() {
  if (!confirm('Limpar todo o histórico de ponto?')) return;
  state.ponto.registros = [];
  addLog('Limpou histórico do ponto virtual');
  saveState();
  navigate('ponto');
}

function pontoAbrirModalColab(idx) {
  var c = idx !== null ? state.ponto.colaboradores[idx] : null;
  var modal = document.getElementById('modal');
  var mc    = document.getElementById('modal-content');
  if (!modal || !mc) return;
  mc.innerHTML =
    '<div style="padding:1.5rem;min-width:300px;max-width:400px">' +
      '<div style="font-size:1.1rem;font-weight:700;margin-bottom:1.25rem">' + (c ? '✏️ Editar Colaborador' : '+ Novo Colaborador') + '</div>' +
      '<div style="margin-bottom:10px"><label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:4px">Nome *</label>' +
        '<input id="pt-nome" class="tn-input" placeholder="Nome completo" value="' + esc(c?c.nome:'') + '" style="width:100%;margin:0"></div>' +
      '<div style="margin-bottom:10px"><label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:4px">Cargo</label>' +
        '<input id="pt-cargo" class="tn-input" placeholder="Ex: Operador, Expedição..." value="' + esc(c?(c.cargo||''):'') + '" style="width:100%;margin:0"></div>' +
      '<div style="margin-bottom:1.25rem"><label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:4px">Senha *</label>' +
        '<input id="pt-senha" type="password" class="tn-input" placeholder="Senha de acesso ao ponto" value="' + esc(c?c.senha:'') + '" style="width:100%;margin:0">' +
        '<div style="font-size:0.72rem;color:var(--text3);margin-top:4px">Esta senha será usada pelo colaborador para registrar o ponto</div></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn" style="flex:1" onclick="closeModal()">Cancelar</button>' +
        '<button class="btn btn-green" style="flex:1" onclick="pontoSalvarColab(' + (idx!==null?idx:'null') + ')">💾 Salvar</button>' +
      '</div>' +
      '<div id="pt-status" style="font-size:0.82rem;color:var(--red);text-align:center;margin-top:8px;min-height:1.2em"></div>' +
    '</div>';
  modal.style.display = 'flex';
  setTimeout(function(){ var el = document.getElementById('pt-nome'); if(el) el.focus(); }, 50);
}

function pontoSalvarColab(idx) {
  var nome  = (document.getElementById('pt-nome') ||{}).value || '';
  var cargo = (document.getElementById('pt-cargo')||{}).value || '';
  var senha = (document.getElementById('pt-senha')||{}).value || '';
  var st    = document.getElementById('pt-status');

  if (!nome.trim()) { if(st) st.textContent='Informe o nome.'; return; }
  if (!senha.trim()) { if(st) st.textContent='Informe uma senha.'; return; }

  if (idx === null || idx === 'null') {
    state.ponto.colaboradores.push({ nome: nome.trim(), cargo: cargo.trim(), senha: senha });
    addLog('Cadastrou colaborador no ponto: "' + nome.trim() + '"');
  } else {
    var c = state.ponto.colaboradores[idx];
    c.nome = nome.trim(); c.cargo = cargo.trim(); c.senha = senha;
    addLog('Editou colaborador no ponto: "' + nome.trim() + '"');
  }
  saveState();
  closeModal();
  navigate('ponto');
}

function pontoAbrirModalManual(idx) {
  var c = state.ponto.colaboradores[idx];
  if (!c) return;
  var modal = document.getElementById('modal');
  var mc    = document.getElementById('modal-content');
  if (!modal || !mc) return;

  var ETAPAS = [
    { label: '> Entrada (08h)',       tipo: 'entrada', etapa: 0, labelEtapa: 'Entrada' },
    { label: '🍽 Saída Almoço (12h)', tipo: 'saida',   etapa: 1, labelEtapa: 'Saída para Almoço' },
    { label: '<- Volta Almoço (13h)', tipo: 'entrada', etapa: 2, labelEtapa: 'Volta do Almoço' },
    { label: '[] Saída (17h)',          tipo: 'saida',   etapa: 3, labelEtapa: 'Saída' },
  ];

  var hoje = new Date();
  var dataDefault = String(hoje.getDate()).padStart(2,'0') + '/' +
                    String(hoje.getMonth()+1).padStart(2,'0') + '/' +
                    hoje.getFullYear();

  var regsHoje = state.ponto.registros.filter(function(r){ return r.colabIdx === idx && r.data === dataDefault; });
  var etapaDefault = Math.min(regsHoje.length, 3);
  var horasDefault = ['08:00','12:00','13:00','17:00'];

  mc.innerHTML =
    '<div style="padding:1.5rem;min-width:320px;max-width:420px">' +
      '<div style="font-size:1.1rem;font-weight:700;margin-bottom:4px">⏱ Registro Manual</div>' +
      '<div style="font-size:0.82rem;color:var(--text3);margin-bottom:1.25rem">Colaborador: <strong>' + esc(c.nome) + '</strong></div>' +

      // Tipo de registro -- toggle entre Ponto e Feriado/Folga
      '<div style="display:flex;gap:6px;margin-bottom:1.25rem">' +
        '<button id="pm-tipo-ponto" onclick="pontoManualTipoToggle(\'ponto\')" ' +
          'style="flex:1;padding:8px;border:2px solid var(--green);border-radius:8px;background:var(--green);color:#fff;font-weight:700;cursor:pointer;font-size:0.85rem">⏱ Ponto</button>' +
        '<button id="pm-tipo-folga" onclick="pontoManualTipoToggle(\'folga\')" ' +
          'style="flex:1;padding:8px;border:2px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text2);font-weight:600;cursor:pointer;font-size:0.85rem">🏖 Feriado / Folga</button>' +
      '</div>' +

      '<div style="margin-bottom:12px">' +
        '<label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:5px;font-weight:600">📅 Data</label>' +
        '<input id="pm-data" type="text" class="tn-input" placeholder="DD/MM/AAAA" value="' + dataDefault + '" ' +
          'style="width:100%;margin:0" oninput="pontoManualAtualizarEtapas(' + idx + ')">' +
        '<div style="font-size:0.72rem;color:var(--text3);margin-top:4px">Formato: DD/MM/AAAA</div>' +
      '</div>' +

      // Campos de ponto (ficam visíveis por padrão)
      '<div id="pm-campos-ponto">' +
        '<div style="margin-bottom:12px">' +
          '<label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:5px;font-weight:600">📋 Etapa</label>' +
          '<div id="pm-etapas" style="display:flex;flex-direction:column;gap:6px">' +
            ETAPAS.map(function(e, ei) {
              return '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.88rem" ' +
                'onmouseover="this.style.borderColor=\'var(--green)\'" onmouseout="this.style.borderColor=\'var(--border)\'">' +
                '<input type="radio" name="pm-etapa" value="' + ei + '" ' + (ei === etapaDefault ? 'checked' : '') + ' style="accent-color:var(--green)">' +
                '<span>' + e.label + '</span>' +
              '</label>';
            }).join('') +
          '</div>' +
          '<div id="pm-etapa-aviso" style="font-size:0.75rem;margin-top:6px;color:var(--amber)"></div>' +
        '</div>' +
        '<div style="margin-bottom:1.25rem">' +
          '<label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:5px;font-weight:600">🕐 Horário</label>' +
          '<input id="pm-hora" type="time" class="tn-input" value="' + horasDefault[etapaDefault] + '" style="width:100%;margin:0">' +
          '<div style="font-size:0.72rem;color:var(--text3);margin-top:4px">Horário real do registro</div>' +
        '</div>' +
      '</div>' +

      // Campo de motivo -- aparece só no modo folga
      '<div id="pm-campos-folga" style="display:none;margin-bottom:1.25rem">' +
        '<label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:5px;font-weight:600">📋 Motivo</label>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">' +
          '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.88rem">' +
            '<input type="radio" name="pm-motivo" value="Feriado" checked style="accent-color:var(--blue)"> <span>🎉 Feriado</span>' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.88rem">' +
            '<input type="radio" name="pm-motivo" value="Folga" style="accent-color:var(--blue)"> <span>🏖 Folga</span>' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.88rem">' +
            '<input type="radio" name="pm-motivo" value="Atestado" style="accent-color:var(--blue)"> <span>🏥 Atestado</span>' +
          '</label>' +
        '</div>' +
        '<div style="padding:10px 12px;background:var(--bg3);border-radius:8px;font-size:0.78rem;color:var(--text2)">v Este dia <strong>não será contado como falta</strong> para o colaborador.</div>' +
      '</div>' +

      '<div style="margin-bottom:1.25rem">' +
        '<label style="font-size:0.8rem;color:var(--text2);display:block;margin-bottom:5px;font-weight:600">📝 Observação</label>' +
        '<input id="pm-obs" class="tn-input" placeholder="Observação adicional..." ' +
          'value="Registrado manualmente pelo administrador" style="width:100%;margin:0">' +
      '</div>' +

      '<div style="display:flex;gap:8px">' +
        '<button class="btn" style="flex:1" onclick="closeModal()">Cancelar</button>' +
        '<button class="btn btn-green" style="flex:1" onclick="pontoSalvarManual(' + idx + ')">v Salvar</button>' +
      '</div>' +
      '<div id="pm-status" style="font-size:0.82rem;color:var(--red);text-align:center;margin-top:8px;min-height:1.2em"></div>' +
    '</div>';

  modal.style.display = 'flex';

  setTimeout(function() {
    var radios = document.querySelectorAll('input[name="pm-etapa"]');
    var horaEl = document.getElementById('pm-hora');
    radios.forEach(function(r) {
      r.addEventListener('change', function() {
        if (horaEl) horaEl.value = horasDefault[parseInt(r.value)];
      });
    });
  }, 50);
}

function pontoManualTipoToggle(tipo) {
  var camposPonto = document.getElementById('pm-campos-ponto');
  var camposFolga = document.getElementById('pm-campos-folga');
  var btnPonto    = document.getElementById('pm-tipo-ponto');
  var btnFolga    = document.getElementById('pm-tipo-folga');
  if (!camposPonto || !camposFolga) return;

  if (tipo === 'folga') {
    camposPonto.style.display = 'none';
    camposFolga.style.display = 'block';
    btnPonto.style.background = 'var(--bg2)'; btnPonto.style.color = 'var(--text2)'; btnPonto.style.borderColor = 'var(--border)';
    btnFolga.style.background = 'var(--blue)'; btnFolga.style.color = '#fff'; btnFolga.style.borderColor = 'var(--blue)';
  } else {
    camposPonto.style.display = 'block';
    camposFolga.style.display = 'none';
    btnPonto.style.background = 'var(--green)'; btnPonto.style.color = '#fff'; btnPonto.style.borderColor = 'var(--green)';
    btnFolga.style.background = 'var(--bg2)'; btnFolga.style.color = 'var(--text2)'; btnFolga.style.borderColor = 'var(--border)';
  }
}

function pontoManualAtualizarEtapas(idx) {
  var dataEl = document.getElementById('pm-data');
  var aviso  = document.getElementById('pm-etapa-aviso');
  if (!dataEl || !aviso) return;
  var data = dataEl.value.trim();
  // Valida formato
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) { aviso.textContent = ''; return; }
  var regsData = state.ponto.registros.filter(function(r){ return r.colabIdx === idx && r.data === data; });
  var n = regsData.length;
  if (n === 0) { aviso.textContent = ''; return; }
  var LABELS = ['Entrada','Saída Almoço','Volta Almoço','Saída'];
  var feitos = regsData.map(function(r,i){ return LABELS[i] || r.tipo; }).join(', ');
  aviso.textContent = n >= 4 ? '⚠ Jornada completa neste dia.' : '⚠ Já registrado: ' + feitos + '. Próxima etapa disponível: ' + (LABELS[n]||'--');
}

function pontoSalvarManual(idx) {
  var c      = state.ponto.colaboradores[idx];
  var dataEl = document.getElementById('pm-data');
  var obsEl  = document.getElementById('pm-obs');
  var stEl   = document.getElementById('pm-status');

  var data = dataEl ? dataEl.value.trim() : '';
  var obs  = obsEl  ? obsEl.value.trim()  : '';

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) { if(stEl) stEl.textContent = '⚠ Data inválida. Use DD/MM/AAAA.'; return; }

  // Detecta modo
  var btnFolga = document.getElementById('pm-tipo-folga');
  var modoFolga = btnFolga && btnFolga.style.background !== 'var(--bg2)' && btnFolga.style.color === '#fff';

  if (modoFolga) {
    // -- Salva feriado/folga ------------------------------
    var motivoEl = document.querySelector('input[name="pm-motivo"]:checked');
    var motivo   = motivoEl ? motivoEl.value : 'Folga';

    // Verifica se já existe folga neste dia
    var jaExiste = state.ponto.registros.some(function(r){
      return r.colabIdx === idx && r.data === data && r.tipo === 'folga';
    });
    if (jaExiste) { if(stEl) stEl.textContent = '⚠ Já existe um registro de ' + motivo.toLowerCase() + ' neste dia.'; return; }

    state.ponto.registros.push({
      id:         Date.now(),
      colabIdx:   idx,
      nomeColab:  c.nome,
      cargo:      c.cargo || '',
      data:       data,
      hora:       '--',
      tipo:       'folga',
      etapa:      -1,
      labelEtapa: motivo,
      manual:     true,
      obs:        obs || motivo,
    });

    addLog(motivo + ' registrado para ' + c.nome + ' em ' + data);
    saveState();
    closeModal();
    navigate('ponto');
    return;
  }

  // -- Salva ponto normal -------------------------------
  var horaEl = document.getElementById('pm-hora');
  var radios = document.querySelectorAll('input[name="pm-etapa"]');
  var hora = horaEl ? horaEl.value.trim() : '';
  var etapaIdx = -1;
  radios.forEach(function(r){ if (r.checked) etapaIdx = parseInt(r.value); });

  if (!hora) { if(stEl) stEl.textContent = '⚠ Informe o horário.'; return; }
  if (etapaIdx < 0) { if(stEl) stEl.textContent = '⚠ Selecione uma etapa.'; return; }

  var ETAPAS = [
    { tipo: 'entrada', labelEtapa: 'Entrada' },
    { tipo: 'saida',   labelEtapa: 'Saída para Almoço' },
    { tipo: 'entrada', labelEtapa: 'Volta do Almoço' },
    { tipo: 'saida',   labelEtapa: 'Saída' },
  ];
  var e = ETAPAS[etapaIdx];

  var horasTrabalhadas = null;
  if (e.tipo === 'saida') {
    var regsData = state.ponto.registros.filter(function(r){ return r.colabIdx === idx && r.data === data && r.tipo === 'entrada'; });
    if (regsData.length) {
      var ultimaEnt = regsData[regsData.length-1];
      var dif = pontoHoraParaMs(hora) - pontoHoraParaMs(ultimaEnt.hora);
      if (dif > 0) {
        var hh = Math.floor(dif/60), mm = dif%60;
        horasTrabalhadas = hh + 'h' + String(mm).padStart(2,'0') + 'min';
      }
    }
  }

  state.ponto.registros.push({
    id:               Date.now(),
    colabIdx:         idx,
    nomeColab:        c.nome,
    cargo:            c.cargo || '',
    data:             data,
    hora:             hora,
    tipo:             e.tipo,
    etapa:            etapaIdx,
    labelEtapa:       e.labelEtapa,
    horasTrabalhadas: horasTrabalhadas,
    manual:           true,
    obs:              obs,
  });

  state.ponto.registros.sort(function(a, b) {
    if (a.data !== b.data || a.colabIdx !== b.colabIdx) return 0;
    return (a.etapa||0) - (b.etapa||0);
  });

  addLog('Registro manual: ' + e.labelEtapa + ' de ' + c.nome + ' em ' + data + ' às ' + hora);
  saveState();
  closeModal();
  navigate('ponto');
}

function pontoExcluirColab(idx) {
  var c = state.ponto.colaboradores[idx];
  if (!c) return;
  if (!confirm('Excluir "' + c.nome + '"? Os registros de ponto serão mantidos.')) return;
  addLog('Removeu colaborador do ponto: "' + c.nome + '"');
  state.ponto.colaboradores.splice(idx, 1);
  // Ajusta índices nos registros
  state.ponto.registros.forEach(function(r){
    if (r.colabIdx > idx) r.colabIdx--;
  });
  saveState();
  navigate('ponto');
}
