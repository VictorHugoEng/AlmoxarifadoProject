/**
 * ============================================================
 * VOLTSTOCK - CLIENT APPLICATION ENGINE (JS)
 * CONTROLE DE ALMOXARIFADO, INSTRUMENTOS E DISPARO MULTICANAL
 * ============================================================
 */

const ESTADO = {
  abaAtiva: 'dashboard',
  estoque: [],
  equipamentos: [],
  compras: [],
  destinatarios: [],
  resumo: null,
  apenasCriticos: false,
  usuarios: [],
  auditoria: [],
  chatContatoAtivo: null,
  notifAberto: false,
  versaoAtual: null,
  atualizandoApp: false
};

let CHAT_IMAGEM = null; // data URL da foto selecionada antes de enviar

function escaparHTML(texto) {
  return String(texto ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Converte datas gravadas pelo banco (UTC, formato "AAAA-MM-DD HH:MM:SS")
// e datas já em ISO (com Z) para o fuso local do usuário corretamente.
function formatarDataHora(valor) {
  if (valor == null || valor === '') return '—';
  try {
    let d;
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(valor)) {
      d = new Date(valor.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(valor);
    }
    if (isNaN(d.getTime())) return valor;
    return d.toLocaleString('pt-BR');
  } catch (e) {
    return valor;
  }
}

// ============================================================
// AUTENTICAÇÃO & SESSÃO (PROTEÇÃO EXTREMA)
// ============================================================
function obterToken() {
  return localStorage.getItem('servmil_token');
}

function obterUsuarioLogado() {
  try {
    return JSON.parse(localStorage.getItem('servmil_usuario'));
  } catch (e) {
    return null;
  }
}

function isAdmin() {
  const u = obterUsuarioLogado();
  return u && u.role === 'ADMIN_MASTER';
}

// Wrapper de fetch que injeta o token de sessão em toda requisição
async function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${obterToken()}` };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers });
}

// Guard: na carga da página valida a sessão e redireciona se inválida
async function verificarSessao() {
  const token = obterToken();
  if (!token) {
    window.location.replace('login.html');
    return null;
  }

  try {
    const res = await fetch('/api/sessao', { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
      localStorage.removeItem('servmil_token');
      localStorage.removeItem('servmil_usuario');
      localStorage.removeItem('servmil_expira');
      window.location.replace('login.html');
      return null;
    }
    const data = await res.json();
    localStorage.setItem('servmil_usuario', JSON.stringify(data.usuario));
    return data.usuario;
  } catch (e) {
    window.location.replace('login.html');
    return null;
  }
}

async function sairDoSistema() {
  try {
    await authFetch('/api/logout', { method: 'POST' });
  } catch (e) { /* sessão pode já estar expirada */ }
  localStorage.removeItem('servmil_token');
  localStorage.removeItem('servmil_usuario');
  localStorage.removeItem('servmil_expira');
  window.location.replace('login.html');
}

// Atualiza identidade exibida no cabeçalho
function renderizarIdentidade(usuario) {
  const area = document.getElementById('area-identidade');
  if (!usuario) return;
  area.classList.remove('hidden');
  area.classList.add('flex');
  document.getElementById('header-usuario-nome').innerText = usuario.nome || usuario.username;
  document.getElementById('header-usuario-role').innerText = usuario.role === 'ADMIN_MASTER' ? 'Administrador Master' : 'Usuário';

  const campoNomeObs = document.getElementById('obs-nome');
  if (campoNomeObs && !campoNomeObs.value) {
    campoNomeObs.value = usuario.nome || usuario.username;
  }

  // Aba de administrador visível apenas para ADMIN_MASTER
  const tabAdmin = document.getElementById('tab-administrador');
  if (usuario.role === 'ADMIN_MASTER') {
    tabAdmin.classList.remove('hidden');
  } else {
    tabAdmin.classList.add('hidden');
  }
}

// ============================================================
// SINTETIZADOR DE ÁUDIO WEB (ALARME ACÚSTICO ELÉTRICO)
// ============================================================
function tocarAlarmeSonoro(frequencia = 880, duracao = 0.25) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(frequencia, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + duracao);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duracao);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duracao);
  } catch (e) {
    console.warn('Áudio bloqueado ou não suportado:', e);
  }
}

// ============================================================
// NAVEGAÇÃO DE ABAS
// ============================================================
function trocarAba(nomeAba, filtrarCriticos = false) {
  ESTADO.abaAtiva = nomeAba;

  const abas = ['dashboard', 'estoque', 'calibracao', 'compras', 'destinatarios', 'chat', 'administrador'];
  abas.forEach(aba => {
    const elView = document.getElementById(`view-${aba}`);
    const elTab = document.getElementById(`tab-${aba}`);
    
    if (aba === nomeAba) {
      elView.classList.remove('hidden');
      elTab.className = 'tab-btn px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 bg-[#00FF66] text-black shadow-[0_0_10px_rgba(0,255,102,0.4)]';
    } else {
      elView.classList.add('hidden');
      elTab.className = 'tab-btn px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-2 text-[#94A3B8] hover:text-white';
    }
  });

  if (filtrarCriticos && nomeAba === 'estoque') {
    ESTADO.apenasCriticos = true;
    atualizarBotaoFiltroCriticos();
  }

  // Recarrega os dados específicos da aba
  if (nomeAba === 'dashboard') carregarDashboard();
  if (nomeAba === 'estoque') carregarEstoque();
  if (nomeAba === 'calibracao') carregarEquipamentos();
  if (nomeAba === 'compras') carregarCompras();
  if (nomeAba === 'destinatarios') carregarDestinatarios();
  if (nomeAba === 'chat') carregarChat();
  if (nomeAba === 'administrador') carregarAdministrador();
}

function alternarFiltroCriticos() {
  ESTADO.apenasCriticos = !ESTADO.apenasCriticos;
  atualizarBotaoFiltroCriticos();
  carregarEstoque();
}

function atualizarBotaoFiltroCriticos() {
  const btn = document.getElementById('btn-filtro-criticos');
  if (ESTADO.apenasCriticos) {
    btn.className = 'px-3 py-2.5 rounded-xl border border-red-500/60 bg-red-500/20 text-xs font-mono text-red-400 font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-[0_0_10px_rgba(239,68,68,0.3)]';
  } else {
    btn.className = 'px-3 py-2.5 rounded-xl border border-[#1E293B] bg-black/40 text-xs font-mono text-[#94A3B8] hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap';
  }
}

// ============================================================
// CARREGAMENTO DO DASHBOARD
// ============================================================
async function carregarDashboard() {
  try {
    const res = await authFetch('/api/alertas/resumo');
    const data = await res.json();
    ESTADO.resumo = data;

    const totalCalibCriticos = data.equipamentos_alerta_15_dias + data.equipamentos_vencidos;

    // Atualiza KPIs
    document.getElementById('kpi-estoque-critico').innerText = data.itens_estoque_critico;
    document.getElementById('kpi-calibracao-alerta').innerText = totalCalibCriticos;
    document.getElementById('kpi-compras-pendentes').innerText = data.solicitacoes_compras_pendentes;

    // Atualiza Badges do Header
    const badgeEstoque = document.getElementById('badge-estoque-critico');
    if (data.itens_estoque_critico > 0) {
      badgeEstoque.innerText = data.itens_estoque_critico;
      badgeEstoque.classList.remove('hidden');
    } else {
      badgeEstoque.classList.add('hidden');
    }

    const badgeCalib = document.getElementById('badge-calib-critico');
    if (totalCalibCriticos > 0) {
      badgeCalib.innerText = totalCalibCriticos;
      badgeCalib.classList.remove('hidden');
    } else {
      badgeCalib.classList.add('hidden');
    }

    // Banner de Emergência
    const banner = document.getElementById('banner-alerta-urgente');
    if (data.itens_estoque_critico > 0 || totalCalibCriticos > 0) {
      banner.classList.remove('hidden');
      document.getElementById('texto-resumo-banner').innerText = 
        `${data.itens_estoque_critico} item(ns) atingiram o limite mínimo (≤ 20 un) e ${totalCalibCriticos} instrumento(s) estão em prazo crítico de calibração.`;
    } else {
      banner.classList.add('hidden');
    }

    // Lista de Estoque Crítico no Dashboard
    const listaEstoque = document.getElementById('lista-dashboard-estoque');
    if (data.itens_criticos_lista.length === 0) {
      listaEstoque.innerHTML = `<p class="text-xs text-[#64748B] font-mono py-4 text-center">Nenhum item em nível crítico no momento.</p>`;
    } else {
      listaEstoque.innerHTML = data.itens_criticos_lista.map(item => `
        <div class="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-red-500/20 hover:border-red-500/40 transition-colors">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold text-white">${item.nome}</span>
              <span class="text-[10px] font-mono px-1.5 py-0.2 bg-[#1E293B] text-[#94A3B8] rounded">${item.codigo_id}</span>
            </div>
            <p class="text-[11px] text-[#94A3B8] mt-0.5">${item.localizacao}</p>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-right">
              <span class="text-sm font-extrabold text-red-400 font-mono">${item.quantidade_atual} ${item.unidade_medida}</span>
              <span class="block text-[10px] text-[#64748B]">Mínimo: ${item.quantidade_minima}</span>
            </div>
            <button onclick="abrirModalCompras(${item.id}, '${item.nome.replace(/'/g, "\\'")}', ${item.quantidade_atual})" class="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg border border-red-500/30 text-xs font-mono font-bold" title="Pedir Reposição">
              ⚡ Comprar
            </button>
          </div>
        </div>
      `).join('');
    }

    // Lista de Calibração Crítica no Dashboard
    const listaCalib = document.getElementById('lista-dashboard-calibracao');
    if (data.equipamentos_criticos_lista.length === 0) {
      listaCalib.innerHTML = `<p class="text-xs text-[#64748B] font-mono py-4 text-center">Todos os instrumentos estão com calibração em dia.</p>`;
    } else {
      listaCalib.innerHTML = data.equipamentos_criticos_lista.map(equip => {
        const isVencido = equip.status_calibracao === 'VENCIDO';
        const corTexto = isVencido ? 'text-red-400' : 'text-amber-400';
        const corBorda = isVencido ? 'border-red-500/30' : 'border-amber-500/30';
        const labelStatus = isVencido ? `VENCIDO (${Math.abs(equip.dias_restantes)}d atrás)` : `VENCE EM ${equip.dias_restantes} DIAS`;

        return `
          <div class="flex items-center justify-between p-3 rounded-xl bg-black/40 border ${corBorda} transition-colors">
            <div>
              <div class="flex items-center gap-2">
                <span class="text-xs font-bold text-white">${equip.nome}</span>
                <span class="text-[10px] font-mono px-1.5 py-0.2 bg-[#1E293B] text-[#94A3B8] rounded">${equip.tag_patrimonio}</span>
              </div>
              <p class="text-[11px] text-[#94A3B8] mt-0.5">${equip.fabricante} ${equip.modelo} • Resp: ${equip.responsavel}</p>
            </div>
            <div class="text-right">
              <span class="text-xs font-extrabold ${corTexto} font-mono block">${labelStatus}</span>
              <button onclick="abrirModalDisparoMultiplo('CALIBRACAO', null, ${equip.id})" class="mt-1 text-[10px] text-[#00FF66] hover:underline font-mono">
                Avisar Responsáveis &rarr;
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

  } catch (error) {
    showToast('erro', 'Falha ao carregar métricas do painel.');
  }
}

