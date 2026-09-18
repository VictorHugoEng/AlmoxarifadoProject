// ============================================================
// CONVERTE PARA PDF  -  logica do app (navegador/celular)
// ============================================================
// Fotos  -> o proprio aparelho monta o PDF (rapido, offline, sem enviar nada)
// Outros -> envia para o servidor local, que usa o LibreOffice e devolve o PDF
// ============================================================

const $ = (sel) => document.querySelector(sel);

const entradaFotos = $('#entrada-fotos');
const entradaArquivos = $('#entrada-arquivos');
const zona = $('#zona');
const lista = $('#lista');
const barraWrap = $('#barra-wrap');
const barra = $('#barra');
const statusTxt = $('#status');
const btnBaixarTodos = $('#baixar-todos');

let resultados = []; // { nome, blob, url }

// ------------------------------------------------------------
// MONTADOR DE PDF (minimo e sem bibliotecas)
// Cada pagina embute uma imagem JPEG. Tamanho A4 ou da imagem.
// ------------------------------------------------------------
const A4 = { w: 595.28, h: 841.89 };
const DPI_IMAGEM = 96;

function montarPDF(paginas, modo) {
  const chunks = [];
  const offsets = {};
  let pos = 0;

  const txt = (s) => {
    const arr = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
    chunks.push(arr); pos += arr.length;
  };
  const bin = (u8) => { chunks.push(u8); pos += u8.length; };

  txt('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const total = 2 + paginas.length * 3;

  // 1 = Catalogo, 2 = Paginas
  offsets[1] = pos; txt('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  const kids = paginas.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  offsets[2] = pos;
  txt(`2 0 obj\n<< /Type /Pages /Kids [ ${kids} ] /Count ${paginas.length} >>\nendobj\n`);

  paginas.forEach((pg, i) => {
    const idPagina = 3 + i * 3;
    const idConteudo = 4 + i * 3;
    const idImagem = 5 + i * 3;

    let pgW, pgH;
    if (modo === 'imagem') {
      pgW = pg.largura * 72 / DPI_IMAGEM;
      pgH = pg.altura * 72 / DPI_IMAGEM;
    } else {
      pgW = A4.w; pgH = A4.h;
    }
    const escala = Math.min(pgW / pg.largura, pgH / pg.altura);
    const dw = pg.largura * escala;
    const dh = pg.altura * escala;
    const x = (pgW - dw) / 2;
    const y = (pgH - dh) / 2;

    const conteudo = `q\n${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`;

    offsets[idPagina] = pos;
    txt(
      `${idPagina} 0 obj\n<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${pgW.toFixed(2)} ${pgH.toFixed(2)}] ` +
      `/Resources << /XObject << /Im0 ${idImagem} 0 R >> >> ` +
      `/Contents ${idConteudo} 0 R >>\nendobj\n`
    );

    offsets[idConteudo] = pos;
    txt(`${idConteudo} 0 obj\n<< /Length ${conteudo.length} >>\nstream\n`);
    txt(conteudo);
    txt('endstream\nendobj\n');

    offsets[idImagem] = pos;
    txt(
      `${idImagem} 0 obj\n<< /Type /XObject /Subtype /Image ` +
      `/Width ${pg.largura} /Height ${pg.altura} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`
    );
    bin(pg.bytes);
    txt('\nendstream\nendobj\n');
  });

  const xrefPos = pos;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= total; id++) {
    xref += String(offsets[id]).padStart(10, '0') + ' 00000 n \n';
  }
  txt(xref);
  txt(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

// ------------------------------------------------------------
// IMAGEM -> JPEG (com orientacao automatica e redimensionamento)
// ------------------------------------------------------------
async function imagemParaJPEG(arquivo, maxLado = 2600, qualidade = 0.92) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch (e) {
    bitmap = await createImageBitmap(arquivo);
  }

  let { width, height } = bitmap;
  const maior = Math.max(width, height);
  if (maior > maxLado) {
    const f = maxLado / maior;
    width = Math.round(width * f);
    height = Math.round(height * f);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();

  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', qualidade));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return { bytes, largura: width, altura: height };
}

function baixar(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return url;
}

// ------------------------------------------------------------
// INTERFACE
// ------------------------------------------------------------
const ICONE_FOTO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
const ICONE_ARQ = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
const ICONE_OK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';

function novoItem(nome) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML =
    `<div class="item-icone">${ICONE_ARQ}</div>` +
    `<div class="item-info"><div class="item-nome" title="${nome}">${nome}</div>` +
    `<div class="item-estado">Na fila...</div></div>` +
    `<div class="item-acao"></div>`;
  lista.prepend(el);
  return el;
}

function marcarOk(el, blob, nomeFinal) {
  const url = URL.createObjectURL(blob);
  const a = el.querySelector('.item-acao');
  const online = document.createElement('a');
  online.className = 'btn-dl';
  online.href = url;
  online.download = nomeFinal;
  online.textContent = 'Baixar';
  a.innerHTML = '';
  a.appendChild(online);
  el.querySelector('.item-icone').innerHTML = ICONE_OK;
  el.classList.add('ok');
  el.querySelector('.item-estado').textContent = 'PDF pronto';
}

function marcarErro(el, msg) {
  el.classList.add('erro');
  el.querySelector('.item-estado').textContent = msg;
}

function ehImagem(arquivo) {
  return /^image\//.test(arquivo.type) || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(arquivo.name);
}

// ------------------------------------------------------------
// CONVERSAO DE DOCUMENTO (servidor + LibreOffice)
// ------------------------------------------------------------
function enviarDocumento(arquivo, aoProgredir) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = `/api/converter?nome=${encodeURIComponent(arquivo.name)}`;
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.responseType = 'blob';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && aoProgredir) aoProgredir(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        const b = xhr.response;
        if (b && b.type && b.type.indexOf('json') >= 0) {
          b.text().then((t) => {
            try { reject(new Error(JSON.parse(t).erro || 'Falha na conversao')); }
            catch (e) { reject(new Error('Falha na conversao')); }
          });
        } else {
          reject(new Error('Falha na conversao (codigo ' + xhr.status + ')'));
        }
      }
    };
    xhr.onerror = () => reject(new Error('Sem conexao com o servidor de conversao'));
    xhr.send(arquivo);
  });
}

