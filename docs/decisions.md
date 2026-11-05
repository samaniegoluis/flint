# Decisions

One line per decision that is expensive to reverse: date, the decision, why, what was
rejected. Append only. A reversal is a new line that names the one it supersedes.

| # | Date | Decision | Why | Rejected |
|---|---|---|---|---|
| D-001 | 2026-11-04 | Name the project **Flint** | A flint strikes fire, a nod to cfire and its author | Warden (agent-gatekeeper angle), Ember, Keystone |
| D-002 | 2026-11-04 | Write it in **cfire** with `ext:webui` | Dogfood the friend's language, feed back real gaps, release open source on top of it | Go + Wails (known-good), Rust + Tauri |
| D-003 | 2026-11-04 | **Hexagonal architecture**: core, ports, adapters, drivers | One core behind GUI, CLI and later MCP/agent/daemon. Native C++ shims swap out as cfire grows | GUI-centric layering (Tether) |
| D-004 | 2026-11-04 | Vault is **SQLite encrypted in full**, one file per vault, synced via any cloud folder | Keeps Tether's KeePass-style model and stops leaking host metadata to the cloud | Per-field encryption, a custom sync server |
| D-005 | 2026-11-04 | **Cache the derived key** (never the password) per vault in the OS keychain | Auto-unlock on known machines; proven in Tether | Remember the password; key file on disk |
| D-006 | 2026-11-04 | **Reopen the last vault on launch**; switch from an Obsidian-style vault switcher | Most launches want the same vault, so a picker every time is friction | Always show a vault picker |
| D-007 | 2026-11-04 | **macOS + Linux** for the MVP | `ext:webui` has no Windows backend (CF-001) | Waiting for Windows |
| D-008 | 2026-11-04 | **React + Vite + xterm.js** frontend, CSS Modules + tokens | Portable from Tether; Kitty keyboard protocol via pinned xterm.js beta | Svelte/Solid |
| D-009 | 2026-11-04 | Docs site with **Astro + Starlight** (landing + Docs), updated in the same commit as each feature | Docs stay fresh; ready for an open-source release | Docusaurus, VitePress, docs written at the end |
| D-010 | 2026-11-04 | **Lean workflow**: one MVP spec, a full roadmap, whole-milestone execution, owner checks only where a human is required | Modern agents move faster than phase-by-phase gating; nothing is lost because the roadmap holds the rest | Tether-era milestones → phases → manual tests |