// ============================================================
// CARREGAMENTO E GESTÃO DO ALMOXARIFADO & ESTOQUE
// ============================================================
async function carregarEstoque() {
  try {
    const busca = document.getElementById('filtro-busca-estoque').value.trim();
    const categoria = document.getElementById('filtro-categoria-estoque').value;
    const apenasCriticos = ESTADO.apenasCriticos;

    const params = new URLSearchParams();
    if (busca) params.append('busca', busca);
    if (categoria) params.append('categoria', categoria);
    if (apenasCriticos) params.append('apenas_criticos', 'true');

    const res = await authFetch(`/api/estoque?${params.toString()}`);
    const itens = await res.json();
    ESTADO.estoque = itens;

    const tbody = document.getElementById('tabela-estoque-body');
    if (itens.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-xs text-[#64748B] font-mono">Nenhum item localizado no estoque com os filtros aplicados.</td></tr>`;
      return;
    }

    tbody.innerHTML = itens.map(item => {
      const isCritico = item.status_alerta === 'CRITICO';
      const rowBg = isCritico ? 'bg-red-950/20' : '';
      const borderCritica = isCritico ? 'border-l-4 border-l-red-500' : '';

      return `
        <tr class="table-row-item ${rowBg} ${borderCritica}">
          <td class="py-3 px-4">
            <div class="flex items-center gap-1.5">
              <span class="font-mono text-[#00FF66] font-bold text-xs">${item.codigo_id}</span>
              <button onclick="abrirModalEdicaoItem(${item.id}, '${item.codigo_id.replace(/'/g, "\\'")}', '${item.nome.replace(/'/g, "\\'")}')" class="p-1 text-[#64748B] hover:text-[#00FF66] hover:bg-[#00FF66]/10 rounded-md transition-all" title="Corrigir ID e Nome do item">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
            </div>
          </td>
          <td class="py-3 px-4">
            <span class="font-semibold text-white block">${item.nome}</span>
            <span class="text-[10px] text-[#64748B]">Preço Est: R$ ${Number(item.preco_estimado).toFixed(2)}</span>
          </td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[#94A3B8]">${item.categoria}</span>
              <button onclick="abrirModalEdicaoDetalhe(${item.id}, '${item.categoria.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', '${item.localizacao.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', ${item.quantidade_atual})" class="p-1 text-[#64748B] hover:text-[#00FF66] hover:bg-[#00FF66]/10 rounded-md transition-all" title="Editar Categoria, Localização e Saldo Físico">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[#94A3B8] font-mono text-[11px]">${item.localizacao}</span>
              <button onclick="abrirModalEdicaoDetalhe(${item.id}, '${item.categoria.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', '${item.localizacao.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', ${item.quantidade_atual})" class="p-1 text-[#64748B] hover:text-[#00FF66] hover:bg-[#00FF66]/10 rounded-md transition-all" title="Editar Categoria, Localização e Saldo Físico">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
            </div>
          </td>
          
          <!-- Saldo Físico -->
          <td class="py-3 px-4 text-center">
            <div class="flex items-center justify-center gap-1 flex-wrap">
              <span class="text-sm font-extrabold font-mono ${isCritico ? 'text-red-400' : 'text-white'}">
                ${item.quantidade_atual}
              </span>
              <span class="text-[10px] text-[#64748B] ml-0.5">${item.unidade_medida}</span>
              <button onclick="abrirModalEdicaoDetalhe(${item.id}, '${item.categoria.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', '${item.localizacao.replace(/'/g, "\\'").replace(/"/g, '&quot;')}', ${item.quantidade_atual})" class="p-1 text-[#64748B] hover:text-[#00FF66] hover:bg-[#00FF66]/10 rounded-md transition-all ml-0.5" title="Corrigir Saldo Físico">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <span class="block w-full text-[9px] text-[#64748B]">Mín: ${item.quantidade_minima}</span>
            </div>
          </td>

          <!-- Ajuste Rápido com quantidade digitada -->
          <td class="py-3 px-4 text-center">
            <div class="inline-flex items-center gap-1 bg-black/60 border border-[#1E293B] rounded-lg p-1">
              <input type="number" min="0" step="1" value="1" id="ajuste-${item.id}" onkeydown="if(event.key==='Enter')ajustarEstoqueManual(${item.id},1)"
                class="w-16 text-center bg-black text-white border border-[#1E293B] rounded-md px-1 py-1 text-xs font-mono focus:border-[#00FF66] focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                title="Digite a quantidade e use + / -">
              <button onclick="ajustarEstoqueManual(${item.id}, -1)" class="btn-qty px-2 py-1 text-xs text-[#94A3B8] hover:text-red-400 font-bold hover:bg-white/5 rounded" title="Dar saída na quantidade digitada">−</button>
              <button onclick="ajustarEstoqueManual(${item.id}, +1)" class="btn-qty px-2 py-1 text-xs text-[#94A3B8] hover:text-[#00FF66] font-bold hover:bg-white/5 rounded" title="Dar entrada na quantidade digitada">+</button>
            </div>
          </td>

          <!-- Status -->
          <td class="py-3 px-4 text-center">
            ${isCritico ? `
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-red-500/20 text-red-400 border border-red-500/40 badge-critico-animado">
                <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                CRÍTICO (≤ 20)
              </span>
            ` : `
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#00FF66]/10 text-[#00FF66] border border-[#00FF66]/30">
                <span class="w-1.5 h-1.5 rounded-full bg-[#00FF66]"></span>
                NORMAL
              </span>
            `}
          </td>

          <!-- Ações -->
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-2">
              <button onclick="abrirModalCompras(${item.id}, '${item.nome.replace(/'/g, "\\'")}', ${item.quantidade_atual})" class="px-2.5 py-1.5 bg-[#00FF66]/15 hover:bg-[#00FF66]/30 text-[#00FF66] border border-[#00FF66]/40 rounded-lg text-xs font-bold font-mono transition-all" title="Pedir Reposição de Compras">
                ⚡ Pedir Compras
              </button>
              <button onclick="abrirModalDisparoMultiplo('ESTOQUE_BAIXO', ${item.id})" class="p-1.5 bg-[#161D2B] hover:bg-[#1E293B] text-[#94A3B8] hover:text-[#00FF66] rounded-lg border border-[#1E293B]" title="Disparar Alerta WhatsApp aos 7 Responsáveis">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
              </button>
              <button onclick="deletarItemEstoque(${item.id})" class="p-1.5 text-[#64748B] hover:text-red-400 transition-colors" title="Excluir Item">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    showToast('erro', 'Falha ao sincronizar dados de estoque.');
  }
}

// Movimentação rápida de saldo (+ / -)
async function ajustarEstoqueManual(id, sinal) {
  const input = document.getElementById(`ajuste-${id}`);
  const valorDigitado = Number(input ? input.value : 0);
  const qtd = (isNaN(valorDigitado) || valorDigitado <= 0) ? 1 : valorDigitado;
  await ajustarEstoque(id, sinal * qtd);
}

async function ajustarEstoque(id, delta) {
  try {
    const res = await authFetch(`/api/estoque/${id}/movimento`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta })
    });
    const itemAtualizado = await res.json();

    // Se atingiu o limite crítico (<= 20), aciona alerta acústico e visual
    if (itemAtualizado.status_alerta === 'CRITICO' && delta < 0) {
      tocarAlarmeSonoro(950, 0.4);
      showToast('alerta', `⚠️ ATENÇÃO: ${itemAtualizado.nome} atingiu saldo de ${itemAtualizado.quantidade_atual} ${itemAtualizado.unidade_medida}!`);
    }

    carregarEstoque();
    carregarDashboard();
  } catch (error) {
    showToast('erro', 'Não foi possível alterar o saldo do estoque.');
  }
}

// Excluir Item de Estoque
async function deletarItemEstoque(id) {
  if (!confirm('Deseja realmente remover este material do almoxarifado?')) return;
  try {
    await authFetch(`/api/estoque/${id}`, { method: 'DELETE' });
    showToast('sucesso', 'Item removido do almoxarifado.');
    carregarEstoque();
    carregarDashboard();
  } catch (e) {
    showToast('erro', 'Falha ao excluir item.');
  }
}

// Corrigir ID e Nome do item (qualquer usuário com acesso)
function abrirModalEdicaoItem(id, codigo, nome) {
  document.getElementById('edit-item-id').value = id;
  document.getElementById('edit-item-codigo').value = codigo;
  document.getElementById('edit-item-nome').value = nome;
  document.getElementById('modal-editar-item').classList.remove('hidden');
}

async function salvarEdicaoItem(event) {
  event.preventDefault();
  const id = document.getElementById('edit-item-id').value;
  const payload = {
    codigo_id: document.getElementById('edit-item-codigo').value,
    nome: document.getElementById('edit-item-nome').value
  };

  try {
    const res = await authFetch(`/api/estoque/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao salvar');

    fecharModal('modal-editar-item');
    showToast('sucesso', 'Item corrigido!');
    carregarEstoque();
    carregarDashboard();
  } catch (err) {
    showToast('erro', err.message);
  }
}

// ============================================================
// GESTÃO DE CATEGORIAS DO ALMOXARIFADO
// ============================================================
let CATEGORIAS = [];

async function carregarCategorias() {
  try {
    const res = await authFetch('/api/categorias');
    const cats = await res.json();
    CATEGORIAS = cats;

    const filtro = document.getElementById('filtro-categoria-estoque');
    const selecionada = filtro.value;
    filtro.innerHTML = '<option value="TODAS">Todas as Categorias</option>' +
      cats.map(c => `<option value="${escAttr(c.nome)}">${escHtml(c.nome)}</option>`).join('');
    filtro.value = selecionada;

    const novoCat = document.getElementById('novo-categoria');
    novoCat.innerHTML = cats.map(c => `<option value="${escAttr(c.nome)}">${escHtml(c.nome)}</option>`).join('');
  } catch (e) {
    showToast('erro', 'Falha ao carregar categorias.');
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function abrirGestaoCategorias() {
  renderizarListaCategorias();
  document.getElementById('modal-gestao-categorias').classList.remove('hidden');
  setTimeout(() => document.getElementById('nova-categoria-input').focus(), 100);
}

function renderizarListaCategorias() {
  const container = document.getElementById('lista-categorias-gestao');
  container.innerHTML = CATEGORIAS.map(c => `
    <div class="flex items-center justify-between gap-2 bg-black/40 border border-[#1E293B] rounded-xl px-3 py-2">
      <input type="text" id="cat-nome-${c.id}" value="${escAttr(c.nome)}" class="min-w-0 flex-1 bg-transparent text-sm text-white focus:outline-none font-mono">
      <div class="flex items-center gap-1">
        <button onclick="renomearCategoria(${c.id})" class="p-1.5 text-[#94A3B8] hover:text-[#00FF66] rounded-lg transition-colors" title="Salvar nome">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </button>
        <button onclick="excluirCategoria(${c.id})" class="p-1.5 text-[#64748B] hover:text-red-400 rounded-lg transition-colors" title="Excluir categoria">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      </div>
    </div>`).join('');
}

async function adicionarCategoria() {
  const input = document.getElementById('nova-categoria-input');
  const nome = input.value.trim();
  if (!nome) return showToast('erro', 'Digite o nome da categoria.');

  try {
    const res = await authFetch('/api/categorias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao adicionar');

    input.value = '';
    await carregarCategorias();
    renderizarListaCategorias();
    showToast('sucesso', `Categoria "${nome}" adicionada!`);
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function renomearCategoria(id) {
  const input = document.getElementById(`cat-nome-${id}`);
  const nome = input.value.trim();
  if (!nome) return showToast('erro', 'O nome da categoria não pode ficar vazio.');

  try {
    const res = await authFetch(`/api/categorias/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao renomear');

    await carregarCategorias();
    renderizarListaCategorias();
    showToast('sucesso', 'Categoria renomeada!');
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function excluirCategoria(id) {
  const c = CATEGORIAS.find(x => x.id === id);
  if (!confirm(`Excluir a categoria "${c?.nome}"?\nOs itens de estoque que usam ela NÃO serão removidos, mas ela sai do filtro.`)) return;

  try {
    const res = await authFetch(`/api/categorias/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao excluir');

    await carregarCategorias();
    renderizarListaCategorias();
    showToast('sucesso', 'Categoria excluída.');
  } catch (err) {
    showToast('erro', err.message);
  }
}

// Corrigir Categoria, Localização e Saldo Físico (qualquer usuário com acesso)
function abrirModalEdicaoDetalhe(id, categoria, localizacao, quantidade) {
  document.getElementById('edit-detalhe-id').value = id;
  document.getElementById('edit-detalhe-categoria').value = categoria;
  document.getElementById('edit-detalhe-localizacao').value = localizacao;
  document.getElementById('edit-detalhe-qtd').value = quantidade;
  document.getElementById('modal-editar-item-detalhe').classList.remove('hidden');
}

async function salvarEdicaoDetalheItem(event) {
  event.preventDefault();
  const id = document.getElementById('edit-detalhe-id').value;
  const payload = {
    categoria: document.getElementById('edit-detalhe-categoria').value,
    localizacao: document.getElementById('edit-detalhe-localizacao').value,
    quantidade_atual: Number(document.getElementById('edit-detalhe-qtd').value)
  };

  try {
    const res = await authFetch(`/api/estoque/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao salvar');

    fecharModal('modal-editar-item-detalhe');
    showToast('sucesso', 'Item atualizado!');
    carregarEstoque();
    carregarDashboard();
  } catch (err) {
    showToast('erro', err.message);
  }
}

// Salvar Novo Item
async function salvarNovoItemEstoque(event) {
  event.preventDefault();
  const payload = {
    codigo_sku: document.getElementById('novo-sku').value,
    categoria: document.getElementById('novo-categoria').value,
    nome: document.getElementById('novo-nome').value,
    quantidade_atual: Number(document.getElementById('novo-qtd-atual').value),
    quantidade_minima: Number(document.getElementById('novo-qtd-minima').value),
    unidade_medida: document.getElementById('novo-unidade').value,
    localizacao: document.getElementById('novo-localizacao').value,
    preco_estimado: Number(document.getElementById('novo-preco').value)
  };

  try {
    const res = await authFetch('/api/estoque', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.erro || 'Erro ao cadastrar');
    }

    fecharModal('modal-novo-item');
    document.getElementById('form-novo-item').reset();
    showToast('sucesso', 'Material cadastrado com sucesso!');
    carregarEstoque();
    carregarDashboard();
  } catch (err) {
    showToast('erro', err.message);
  }
}

// ============================================================
// GESTÃO DE EQUIPAMENTOS & CALIBRAÇÃO (METROLOGIA)
// ============================================================
async function carregarEquipamentos() {
  try {
    const res = await authFetch('/api/equipamentos');
    const equipamentos = await res.json();
    ESTADO.equipamentos = equipamentos;

    const tbody = document.getElementById('tabela-equipamentos-body');
    if (equipamentos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-xs text-[#64748B] font-mono">Nenhum equipamento cadastrado para rastreio de calibração.</td></tr>`;
      return;
    }

    tbody.innerHTML = equipamentos.map(eq => {
      let badgeHtml = '';
      let rowHighlight = '';

      if (eq.status_calibracao === 'VENCIDO') {
        badgeHtml = `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-extrabold tracking-wide whitespace-nowrap bg-red-500/20 text-red-400 border border-red-500/40 badge-critico-animado">VENCIDO (BLOQUEADO)</span>`;
        rowHighlight = 'bg-red-950/20 border-l-4 border-l-red-500';
      } else if (eq.status_calibracao === 'ALERTA_15_DIAS') {
        badgeHtml = `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold tracking-wide whitespace-nowrap bg-amber-500/20 text-amber-400 border border-amber-500/40">VENCE EM ${eq.dias_restantes} DIAS</span>`;
        rowHighlight = 'bg-amber-950/15 border-l-4 border-l-amber-500';
      } else {
        badgeHtml = `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold tracking-wide whitespace-nowrap bg-[#00FF66]/10 text-[#00FF66] border border-[#00FF66]/30">CALIBRADO (${eq.dias_restantes}d)</span>`;
      }

      return `
        <tr class="table-row-item ${rowHighlight}">
          <td class="py-3.5 px-4 font-mono text-[#00FF66] font-bold">${eq.tag_patrimonio}</td>
          <td class="py-3.5 px-4">
            <span class="font-semibold text-white block">${eq.nome}</span>
            <span class="text-[10px] text-[#64748B]">${eq.fabricante} ${eq.modelo} • Resp: ${eq.responsavel}</span>
          </td>
          <td class="py-3.5 px-4 font-mono text-[#94A3B8] text-xs">${eq.numero_serie}</td>
          <td class="py-3.5 px-4 font-mono text-[#94A3B8]">${eq.data_ultima_calibracao}</td>
          <td class="py-3.5 px-4 font-mono font-bold text-white">${eq.data_validade_calibracao}</td>
          <td class="py-3.5 px-4 text-center font-mono font-extrabold text-sm ${eq.dias_restantes <= 0 ? 'text-red-400' : (eq.dias_restantes <= 30 ? 'text-amber-400' : 'text-[#00FF66]')}">
            ${eq.dias_restantes} d
          </td>
          <td class="py-3.5 px-4 text-center">${badgeHtml}</td>
          <td class="py-3.5 px-4 text-right">
            <div class="flex items-center justify-end gap-2">
              <button onclick="abrirModalDisparoMultiplo('CALIBRACAO', null, ${eq.id})" class="px-2.5 py-1.5 bg-[#161D2B] hover:bg-[#1E293B] text-white border border-[#334155] rounded-lg text-xs font-mono flex items-center gap-1" title="Avisar Responsáveis via WhatsApp">
                <svg class="w-3.5 h-3.5 text-[#00FF66]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
                Avisar (7)
              </button>
              <button onclick="deletarEquipamento(${eq.id})" class="p-1.5 text-[#64748B] hover:text-red-400" title="Remover Equipamento">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    showToast('erro', 'Erro ao carregar lista de calibrações.');
  }
}

// Salvar Novo Equipamento
async function salvarNovoEquipamento(event) {
  event.preventDefault();
  const payload = {
    tag_patrimonio: document.getElementById('equip-tag').value,
    numero_serie: document.getElementById('equip-serie').value,
    nome: document.getElementById('equip-nome').value,
    fabricante: document.getElementById('equip-fab').value,
    modelo: document.getElementById('equip-modelo').value,
    data_ultima_calibracao: document.getElementById('equip-dt-ultima').value,
    data_validade_calibracao: document.getElementById('equip-dt-validade').value,
    laboratorio: document.getElementById('equip-lab').value,
    responsavel: document.getElementById('equip-resp').value
  };

  try {
    const res = await authFetch('/api/equipamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.erro || 'Falha ao cadastrar');
    }

    fecharModal('modal-novo-equipamento');
    document.getElementById('form-novo-equipamento').reset();
    showToast('sucesso', 'Instrumento cadastrado com sucesso!');
    carregarEquipamentos();
    carregarDashboard();
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function deletarEquipamento(id) {
  if (!confirm('Deseja excluir este equipamento do controle de calibração?')) return;
  try {
    await authFetch(`/api/equipamentos/${id}`, { method: 'DELETE' });
    showToast('sucesso', 'Equipamento removido.');
    carregarEquipamentos();
    carregarDashboard();
  } catch (e) {
    showToast('erro', 'Falha ao remover equipamento.');
  }
}

// ============================================================
// SOLICITAÇÃO DE COMPRAS
// ============================================================
function abrirModalCompras(itemId, itemNome, saldoAtual) {
  document.getElementById('compras-item-id').value = itemId;
  document.getElementById('compras-item-nome').value = itemNome;
  document.getElementById('compras-item-saldo').value = `${saldoAtual} un`;
  document.getElementById('compras-item-qtd').value = 100;
  document.getElementById('compras-item-setor').value = 'Almoxarifado Inteligente';
  document.getElementById('modal-compras').classList.remove('hidden');
}

async function enviarSolicitacaoCompras(event) {
  event.preventDefault();
  const usuarioLogado = obterUsuarioLogado();
  const setorInformado = document.getElementById('compras-item-setor').value.trim();

  const payload = {
    item_id: document.getElementById('compras-item-id').value,
    quantidade_solicitada: Number(document.getElementById('compras-item-qtd').value),
    urgencia: document.getElementById('compras-item-urgencia').value,
    observacao: document.getElementById('compras-item-obs').value,
    solicitante: usuarioLogado ? (usuarioLogado.nome || usuarioLogado.username) : 'Funcionário',
    setor: setorInformado || 'Almoxarifado Inteligente'
  };

  try {
    const res = await authFetch('/api/compras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Falha ao emitir pedido');

    fecharModal('modal-compras');
    showToast('sucesso', '⚡ Pedido enviado ao setor de Compras!');
    tocarAlarmeSonoro(1200, 0.2);

    carregarCompras();
    carregarDashboard();

    // Pergunta se deseja já avisar os 7 responsáveis pelo WhatsApp
    setTimeout(() => {
      if (confirm('Deseja disparar o aviso de compra aos 7 responsáveis agora via WhatsApp?')) {
        abrirModalDisparoMultiplo('ESTOQUE_BAIXO', payload.item_id);
      }
    }, 400);

  } catch (err) {
    showToast('erro', err.message);
  }
}

async function carregarCompras() {
  try {
    const res = await authFetch('/api/compras');
    const pedidos = await res.json();
    ESTADO.compras = pedidos;

    const tbody = document.getElementById('tabela-compras-body');
    if (pedidos.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-xs text-[#64748B] font-mono">Nenhuma solicitação de compra emitida ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = pedidos.map(p => {
      let statusBadge = '';
      if (p.status === 'PENDENTE') statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">PENDENTE</span>`;
      else if (p.status === 'EM_COTACAO') statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/30">EM COTAÇÃO</span>`;
      else statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#00FF66]/20 text-[#00FF66] border border-[#00FF66]/30">ATENDIDO</span>`;

      return `
        <tr class="table-row-item">
          <td class="py-3.5 px-4 font-mono text-[#00FF66] font-bold">#REQ-${String(p.id).padStart(4, '0')}</td>
          <td class="py-3.5 px-4 font-semibold text-white">${p.item_nome}</td>
          <td class="py-3.5 px-4 text-center font-mono text-red-400">${p.quantidade_atual} un</td>
          <td class="py-3.5 px-4 text-center font-mono text-[#00FF66] font-bold">+${p.quantidade_solicitada} un</td>
          <td class="py-3.5 px-4 text-xs font-mono text-[#94A3B8]">${p.urgencia}</td>
          <td class="py-3.5 px-4 text-xs font-mono text-[#64748B]">${formatarDataHora(p.data_solicitacao)}</td>
          <td class="py-3.5 px-4 text-center">${statusBadge}</td>
          <td class="py-3.5 px-4 text-right">
            ${p.status === 'PENDENTE' ? `
              <button onclick="alterarStatusCompra(${p.id}, 'EM_COTACAO')" class="px-2.5 py-1 bg-[#1E293B] hover:bg-[#334155] text-white rounded text-[11px] font-mono">
                Iniciar Cotação
              </button>
            ` : (p.status === 'EM_COTACAO' ? `
              <button onclick="alterarStatusCompra(${p.id}, 'ATENDIDO')" class="px-2.5 py-1 bg-[#00FF66]/20 hover:bg-[#00FF66]/40 text-[#00FF66] rounded text-[11px] font-mono font-bold">
                Marcar Recebido
              </button>
            ` : `<span class="text-xs text-[#64748B] font-mono">Concluído</span>`)}
          </td>
        </tr>
      `;
    }).join('');

    carregarObservacoes();

  } catch (error) {
    showToast('erro', 'Erro ao carregar histórico de compras.');
  }
}

// ============================================================
// MURAL DE OBSERVAÇÕES DE TODOS OS SETORES
// ============================================================
async function carregarObservacoes() {
  try {
    const res = await authFetch('/api/observacoes');
    const obs = await res.json();
    const lista = document.getElementById('lista-observacoes');

    if (obs.length === 0) {
      lista.innerHTML = `<p class="text-xs text-[#64748B] font-mono py-6 text-center">Nenhuma observação no mural ainda. Escreva a primeira do seu setor!</p>`;
      return;
    }

    lista.innerHTML = obs.map(o => {
      const segura = o.observacao.replace(/</g, '&lt;');
      const statusConfig = {
        'EM_ABERTO':  { label: 'Em Aberto',  ativo: 'bg-red-500 ring-2 ring-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]', irado: 'bg-red-500/20 hover:bg-red-500/50', texto: 'text-red-400' },
        'AGUARDANDO': { label: 'Aguardando', ativo: 'bg-amber-400 ring-2 ring-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]', irado: 'bg-amber-400/20 hover:bg-amber-400/50', texto: 'text-amber-400' },
        'RESOLVIDO':  { label: 'Resolvido',  ativo: 'bg-[#00FF66] ring-2 ring-[#00FF66] shadow-[0_0_8px_rgba(0,255,102,0.7)]', irado: 'bg-[#00FF66]/20 hover:bg-[#00FF66]/50', texto: 'text-[#00FF66]' }
      };
      const atual = statusConfig[o.status] || statusConfig['EM_ABERTO'];

      const bolinhas = ['EM_ABERTO', 'AGUARDANDO', 'RESOLVIDO'].map(s => {
        const cfg = statusConfig[s];
        const isAtivo = s === o.status;
        return `
          <button onclick="mudarStatusObservacao(${o.id}, '${s}')" title="Marcar como: ${cfg.label}"
            class="w-4 h-4 rounded-full transition-all ${isAtivo ? cfg.ativo : `${cfg.irado} cursor-pointer`}"></button>
        `;
      }).join('');

      return `
        <div class="p-4 hover:bg-white/5 transition-colors flex gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 text-[11px] font-mono flex-wrap">
              <span class="w-2 h-2 rounded-full bg-[#38BDF8]"></span>
              <span class="font-bold text-white">${o.autor}</span>
              <span class="px-2 py-0.5 rounded bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/30 font-bold">${o.setor}</span>
              <span class="text-[#64748B] ml-auto">${formatarDataHora(o.criado_em)}</span>
            </div>
            <p class="mt-2 text-xs text-[#E2E8F0] leading-relaxed whitespace-pre-wrap break-words">${segura}</p>
            <div class="mt-2.5 flex items-center gap-2.5 pt-2 border-t border-[#1E293B]/50">
              <span class="text-[10px] font-mono text-[#64748B] uppercase tracking-wider">Status:</span>
              ${bolinhas}
              <span class="text-[10px] font-mono font-bold ${atual.texto}">${atual.label}</span>
            </div>
          </div>
          <button onclick="excluirObservacao(${o.id})" class="self-start p-1.5 text-[#64748B] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors" title="Apagar esta observação">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      `;
    }).join('');
  } catch (error) {
    showToast('erro', 'Falha ao carregar o mural de observações.');
  }
}

async function publicarObservacao(event) {
  event.preventDefault();
  const texto = document.getElementById('obs-texto').value.trim();
  const setor = document.getElementById('obs-setor').value.trim() || 'Almoxarifado Inteligente';
  const nome = document.getElementById('obs-nome').value.trim() || (obterUsuarioLogado()?.nome || 'Funcionário');

  if (!texto) return;

  try {
    const res = await authFetch('/api/observacoes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ observacao: texto, setor, nome })
    });

    if (!res.ok) throw new Error('Falha ao publicar');

    document.getElementById('obs-texto').value = '';
    showToast('sucesso', 'Observação publicada no mural para todos!');
    carregarObservacoes();
  } catch (err) {
    showToast('erro', 'Não foi possível publicar a observação.');
  }
}

async function excluirObservacao(id) {
  if (!confirm('Apagar esta observação do mural?')) return;
  try {
    const res = await authFetch(`/api/observacoes/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha ao apagar');
    showToast('sucesso', 'Observação apagada.');
    carregarObservacoes();
  } catch (e) {
    showToast('erro', 'Não foi possível apagar a observação.');
  }
}

async function mudarStatusObservacao(id, status) {
  try {
    const res = await authFetch(`/api/observacoes/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (!res.ok) throw new Error('Falha ao alterar status');
    showToast('sucesso', 'Status alterado!');
    carregarObservacoes();
  } catch (e) {
    showToast('erro', 'Não foi possível alterar o status.');
  }
}

async function alterarStatusCompra(id, status) {
  try {
    await authFetch(`/api/compras/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    showToast('sucesso', 'Status da solicitação atualizado.');
    carregarCompras();
    carregarDashboard();
  } catch (e) {
    showToast('erro', 'Falha ao atualizar status.');
  }
}

// ============================================================
// OS 4 DESTINATÁRIOS & DISPARADOR MULTI-WHATSAPP
// ============================================================
async function carregarDestinatarios() {
  try {
    const res = await authFetch('/api/destinatarios');
    const lista = await res.json();
    ESTADO.destinatarios = lista;

    const grid = document.getElementById('grid-destinatarios');
    grid.innerHTML = lista.map((d, index) => `
      <div class="bg-[#121824] p-5 rounded-2xl border border-[#1E293B] relative overflow-hidden flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center justify-between">
            <span class="px-2 py-0.5 rounded text-[10px] font-mono font-extrabold bg-[#00FF66]/10 text-[#00FF66] border border-[#00FF66]/30">
              RESPONSÁVEL #0${index + 1}
            </span>
            <button onclick="abrirModalEdicaoDestinatario(${d.id})" class="text-xs text-[#94A3B8] hover:text-[#00FF66] font-mono flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
              Editar
            </button>
          </div>
          <h4 class="text-base font-bold text-white mt-2">${d.nome}</h4>
          <p class="text-xs text-[#94A3B8] font-mono">${d.cargo}</p>
        </div>

        <div class="space-y-1.5 pt-3 border-t border-[#1E293B] text-xs font-mono">
          <div class="flex items-center justify-between text-[#94A3B8]">
            <span>WhatsApp:</span>
            <span class="text-white font-bold">${d.telefone_whatsapp}</span>
          </div>
          <div class="flex items-center justify-between text-[#94A3B8]">
            <span>E-mail:</span>
            <span class="text-white truncate max-w-[200px]">${d.email}</span>
          </div>
        </div>

        <a href="https://wa.me/${d.telefone_whatsapp}?text=Teste%20de%20conexao%20Almoxarifado%20Inteligente" target="_blank" class="w-full py-2 bg-[#161D2B] hover:bg-[#1E293B] text-white border border-[#334155] rounded-xl text-center text-xs font-mono flex items-center justify-center gap-2 transition-all">
          <svg class="w-4 h-4 text-[#00FF66]" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
          Abrir Conversa Direta
        </a>
      </div>
    `).join('');

  } catch (error) {
    showToast('erro', 'Falha ao carregar destinatários.');
  }
}

// Modal de Disparo WhatsApp Multi-Contato (Gratuito e Imediato)
async function abrirModalDisparoMultiplo(tipo, itemId = null, equipId = null) {
  try {
    const payload = { tipo, item_id: itemId, equipamento_id: equipId };
    const res = await authFetch('/api/alertas/disparar-multiplo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    document.getElementById('preview-mensagem-disparo').innerText = data.mensagem;

    const listaBotoes = document.getElementById('lista-botoes-whatsapp');
    listaBotoes.innerHTML = data.destinatarios.map(dest => `
      <div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-black/40 border border-[#1E293B]">
        <div class="min-w-0 flex-1">
          <span class="font-bold text-white block text-xs">${dest.nome}</span>
          <span class="text-[10px] text-[#94A3B8] font-mono">${dest.cargo} • ${dest.telefone}</span>
        </div>
        <a href="${dest.link_whatsapp}" target="_blank" onclick="showToast('sucesso', 'Link aberto para ${dest.nome}!')" class="px-3 py-1.5 bg-[#00FF66] hover:bg-[#00E65B] text-black font-bold font-mono text-xs rounded-xl flex items-center gap-1.5 shadow-[0_0_10px_rgba(0,255,102,0.3)] whitespace-nowrap">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/></svg>
          ENVIAR WHATSAPP
        </a>
      </div>
    `).join('');

    document.getElementById('modal-disparo').classList.remove('hidden');
  } catch (err) {
    showToast('erro', 'Falha ao processar disparo de alerta.');
  }
}

function testarDisparo4Destinatarios() {
  abrirModalDisparoMultiplo('MANUAL', null, null);
}

// Edição de Destinatário
function abrirModalEdicaoDestinatario(id) {
  const dest = ESTADO.destinatarios.find(d => d.id === id);
  if (!dest) return;

  document.getElementById('edit-dest-id').value = dest.id;
  document.getElementById('edit-dest-nome').value = dest.nome;
  document.getElementById('edit-dest-cargo').value = dest.cargo;
  document.getElementById('edit-dest-whats').value = dest.telefone_whatsapp;
  document.getElementById('edit-dest-email').value = dest.email;

  document.getElementById('modal-editar-destinatario').classList.remove('hidden');
}

async function salvarEdicaoDestinatario(event) {
  event.preventDefault();
  const id = document.getElementById('edit-dest-id').value;
  const payload = {
    nome: document.getElementById('edit-dest-nome').value,
    cargo: document.getElementById('edit-dest-cargo').value,
    telefone_whatsapp: document.getElementById('edit-dest-whats').value,
    email: document.getElementById('edit-dest-email').value,
    ativo: 1
  };

  try {
    const res = await authFetch(`/api/destinatarios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Erro ao salvar contato');

    fecharModal('modal-editar-destinatario');
    showToast('sucesso', 'Contato de emergência atualizado!');
    carregarDestinatarios();
  } catch (err) {
    showToast('erro', err.message);
  }
}

// ============================================================
// MODAL CONTROLLER & TOASTS
// ============================================================
function fecharModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function abrirModalNovoItem() {
  document.getElementById('modal-novo-item').classList.remove('hidden');
}

function abrirModalNovoEquipamento() {
  document.getElementById('modal-novo-equipamento').classList.remove('hidden');
}

function showToast(tipo, mensagem) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');

  const cores = {
    sucesso: 'border-[#00FF66]/50 bg-[#0E1B15] text-[#00FF66]',
    alerta: 'border-amber-500/50 bg-[#1D150B] text-amber-300',
    erro: 'border-red-500/50 bg-[#1D0B0E] text-red-300'
  };

  toast.className = `toast-item border rounded-xl p-3.5 shadow-2xl flex items-center gap-3 text-xs font-mono max-w-sm backdrop-blur-md ${cores[tipo] || cores.sucesso}`;
  toast.innerHTML = `
    <span class="text-base">${tipo === 'sucesso' ? '⚡' : (tipo === 'alerta' ? '⚠️' : '🛑')}</span>
    <span class="flex-1">${mensagem}</span>
    <button onclick="this.parentElement.remove()" class="text-white/60 hover:text-white">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4500);
}

// ============================================================
// ADMINISTRADOR - CONTROLE GERAL (RBAC)
// ============================================================
function abrirModalNovoUsuario() {
  document.getElementById('modal-novo-usuario').classList.remove('hidden');
}

async function carregarAdministrador() {
  await Promise.all([carregarUsuarios(), carregarAuditoria(), carregarBackupStatus(), carregarStatusNuvemAdmin(), carregarStatusAtualizacao()]);
}

async function mostrarVersaoNoTopo() {
  const chip = document.getElementById('chip-versao');
  if (!chip) return;
  try {
    const res = await authFetch('/api/atualizacao/status');
    if (!res.ok) return;
    const dados = await res.json();
    chip.textContent = `· v${dados.versaoAtual}`;
  } catch (e) {}
}

// ============================================================
// EXPORTAÇÃO EM PLANILHA (CSV / Excel) - só do lado do cliente
// ============================================================
function gerarCSV(cabecalhos, linhas) {
  const esc = v => {
    const s = v == null ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const partes = [cabecalhos.map(esc).join(';')];
  for (const l of linhas) partes.push(l.map(esc).join(';'));
  return '\ufeff' + partes.join('\r\n');
}

function baixarArquivo(nome, conteudo, tipo = 'text/csv;charset=utf-8') {
  const blob = new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function hojeNome() {
  return new Date().toISOString().slice(0, 10);
}

function exportarEstoqueCSV() {
  const itens = ESTADO.estoque || [];
  if (itens.length === 0) return showToast('erro', 'Não há itens na lista atual para exportar.');
  const linhas = itens.map(it => [
    it.codigo_id,
    it.nome,
    it.categoria,
    it.localizacao,
    it.quantidade_atual,
    it.quantidade_minima,
    it.unidade_medida,
    'R$ ' + Number(it.preco_estimado).toFixed(2).replace('.', ','),
    it.status_alerta === 'CRITICO' ? 'CRÍTICO' : (it.quantidade_atual <= it.quantidade_minima ? 'BAIXO' : 'OK')
  ]);
  baixarArquivo(`almoxarifado_${hojeNome()}.csv`,
    gerarCSV(['ID / Código', 'Descrição do Material', 'Categoria', 'Localização', 'Saldo Físico', 'Estoque Mínimo', 'Unidade', 'Preço Estimado', 'Status'], linhas));
  showToast('sucesso', `Planilha exportada (${itens.length} itens)!`);
}

function exportarCalibracaoCSV() {
  const equip = ESTADO.equipamentos || [];
  if (equip.length === 0) return showToast('erro', 'Não há equipamentos cadastrados para exportar.');
  const linhas = equip.map(eq => [
    eq.tag_patrimonio,
    `${eq.nome}${eq.modelo ? ' - ' + eq.modelo : ''}`,
    eq.numero_serie,
    eq.fabricante,
    eq.responsavel,
    eq.data_ultima_calibracao,
    eq.data_validade_calibracao,
    (eq.dias_restantes || 0) + ' dias',
    eq.status_calibracao === 'VENCIDO' ? 'VENCIDO (BLOQUEADO)' : (eq.status_calibracao === 'ALERTA_15_DIAS' ? `VENCE EM ${eq.dias_restantes} DIAS` : 'CALIBRADO')
  ]);
  baixarArquivo(`calibracao_${hojeNome()}.csv`,
    gerarCSV(['Patrimônio (TAG)', 'Equipamento / Modelo', 'Nº Série', 'Fabricante', 'Responsável', 'Última Aferição', 'Validade Limite', 'Dias Restantes', 'Status Calibração'], linhas));
  showToast('sucesso', `Planilha exportada (${equip.length} equipamentos)!`);
}

function exportarComprasCSV() {
  const pedidos = ESTADO.compras || [];
  if (pedidos.length === 0) return showToast('erro', 'Não há solicitações para exportar.');
  const linhas = pedidos.map(p => [
    'REQ-' + String(p.id).padStart(4, '0'),
    p.item_nome,
    p.quantidade_atual + ' un',
    p.quantidade_solicitada + ' un',
    p.urgencia,
    formatarDataHora(p.data_solicitacao),
    p.status === 'PENDENTE' ? 'PENDENTE' : (p.status === 'EM_COTACAO' ? 'EM COTAÇÃO' : 'ATENDIDO')
  ]);
  baixarArquivo(`compras_${hojeNome()}.csv`,
    gerarCSV(['ID Pedido', 'Item Solicitado', 'Saldo na Época', 'Qtd Solicitada', 'Urgência', 'Data / Hora', 'Status'], linhas));
  showToast('sucesso', `Planilha exportada (${pedidos.length} solicitações)!`);
}

async function carregarStatusAtualizacao() {
  const badge = document.getElementById('atualizacao-badge');
  const el = document.getElementById('atualizacao-status');
  const btn = document.getElementById('btn-atualizar');
  if (!badge || !el) return;
  try {
    const res = await authFetch('/api/atualizacao/status');
    if (!res.ok) throw new Error('Sem permissão');
    const dados = await res.json();

    if (!dados.conectado) {
      badge.className = 'px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/40';
      badge.textContent = 'SEM NUVEM';
      el.innerHTML = 'Conecte a nuvem (card acima) para poder atualizar o programa por aqui.';
      if (btn) { btn.disabled = true; }
      return;
    }

    if (dados.temAtualizacao) {
      badge.className = 'px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-full border bg-[#38BDF8]/10 text-[#38BDF8] border-[#38BDF8]/40';
      badge.textContent = `NOVA: ${dados.versaoDisponivel}`;
      el.innerHTML = `Versão atual: <b class="text-white">${dados.versaoAtual}</b> · A nova versão <b class="text-[#38BDF8]">${dados.versaoDisponivel}</b> está na nuvem. Clique em <b class="text-white">BAIXAR E ATUALIZAR AGORA</b> para aplicar (o sistema reinicia sozinho).`;
      if (btn) { btn.disabled = false; btn.classList.remove('opacity-40'); }
      return;
    }

    badge.className = 'px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-full border bg-[#00FF66]/10 text-[#00FF66] border-[#00FF66]/40';
    badge.textContent = 'ATUALIZADO';
    el.innerHTML = `Versão atual: <b class="text-white">${dados.versaoAtual}</b>` +
      (dados.versaoDisponivel
        ? ` · Nuvem também na <b class="text-white">${dados.versaoDisponivel}</b> (tudo em dia).`
        : ' · Nenhum pacote de atualização na nuvem ainda.');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-40'); }
  } catch (e) {
    badge.textContent = 'ERRO';
    el.innerText = 'Não foi possível consultar atualizações.';
  }
}

async function verificarAtualizacao() {
  const btn = document.getElementById('btn-atualizar');
  const oldTxt = btn ? btn.textContent : '';
  try {
    await carregarStatusAtualizacao();
    const badge = document.getElementById('atualizacao-badge');
    if (badge && badge.textContent.indexOf('NOVA') === 0) showToast('sucesso', 'Há uma nova versão disponível!');
    else showToast('sucesso', 'Sistema está atualizado.');
  } catch (e) {
    showToast('erro', 'Falha ao verificar atualização.');
  } finally {
    if (btn && btn.textContent !== oldTxt) { btn.textContent = oldTxt; }
  }
}

async function aplicarAtualizacao() {
  if (!confirm('Baixar a nova versão da nuvem e atualizar o sistema agora?\n\nO servidor será reiniciado sozinho (uns 10-15 segundos de pausa).')) return;
  const btn = document.getElementById('btn-atualizar');
  const oldTxt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'ATUALIZANDO...'; }
  try {
    const res = await authFetch('/api/atualizacao/aplicar', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || data.detalhes || 'Falha ao aplicar.');
    showToast('sucesso', data.mensagem);
    setTimeout(() => { window.location.reload(); }, 10000);
  } catch (err) {
    showToast('erro', err.message);
    if (btn) { btn.disabled = false; btn.textContent = oldTxt; }
  }
}

async function carregarStatusNuvemAdmin() {
  const badge = document.getElementById('nuvem-admin-badge');
  const el = document.getElementById('nuvem-admin-status');
  if (!badge || !el) return;
  try {
    const res = await authFetch('/api/nuvem/status');
    if (!res.ok) throw new Error('Sem permissão');
    const dados = await res.json();

    if (!dados.configurado) {
      badge.className = 'px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/40';
      badge.textContent = 'A CONFIGURAR';
      el.innerHTML = 'A nuvem ainda não foi configurada. Cole o <b class="text-white">Client ID</b> e o <b class="text-white">Client Secret</b> abaixo e clique em SALVAR CREDENCIAIS.';
      return;
    }

    if (dados.conectado) {
      badge.className = 'px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-full border bg-[#00FF66]/10 text-[#00FF66] border-[#00FF66]/40';
      badge.textContent = 'CONECTADO';
      const quando = dados.ultimaSincronizacao ? formatarDataHora(dados.ultimaSincronizacao) : '—';
      let txt = `Conta conectada: <b class="text-[#00FF66]">${dados.conta || 'Google'}</b> · Última sincronização: <b class="text-white">${quando}</b>.`;
      if (dados.ultimoErro) txt += `<br><span class="text-red-400">⚠ ${dados.ultimoErro}</span>`;
      el.innerHTML = txt + '<br><span class="text-[#64748B]">Backup automático ativo: toda alteração sobe sozinho para "' + dados.pastaDrive + '" na Drive.</span>';
      return;
    }

    badge.className = 'px-2.5 py-1 text-[9px] font-mono font-bold uppercase rounded-full border bg-[#94A3B8]/10 text-[#94A3B8] border-[#1E293B]';
    badge.textContent = 'DESCONECTADO';
    el.innerHTML = 'Credenciais salvas, mas nenhuma conta conectada ainda. Clique em <b class="text-white">CONECTAR NUVEM</b> para entrar com o Google.';
  } catch (e) {
    badge.textContent = 'ERRO';
    el.innerText = 'Não foi possível consultar o status da nuvem.';
  }
}

async function salvarConfigNuvem() {
  const clientId = document.getElementById('nuvem-client-id').value.trim();
  const clientSecret = document.getElementById('nuvem-client-secret').value.trim();
  if (!clientId || !clientSecret) {
    return showToast('erro', 'Preencha o Client ID e o Client Secret.');
  }
  try {
    const res = await authFetch('/api/nuvem/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha');
    showToast('sucesso', 'Credenciais salvas! Agora conecte a nuvem.');
    document.getElementById('nuvem-client-secret').value = '';
    await carregarStatusNuvemAdmin();
  } catch (err) {
    showToast('erro', err.message);
  }
}

function conectarNuvemAdmin() {
  window.location.href = '/api/nuvem/login';
}

async function enviarNuvemAgora() {
  try {
    const res = await authFetch('/api/nuvem/enviar', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha');
    showToast('sucesso', data.mensagem);
    await carregarStatusNuvemAdmin();
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function restaurarNuvem() {
  if (!confirm('Baixar a versão mais recente do banco da nuvem?\nO arquivo será salvo na pasta backups/ (aplicar exige reiniciar o servidor).')) return;
  try {
    const res = await authFetch('/api/nuvem/restaurar', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha');
    showToast('sucesso', data.mensagem);
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function desconectarNuvem() {
  if (!confirm('Desconectar a conta Google? Os backups não subirão mais para a nuvem até reconectar.')) return;
  try {
    const res = await authFetch('/api/nuvem/desconectar', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha');
    showToast('sucesso', data.mensagem);
    await carregarStatusNuvemAdmin();
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function carregarBackupStatus() {
  const el = document.getElementById('backup-status');
  if (!el) return;
  try {
    const res = await authFetch('/api/backup/status');
    if (!res.ok) throw new Error('Sem permissão');
    const dados = await res.json();
    const tamanho = dados.tamanhoDB ? `(${(dados.tamanhoDB / 1024 / 1024).toFixed(2)} MB)` : '';
    if (dados.ultimoBackup) {
      const quando = formatarDataHora(dados.ultimoBackup.data);
      const tamanhoBK = (dados.ultimoBackup.tamanho / 1024).toFixed(1);
      el.innerHTML = `Último backup: <b class="text-[#00FF66]">${quando}</b> · arquivo <span class="text-white">${dados.ultimoBackup.caminho.split(/[\\/]/).pop()}</span> (${tamanhoBK} KB). Banco atual: <span class="text-white">${tamanho}</span> · cópias guardadas: <span class="text-white">${dados.backupsRecentes ? dados.backupsRecentes.length : 0}</span>`;
    } else {
      el.innerHTML = `Nenhum backup ainda. O primeiro será criado automaticamente ao ligar o servidor. Banco atual: <span class="text-white">${tamanho}</span>`;
    }
  } catch (e) {
    el.innerText = 'Não foi possível consultar o status do backup.';
  }
}

async function gerarBackupAgora() {
  const btn = event.currentTarget;
  btn.disabled = true;
  btn.innerHTML = 'GERANDO...';
  try {
    const res = await authFetch('/api/backup', { method: 'POST' });
    if (!res.ok) throw new Error('Falha');
    showToast('sucesso', 'Backup gerado com sucesso!');
    await carregarBackupStatus();
  } catch (e) {
    showToast('erro', 'Não foi possível gerar o backup.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'GERAR BACKUP AGORA';
  }
}

async function carregarUsuarios() {
  try {
    const res = await authFetch('/api/usuarios');
    const usuarios = await res.json();
    ESTADO.usuarios = usuarios;
    document.getElementById('conta-usuarios').innerText = usuarios.length;

    const tbody = document.getElementById('tabela-usuarios-body');
    tbody.innerHTML = usuarios.map(u => {
      const roleBadge = u.role === 'ADMIN_MASTER'
        ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-extrabold bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40">ADMIN_MASTER</span>`
        : `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/30">${u.role}</span>`;

      const ativoBadge = u.ativo === 1
        ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#00FF66]/20 text-[#00FF66] border border-[#00FF66]/30">ATIVO</span>`
        : `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-extrabold bg-red-500/20 text-red-400 border border-red-500/40">DESATIVADO</span>`;

      const segInfo = u.bloqueado
        ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono font-extrabold bg-red-500/20 text-red-400 border border-red-500/40">BLOQUEADO</span>`
        : (u.tentativas_falhas > 0
          ? `<span class="text-[10px] font-mono text-amber-400">${u.tentativas_falhas} falha(s)</span>`
          : `<span class="text-[10px] font-mono text-[#00FF66]">OK</span>`);

      const roleSelect = u.role === 'ADMIN_MASTER'
        ? `<button onclick="alterarRoleUsuario(${u.id})" class="px-2 py-1 bg-[#F59E0B]/20 hover:bg-[#F59E0B]/40 text-[#F59E0B] rounded text-[11px] font-mono font-bold">${u.role}</button>`
        : `<select onchange="alterarRoleUsuario(${u.id}, this.value)" class="bg-black/50 border border-[#1E293B] rounded-lg px-2 py-1 text-[11px] font-mono text-[#94A3B8]">
            <option value="OPERADOR" ${u.role === 'OPERADOR' ? 'selected' : ''}>OPERADOR</option>
            <option value="COMPRAS" ${u.role === 'COMPRAS' ? 'selected' : ''}>COMPRAS</option>
            <option value="CONSULTA" ${u.role === 'CONSULTA' ? 'selected' : ''}>CONSULTA</option>
          </select>`;

      return `
        <tr class="${u.ativo === 1 ? '' : 'opacity-60'}">
          <td class="py-3 px-4 font-mono text-[#64748B]">#${String(u.id).padStart(3, '0')}</td>
          <td class="py-3 px-4 font-mono text-[#00FF66] font-bold">${u.username}</td>
          <td class="py-3 px-4">
            <span class="font-semibold text-white block">${u.nome_completo}</span>
            <span class="text-[10px] text-[#64748B]">${u.cargo}</span>
          </td>
          <td class="py-3 px-4 text-center">${roleBadge}</td>
          <td class="py-3 px-4 text-center">${ativoBadge}</td>
          <td class="py-3 px-4 text-center">${segInfo}</td>
          <td class="py-3 px-4 text-center font-mono text-[#94A3B8] text-[11px]">${u.ultimo_login ? formatarDataHora(u.ultimo_login) : 'Nunca'}</td>
          <td class="py-3 px-4 text-right">
            <div class="flex items-center justify-end gap-1.5">
              ${u.bloqueado ? `<button onclick="desbloquearUsuario(${u.id})" class="px-2 py-1 bg-[#F59E0B]/20 hover:bg-[#F59E0B]/40 text-[#F59E0B] rounded text-[11px] font-mono font-bold" title="Desbloquear conta">🔓 Desbloquear</button>` : ''}
              <button onclick="alternarAtivoUsuario(${u.id}, ${u.ativo === 1 ? 0 : 1})" class="px-2 py-1 bg-[#1E293B] hover:bg-[#334155] text-white rounded text-[11px] font-mono">${u.ativo === 1 ? 'Desativar' : 'Reativar'}</button>
              ${u.id !== ESTADO.usuariosAtual?.id ? `<button onclick="excluirUsuario(${u.id})" class="px-2 py-1 bg-red-500/15 hover:bg-red-500/30 text-red-400 rounded text-[11px] font-mono" title="Excluir usuário">Excluir</button>` : '<span class="text-[10px] text-[#64748B]">você</span>'}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (error) {
    showToast('erro', 'Falha ao carregar usuários.');
  }
}

async function salvarNovoUsuario(event) {
  event.preventDefault();
  const payload = {
    username: document.getElementById('novo-user-username').value,
    senha: document.getElementById('novo-user-senha').value,
    nome_completo: document.getElementById('novo-user-nome').value,
    cargo: document.getElementById('novo-user-cargo').value,
    role: document.getElementById('novo-user-role').value
  };

  try {
    const res = await authFetch('/api/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.erro || 'Erro ao criar usuário');
    }

    fecharModal('modal-novo-usuario');
    document.getElementById('form-novo-usuario').reset();
    showToast('sucesso', 'Usuário criado com sucesso!');
    carregarAdministrador();
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function alternarAtivoUsuario(id, ativo) {
  try {
    const res = await authFetch(`/api/usuarios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ativo })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.erro || 'Erro na operação');
    }
    showToast('sucesso', ativo ? 'Usuário reativado.' : 'Usuário desativado.');
    carregarAdministrador();
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function alterarRoleUsuario(id, roleNova) {
  const nova = roleNova || prompt('Nova role deste usuário (OPERADOR, COMPRAS, CONSULTA, ADMIN_MASTER):').toUpperCase().trim();
  if (!nova) return;
  try {
    const res = await authFetch(`/api/usuarios/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: nova })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.erro || 'Erro ao alterar permissão');
    }
    showToast('sucesso', 'Permissão atualizada.');
    carregarAdministrador();
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function desbloquearUsuario(id) {
  try {
    const res = await authFetch(`/api/usuarios/${id}/desbloquear`, { method: 'POST' });
    if (!res.ok) throw new Error('Erro ao desbloquear');
    showToast('sucesso', 'Conta desbloqueada.');
    carregarAdministrador();
  } catch (e) {
    showToast('erro', 'Falha ao desbloquear conta.');
  }
}

async function excluirUsuario(id) {
  if (!confirm('Excluir permanentemente este usuário e todas as suas sessões?')) return;
  try {
    const res = await authFetch(`/api/usuarios/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.erro || 'Erro ao excluir');
    }
    showToast('sucesso', 'Usuário excluído.');
    carregarAdministrador();
  } catch (err) {
    showToast('erro', err.message);
  }
}

async function carregarAuditoria() {
  try {
    const res = await authFetch('/api/auditoria');
    const logs = await res.json();
    ESTADO.auditoria = logs;

    const tbody = document.getElementById('tabela-auditoria-body');
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-xs text-[#64748B] font-mono">Nenhum evento de segurança registrado.</td></tr>`;
      return;
    }

    const coresEvento = {
      'LOGIN_SUCESSO': 'text-[#00FF66]',
      'LOGIN_FALHA': 'text-amber-400',
      'BLOQUEIO_BRUTE_FORCE': 'text-red-400 font-extrabold',
      'LOGIN_BLOQUEADO': 'text-red-400',
      'LOGIN_DESATIVADO': 'text-red-400',
      'LOGOUT': 'text-[#94A3B8]',
      'ACESSO_NEGADO': 'text-red-400',
      'CRIACAO_USUARIO': 'text-[#38BDF8]',
      'EDICAO_USUARIO': 'text-[#38BDF8]',
      'EXCLUSAO_USUARIO': 'text-red-400',
      'RESET_SENHA': 'text-[#F59E0B]',
      'DESBLOQUEIO_MANUAL': 'text-[#00FF66]',
      'ESTOQUE_CADASTRO': 'text-[#00FF66]',
      'ESTOQUE_EDICAO': 'text-[#38BDF8]',
      'ESTOQUE_MOVIMENTO': 'text-[#F59E0B]',
      'ESTOQUE_EXCLUSAO': 'text-red-400',
      'EQUIP_CADASTRO': 'text-[#00FF66]',
      'EQUIP_EDICAO': 'text-[#38BDF8]',
      'EQUIP_EXCLUSAO': 'text-red-400',
      'COMPRA_CRIACAO': 'text-[#38BDF8]',
      'COMPRA_STATUS': 'text-[#F59E0B]',
      'COMPRA_FEEDBACK': 'text-[#94A3B8]',
      'DESTINATARIO_EDICAO': 'text-[#F59E0B]',
      'DISPARO_ALERTA': 'text-red-400',
      'OBSERVACAO_PUBLICADA': 'text-[#00FF66]',
      'OBSERVACAO_APAGADA': 'text-red-400',
      'OBSERVACAO_STATUS': 'text-[#F59E0B]',
      'BACKUP_DB': 'text-[#00FF66]'
    };

    tbody.innerHTML = logs.map(l => `
      <tr class="hover:bg-white/5">
        <td class="py-2.5 px-4 font-mono text-[11px] text-[#64748B]">${formatarDataHora(l.data_hora)}</td>
        <td class="py-2.5 px-4 font-mono text-[11px] text-white">${l.nome_registrado || l.username_tentativa || '—'}</td>
        <td class="py-2.5 px-4">
          <span class="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-black/40 border border-[#1E293B] ${coresEvento[l.evento] || 'text-[#94A3B8]'}">${l.evento}</span>
        </td>
        <td class="py-2.5 px-4 font-mono text-[11px] text-[#64748B]">${l.ip || '—'}</td>
        <td class="py-2.5 px-4 text-[11px] text-[#94A3B8]">${l.detalhes || ''}</td>
      </tr>
    `).join('');
  } catch (error) {
    showToast('erro', 'Falha ao carregar auditoria.');
  }
}

// Inicialização automática ao carregar página
document.addEventListener('DOMContentLoaded', async () => {
  iniciarRelogioBrasilia();
  mostrarVersaoNoTopo();
  const usuario = await verificarSessao();
  if (usuario) {
    ESTADO.usuariosAtual = { id: usuario.id, role: usuario.role };
    renderizarIdentidade(usuario);
    carregarDashboard();
    carregarCategorias();
    atualizarBadges();
    mostrarVersaoNoTopo();
    // Atualização automática do sininho e balão de mensagens
    setInterval(atualizarBadges, 10000);
    // Detector de nova versão: você no controle (recarrega sozinho ao mudar algo)
    verificarNovasVersoes();
    setInterval(verificarNovasVersoes, 15000);
    document.addEventListener('click', (e) => {
      const painel = document.getElementById('painel-notificacoes');
      const btnSininho = e.target.closest('button[title="Notificações do sistema"]');
      const emAberto = ESTADO.notifAberto;
      if (emAberto && !btnSininho && !e.target.closest('#painel-notificacoes')) {
        fecharPainelNotificacoes();
      }
    });
  }
});

// ============================================================
// RELÓGIO DE BRASÍLIA AO VIVO (cabeçalho)
// ============================================================
function iniciarRelogioBrasilia() {
  const elHora = document.getElementById('relogio-hora');
  const elData = document.getElementById('relogio-data');
  if (!elHora) return;

  const fmtHora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const fmtData = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });

  function atualizar() {
    const agora = new Date();
    elHora.textContent = fmtHora.format(agora);
    if (elData) elData.textContent = `Brasília · ${fmtData.format(agora)}`;
  }

  atualizar();
  setInterval(atualizar, 1000);
}

async function verificarNovasVersoes() {
  try {
    const res = await authFetch('/api/versao');
    if (!res.ok) return;
    const dados = await res.json();
    if (ESTADO.versaoAtual && ESTADO.versaoAtual !== dados.versao && !ESTADO.atualizandoApp) {
      ESTADO.atualizandoApp = true;
      const quando = formatarDataHora(dados.atualizado_em);
      const painel = document.getElementById('painel-versao');
      if (painel) {
        painel.classList.remove('hidden');
        document.getElementById('versao-explicacao').innerText = `Alterações aplicadas em ${quando}.`;
      }
      setTimeout(() => window.location.reload(), 6000);
    } else {
      ESTADO.versaoAtual = dados.versao;
    }
  } catch (e) {}
}

// ============================================================
// SININHO DE NOTIFICAÇÕES + BALÃO DE MENSAGENS
// ============================================================
function alternarPainelNotificacoes() {
  const painel = document.getElementById('painel-notificacoes');
  if (painel.classList.contains('hidden')) {
    painel.classList.remove('hidden');
    ESTADO.notifAberto = true;
    carregarNotificacoes();
  } else {
    fecharPainelNotificacoes();
  }
}

function fecharPainelNotificacoes() {
  document.getElementById('painel-notificacoes').classList.add('hidden');
  ESTADO.notifAberto = false;
  marcarNotificacoesLidas();
}

function abrirChatDaNotificacao() {
  fecharPainelNotificacoes();
  trocarAba('chat');
  carregarChat();
}

async function carregarNotificacoes() {
  try {
    const res = await authFetch('/api/notificacoes');
    if (!res.ok) throw new Error('Falha');
    const dados = await res.json();
    ESTADO.notifDados = dados;

    const badge = document.getElementById('badge-sininho');
    if (dados.naoLidas > 0) {
      badge.classList.remove('hidden');
      badge.innerText = dados.naoLidas > 99 ? '99+' : dados.naoLidas;
    } else {
      badge.classList.add('hidden');
    }

    const contador = document.getElementById('painel-notif-contador');
    const lista = document.getElementById('painel-notif-lista');

    if (!dados.notificacoes || dados.notificacoes.length === 0) {
      lista.innerHTML = `<p class="text-xs text-[#64748B] font-mono py-8 text-center">Nenhuma alteração registrada ainda.</p>`;
      contador.innerText = '0';
      return;
    }

    contador.innerText = `${dados.notificacoes.length} mostradas${dados.naoLidas > 0 ? ` · ${dados.naoLidas} novas` : ''}`;
    lista.innerHTML = dados.notificacoes.map(n => {
      const segura = escaparHTML(n.detalhes || n.evento);
      const quem = n.username_tentativa ? ` · <b class="text-[#94A3B8]">${escaparHTML(n.username_tentativa)}</b>` : '';
      return `
        <div class="px-4 py-3 hover:bg-white/5 transition-colors ${n.id > dados.ultimoLidoId ? 'bg-[#38BDF8]/5 border-l-2 border-l-[#38BDF8]' : ''}">
          <div class="flex items-start gap-2.5">
            <span class="mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${corEventoNotif(n.evento)}"></span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-[10px] font-mono flex-wrap">
                <span class="font-bold text-white uppercase tracking-wider">${escaparHTML(n.evento.replace(/_/g, ' '))}</span>
                <span class="text-[#64748B] ml-auto">${tempoRelativo(n.criado_em)}</span>
              </div>
              <p class="mt-1 text-xs text-[#E2E8F0] leading-relaxed break-words">${segura}${quem}</p>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    document.getElementById('painel-notif-lista').innerHTML = `<p class="text-xs text-red-400 font-mono py-8 text-center">Falha ao carregar notificações.</p>`;
  }
}

async function marcarNotificacoesLidas(ultimoId) {
  const dados = ESTADO.notifDados;
  if (!dados) return;
  const id = ultimoId || dados.notificacoes?.[0]?.id || dados.ultimoLidoId;
  if (!id || id <= dados.ultimoLidoId) return;
  try {
    await authFetch('/api/notificacoes/lidas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ultimoId: id })
    });
    dados.naoLidas = 0;
    dados.ultimoLidoId = id;
    document.getElementById('badge-sininho').classList.add('hidden');
  } catch (e) {}
}

function corEventoNotif(evento) {
  const cores = {
    'ESTOQUE_CADASTRO': 'bg-[#00FF66]', 'ESTOQUE_EDICAO': 'bg-[#38BDF8]', 'ESTOQUE_MOVIMENTO': 'bg-amber-400', 'ESTOQUE_EXCLUSAO': 'bg-red-500',
    'EQUIP_CADASTRO': 'bg-[#00FF66]', 'EQUIP_EDICAO': 'bg-[#38BDF8]', 'EQUIP_EXCLUSAO': 'bg-red-500',
    'COMPRA_CRIACAO': 'bg-[#38BDF8]', 'COMPRA_STATUS': 'bg-amber-400', 'COMPRA_FEEDBACK': 'bg-[#94A3B8]',
    'OBSERVACAO_PUBLICADA': 'bg-[#00FF66]', 'OBSERVACAO_STATUS': 'bg-amber-400', 'OBSERVACAO_APAGADA': 'bg-red-500',
    'DESTINATARIO_EDICAO': 'bg-amber-400', 'DISPARO_ALERTA': 'bg-red-500', 'BACKUP_DB': 'bg-[#00FF66]',
    'CRIACAO_USUARIO': 'bg-[#38BDF8]', 'EDICAO_USUARIO': 'bg-[#38BDF8]', 'EXCLUSAO_USUARIO': 'bg-red-500',
    'RESET_SENHA': 'bg-amber-400', 'DESBLOQUEIO_MANUAL': 'bg-[#00FF66]', 'BLOQUEIO_BRUTE_FORCE': 'bg-red-500'
  };
  return cores[evento] || 'bg-[#38BDF8]';
}

function tempoRelativo(valor) {
  try {
    let d;
    if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(valor)) {
      d = new Date(valor.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(valor);
    }
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min atrás`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs} h atrás`;
    const dias = Math.floor(hrs / 24);
    return `${dias} d atrás`;
  } catch (e) {
    return '';
  }
}

// ============================================================
// CHAT PRIVADO (MENSAGENS 1-A-1)
// ============================================================
async function carregarChat() {
  const busca = (document.getElementById('chat-busca')?.value || '').toLowerCase().trim();

  try {
    const res = await authFetch('/api/chat/contatos');
    const contatos = await res.json();

    const lista = document.getElementById('chat-lista-contatos');
    const filtrados = busca
      ? contatos.filter(c => (c.nome_completo || '').toLowerCase().includes(busca) || (c.username || '').toLowerCase().includes(busca))
      : contatos;

    if (filtrados.length === 0) {
      lista.innerHTML = `<p class="text-xs text-[#64748B] font-mono py-8 text-center">Nenhum funcionário encontrado.</p>`;
    } else {
      lista.innerHTML = filtrados.map(c => {
        const inicial = (c.nome_completo || c.username || '?').trim().charAt(0).toUpperCase();
        const ativo = ESTADO.chatContatoAtivo === c.id;
        const previsu = c.ultima_mensagem ? c.ultima_mensagem : 'Nenhuma mensagem ainda';
        return `
          <button onclick="abrirConversa(${c.id})" class="w-full text-left px-3 py-3 hover:bg-white/5 transition-colors flex items-center gap-3 ${ativo ? 'bg-[#38BDF8]/10 border-l-2 border-l-[#38BDF8]' : ''}">
            <div class="w-9 h-9 rounded-full bg-[#38BDF8]/20 text-[#38BDF8] border border-[#38BDF8]/40 flex items-center justify-center font-bold font-mono text-sm flex-shrink-0">${inicial}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-white font-mono truncate">${escaparHTML(c.nome_completo || c.username)}</span>
                ${c.nao_lidas > 0 ? `<span class="px-1.5 py-0.5 rounded-full bg-[#38BDF8] text-black text-[10px] font-bold font-mono flex-shrink-0">${c.nao_lidas}</span>` : ''}
              </div>
              <span class="text-[10px] text-[#64748B] font-mono block truncate mt-0.5">${c.cargo}</span>
              <span class="text-[10px] font-mono ${c.ultima_mensagem ? 'text-[#94A3B8]' : 'text-[#475569]'} block truncate mt-0.5">${escaparHTML(c.ultima_mensagem || 'Toque para iniciar a conversa')}</span>
            </div>
          </button>
        `;
      }).join('');
    }

    // Se há contato ativo, recarrega a conversa (atualização automática)
    if (ESTADO.chatContatoAtivo) {
      const inputFocado = document.activeElement === document.getElementById('chat-mensagem-input');
      if (!inputFocado) carregarConversa(ESTADO.chatContatoAtivo);
    }
  } catch (e) {
    document.getElementById('chat-lista-contatos').innerHTML = `<p class="text-xs text-red-400 font-mono py-8 text-center">Falha ao carregar contatos.</p>`;
  }
}

async function abrirConversa(id) {
  ESTADO.chatContatoAtivo = id;
  document.getElementById('chat-cabecalho').classList.add('flex');
  document.getElementById('chat-cabecalho').classList.remove('hidden');
  document.getElementById('chat-form-envio').classList.remove('hidden');
  carregarChat();
}

async function carregarConversa(id) {
  try {
    const res = await authFetch(`/api/chat/${id}`);
    if (!res.ok) throw new Error('Falha');
    const dados = await res.json();

    const inicial = (dados.outro.nome_completo || dados.outro.username || '?').trim().charAt(0).toUpperCase();
    document.getElementById('chat-contato-avatar').innerText = inicial;
    document.getElementById('chat-contato-nome').innerText = dados.outro.nome_completo || dados.outro.username;
    document.getElementById('chat-contato-cargo').innerText = dados.outro.username + ' · ' + (dados.outro.role || '');

    const area = document.getElementById('chat-mensagens');
    const estavaNoFim = area.scrollHeight - area.scrollTop - area.clientHeight < 80;
    const antes = area.querySelectorAll('[data-msg-id]').length;

    if (dados.mensagens.length === 0) {
      area.innerHTML = `<div class="h-full flex items-center justify-center"><p class="text-xs text-[#64748B] font-mono text-center">Inicie a conversa com ${escaparHTML(dados.outro.nome_completo || dados.outro.username)}!</p></div>`;
    } else {
      area.innerHTML = dados.mensagens.map(m => {
        const minha = m.remetente_id === ESTADO.usuariosAtual?.id;
        const temFoto = !!m.imagem;
        return `
          <div data-msg-id="${m.id}" class="flex ${minha ? 'justify-end' : 'justify-start'}">
            <div class="max-w-[70%] px-3.5 py-2.5 rounded-2xl ${minha
              ? 'bg-[#38BDF8] text-black rounded-br-sm'
              : 'bg-[#0E131F] border border-[#1E293B] text-[#E2E8F0] rounded-bl-sm'}">
              ${temFoto ? `<img src="${m.imagem}" loading="lazy" alt="foto enviada" class="block max-w-[240px] max-h-[260px] w-full h-auto object-cover rounded-xl cursor-pointer ${m.mensagem ? 'mb-2' : ''}" onclick="window.open('${m.imagem}','_blank')">` : ''}
              ${m.mensagem ? `<p class="text-xs font-mono whitespace-pre-wrap break-words">${escaparHTML(m.mensagem)}</p>` : ''}
              <p class="text-[9px] font-mono mt-1 ${minha ? 'text-black/60' : 'text-[#64748B]'} flex items-center gap-1">
                ${formatarDataHora(m.criado_em)}
                ${minha && m.lida === 1 ? '<span class="text-black/70">●</span>' : ''}
              </p>
            </div>
          </div>
        `;
      }).join('');
    }

    // Marca como lidas as mensagens do contato aberto
    await authFetch(`/api/chat/${id}/lidas`, { method: 'POST' });

    // Rola para o fim apenas se era o caso (não atrapalha a leitura)
    if (estavaNoFim || antes === 0) {
      area.scrollTop = area.scrollHeight;
    }

    atualizarBadgeBalaoMsg();
  } catch (e) {
    document.getElementById('chat-mensagens').innerHTML = `<p class="text-xs text-red-400 font-mono py-8 text-center">Falha ao carregar conversa.</p>`;
  }
}

async function enviarMensagem(event) {
  event.preventDefault();
  const input = document.getElementById('chat-mensagem-input');
  const texto = input.value.trim();
  const id = ESTADO.chatContatoAtivo;
  if ((!texto && !CHAT_IMAGEM) || !id) return;

  try {
    const res = await authFetch(`/api/chat/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensagem: texto, imagem_base64: CHAT_IMAGEM })
    });
    if (!res.ok) {
      const dados = await res.json().catch(() => ({}));
      throw new Error(dados.erro || 'Falha');
    }
    input.value = '';
    removerImagemChat();
    carregarConversa(id);
    carregarChat();
  } catch (e) {
    alert(e.message || 'Não foi possível enviar a mensagem/foto.');
  }
}

