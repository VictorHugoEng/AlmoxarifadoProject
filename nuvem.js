// ============================================================
// NUVEM (GOOGLE DRIVE) — BACKUP AUTOMÁTICO NA CONTA GOOGLE
// ============================================================
// Como funciona:
//  - Credenciais OAuth (Client ID/Secret) + tokens ficam em nuvem_config.json
//  - O token de acesso é renovado sozinho (refresh_token)
//  - A cada alteração de item, o banco (voltstock.db) é copiado para uma
//    pasta "Almoxarifado Inteligente Backup" no Google Drive de quem Conectar
//  - Ao ligar o servidor, baixa a versão mais recente da nuvem (caso outro
//    computador tenha trabalhado)
// ============================================================
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Acesso tardio ao banco: evita dependência circular com database.js
// (que chama a nuvem durante a recuperação automática de boot).
function pegarDatabase() {
  return require('./database');
}
function caminhoDoBanco() {
  return pegarDatabase().DB_PATH;
}

const ARQUIVO_CONFIG = process.env.ALMOX_CONFIG_PATH || path.join(__dirname, 'nuvem_config.json');
const PASTA_BACKUPS = path.join(__dirname, 'backups');

const NOME_PASTA_DRIVE = 'Almoxarifado Inteligente Backup';
const NOME_ARQUIVO_DRIVE = 'voltstock_live.db';
const NOME_ZIP_ATUALIZACAO = 'almoxarifado_update.zip';
const NOME_VERSAO_NUVEM = 'almoxarifado_versao.txt';
const ESCOPOS =
  'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

// Estado em memória (para status rápido e evitar reenvio sem mudança)
let ultimaSincronizacao = null;
let ultimoErro = null;
let ultimoHashEnviado = null;
let sincronizando = false;
let timerSincronizacao = null;
let nuvemPendente = false; // houve alteração durante um envio: reenviar ao terminar

// ============================================================
// CONFIG (arquivo local)
// ============================================================
function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8'));
  } catch (e) {
    return {};
  }
}

function salvarConfig(cfg) {
  try {
    fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.error('[Nuvem] Falha ao salvar configuração:', e.message);
  }
}

function temCliente() {
  const c = lerConfig();
  return !!(c.google_client_id && c.google_client_secret);
}

function temTokens() {
  const c = lerConfig();
  return !!(c.tokens && c.tokens.refresh_token);
}

function salvarCredenciais(clientId, clientSecret) {
  const cfg = lerConfig();
  cfg.google_client_id = clientId;
  cfg.google_client_secret = clientSecret;
  salvarConfig(cfg);
}

function desconectar() {
  const cfg = lerConfig();
  cfg.tokens = undefined;
  cfg.conta = undefined;
  salvarConfig(cfg);
  ultimoHashEnviado = null;
}

function status() {
  const cfg = lerConfig();
  return {
    configurado: temCliente(),
    conectado: temTokens(),
    conta: cfg.conta || null,
    ultimaSincronizacao,
    ultimoErro,
    arquivoDrive: NOME_ARQUIVO_DRIVE,
    pastaDrive: NOME_PASTA_DRIVE,
  };
}

// ============================================================
// OAuth2 GOOGLE
// ============================================================
function urlAutorizacao(redirectUri) {
  const cfg = lerConfig();
  const params = new URLSearchParams({
    client_id: cfg.google_client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPOS,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function trocarCodigoPorToken(code, redirectUri) {
  const cfg = lerConfig();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.google_client_id,
      client_secret: cfg.google_client_secret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Falha ao obter autorização do Google');
  }
  if (!data.refresh_token) {
    throw new Error(
      'O Google não retornou refresh_token (aviso: o prompt de consentimento deve pedir novamente)'
    );
  }
  return data;
}

async function obterTokenValido() {
  const cfg = lerConfig();
  if (!cfg.tokens || !cfg.tokens.refresh_token) return null;

  const t = cfg.tokens;
  if (t.expiry_date && Date.now() < t.expiry_date - 60000) {
    return t.access_token;
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.google_client_id,
      client_secret: cfg.google_client_secret,
      refresh_token: t.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Falha ao renovar sessão do Google');
  }

  t.access_token = data.access_token;
  t.expiry_date = Date.now() + (data.expires_in || 3600) * 1000;
  cfg.tokens = t;
  salvarConfig(cfg);
  return t.access_token;
}

async function buscarEmailConta(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    return data.email || null;
  } catch (e) {
    return null;
  }
}

// ============================================================
// GOOGLE DRIVE (pastas e arquivos)
// ============================================================
async function pedidoDrive(url, opcoes = {}) {
  const token = await obterTokenValido();
  if (!token) throw new Error('Nuvem não conectada. Clique em Entrar na Nuvem.');
  const res = await fetch(url, {
    ...opcoes,
    headers: { ...(opcoes.headers || {}), Authorization: `Bearer ${token}` },
  });
  const dados = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(dados?.error?.message || `Google respondeu ${res.status}`);
  }
  return dados;
}

