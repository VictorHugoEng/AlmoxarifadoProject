'use strict';

// ============================================================
// NUVEM (Google Drive), ATUALIZAÇÃO OTA, BACKUP E VERSÃO
// ============================================================

const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const nuvem = require('../nuvem');
const backup = require('../backup');
const { exigirAdmin } = require('../auth');
const { obterIp, registrarLog, msgErroInterno } = require('../auth');
const { versaoAtual, compararVersoes, versaoDoApp, copiarRecursivo } = require('../helpers');

const router = express.Router();

// Arquivos protegidos contra a aplicação de pacote OTA
const ARQ_PROTEGIDOS = new Set([
  'voltstock.db',
  'voltstock.db-wal',
  'voltstock.db-shm',
  'nuvem_config.json',
]);

// ==========================================================
// NUVEM (GOOGLE DRIVE)
// ==========================================================

// Status público (tela de login usa para exibir o botão/estado)
router.get('/nuvem/status', (req, res) => {
  res.json(nuvem.status());
});

// Iniciar conexão com a nuvem (OAuth Google) — redireciona para o Google
router.get('/nuvem/login', (req, res) => {
  if (!nuvem.temCliente()) {
    return res.redirect('/login.html?nuvem=naoconfigurado');
  }
  const redirectUri = `${nuvem.originDoRequest(req)}/api/nuvem/oauth2/callback`;
  res.redirect(nuvem.urlAutorizacao(redirectUri));
});

// Retorno do Google após autorização
router.get('/nuvem/oauth2/callback', async (req, res) => {
  try {
    if (!req.query.code) {
      throw new Error(req.query.error || 'Autorização negada pelo Google');
    }
    const redirectUri = `${nuvem.originDoRequest(req)}/api/nuvem/oauth2/callback`;
    const dados = await nuvem.trocarCodigoPorToken(req.query.code, redirectUri);

    const cfg = nuvem.lerConfig();
    cfg.tokens = {
      access_token: dados.access_token,
      refresh_token: dados.refresh_token,
      expiry_date: Date.now() + (dados.expires_in || 3600) * 1000,
    };
    cfg.conta = (await nuvem.buscarEmailConta(dados.access_token)) || undefined;
    nuvem.salvarConfig(cfg);

    // Envia a primeira cópia imediatamente
    await nuvem.enviarBackupNuvem();
    res.redirect('/login.html?nuvem=ok');
  } catch (error) {
    console.error('[Nuvem] Falha no retorno do Google:', error.message);
    res.redirect('/login.html?nuvem=erro');
  }
});

// Salvar credenciais do app Google (só admin)
router.post('/nuvem/config', exigirAdmin, async (req, res) => {
  try {
    const clientId = (req.body.client_id || '').trim();
    const clientSecret = (req.body.client_secret || '').trim();
    if (!clientId || !clientSecret) {
      return res.status(400).json({ erro: 'Informe o Client ID e o Client Secret do Google.' });
    }
    nuvem.salvarCredenciais(clientId, clientSecret);
    await registrarLog(
      'NUVEM_CONFIG',
      req.usuario.id,
      req.usuario.username,
      'Configurou credenciais do Google Drive',
      obterIp(req)
    );
    res.json({ mensagem: 'Credenciais salvas! Agora clique em Conectar.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao salvar configuração', detalhes: msgErroInterno(error) });
  }
});

// Desconectar a conta Google (só admin)
router.post('/nuvem/desconectar', exigirAdmin, async (req, res) => {
  try {
    nuvem.desconectar();
    await registrarLog(
      'NUVEM_DESCONEXAO',
      req.usuario.id,
      req.usuario.username,
      'Desconectou a conta Google',
      obterIp(req)
    );
    res.json({ mensagem: 'Nuvem desconectada.' });
  } catch (error) {
    res.status(500).json({ erro: 'Erro ao desconectar', detalhes: msgErroInterno(error) });
  }
});

// Enviar backup para a nuvem agora (só admin)
router.post('/nuvem/enviar', exigirAdmin, async (req, res) => {
  try {
    const resultado = await nuvem.enviarBackupNuvem();
    if (!resultado.ok) return res.status(400).json({ erro: resultado.erro });
    await registrarLog(
      'NUVEM_ENVIO',
      req.usuario.id,
      req.usuario.username,
      'Enviou backup ao Google Drive manualmente',
      obterIp(req)
    );
    res.json({
      mensagem: resultado.atualizado ? 'Backup enviado à nuvem!' : 'Nuvem já está atualizada.',
    });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao enviar', detalhes: msgErroInterno(error) });
  }
});

// Baixar a versão mais recente da nuvem (só admin)
router.post('/nuvem/restaurar', exigirAdmin, async (req, res) => {
  try {
    const resultado = await nuvem.baixarBackupNuvem();
    if (!resultado.ok) return res.status(400).json({ erro: resultado.erro });
    await registrarLog(
      'NUVEM_DOWNLOAD',
      req.usuario.id,
      req.usuario.username,
      `Baixou backup da nuvem: ${path.basename(resultado.caminho)}`,
      obterIp(req)
    );
    res.json({
      mensagem: 'Backup baixado da nuvem! Para aplicá-lo, reinicie o servidor.',
      caminho: resultado.caminho,
    });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao baixar', detalhes: msgErroInterno(error) });
  }
});

// ==========================================================
// BACKUP LOCAL (MANUAL E STATUS)
// ==========================================================

