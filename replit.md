# Workspace

## Overview

API server hosting **Tedauuu** — an AI chatbot created by Mr. Suraj Sir. Powered by Google Gemini (via Replit AI Integrations). Talks in any language with emojis, jokes, and human-like personality. Designed to be linked to WhatsApp via webhooks.

## Tedauuu API

- `GET /api/` — info about the bot and endpoints
- `GET /api/healthz` — health check
- `POST /api/chat` — chat with Tedauuu
  - body: `{ "message": "string", "history": [{ "role": "user|assistant", "content": "string" }] }`
  - response: `{ "reply": "string", "name": "Tedauuu", "creator": "Mr. Suraj Sir" }`

Persona is enforced via system prompt: identity is Tedauuu by Mr. Suraj Sir, replies match the user's language, include emojis and gentle humor.

## Stack

- Node.js 24, TypeScript 5.9, pnpm workspaces
- Express 5 API in `artifacts/api-server`
- `@google/genai` SDK pointed at the Replit AI Integrations Gemini proxy
  (`AI_INTEGRATIONS_GEMINI_BASE_URL` + `AI_INTEGRATIONS_GEMINI_API_KEY`,
  initialized with `httpOptions.apiVersion: ""`)
- Model: `gemini-2.5-flash`

## Key Commands

- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm run typecheck` — full typecheck
