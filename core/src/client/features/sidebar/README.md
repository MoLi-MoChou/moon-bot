# Sidebar Feature

The sidebar feature owns the team navigation surface and its supporting rows,
account actions, and feature CSS. Shared client services remain one level up;
the feature should expose its public integration through `sidebar.tsx`.

- `sidebar.tsx`: feature entry and public exports
- `sidebar-rows.tsx`: Bot, room, and Agent rows
- `sidebar-account.tsx`: account and shell actions
- `sidebar-css.ts`: feature styles
- `sidebar-types.d.ts`: feature contracts
