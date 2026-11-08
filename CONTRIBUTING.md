# Contributing to AtomBook

Thank you for considering a contribution. Please open an issue before substantial changes so the scope and compatibility impact can be discussed.

## Development
- Use Node.js 22 or newer.
- Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`.
- Keep changes focused and include regression tests for bug fixes.
- Do not commit business backups, signing keys, passwords, keystores, or generated installers.

## Data compatibility
AtomBook stores business data locally in IndexedDB. Preserve the existing `billbook` database name and `app://billbook/` Electron origin. Database changes must be additive or include a tested migration. Never renumber issued documents or silently recalculate historical totals.

## Pull requests
Describe the user problem, implementation, tests performed, platform impact and any data migration. Include screenshots for UI changes and sample output for PDF changes.
