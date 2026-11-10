# Legacy NAS version

This folder is reserved for the original Python/SQLite/Telegram bot
(`CLAUDE.md`, `wardrobe_db.py`, `schema.sql`, `bot.py`) so it stays usable on
the NAS alongside the new static web app.

Those source files weren't present in this project folder when the web app
was built, so there was nothing to move yet. If you still have them
elsewhere, drop them in here — nothing in the web app (`src/`, `index.html`,
`sw.js`, etc.) references this folder, so it's safe to add files here at any
time without affecting the deployed site.
