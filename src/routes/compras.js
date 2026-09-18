'use strict';

// ============================================================
// COMPRAS, DESTINATÁRIOS E CENTRAL DE ALERTAS
// ============================================================

const express = require('express');
const { db } = require('../database');
const { obterIp, registrarLog, msgErroInterno } = require('../auth');
const { enriquecerItemEstoque, enriquecerEquipamento } = require('../helpers');

const router = express.Router();

// ==========================================================
// SOLICITAÇÕES DE COMPRAS
// ==========================================================

// Listar solicitações
router.get('/compras', async (req, res) => {
  try {
    const solicitacoes = await db
      .prepare('SELECT * FROM solicitacoes_compras ORDER BY data_solicitacao DESC')
      .all();
    res.json(solicitacoes);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao buscar solicitações', detalhes: msgErroInterno(error) });
  }
});

// Criar solicitação de compras com disparo de alerta
router.post('/compras', async (req, res) => {
  try {
    const { item_id, quantidade_solicitada, urgencia, observacao, solicitante, setor } = req.body;

    const item = await db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(Number(item_id));
    if (!item) {
      return res.status(404).json({ erro: 'Item de estoque não encontrado' });
    }

    const nova = await db
      .prepare(
        `
        INSERT INTO solicitacoes_compras
        (item_id, item_nome, quantidade_atual, quantidade_solicitada, urgencia, solicitante, setor, observacao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `
      )
      .get(
        item.id,
        item.nome,
        item.quantidade_atual,
        Number(quantidade_solicitada) || 100,
        urgencia || 'ALTA',
        solicitante || 'Almoxarifado Inteligente',
        setor || 'Almoxarifado Inteligente',
        observacao ||
          `Disparo automático de reposição. Saldo atual: ${item.quantidade_atual} ${item.unidade_medida}`
      );

    const novaSolicitacao = await db
      .prepare('SELECT * FROM solicitacoes_compras WHERE id = ?')
      .get(nova.id);

    // Registra no histórico de alertas
    await db
      .prepare(
        `
        INSERT INTO historico_alertas (tipo, origem_id, titulo, mensagem)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(
        'SOLICITACAO_COMPRA',
        novaSolicitacao.id,
        `Nova Solicitação de Compra: ${item.nome}`,
        `Solicitado lote de ${quantidade_solicitada} ${item.unidade_medida}. Urgência: ${urgencia || 'ALTA'}. Saldo atual: ${item.quantidade_atual}.`
      );

    await registrarLog(
      'COMPRA_CRIACAO',
      req.usuario.id,
      req.usuario.username,
      `Solicitou compra de "${item.nome}" x${quantidade_solicitada} (${urgencia || 'ALTA'})`,
      obterIp(req)
    );

    res.status(201).json(novaSolicitacao);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao emitir solicitação de compra', detalhes: msgErroInterno(error) });
  }
});

// Alterar status da solicitação
router.patch('/compras/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    await db.prepare('UPDATE solicitacoes_compras SET status = ? WHERE id = ?').run(status, id);
    const atualizado = await db.prepare('SELECT * FROM solicitacoes_compras WHERE id = ?').get(id);
    await registrarLog(
      'COMPRA_STATUS',
      req.usuario.id,
      req.usuario.username,
      `Alterou status da solicitação #REQ-${String(id).padStart(4, '0')} (${atualizado?.item_nome}) para ${status}`,
      obterIp(req)
    );
    res.json(atualizado);
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao atualizar status', detalhes: msgErroInterno(error) });
  }
});