// ------------------------------------------------------------
// PROCESSAMENTO GERAL
// ------------------------------------------------------------
let ocupado = false;

async function processar(arquivos) {
  arquivos = Array.from(arquivos || []);
  if (!arquivos.length || ocupado) return;
  ocupado = true;
  btnBaixarTodos.hidden = true;

  const fotos = arquivos.filter(ehImagem);
  const docs = arquivos.filter((a) => !ehImagem(a));

  // 1) FOTOS -> um unico PDF (uma foto por pagina)
  if (fotos.length) {
    const itens = fotos.map((f) => novoItem(f.name));
    barraWrap.hidden = false;
    try {
      const paginas = [];
      for (let i = 0; i < fotos.length; i++) {
        itens[i].querySelector('.item-estado').textContent = `Convertendo foto ${i + 1} de ${fotos.length}...`;
        const pg = await imagemParaJPEG(fotos[i]);
        paginas.push(pg);
        itens[i].querySelector('.item-estado').textContent = 'Pronto, montando PDF...';
      }
      const modo = $('#modo-pagina').value;
      const blob = montarPDF(paginas, modo);
      const nomeBase = fotos.length === 1
        ? fotos[0].name.replace(/\.[^.]+$/, '')
        : `fotos-${new Date().toISOString().slice(0, 10)}`;
      const nomeFinal = nomeBase + '.pdf';
      itens.forEach((el) => marcarOk(el, blob, nomeFinal));
      baixar(blob, nomeFinal);
      resultados.push({ nome: nomeFinal, blob });
    } catch (e) {
      itens.forEach((el) => marcarErro(el, 'Erro: ' + e.message));
    } finally {
      barraWrap.hidden = true;
    }
  }

  // 2) DOCUMENTOS -> enviam um a um para o servidor
  for (const arq of docs) {
    const el = novoItem(arq.name);
    barraWrap.hidden = false;
    barra.style.width = '0%';
    statusTxt.textContent = `Enviando ${arq.name}...`;
    try {
      const blob = await enviarDocumento(arq, (p) => { barra.style.width = (p * 70) + '%'; });
      barra.style.width = '100%';
      el.querySelector('.item-estado').textContent = 'Convertendo no servidor...';
      const nomeFinal = arq.name.replace(/\.[^.]+$/, '') + '.pdf';
      marcarOk(el, blob, nomeFinal);
      baixar(blob, nomeFinal);
      resultados.push({ nome: nomeFinal, blob });
    } catch (e) {
      marcarErro(el, e.message);
    } finally {
      barraWrap.hidden = true;
      statusTxt.textContent = '';
    }
  }

  if (resultados.length > 1) btnBaixarTodos.hidden = false;
  ocupado = false;
}

// ------------------------------------------------------------
// EVENTOS
// ------------------------------------------------------------
$('#btn-fotos').addEventListener('click', () => entradaFotos.click());
$('#btn-arquivos').addEventListener('click', () => entradaArquivos.click());
entradaFotos.addEventListener('change', (e) => { processar(e.target.files); e.target.value = ''; });
entradaArquivos.addEventListener('change', (e) => { processar(e.target.files); e.target.value = ''; });

btnBaixarTodos.addEventListener('click', () => {
  resultados.forEach((r, i) => setTimeout(() => baixar(r.blob, r.nome), i * 400));
});

// Arrastar e soltar (desktop)
['dragenter', 'dragover'].forEach((ev) =>
  zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('arrastando'); }));
['dragleave', 'drop'].forEach((ev) =>
  zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.remove('arrastando'); }));
zona.addEventListener('drop', (e) => processar(e.dataTransfer.files));

// Colar imagem (Ctrl+V) no desktop
document.addEventListener('paste', (e) => {
  const itens = e.clipboardData && e.clipboardData.items;
  if (!itens) return;
  const arquivos = [];
  for (const it of itens) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) arquivos.push(new File([f], 'colado-' + Date.now() + '.png', { type: f.type }));
    }
  }
  if (arquivos.length) processar(arquivos);
});

// Diagnostico do servidor (avisa se o LibreOffice falta)
fetch('/api/diagnostico').then((r) => r.json()).then((d) => {
  const b = $('#selo');
  if (d.libreoffice) {
    b.textContent = 'Pronto';
    b.className = 'selo ok';
  } else {
    b.textContent = 'LibreOffice ausente';
    b.className = 'selo erro';
    b.title = 'Word/Excel/PPT nao convertem sem o LibreOffice. Fotos continuam funcionando.';
  }
}).catch(() => {});

// PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
