'use strict';

// ============================================================
// EQUIPAMENTOS & CALIBRAÇÃO (METROLOGIA)
// ============================================================

const express = require('express');
const { db } = require('../database');
const { obterIp, registrarLog, msgErroInterno } = require('../auth');
const { eErroUnico, enriquecerEquipamento } = require('../helpers');

const router = express.Router();

// Listar todos os equipamentos com dias restantes calculados
router.get('/equipamentos', async (req, res) => {
  try {
    const { status_filtro } = req.query;
    const dados = await db
      .prepare('SELECT * FROM equipamentos_calibracao ORDER BY data_validade_calibracao ASC')
      .all();
    let lista = dados.map(enriquecerEquipamento);

    if (status_filtro && status_filtro !== 'TODOS') {
      lista = lista.filter(e => e.status_calibracao === status_filtro);
    }

    res.json(lista);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao buscar equipamentos', detalhes: msgErroInterno(error) });
  }
});

// Cadastrar novo equipamento
router.post('/equipamentos', async (req, res) => {
  try {
    const {
      tag_patrimonio,
      nome,
      fabricante,
      modelo,
      numero_serie,
      data_ultima_calibracao,
      data_validade_calibracao,
      laboratorio,
      certificado_num,
      responsavel,
    } = req.body;

    if (!tag_patrimonio || !nome || !data_validade_calibracao) {
      return res
        .status(400)
        .json({ erro: 'Campos obrigatórios: tag_patrimonio, nome, data_validade_calibracao' });
    }

    const novo = await db
      .prepare(
        `
      INSERT INTO equipamentos_calibracao
      (tag_patrimonio, nome, fabricante, modelo, numero_serie, data_ultima_calibracao, data_validade_calibracao, laboratorio, certificado_num, responsavel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `
      )
      .get(
        tag_patrimonio.toUpperCase().trim(),
        nome.trim(),
        fabricante || 'N/A',
        modelo || 'N/A',
        numero_serie || 'S/N',
        data_ultima_calibracao || new Date().toISOString().split('T')[0],
        data_validade_calibracao,
        laboratorio || '',
        certificado_num || '',
        responsavel || 'Almoxarifado'
      );

    const registro = await db
      .prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?')
      .get(novo.id);
    await registrarLog(
      'EQUIP_CADASTRO',
      req.usuario.id,
      req.usuario.username,
      `Cadastrou equipamento "${registro.nome}" (${registro.tag_patrimonio})`,
      obterIp(req)
    );
    res.status(201).json(enriquecerEquipamento(registro));
  } catch (error) {
    if (eErroUnico(error)) {
      return res.status(409).json({ erro: 'TAG de patrimônio já cadastrada' });
    }
    res
      .status(500)
      .json({ erro: 'Erro ao cadastrar equipamento', detalhes: msgErroInterno(error) });
  }
});

// Atualizar equipamento / renovar calibração
router.put('/equipamentos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      nome,
      fabricante,
      modelo,
      numero_serie,
      data_ultima_calibracao,
      data_validade_calibracao,
      laboratorio,
      certificado_num,
      responsavel,
    } = req.body;

    const atual = await db.prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?').get(id);
    if (!atual) return res.status(404).json({ erro: 'Equipamento não localizado' });

    const result = await db
      .prepare(
        `
        UPDATE equipamentos_calibracao
        SET nome = ?, fabricante = ?, modelo = ?, numero_serie = ?, data_ultima_calibracao = ?, data_validade_calibracao = ?, laboratorio = ?, certificado_num = ?, responsavel = ?
        WHERE id = ?
      `
      )
      .run(
        nome ?? atual.nome,
        fabricante ?? atual.fabricante,
        modelo ?? atual.modelo,
        numero_serie ?? atual.numero_serie,
        data_ultima_calibracao ?? atual.data_ultima_calibracao,
        data_validade_calibracao ?? atual.data_validade_calibracao,
        laboratorio ?? atual.laboratorio,
        certificado_num ?? atual.certificado_num,
        responsavel ?? atual.responsavel,
        id
      );

    if (result.changes === 0) return res.status(404).json({ erro: 'Equipamento não localizado' });

    const atualizado = await db
      .prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?')
      .get(id);
    await registrarLog(
      'EQUIP_EDICAO',
      req.usuario.id,
      req.usuario.username,
      `Editou equipamento "${atualizado.nome}" (${atualizado.tag_patrimonio})`,
      obterIp(req)
    );
    res.json(enriquecerEquipamento(atualizado));
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Erro ao atualizar equipamento', detalhes: msgErroInterno(error) });
  }
});

// Deletar equipamento
router.delete('/equipamentos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const equip = await db.prepare('SELECT * FROM equipamentos_calibracao WHERE id = ?').get(id);
    const result = await db.prepare('DELETE FROM equipamentos_calibracao WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ erro: 'Equipamento não localizado' });
    await registrarLog(
      'EQUIP_EXCLUSAO',
      req.usuario.id,
      req.usuario.username,
      `Excluiu equipamento "${equip?.nome || id}" (${equip?.tag_patrimonio || ''})`,
      obterIp(req)
    );
    res.json({ mensagem: 'Equipamento removido' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao excluir equipamento', detalhes: msgErroInterno(error) });
  }
});

module.exports = router;