// Backup manual (botão na aba ADMINISTRADOR)
router.post('/backup', exigirAdmin, async (req, res) => {
  try {
    const backupGerado = await backup.realizarBackup();
    if (!backupGerado) return res.status(500).json({ erro: 'Falha ao gerar backup.' });
    await registrarLog(
      'BACKUP_DB',
      req.usuario.id,
      req.usuario.username,
      `Gerou backup manual do banco (voltstock_${path.basename(backupGerado.caminho)}, ${(backupGerado.tamanho / 1024).toFixed(1)} KB)`,
      obterIp(req)
    );
    res.json({ mensagem: 'Backup gerado com sucesso!', backup: backupGerado });
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao gerar backup.', detalhes: msgErroInterno(error) });
  }
});

// Status dos backups locais
router.get('/backup/status', exigirAdmin, async (req, res) => {
  try {
    res.json(backup.statusBackup());
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar backups', detalhes: msgErroInterno(error) });
  }
});

// ==========================================================
// ATUALIZAÇÃO DO PROGRAMA PELA NUVEM
// (coloque almoxarifado_update.zip + almoxarifado_versao.txt na nuvem)
// ==========================================================

router.get('/atualizacao/status', exigirAdmin, async (req, res) => {
  try {
    const atual = versaoAtual();
    const conectado = nuvem.temCliente() && nuvem.temTokens();
    let disponivel = null;
    if (conectado) disponivel = await nuvem.lerVersaoDaNuvem();
    res.json({
      versaoAtual: atual,
      versaoDisponivel: disponivel,
      temAtualizacao: !!disponivel && compararVersoes(disponivel, atual) > 0,
      conectado,
    });
  } catch (error) {
    res
      .status(500)
      .json({ erro: 'Falha ao verificar atualização', detalhes: msgErroInterno(error) });
  }
});

router.post('/atualizacao/aplicar', exigirAdmin, async (req, res) => {
  try {
    const atual = versaoAtual();
    const baixado = await nuvem.baixarAtualizacaoNuvem();
    if (!baixado.ok)
      return res.status(500).json({ erro: 'Falha ao baixar atualização', detalhes: baixado.erro });
    if (!baixado.disponivel)
      return res.status(404).json({ erro: 'Nenhum pacote de atualização na nuvem.' });
    if (baixado.versao && compararVersoes(baixado.versao, atual) <= 0) {
      return res.json({ mensagem: `Sistema já está na versão ${atual} (atualizada).` });
    }

    const pastaAtualizacao = config.paths.atualizacaoPendente;
    fs.rmSync(pastaAtualizacao, { recursive: true, force: true });
    fs.mkdirSync(pastaAtualizacao, { recursive: true });
    const zipPath = path.join(pastaAtualizacao, 'pacote.zip');
    fs.writeFileSync(zipPath, baixado.zip);

    const { execSync } = require('node:child_process');
    const extraido = path.join(pastaAtualizacao, 'extraido');
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Force -LiteralPath '${zipPath}' -DestinationPath '${extraido}'"`,
      { timeout: 120000, stdio: 'ignore' }
    );

    if (
      !fs.existsSync(path.join(extraido, 'server.js')) &&
      !fs.existsSync(path.join(extraido, 'src'))
    ) {
      return res.status(400).json({ erro: 'Pacote inválido (server.js não encontrado).' });
    }

    // Backup do código atual (permite reverter manualmente depois)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(config.paths.backupCodigo, stamp);
    fs.mkdirSync(backupDir, { recursive: true });
    for (const nome of [
      'server.js',
      'database.js',
      'nuvem.js',
      'src',
      'package.json',
      'package-lock.json',
      'versao.txt',
      'public',
    ]) {
      const de = path.join(config.root, nome);
      if (!fs.existsSync(de)) continue;
      if (nome === 'public' || nome === 'src') copiarRecursivo(de, path.join(backupDir, nome));
      else
        try {
          fs.copyFileSync(de, path.join(backupDir, nome));
        } catch (e) {}
    }

    // Aplica o novo código (mantém banco, credenciais e pastas de dados)
    for (const it of fs.readdirSync(extraido, { withFileTypes: true })) {
      const nome = it.name;
      if (ARQ_PROTEGIDOS.has(nome)) continue;
      if (nome === 'backups' || nome === 'atualizacao_pendente') continue;
      const de = path.join(extraido, nome);
      const para = path.join(config.root, nome);
      if (it.isDirectory()) copiarRecursivo(de, para);
      else {
        try {
          fs.copyFileSync(de, para);
        } catch (e) {}
      }
    }
    // versao.txt vem no pacote
    try {
      fs.copyFileSync(path.join(extraido, 'versao.txt'), config.paths.versao);
    } catch (e) {}

    await registrarLog(
      'ATUALIZACAO_SISTEMA',
      req.usuario.id,
      req.usuario.username,
      `Aplicou atualização ${atual} -> ${baixado.versao}`,
      obterIp(req)
    );

    res.json({
      mensagem: `Atualização para ${baixado.versao} aplicada. O sistema está reiniciando...`,
      reiniciando: true,
    });
    setTimeout(() => process.exit(0), 900);
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao aplicar atualização', detalhes: msgErroInterno(error) });
  }
});

// ==========================================================
// VERSÃO DO SISTEMA (RECARGA OTA PARA TODOS OS DISPOSITIVOS)
// ==========================================================

router.get('/versao', (req, res) => {
  try {
    res.json(versaoDoApp());
  } catch (error) {
    res.status(500).json({ erro: 'Falha ao consultar versão', detalhes: msgErroInterno(error) });
  }
});

module.exports = router;
