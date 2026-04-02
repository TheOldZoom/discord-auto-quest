# Discord Auto Quest

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
| `QUEST_WEBHOOK_URL` | Optional. One URL for **both** new-quest and completed events (JSON `POST`). |
| `QUEST_WEBHOOK_NEW` | Optional. URL only for **new quest** notifications (overrides URL for that event if set). |
| `QUEST_WEBHOOK_COMPLETED` | Optional. URL only for **quest completed** notifications. |
| `QUEST_WEBHOOK_GATEWAY` | Optional. URL for **Gateway connected** (on every `READY`, including reconnects). If unset, `QUEST_WEBHOOK_URL` is used for this event when set. |

Optional `QUEST_WEBHOOK_*` URLs override `QUEST_WEBHOOK_URL` for that event. Webhooks **@mention** the account and send JSON payloads.

Bad `DISCORD_PRESENCE` → **`dnd`**. Bad or missing `CHECK_INTERVAL_MINUTES` → **5** minutes.

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

| Role | People |
|------|--------|
| **Original author** | [zt3xdv](https://github.com/zt3xdv) — initial Auto Quest implementation |
| **Contributions** | [theoldzoom](https://github.com/theoldzoom) — multi-account support, configuration, documentation, and webhooks |
