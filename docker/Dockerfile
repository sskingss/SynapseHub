FROM node:20-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx tsup src/index.ts --format esm --dts --out-dir dist

EXPOSE 3777
CMD ["sh", "-c", "node --import tsx src/db/migrate.ts && node dist/index.js"]
