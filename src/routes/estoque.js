'use strict';

// ============================================================
// ESTOQUE & CATEGORIAS (ALMOXARIFADO)
// ============================================================

const express = require('express');
const { db } = require('../database');
const { obterIp, registrarLog, msgErroInterno } = require('../auth');
const { eErroUnico, enriquecerItemEstoque } = require('../helpers');

const router = express.Router();

// ==========================================================
// ITENS DE ESTOQUE
// ==========================================================

// Listar todos os itens com status
router.get('/estoque', async (req, res) => {
  try {
    const { busca, categoria, apenas_criticos } = req.query;
    let query = 'SELECT * FROM estoque_itens WHERE 1=1';
    const params = [];

    if (busca) {
      query += ' AND (nome LIKE ? OR codigo_id LIKE ? OR localizacao LIKE ?)';
      params.push(`%${busca}%`, `%${busca}%`, `%${busca}%`);
    }

    if (categoria && categoria !== 'TODAS') {
      query += ' AND categoria = ?';
      params.push(categoria);
    }

    query += ' ORDER BY (quantidade_atual <= quantidade_minima) DESC, nome ASC';

    const itens = (await db.prepare(query).all(...params)).map(enriquecerItemEstoque);

    if (apenas_criticos === 'true') {
      return res.json(itens.filter(i => i.status_alerta === 'CRITICO'));
    }

    res.json(itens);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar estoque', detalhes: msgErroInterno(error) });
  }
});

// Cadastrar novo item de estoque
router.post('/estoque', async (req, res) => {
  try {
    const {
      codigo_id,
      codigo_sku,
      nome,
      categoria,
      quantidade_atual,
      quantidade_minima,
      unidade_medida,
      localizacao,
      preco_estimado,
    } = req.body;
    const codFinal = (codigo_id || codigo_sku || '').toUpperCase().trim();

    if (!codFinal || !nome || !categoria) {
      return res.status(400).json({ erro: 'Campos obrigatórios: codigo_id, nome, categoria' });
    }

    const novo = await db
      .prepare(
        `
      INSERT INTO estoque_itens
      (codigo_id, nome, categoria, quantidade_atual, quantidade_minima, unidade_medida, localizacao, preco_estimado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `
      )
      .get(
        codFinal,
        nome.trim(),
        categoria.trim(),
        Number(quantidade_atual) || 0,
        Number(quantidade_minima) || 20,
        (unidade_medida || 'UN').toUpperCase().trim(),
        localizacao || 'Almoxarifado Inteligente',
        Number(preco_estimado) || 0.0
      );

    const novoItem = await db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(novo.id);
    await registrarLog(
      'ESTOQUE_CADASTRO',
      req.usuario.id,
      req.usuario.username,
      `Cadastrou item "${novoItem.nome}" (${codFinal}) qtd ${novoItem.quantidade_atual} ${novoItem.unidade_medida}`,
      obterIp(req)
    );
    res.status(201).json(enriquecerItemEstoque(novoItem));
  } catch (error) {
    if (eErroUnico(error)) {
      return res.status(409).json({ erro: 'ID / Código já cadastrado no sistema' });
    }
    res.status(500).json({ erro: 'Erro ao cadastrar item', detalhes: msgErroInterno(error) });
  }
});

