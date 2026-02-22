# Close Agent Sidebar

A Cursor extension that exposes one command:

- `Close Agent Sidebar` (`workbench.action.closeUnifiedSidebar`)

The command reads workspace-scoped Cursor state from `state.vscdb`:

- Table: `ItemTable`
- Key: `workbench.unifiedSidebar.hidden`

Behavior:

- `false` -> unified sidebar is visible -> runs `workbench.action.toggleUnifiedSidebar`
- `true` -> unified sidebar already hidden -> no-op
- missing/invalid state or query errors -> no-op

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Package extension
npx @vscode/vsce package

# Install in Cursor
cursor --install-extension close-agent-sidebar-*.vsix
```
