const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORTA = Number(process.env.PORTA_TESTE || 4871);
const BASE = `http://127.0.0.1:${PORTA}`;
const RAIZ = path.join(__dirname, '..');
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'almoxarifado-test-'));

let servidor = null;

function iniciarServidor() {
  return new Promise((resolve, reject) => {
    const processo = spawn(process.execPath, ['src/index.js'], {
      cwd: RAIZ,
      env: {
        ...process.env,
        PORT: String(PORTA),
        NODE_ENV: 'test',
        ALMOX_DB_PATH: path.join(TEMP, 'voltstock.db'),
        ALMOX_CONFIG_PATH: path.join(TEMP, 'nuvem_config.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let saida = '';
    let concluido = false;

    const finalizar = erro => {
      if (concluido) return;
      concluido = true;
      if (erro) {
        processo.kill();
        reject(erro);
      } else {
        resolve(processo);
      }
    };

    const timeout = setTimeout(
      () => finalizar(new Error(`Servidor não iniciou a tempo.\n${saida}`)),
      30000
    );

    processo.stdout.on('data', dados => {
      saida += dados.toString();
      if (saida.includes('Servidor ativo em')) {
        clearTimeout(timeout);
        finalizar();
      }
    });

    processo.stderr.on('data', dados => {
      saida += dados.toString();
    });

    processo.on('exit', codigo => {
      clearTimeout(timeout);
      finalizar(new Error(`Servidor encerrou antes do esperado (código ${codigo}).\n${saida}`));
    });
  });
}

before(async () => {
  servidor = await iniciarServidor();
});

after(async () => {
  if (servidor && servidor.exitCode === null) {
    servidor.kill();
    await new Promise(resolve => servidor.once('exit', resolve));
  }
  try {
    fs.rmSync(TEMP, { recursive: true, force: true });
  } catch (e) {
    // Diretório temporário no Windows pode ficar preso por alguns ms; ignorar.
  }
});

test('serve o frontend (index.html) na raiz', async () => {
  const resposta = await fetch(`${BASE}/`);
  assert.strictEqual(resposta.status, 200);
  const corpo = await resposta.text();
  assert.match(corpo, /<html/i);
});

test('login do admin padrão e acesso a endpoint autenticado', async () => {
  const login = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'anderson', senha: '123456' }),
  });
  assert.strictEqual(login.status, 200);
  const dados = await login.json();
  assert.ok(dados.token);

  const versao = await fetch(`${BASE}/api/versao`, {
    headers: { Authorization: `Bearer ${dados.token}` },
  });
  assert.strictEqual(versao.status, 200);
  const corpo = await versao.json();
  assert.strictEqual(typeof corpo.versao, 'string');
  assert.ok(corpo.atualizado_em);
});
