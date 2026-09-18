FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Dados persistentes fora do container. Com SQLite local, monte também /app:
#   docker run -v almox_data:/app ...
# Com PostgreSQL (DATABASE_URL), nenhum volume é necessário.
VOLUME ["/app/backups"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "src/index.js"]
