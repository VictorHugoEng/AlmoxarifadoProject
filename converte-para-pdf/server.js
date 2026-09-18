// ============================================================
// CONVERTE PARA PDF  -  servidor local (leve)
// ============================================================
// - Fotos/imagens: o proprio celular/navegador converte (nao passa aqui).
// - Word, Excel, PowerPoint, texto, etc: este servidor chama o LibreOffice
//   em modo "headless" e devolve o PDF pronto. Nada de servico externo.
//
// Rotas:
//   GET  /                      -> tela do app (PWA)
//   GET  /api/diagnostico       -> diz se o LibreOffice foi encontrado
//   POST /api/converter?nome=X  -> corpo = bytes crus do arquivo; devolve PDF
// ============================================================
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const app = express();
const PORT = process.env.PORT || 3210;

const PASTA_PUBLICA = path.join(__dirname, 'public');
const PASTA_TMP = path.join(os.tmpdir(), 'converte-para-pdf');
fs.mkdirSync(PASTA_TMP, { recursive: true });

const TAMANHO_MAX = 80 * 1024 * 1024; // 80 MB por arquivo

// ------------------------------------------------------------
// LOCALIZA O LIBREOFFICE (soffice)
// ------------------------------------------------------------
const CANDIDATOS_SOFFICE = [
  process.env.SOFFICE_PATH,
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'LibreOffice', 'program', 'soffice.exe'),
  'soffice',
].filter(Boolean);

function acharSoffice() {
  for (const p of CANDIDATOS_SOFFICE) {
    try {
      if (p === 'soffice') return p; // confia no PATH
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

let SOFFICE = acharSoffice();

// ------------------------------------------------------------
// FILA: o LibreOffice headless nao gosta de muitas conversoes juntas.
// Serializamos uma por vez (fila) para nunca travar/corromper.
// ------------------------------------------------------------
let fila = Promise.resolve();
function naFila(tarefa) {
  const resultado = fila.then(tarefa, tarefa);
  fila = resultado.catch(() => {});
  return resultado;
}

function extensaoDe(nome) {
  const m = /\.([a-z0-9]+)$/i.exec(String(nome || ''));
  return m ? m[1].toLowerCase() : '';
}

// Executa o soffice e devolve uma Promise
function rodarSoffice(entrada, pastaSaida, perfil) {
  const args = [
    `-env:UserInstallation=file:///${perfil.replace(/\\/g, '/')}`,
    '--headless',
    '--nologo',
    '--nofirststartwizard',
    '--nolockcheck',
    '--nodefault',
    '--norestore',
    '--convert-to',
    'pdf:writer_pdf_Export',
    '--outdir',
    pastaSaida,
    entrada,
  ];
  return new Promise((resolve, reject) => {
    execFile(SOFFICE, args, { timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || stdout || err.message));
      resolve(stdout || '');
    });
  });
}

// ------------------------------------------------------------
// CONVERSAO PRINCIPAL
// ------------------------------------------------------------
async function converterParaPDF(nome, buffer) {
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(PASTA_TMP, id);
  const pastaSaida = path.join(dir, 'saida');
  const perfil = path.join(dir, 'perfil');
  fs.mkdirSync(pastaSaida, { recursive: true });
  fs.mkdirSync(perfil, { recursive: true });

  const ext = extensaoDe(nome) || 'bin';
  const base = 'entrada';
  const entrada = path.join(dir, `${base}.${ext}`);
  fs.writeFileSync(entrada, buffer);

  try {
    await rodarSoffice(entrada, pastaSaida, perfil);

    let arquivoPdf = path.join(pastaSaida, `${base}.pdf`);
    if (!fs.existsSync(arquivoPdf)) {
      // As vezes o LibreOffice troca o nome; procura qualquer .pdf gerado
      const achados = fs.readdirSync(pastaSaida).filter(f => f.toLowerCase().endsWith('.pdf'));
      if (!achados.length)
        throw new Error('O LibreOffice nao gerou o PDF (formato nao suportado?).');
      arquivoPdf = path.join(pastaSaida, achados[0]);
    }
    return fs.readFileSync(arquivoPdf);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {}
  }
}

// ------------------------------------------------------------
// MIDDLEWARES
// ------------------------------------------------------------
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // permite embutir no simulador local
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.static(PASTA_PUBLICA));

// Diagnostico: o app mostra um aviso se o LibreOffice nao estiver instalado
app.get('/api/diagnostico', (req, res) => {
  SOFFICE = acharSoffice();
  res.json({
    ok: true,
    soffice: SOFFICE,
    libreoffice: !!SOFFICE,
    limite_mb: Math.round(TAMANHO_MAX / 1024 / 1024),
  });
});

// Converte arquivo enviado (corpo cru). Nome vai na query ?nome=
app.post('/api/converter', express.raw({ type: '*/*', limit: '80mb' }), async (req, res) => {
  try {
    const nome = decodeURIComponent(String(req.query.nome || 'arquivo')).slice(0, 180);
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    if (!buffer.length) {
      return res.status(400).json({ erro: 'Arquivo vazio ou nao enviado.' });
    }
    if (buffer.length > TAMANHO_MAX) {
      return res.status(413).json({ erro: 'Arquivo muito grande (maximo de 80 MB).' });
    }

    // Ja e PDF? Devolve o proprio arquivo.
    if (extensaoDe(nome) === 'pdf') {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${nome}"`);
      return res.send(buffer);
    }

    SOFFICE = SOFFICE || acharSoffice();
    if (!SOFFICE) {
      return res.status(503).json({
        erro: 'LibreOffice nao encontrado neste computador. Rode o instalador (INSTALAR-LIBREOFFICE.bat).',
      });
    }

    const pdf = await naFila(() => converterParaPDF(nome, buffer));

    const nomePdf = nome.replace(/\.[a-z0-9]+$/i, '') + '.pdf';
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename=\"${nomePdf.replace(/"/g, '')}\"`);
    res.send(pdf);
  } catch (error) {
    console.error('[Conversao] Falha:', error.message);
    res.status(500).json({ erro: 'Nao foi possivel converter este arquivo. ' + error.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log('====================================================');
  console.log('  CONVERTE PARA PDF  //  servidor ativo');
  console.log(`  Local:       http://localhost:${PORT}`);
  console.log(`  LibreOffice: ${SOFFICE || 'NAO ENCONTRADO'}`);
  console.log('  Deixe esta janela aberta. Feche para desligar.');
  console.log('====================================================');
});
