# Repository Guidelines

## Project Structure & Module Organization

This WebUI targets Vue 3, TypeScript, and Vite. The planned layout follows `Claude.md`: `src/adapter` (backend adapters), `src/api` (Axios/network layer), `src/store` (Pinia state), `src/components` (UI), `src/views` (pages), `src/utils` (helpers), and `src/assets` (static files). Keep adapter, network, state, and view responsibilities separated.

## Build, Test, and Development Commands

After the Vite app is scaffolded, use standard scripts:

- `pnpm install` - install dependencies.
- `pnpm dev` - start the local dev server.
- `pnpm build` - produce static assets for deployment (see `Claude.md` deployment notes).
- `pnpm test` - run the test suite once configured.

Align any new scripts with this pattern.

## Coding Style & Naming Conventions

Use TypeScript with `<script setup>` in Vue SFCs. Prefer 2-space indentation, single quotes, and trailing commas. Name Vue components and their files in `PascalCase` (for example, `TorrentRow.vue`); use `camelCase` for functions, composables (`useX`), and variables. Keep modules small and focused; avoid cross-layer shortcuts (for example, views should not call raw qBittorrent APIs).

## Testing Guidelines

Place tests alongside source files or under `tests/` using `*.spec.ts` naming. Focus coverage on adapters, network guards, and stores; validate behavior with realistic torrent data. Aim for roughly 80 percent line and branch coverage over time.

## Commit & Pull Request Guidelines

Write concise, imperative commit messages; Conventional Commit prefixes (for example, `feat:`, `fix:`) are encouraged. For each pull request, describe the change, reference related issues, and include screenshots or GIFs for UI updates. Call out any security-sensitive or performance-critical changes explicitly and link to sections of `Claude.md` that you followed.

## Agent & Architecture Notes

Whether you are a human or AI contributor, read `Claude.md` before major changes. Preserve the four-module architecture (bootstrap, adapter, network, state and view), avoid formatting or authentication logic in the wrong layer, and prefer simple, well-tested code over cleverness.
