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
| `CHECK_INTERVAL_MINUTES` | How often to poll for quests (e.g. `5`). Default: **`5`** |

Invalid `DISCORD_PRESENCE` value fall back to `dnd` with a console warning.
Invalid or missing `CHECK_INTERVAL_MINUTES` falls back to **5** minutes (minimum interval **1** second when a positive number is set).

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
