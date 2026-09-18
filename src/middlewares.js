'use strict';

// ============================================================
// MIDDLEWARES DE INFRAESTRUTURA (header, cache, rate limiting)
// ============================================================

const express = require('express');
const { obterIp, registrarLog } = require('./auth');

// ============================================================
// RATE LIMITER POR IP (PROTEÇÃO CONTRA FLOOD/DOS)
// ============================================================
const limitesPorIP = new Map();

function removerLimitesAntigos() {
  const agora = Date.now();
  if (limitesPorIP.size < 5000) return;
  for (const [chave, rec] of limitesPorIP) {
    if (rec.bloqueadoAte < agora && agora - rec.janelaInicio > rec.janelaMs * 2) {
      limitesPorIP.delete(chave);
    }
  }
}

function criarRateLimiter({ janelaMs = 60000, max = 100, nome = 'api', bloquearMs = 0 }) {
  return (req, res, next) => {
    const chave = `${nome}:${obterIp(req)}`;
    const agora = Date.now();
    let rec = limitesPorIP.get(chave);
    if (!rec) {
      rec = { janelaInicio: agora, janelaMs, contador: 0, bloqueadoAte: 0 };
      limitesPorIP.set(chave, rec);
    }

    if (rec.bloqueadoAte > agora) {
      const seg = Math.ceil((rec.bloqueadoAte - agora) / 1000);
      return res.status(429).json({ erro: `Muitas requisições. Aguarde ${seg} segundos.` });
    }

    if (agora - rec.janelaInicio > janelaMs) {
      rec.janelaInicio = agora;
      rec.contador = 0;
    }

    rec.contador++;
    if (rec.contador > max) {
      if (bloquearMs > 0) rec.bloqueadoAte = agora + bloquearMs;
      registrarLog(
        'RATE_LIMIT',
        null,
        null,
        `IP ${obterIp(req)} excedeu limite ${nome} (${max}/janela)`,
        obterIp(req)
      );
      return res.status(429).json({ erro: 'Muitas requisições. Tente novamente em instantes.' });
    }

    removerLimitesAntigos();
    next();
  };
}

// Cabeçalhos de segurança (equivalente ao pacote "helmet")
function cabecalhosSeguranca(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; ')
  );
  next();
}

// Impede que navegador/app guarde cópia antiga de qualquer coisa
// (a recarga OTA funciona e qualquer alteração chega na hora).
function semCache(req, res, next) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
}

// Parsing de corpo com limites inteligentes:
// - 100kb nas rotas padrão (evita abuso de CPU/memória pré-login)
// - Rotas de chat usam parser próprio (12 MB) registrado DEPOIS da autenticação
function parseCorpoPadrao(req, res, next) {
  if (req.path.startsWith('/api/chat/')) return next();
  express.json({ limit: '100kb' })(req, res, next);
}

module.exports = {
  criarRateLimiter,
  cabecalhosSeguranca,
  semCache,
  parseCorpoPadrao,
};