// ============================================================
// ENVIO DE FOTO NO CHAT (4 MB máx, PNG/JPG/WEBP/GIF)
// ============================================================
function selecionarImagemChat(event) {
  const arquivo = event.target.files && event.target.files[0];
  if (!arquivo) return;

  if (!arquivo.type.startsWith('image/')) {
    alert('Selecione apenas arquivos de imagem.');
    event.target.value = '';
    return;
  }
  if (arquivo.size > 5 * 1024 * 1024) {
    alert('Foto muito grande: máximo de 5 MB.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    CHAT_IMAGEM = reader.result;
    const prev = document.getElementById('chat-imagem-preview');
    prev.innerHTML = `
      <div class="relative inline-block">
        <img src="${reader.result}" class="h-16 w-16 object-cover rounded-xl border border-[#38BDF8]/50 shadow-lg" alt="pré-visualização">
        <button type="button" onclick="removerImagemChat()" title="Remover foto"
          class="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-black text-xs font-bold flex items-center justify-center hover:bg-red-400 transition-colors">✕</button>
      </div>`;
    prev.classList.remove('hidden');
  };
  reader.readAsDataURL(arquivo);
}

function removerImagemChat() {
  CHAT_IMAGEM = null;
  const prev = document.getElementById('chat-imagem-preview');
  if (prev) {
    prev.classList.add('hidden');
    prev.innerHTML = '';
  }
  const input = document.getElementById('chat-imagem-input');
  if (input) input.value = '';
}

async function atualizarBadgeBalaoMsg() {
  try {
    const res = await authFetch('/api/chat/naolidas/total');
    const dados = await res.json();
    const badge = document.getElementById('badge-balao-msg');
    if (dados.total > 0) {
      badge.classList.remove('hidden');
      badge.innerText = dados.total > 99 ? '99+' : dados.total;
    } else {
      badge.classList.add('hidden');
    }
    const badgeAba = document.getElementById('badge-chat-naolido');
    if (badgeAba) {
      badgeAba.classList.toggle('hidden', !(dados.total > 0));
      badgeAba.innerText = dados.total;
    }
  } catch (e) {}
}

async function atualizarBadges() {
  atualizarBadgeBalaoMsg();
  try {
    const res = await authFetch('/api/notificacoes');
    if (!res.ok) throw new Error('Falha');
    const dados = await res.json();
    ESTADO.notifDados = dados;
    const badge = document.getElementById('badge-sininho');
    if (dados.naoLidas > 0) {
      badge.classList.remove('hidden');
      badge.innerText = dados.naoLidas > 99 ? '99+' : dados.naoLidas;
    } else {
      badge.classList.add('hidden');
    }
    // Atualiza a lista se o painel estiver aberto
    if (ESTADO.notifAberto) {
      carregarNotificacoes();
    }
  } catch (e) {}
}

