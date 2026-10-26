# Client UI

The client UI is organized by responsibility:

- `design/` contains the CSS and visual tokens shared by every screen.
- Feature components stay at `src/client/` while they are being split into
  independently testable feature folders.

Keep visual primitives and styles in `design/`; feature behavior should import
the design entry point instead of reaching into individual style sheets.
