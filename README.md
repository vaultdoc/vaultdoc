# vaultdoc

[![CI](https://github.com/YOUR_ORG/vaultdoc/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/vaultdoc/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-brightgreen)](package.json)

An MCP server that gives Claude Code and Cursor direct access to your team's internal documentation. The AI reads, writes, and searches docs — with AI-polished updates and Slack notifications on every change.

```
Claude Code / Cursor
       │ MCP call
       ▼
  vaultdoc  ──► Anthropic API (improves content)
       │
       ├──► Markdown files (versioned, on disk)
       └──► Slack webhook (notifies team)
```

## Tools

| Tool | Description |
|---|---|
| `list_docs` | List all docs, filter by category |
| `get_doc` | Fetch full content of a doc |
| `search_docs` | Keyword search across titles, tags, and content |
| `create_doc` | Create a doc — AI polishes it, Slack notified |
| `update_doc` | Describe a change — AI applies it, Slack notified |
| `delete_doc` | Delete a doc, Slack notified |
| `get_runbook` | Fetch runbook by service name (on-call shortcut) |
| `list_runbooks` | All runbooks at a glance |
| `get_devops_context` | Load all DevOps/arch/runbook summaries as context |
| `get_incident_docs` | All post-mortems and incident docs |

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/YOUR_ORG/vaultdoc.git
cd vaultdoc
cp .env.example .env   # fill in ADMIN_KEY and ANTHROPIC_API_KEY at minimum
docker compose up -d
```

### Manual

```bash
npm install
cp .env.example .env   # fill in your values
npm run build
node dist/server.js
```

For development with hot reload:
```bash
npm run dev
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMIN_KEY` | Yes | — | Secret for `/admin/keys` endpoints |
| `ANTHROPIC_API_KEY` | Yes | — | Powers AI doc improvements |
| `SLACK_WEBHOOK_URL` | No | — | Slack incoming webhook URL |
| `SLACK_CHANNEL` | No | `#team-docs` | Channel name shown in messages |
| `TEAM_NAME` | No | `Engineering Team` | Shown in Slack notifications |
| `ALLOWED_IPS` | No | (disabled) | CIDR ranges for IP allowlist, e.g. `10.8.0.0/24` |
| `DOCS_DIR` | No | `./docs` | Path to the docs directory |
| `API_KEYS_FILE` | No | `./data/api-keys.json` | Path to the named API keys file |
| `PORT` | No | `3000` | HTTP port |

## API Key Management

Keys are stored as named entries in `data/api-keys.json`. Manage them without restarting:

```bash
# Add a key
curl -X POST http://localhost:3000/admin/keys \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-code-antoine", "key": "sk-mcp-your-secret"}'

# List key names (secrets are never returned)
curl http://localhost:3000/admin/keys \
  -H "Authorization: Bearer $ADMIN_KEY"

# Revoke a key
curl -X DELETE http://localhost:3000/admin/keys/claude-code-antoine \
  -H "Authorization: Bearer $ADMIN_KEY"
```

## Connecting Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "team-docs": {
      "type": "http",
      "url": "http://YOUR_SERVER_IP:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## Connecting Cursor

Add to Cursor settings → MCP:

```json
{
  "mcpServers": {
    "team-docs": {
      "url": "http://YOUR_SERVER_IP:3000/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## Deployment

### Option 1 — Work machine / VPS behind VPN (recommended)

Best for teams: the server lives inside your network, only reachable over VPN.

```bash
# 1. Clone and configure
git clone https://github.com/YOUR_ORG/vaultdoc.git && cd vaultdoc
cp .env.example .env
# edit .env: set ADMIN_KEY, ANTHROPIC_API_KEY, ALLOWED_IPS=10.8.0.0/24

# 2. Start
docker compose up -d

# 3. TLS + VPN allowlist via nginx (see nginx.example.conf)
sudo cp nginx.example.conf /etc/nginx/sites-available/vaultdoc
# edit domain + VPN subnet, then:
sudo ln -s /etc/nginx/sites-available/vaultdoc /etc/nginx/sites-enabled/
sudo certbot --nginx -d vaultdoc.yourdomain.com
sudo nginx -s reload
```

Connect Claude Code using `https://vaultdoc.yourdomain.com/mcp` — only works when on VPN.

---

### Option 2 — Fly.io (free tier, public internet + API key auth)

Good for distributed teams with no shared VPN. Auth is API-key only (set `ALLOWED_IPS=` to disable IP filtering).

```bash
# Install flyctl: https://fly.io/docs/hands-on/install-flyctl/
fly auth login
fly launch --no-deploy   # picks up fly.toml automatically

# Persistent volume for docs + keys
fly volumes create vaultdoc_data --size 1 --region cdg

# Set secrets
fly secrets set \
  ADMIN_KEY="$(openssl rand -hex 32)" \
  ANTHROPIC_API_KEY="sk-ant-..." \
  SLACK_WEBHOOK_URL="https://hooks.slack.com/..."

fly deploy
```

Free tier gives you 3 shared-cpu-1x VMs and 3 GB storage. The machine auto-stops when idle.

---

### Option 3 — Railway (easiest, ~$5/mo)

No config files needed — connect your GitHub repo and set env vars in the dashboard.

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
2. Select your `vaultdoc` fork
3. Add a Volume mounted at `/data`
4. Set env vars: `ADMIN_KEY`, `ANTHROPIC_API_KEY`, optionally `SLACK_WEBHOOK_URL`
5. Deploy — Railway auto-detects the Dockerfile

Railway has a free trial but requires a paid plan (~$5/mo) for persistent uptime.

---

### Landing page — GitHub Pages (free)

```bash
# In your GitHub repo settings:
# Settings → Pages → Source: Deploy from branch
# Branch: main, Folder: /landing
# → Live at https://YOUR_ORG.github.io/vaultdoc

# Custom domain: add a CNAME file to landing/
echo "vaultdoc.io" > landing/CNAME
git add landing/CNAME && git commit -m "chore: add custom domain" && git push
```

---

## Security

- **IP allowlist** — set `ALLOWED_IPS` to your VPN subnet to block all non-VPN traffic
- **Named API keys** — one key per person/tool, revoke individually without touching others
- **Separate admin key** — `ADMIN_KEY` is distinct from client keys; key management never bootstraps itself
- **Path traversal protection** — all doc paths are sandboxed to `DOCS_DIR`
- **Non-root Docker user** — the container runs as an unprivileged `mcp` user
- **Rate limiting** — 100 req/min per IP

Recommended deployment: run behind an nginx/Caddy reverse proxy with TLS, inside a private VPN subnet.

## Doc Categories

`runbook` · `architecture` · `onboarding` · `incident` · `devops` · `api` · `process` · `general`

## Development

```bash
npm run dev        # tsx watch — hot reload
npm run typecheck  # tsc --noEmit
npm run build      # compile to dist/
```

PRs welcome. Keep changes focused and include a brief description of what and why.

## License

AGPLv3 — you can self-host, modify, and contribute freely. If you run a modified version as a service, you must publish your changes. See [LICENSE](LICENSE).
