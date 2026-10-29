---
'kimaki': patch
---

Fix agent shell commands and the `kimaki` command on Windows with PowerShell, cmd.exe and Git Bash.

- **PowerShell and cmd.exe**: every shell command started with `export : The term 'export' is not recognized`, so `kimaki buttons` and `kimaki upload-to-discord` failed with `The Kimaki plugin must provide KIMAKI_TOOL_CALL`. On Windows the plugin now passes `KIMAKI_DATA_DIR`, `KIMAKI_LOCK_PORT`, `KIMAKI_TOOL_CALL` and the `~/.kimaki/bin` PATH entry as environment variables instead of a POSIX `export` prefix, so every shell gets them.
- **Git Bash**: the `C:\Users\you\.kimaki\bin` PATH entry was split on `:` and `kimaki` did not resolve. Git Bash now gets the Windows PATH from the environment and converts it itself.
- **Git Bash**: `~/.kimaki/bin` had only `kimaki.cmd`, which Git Bash never runs. Kimaki now also writes an extensionless `kimaki` sh script, like npm does for global commands.
- **`kimaki.cmd`**: it quoted paths with POSIX single quotes, so every call failed with `The filename, directory name, or volume label syntax is incorrect` when Node was in `C:\Program Files`. It now uses double quotes:

```bat
@echo off
set "KIMAKI_DATA_DIR=C:\Users\you\.kimaki"
"C:\Program Files\nodejs\node.exe" "C:\...\kimaki\dist\cli.js" %*
```

The onboarding thread now tells the agent to run plain `kimaki project add`, which works in every shell, instead of the full quoted Node command.

macOS and Linux shells are unchanged.

Fixes #252