async function garantirPasta() {
  const q = encodeURIComponent(
    `name='${NOME_PASTA_DRIVE}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const lista = await pedidoDrive(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`
  );
  if (lista.files && lista.files.length) return lista.files[0].id;

  const criado = await pedidoDrive('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: NOME_PASTA_DRIVE,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  return criado.id;
}

async function encontrarArquivoPorNome(folderId, nome) {
  const q = encodeURIComponent(`name='${nome}' and '${folderId}' in parents and trashed=false`);
  const lista = await pedidoDrive(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`
  );
  if (lista.files && lista.files.length) return lista.files[0].id;
  return null;
}

async function encontrarArquivo(folderId) {
  return encontrarArquivoPorNome(folderId, NOME_ARQUIVO_DRIVE);
}

// Cria ou atualiza um arquivo (por nome) dentro da pasta "Almoxarifado Inteligente Backup".
async function fazerUploadBytes(nome, bytes, mime = 'application/octet-stream') {
  const folderId = await garantirPasta();
  let fileId = await encontrarArquivoPorNome(folderId, nome);
  const token = await obterTokenValido();

  if (fileId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
        body: bytes,
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || `Google respondeu ${res.status}`);
    }
    return { atualizado: true };
  }

  const criado = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, mimeType: mime, parents: [folderId] }),
  });
  const dados = await criado.json();
  if (!criado.ok) throw new Error(dados?.error?.message || `Google respondeu ${criado.status}`);

  const envio = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${dados.id}?uploadType=media`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': mime },
      body: bytes,
    }
  );
  if (!envio.ok) {
    const err = await envio.json().catch(() => null);
    throw new Error(err?.error?.message || `Google respondeu ${envio.status}`);
  }
  return { criado: true };
}

// Baixa o conteúdo bruto de um arquivo da pasta (ou null se não existir).
async function baixarArquivoPorNome(nome) {
  const folderId = await garantirPasta();
  const fileId = await encontrarArquivoPorNome(folderId, nome);
  if (!fileId) return null;
  const token = await obterTokenValido();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error?.message || `Google respondeu ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ============================================================
// ATUALIZAÇÃO DO PROGRAMA PELA NUVEM
// ============================================================
async function lerVersaoDaNuvem() {
  try {
    const buf = await baixarArquivoPorNome(NOME_VERSAO_NUVEM);
    if (!buf) return null;
    return buf.toString('utf8').trim() || null;
  } catch (e) {
    return null;
  }
}

async function baixarAtualizacaoNuvem() {
  try {
    const zip = await baixarArquivoPorNome(NOME_ZIP_ATUALIZACAO);
    const versao = await lerVersaoDaNuvem();
    if (!zip) return { ok: true, disponivel: false };
    return { ok: true, disponivel: true, zip, versao };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

async function enviarPacoteAtualizacaoNuvem(zipBytes, versao) {
  if (!temCliente() || !temTokens()) {
    return { ok: false, erro: 'Nuvem não conectada' };
  }
  try {
    await fazerUploadBytes(NOME_ZIP_ATUALIZACAO, zipBytes);
    await fazerUploadBytes(
      NOME_VERSAO_NUVEM,
      Buffer.from((versao || '').trim(), 'utf8'),
      'text/plain'
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// ENVIO / DOWNLOAD DO BACKUP
// ============================================================
async function enviarBackupNuvem() {
  if (!temCliente() || !temTokens()) return { ok: false, erro: 'Nuvem não conectada' };
  if (sincronizando) return { ok: false, erro: 'Sincronização já em andamento' };

  sincronizando = true;
  try {
    pegarDatabase().db.exec('PRAGMA wal_checkpoint(FULL);');
    if (!fs.existsSync(caminhoDoBanco())) {
      return { ok: false, erro: 'Banco de dados não encontrado' };
    }

    const bytes = fs.readFileSync(caminhoDoBanco());
    const hash = crypto.createHash('md5').update(bytes).digest('hex');
    if (hash === ultimoHashEnviado) {
      ultimaSincronizacao = new Date().toISOString();
      return { ok: true, atualizado: false };
    }

    const folderId = await garantirPasta();
    const fileId = await encontrarArquivo(folderId);

    if (fileId) {
      // Já existe: atualiza o conteúdo
      const token = await obterTokenValido();
      const res = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
          body: bytes,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || `Google respondeu ${res.status}`);
      }
    } else {
      // Cria com metadados e depois envia o conteúdo
      const token = await obterTokenValido();
      const criado = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: NOME_ARQUIVO_DRIVE,
          mimeType: 'application/octet-stream',
          parents: [folderId],
        }),
      });
      const dadosCriado = await criado.json();
      if (!criado.ok) {
        throw new Error(dadosCriado?.error?.message || `Google respondeu ${criado.status}`);
      }
      const envio = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${dadosCriado.id}?uploadType=media`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
          body: bytes,
        }
      );
      if (!envio.ok) {
        const err = await envio.json().catch(() => null);
        throw new Error(err?.error?.message || `Google respondeu ${envio.status}`);
      }
    }

    ultimoHashEnviado = hash;
    ultimaSincronizacao = new Date().toISOString();
    ultimoErro = null;
    console.log(`[Nuvem] Backup enviado ao Google Drive (${(bytes.length / 1024).toFixed(1)} KB)`);
    return { ok: true, atualizado: true };
  } catch (e) {
    ultimoErro = e.message;
    console.error('[Nuvem] Falha ao enviar backup:', e.message);
    return { ok: false, erro: e.message };
  } finally {
    sincronizando = false;
  }
}

