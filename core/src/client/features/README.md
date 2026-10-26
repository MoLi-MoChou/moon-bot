# Client Features

Feature folders contain behavior for one user-facing area. They may depend on
shared client services and `ui/design`, but shared modules must not import a
feature back. Each feature should expose a small public surface through its
entry module and keep tests next to the behavior they cover.

Current feature areas:

- `conversation/`: turn process details and conversation-adjacent UI. Import
  its public surface from `conversation/index.ts`.
- `sidebar/`: team navigation, rows, account actions, and sidebar styles.
- `settings/`: settings dialog and its page-specific editors.
- `browser/`: Bot web guests, page reading, and the browser panel.
