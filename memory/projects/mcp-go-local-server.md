# mcp-go-local-server

Go 1.24 MCP server exposing 20+ Git/GitLab tools via the MCP protocol.

## Stack
- Go 1.24
- YAML-based server config (`internal/config/`)
- All tools in `internal/module/tools/git/`
- MCP result formatting in `internal/module/core/`
- Base agent abstraction in `internal/module/agent/`

## Dev commands
```bash
make build    # binary → bin/mcp-go-local-server
make run      # go run ./cmd/server (port 8080)
make test
make lint     # requires golangci-lint
```

## Active context
<!-- Update this section when starting a new work session -->
- What's being worked on:
- Last known branch:
- Open decisions:

## Known gotchas
<!-- Add entries as they're discovered — or let memory-manager write here -->