async function baixarBackupNuvem(opcoes = {}) {
  if (!temCliente() || !temTokens()) return { ok: false, erro: 'Nuvem não conectada' };

  try {
    const folderId = await garantirPasta();
    const fileId = await encontrarArquivo(folderId);
    if (!fileId) {
      return { ok: false, erro: 'Nenhum backup encontrado na nuvem ainda' };
    }

    const token = await obterTokenValido();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error?.message || `Google respondeu ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) {
      return { ok: false, erro: 'Arquivo na nuvem está vazio' };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.mkdirSync(PASTA_BACKUPS, { recursive: true });
    const destino = path.join(PASTA_BACKUPS, `voltstock_NUVEM_${stamp}.db`);
    fs.writeFileSync(destino, buffer);

    if (opcoes.aplicar) {
      // Aplica como banco principal (recuperação automática em máquina nova
      // ou após apagão). Nunca altera a cópia em backups/.
      const principal = caminhoDoBanco();
      if (fs.existsSync(principal)) {
        try {
          fs.copyFileSync(
            principal,
            path.join(PASTA_BACKUPS, `voltstock_PRE_RESTAURO_${stamp}.db`)
          );
        } catch (e) {}
      }
      for (const suf of ['-wal', '-shm']) {
        try {
          fs.unlinkSync(principal + suf);
        } catch (e) {}
      }
      fs.writeFileSync(principal, buffer);
      try {
        fs.appendFileSync(
          path.join(PASTA_BACKUPS, 'historico_backups.txt'),
          `[${new Date().toLocaleString('pt-BR')}] RECUPERACAO DA NUVEM: banco restaurado de voltstock_live.db (Google Drive)\n`
        );
      } catch (e) {}
      console.log(
        `[Nuvem] Backup APLICADO da nuvem no banco principal (${(buffer.length / 1024).toFixed(1)} KB) + cópia em backups/`
      );
    } else {
      console.log(
        `[Nuvem] Backup baixado da nuvem: ${path.basename(destino)} (${(buffer.length / 1024).toFixed(1)} KB)`
      );
    }
    return { ok: true, caminho: destino, aplicado: !!opcoes.aplicar };
  } catch (e) {
    ultimoErro = e.message;
    console.error('[Nuvem] Falha ao baixar backup:', e.message);
    return { ok: false, erro: e.message };
  }
}

// ============================================================
// DISPARO AUTOMÁTICO (a cada alteração de item)
// ============================================================
const DEBOUNCE_NUVEM_MS = 1200; // agrupa alterações em rajada; sobe quase instantâneo

async function sincronizarAgora() {
  if (!temCliente() || !temTokens()) return;
  if (sincronizando) {
    // Já existe envio em andamento: marca para reenviar assim que terminar,
    // assim NUNCA perdemos a última alteração feita.
    nuvemPendente = true;
    return;
  }
  const resultado = await enviarBackupNuvem();
  if (nuvemPendente) {
    nuvemPendente = false;
    agendarSincronizacaoNuvem();
  }
  return resultado;
}

function agendarSincronizacaoNuvem() {
  if (!temCliente() || !temTokens()) return;
  if (timerSincronizacao) return; // já existe envio agendado (junta a rajada)
  timerSincronizacao = setTimeout(() => {
    timerSincronizacao = null;
    sincronizarAgora();
  }, DEBOUNCE_NUVEM_MS);
}

// ============================================================
// STATUS PARA A TELA DE LOGIN
// ============================================================
function originDoRequest(req) {
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = {
  lerConfig,
  salvarConfig,
  temCliente,
  temTokens,
  salvarCredenciais,
  desconectar,
  status,
  urlAutorizacao,
  trocarCodigoPorToken,
  obterTokenValido,
  buscarEmailConta,
  enviarBackupNuvem,
  baixarBackupNuvem,
  agendarSincronizacaoNuvem,
  sincronizarAgora,
  lerVersaoDaNuvem,
  baixarAtualizacaoNuvem,
  enviarPacoteAtualizacaoNuvem,
  originDoRequest,
};