// Atualizar feedback do setor de compras e motivo da espera
router.patch('/compras/:id/feedback', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { feedback_compras, status } = req.body;

    if (status) {
      await db
        .prepare('UPDATE solicitacoes_compras SET feedback_compras = ?, status = ? WHERE id = ?')
        .run(feedback_compras, status, id);
    } else {
      await db
        .prepare('UPDATE solicitacoes_compras SET feedback_compras = ? WHERE id = ?')
        .run(feedback_compras, id);
    }

    const atualizado = await db.prepare('SELECT * FROM solicitacoes_compras WHERE id = ?').get(id);
    await registrarLog(
      'COMPRA_FEEDBACK',
      req.usuario.id,
      req.usuario.username,
      `Atualizou feedback da solicitação #REQ-${String(id).padStart(4, '0')}${status ? ` (status ${status})` : ''}`,
      obterIp(req)
    );
    res.json(atualizado);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Erro ao atualizar feedback de compras', detalhes: msgErroInterno(error) });
  }
});

// ==========================================================
// DESTINATÁRIOS DE ALERTA
// ==========================================================

// Listar os destinatários
router.get('/destinatarios', async (req, res) => {
  try {
    const destinatarios = await db
      .prepare('SELECT * FROM destinatarios_notificacao ORDER BY id ASC')
      .all();
    res.json(destinatarios);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao buscar destinatários', detalhes: msgErroInterno(error) });
  }
});

// Atualizar dados de um destinatário (ex: telefone WhatsApp real ou e-mail)
router.put('/destinatarios/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, cargo, telefone_whatsapp, email, ativo } = req.body;

    await db
      .prepare(
        `
        UPDATE destinatarios_notificacao
        SET nome = ?, cargo = ?, telefone_whatsapp = ?, email = ?, ativo = ?
        WHERE id = ?
      `
      )
      .run(nome, cargo, telefone_whatsapp.replace(/\D/g, ''), email, ativo ? 1 : 0, id);

    const atualizado = await db
      .prepare('SELECT * FROM destinatarios_notificacao WHERE id = ?')
      .get(id);
    await registrarLog(
      'DESTINATARIO_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Atualizou contato "${atualizado?.nome || id}" (cargo ${atualizado?.cargo || ''})`,
      obterIp(req)
    );
    res.json(atualizado);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao atualizar destinatário', detalhes: msgErroInterno(error) });
  }
});

// ==========================================================
// CENTRAL DE INTELIGÊNCIA & DISPARO DE ALERTAS
// ==========================================================

// Resumo geral do dashboard (KPIs em tempo real)
router.get('/alertas/resumo', async (req, res) => {
  try {
    const todosItens = (await db.prepare('SELECT * FROM estoque_itens').all()).map(
      enriquecerItemEstoque
    );
    const todosEquips = (await db.prepare('SELECT * FROM equipamentos_calibracao').all()).map(
      enriquecerEquipamento
    );

    const itensCriticos = todosItens.filter(i => i.status_alerta === 'CRITICO');
    const equipsAlerta15 = todosEquips.filter(e => e.status_calibracao === 'ALERTA_15_DIAS');
    const equipsVencidos = todosEquips.filter(e => e.status_calibracao === 'VENCIDO');
    const comprasPendentes = (
      await db
        .prepare("SELECT COUNT(*) as total FROM solicitacoes_compras WHERE status = 'PENDENTE'")
        .get()
    ).total;

    res.json({
      total_itens_estoque: todosItens.length,
      itens_estoque_critico: itensCriticos.length,
      total_equipamentos: todosEquips.length,
      equipamentos_alerta_15_dias: equipsAlerta15.length,
      equipamentos_vencidos: equipsVencidos.length,
      solicitacoes_compras_pendentes: comprasPendentes,
      itens_criticos_lista: itensCriticos.slice(0, 5),
      equipamentos_criticos_lista: [...equipsVencidos, ...equipsAlerta15].slice(0, 5),
    });
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Erro ao gerar resumo de alertas', detalhes: msgErroInterno(error) });
  }
});

