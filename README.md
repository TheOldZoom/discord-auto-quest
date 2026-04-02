# Auto Quest

Node script that connects to Discord, watches for quests, and drives completion flows (activity heartbeats, video progress, etc.). Supports **multiple accounts** via comma separated tokens.

## Requirements

- Node 18+ (or Docker)
- `DISCORD_TOKEN` in environment or `.env`

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | example |
|----------|-------------|
| `DISCORD_TOKEN` | `token` or `token1,token2,token3,...` |
| `DISCORD_PRESENCE` | `online`, `idle`, `dnd`, or `invisible`. Default: **`dnd`** (Do Not Disturb) |

Invalid `DISCORD_PRESENCE` value fall back to `dnd` with a console warning.

## Run locally

```bash
npm install
node index.js
```

## Run on a Docker container via `docker compose`

```bash
docker compose up -d
```


### Logs

```bash
docker compose logs -f autoquest
```

## Disclaimer

This project is provided for **educational purposes** only. Use at your own risk. Automating the Discord client may conflict with Discord’s Terms of Service. Do not commit `.env` or real tokens to git.

## Credits

[zt3xdv](https://github.com/zt3xdv) - Originally made the code & I added the multiple accounts support
