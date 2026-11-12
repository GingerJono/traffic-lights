# traffic lights

Created 2026-11-12 13:59 by ClaudeControl. The original request is in `BRIEF.md`.
GitHub: https://github.com/GingerJono/traffic-lights (private)

## Working conventions

This project keeps three living files. Keep them current: they are how the next session (or the user, on their phone) picks up where you left off.

- **`JOURNAL.md`**: an append-only history. After every meaningful update (a feature built, a finding, a decision, a dead end), add an entry at the bottom: `## YYYY-MM-DD HH:MM`, a short headline, then bullets for what changed, why, and which files. Never rewrite past entries.
- **`HANDOVER.md`**: a snapshot of right now, rewritten (not appended) at the end of each chunk of work. It covers: current state, how to run or use it, where the important things are, what's in progress, open questions, and the very next step.
- **`TODO.md`**: a checklist under Now / Next / Later / Done. Tick items as you finish them, and add new items as they come up.

After each update, commit with a clear message and `git push`. Never commit secrets, credentials, tokens or `.env` files.

## Ground rules

- Ask before anything destructive or irreversible: deleting or moving the user's files, deleting online content, or sending messages on their behalf.
- Never type the user's passwords. If a site needs a sign-in, ask the user to do it in Chrome.
