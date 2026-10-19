# Risuai Node Server

> Warning: Node server may be deprecated in future versions, replaced with [Hono](https://hono.dev/) based server which could run in multiple environments including nodejs, deno, and serverless platforms such as Cloudflare Workers, Vercel Edge Functions, etc.

This is the Node.js server for Risuai, for self-hosting purposes, who want to run Risuai on their own server remotely, without using official server for privacy or other reasons.
## Where the save lives (`RISU_STORE`)

`RISU_STORE=sqlite` (the default) keeps every stored file, images included, as a BLOB in one file, `save.store.sqlite`
(`saveStore.cjs`). `RISU_STORE=files` keeps each one as `save/<hex of its path>`, as before. The HTTP file API (`/api/read`, `/api/write`, `/api/list`, `/api/remove`)
is the same on both.

- `node server/node/storeMigrate.cjs save --to sqlite` copies every `save/<hex>` file into the store and verifies each one by
  sha256; a second run copies nothing. It never deletes the files: they are the rollback. A server started with `RISU_STORE=sqlite`
  on a save that has no store yet runs this itself before it serves.
- `node server/node/storeMigrate.cjs save --to files` writes the store back out to `save/` (verified the same way), and
  `--check` compares the two without changing either. Both refuse while a server holds the save (`save.server.pid`).
- Rollback: stop the server, `storeMigrate.cjs save --to files`, start it with `RISU_STORE=files`. A files server refuses a save
  whose store has writes the files lack, so a rollback without the export cannot silently serve old data.