// Movimentação rápida de estoque (+ ou - unidades)
router.patch('/estoque/:id/movimento', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { delta, motivo } = req.body;

    if (isNaN(delta)) {
      return res.status(400).json({ erro: 'Valor de alteração (delta) inválido' });
    }

    const item = await db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    if (!item) {
      return res.status(404).json({ erro: 'Item não encontrado' });
    }

    const novaQuantidade = Math.max(0, item.quantidade_atual + Number(delta));

    await db
      .prepare(
        `
        UPDATE estoque_itens
        SET quantidade_atual = ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .run(novaQuantidade, id);

    const itemAtualizado = await db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    const itemEnriquecido = enriquecerItemEstoque(itemAtualizado);

    // Se caiu no estoque crítico (<= quantidade_minima), registra no histórico
    if (
      itemEnriquecido.status_alerta === 'CRITICO' &&
      item.quantidade_atual > item.quantidade_minima
    ) {
      await db
        .prepare(
          `
          INSERT INTO historico_alertas (tipo, origem_id, titulo, mensagem)
          VALUES (?, ?, ?, ?)
        `
        )
        .run(
          'ESTOQUE_BAIXO',
          id,
          `Estoque Crítico: ${item.nome}`,
          `Item atingiu saldo de ${novaQuantidade} ${item.unidade_medida} (Limite crítico: ${item.quantidade_minima}). Disparo recomendado para Compras.`
        );
    }

    await registrarLog(
      'ESTOQUE_MOVIMENTO',
      req.usuario.id,
      req.usuario.username,
      `"${item.nome}" (${item.codigo_id}): ${item.quantidade_atual} → ${novaQuantidade} ${item.unidade_medida} (delta ${Number(delta)})`,
      obterIp(req)
    );

    res.json(itemEnriquecido);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha na movimentação de estoque', detalhes: msgErroInterno(error) });
  }
});

// Atualização cadastral do item (parcial: só os campos enviados)
router.put('/estoque/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      codigo_id,
      nome,
      categoria,
      quantidade_atual,
      quantidade_minima,
      unidade_medida,
      localizacao,
      preco_estimado,
    } = req.body;

    const atual = await db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    if (!atual) {
      return res.status(404).json({ erro: 'Item não localizado' });
    }

    const novoCodigo = (codigo_id ?? atual.codigo_id).toString().trim().toUpperCase();

    await db
      .prepare(
        `
        UPDATE estoque_itens
        SET codigo_id = ?, nome = ?, categoria = ?, quantidade_atual = ?, quantidade_minima = ?, unidade_medida = ?, localizacao = ?, preco_estimado = ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      )
      .run(
        novoCodigo,
        (nome ?? atual.nome).toString().trim(),
        (categoria ?? atual.categoria).toString().trim(),
        Number(quantidade_atual ?? atual.quantidade_atual),
        Number(quantidade_minima ?? atual.quantidade_minima),
        (unidade_medida ?? atual.unidade_medida).toString().toUpperCase().trim(),
        (localizacao ?? atual.localizacao).toString().trim(),
        Number(preco_estimado ?? atual.preco_estimado),
        id
      );

    const atualizado = await db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    await registrarLog(
      'ESTOQUE_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Editou identificação do item "${atualizado.nome}" (${atualizado.codigo_id})`,
      obterIp(req)
    );
    res.json(enriquecerItemEstoque(atualizado));
  } catch (error) {
    if (eErroUnico(error)) {
      return res.status(409).json({ erro: 'Este ID já está em uso por outro item' });
    }
    res.status(500).json({ erro: 'Erro ao atualizar item', detalhes: msgErroInterno(error) });
  }
});

// Remover item
router.delete('/estoque/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const item = await db.prepare('SELECT * FROM estoque_itens WHERE id = ?').get(id);
    const result = await db.prepare('DELETE FROM estoque_itens WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Item não localizado' });
    await registrarLog(
      'ESTOQUE_EXCLUSAO',
      req.usuario.id,
      req.usuario.username,
      `Excluiu item "${item?.nome || id}" (${item?.codigo_id || ''})`,
      obterIp(req)
    );
    res.json({ mensagem: 'Item removido com sucesso' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir item', detalhes: msgErroInterno(error) });
  }
});

// ==========================================================
// CATEGORIAS
// ==========================================================

// Listar categorias cadastradas
router.get('/categorias', async (req, res) => {
  try {
    const cats = await db.prepare('SELECT * FROM categorias ORDER BY LOWER(nome)').all();
    res.json(cats);
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao consultar categorias', detalhes: msgErroInterno(error) });
  }
});

// Cadastrar nova categoria
router.post('/categorias', async (req, res) => {
  try {
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da categoria' });

    const nova = await db
      .prepare('INSERT INTO categorias (nome) VALUES (?) RETURNING id')
      .get(nome);
    const registro = await db.prepare('SELECT * FROM categorias WHERE id = ?').get(nova.id);
    await registrarLog(
      'CATEGORIA_CADASTRO',
      req.usuario.id,
      req.usuario.username,
      `Cadastrou categoria "${nome}"`,
      obterIp(req)
    );
    res.status(201).json(registro);
  } catch (error) {
    if (eErroUnico(error)) {
      return res.status(409).json({ erro: 'Já existe uma categoria com esse nome' });
    }
    res.status(500).json({ erro: 'Erro ao cadastrar categoria', detalhes: msgErroInterno(error) });
  }
});

// Renomear categoria
router.put('/categorias/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nome = (req.body.nome || '').trim();
    if (!nome) return res.status(400).json({ erro: 'Informe o nome da categoria' });

    const result = await db.prepare('UPDATE categorias SET nome = ? WHERE id = ?').run(nome, id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Categoria não localizada' });

    const atualizada = await db.prepare('SELECT * FROM categorias WHERE id = ?').get(id);
    await registrarLog(
      'CATEGORIA_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Renomeou categoria "${atualizada?.nome || nome}"`,
      obterIp(req)
    );
    res.json(atualizada);
  } catch (error) {
    if (eErroUnico(error)) {
      return res.status(409).json({ erro: 'Já existe uma categoria com esse nome' });
    }
    res.status(500).json({ erro: 'Erro ao renomear categoria', detalhes: msgErroInterno(error) });
  }
});

// Excluir categoria
router.delete('/categorias/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const cat = await db.prepare('SELECT * FROM categorias WHERE id = ?').get(id);
    const result = await db.prepare('DELETE FROM categorias WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Categoria não localizada' });
    await registrarLog(
      'CATEGORIA_EXCLUSAO',
      req.usuario.id,
      req.usuario.username,
      `Excluiu categoria "${cat?.nome || id}"`,
      obterIp(req)
    );
    res.json({ mensagem: 'Categoria removida' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir categoria', detalhes: msgErroInterno(error) });
  }
});

module.exports = router;
