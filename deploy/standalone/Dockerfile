# syntax=docker/dockerfile:1

FROM node:20-alpine AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate && pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build


FROM caddy:2-alpine

WORKDIR /srv
COPY --from=build /app/dist /srv
COPY deploy/standalone/Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