// Endpoint de disparo de notificação para os destinatários ativos
router.post('/alertas/disparar-multiplo', async (req, res) => {
  try {
    const { tipo, item_id, equipamento_id, mensagem_customizada } = req.body;

    const destinatariosAtivos = await db
      .prepare('SELECT * FROM destinatarios_notificacao WHERE ativo = 1')
      .all();

    let titulo = '';
    let corpoMensagem = '';

    if (tipo === 'ESTOQUE_BAIXO' && item_id) {
      const item = await db
        .prepare('SELECT * FROM estoque_itens WHERE id = ?')
        .get(Number(item_id));
      if (!item) return res.status(404).json({ erro: 'Item não encontrado' });
      titulo = `🚨 ALERTA CRÍTICO: ESTOQUE BAIXO - ${item.nome}`;
      corpoMensagem =
        `*ALMOXARIFADO INTELIGENTE - ALERTA DE ALMOXARIFADO*\n\n` +
        `📦 *Item:* ${item.nome}\n` +
        `🔖 *ID/Código:* ${item.codigo_id}\n` +
        `📍 *Localização:* ${item.localizacao}\n` +
        `⚠️ *Saldo Físico:* ${item.quantidade_atual} ${item.unidade_medida}\n` +
        `🛑 *Limite Mínimo:* ${item.quantidade_minima} ${item.unidade_medida}\n\n` +
        `Ação imediata necessária: Solicitar reposição urgente junto ao setor de Compras.`;
    } else if (tipo === 'CALIBRACAO' && equipamento_id) {
      const equip = await db
        .prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?')
        .get(Number(equipamento_id));
      if (!equip) return res.status(404).json({ erro: 'Equipamento não encontrado' });
      const equipEnriquecido = enriquecerEquipamento(equip);
      titulo = `⚡ ALERTA DE METROLOGIA: CALIBRAÇÃO - ${equip.nome}`;
      corpoMensagem =
        `*ALMOXARIFADO INTELIGENTE - ALERTA DE CALIBRAÇÃO*\n\n` +
        `🔬 *Equipamento:* ${equip.nome}\n` +
        `🏷️ *Patrimônio:* ${equip.tag_patrimonio}\n` +
        `⚙️ *Modelo:* ${equip.fabricante} ${equip.modelo}\n` +
        `📅 *Vencimento:* ${equip.data_validade_calibracao}\n` +
        `⏳ *Prazo Restante:* ${equipEnriquecido.dias_restantes} dias (${equipEnriquecido.status_calibracao})\n` +
        `👤 *Responsável:* ${equip.responsavel}\n\n` +
        `Ação necessária: Agendar recalibração imediata com laboratório credenciado.`;
    } else {
      titulo = 'ALERTA GERAL DO SISTEMA';
      corpoMensagem =
        mensagem_customizada || 'Alerta operacional disparado pelo gestor do Almoxarifado.';
    }

    // Gera links universais do WhatsApp para cada um dos destinatários
    const disparos = destinatariosAtivos.map(dest => {
      const encodedMsg = encodeURIComponent(corpoMensagem);
      const whatsappLink = `https://wa.me/${dest.telefone_whatsapp}?text=${encodedMsg}`;

      return {
        id: dest.id,
        nome: dest.nome,
        cargo: dest.cargo,
        telefone: dest.telefone_whatsapp,
        email: dest.email,
        link_whatsapp: whatsappLink,
      };
    });

    // Registra disparo no histórico
    await db
      .prepare(
        `
        INSERT INTO historico_alertas (tipo, origem_id, titulo, mensagem)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(tipo || 'MANUAL', item_id || equipamento_id || null, titulo, corpoMensagem);

    await registrarLog(
      'DISPARO_ALERTA',
      req.usuario.id,
      req.usuario.username,
      `Disparou alerta ${tipo || 'MANUAL'} para ${disparos.length} destinatário(s): ${titulo}`,
      obterIp(req)
    );

    res.json({
      sucesso: true,
      titulo,
      mensagem: corpoMensagem,
      total_destinatarios: disparos.length,
      destinatarios: disparos,
    });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao disparar alertas', detalhes: msgErroInterno(error) });
  }
});

module.exports = router;
