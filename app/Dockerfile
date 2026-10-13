# syntax=docker/dockerfile:1

# ---- build stage: install dev deps, typecheck, build frontend + server bundle ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage: just Node + the built output (no node_modules needed) ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
# Cloud Run sets PORT; default to 8080 for local `docker run`.
ENV PORT=8080
WORKDIR /app
# package.json carries "type": "module" so dist/server.js runs as ESM.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
