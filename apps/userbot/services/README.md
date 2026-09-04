# Systemd userbot services

## Prerequisites

- `bun install` has been run in `workers/userbot`
- `workers/userbot/.env.local` exists with required env vars (see `workers/userbot/README.md`)

## Units

| Unit | Schedule | Description |
|------|----------|-------------|
| `loyal-userbot-sync` | Every 2 hours | Sync Telegram messages |
| `loyal-userbot-summary-publish` | Daily 06:10 UTC | Publish summary notifications |

## Install & enable

Before installing, update the `.service` files to replace placeholder paths with your actual paths:

- `/path/to/loyal-app` → your repo checkout path
- `/path/to/.bun/bin/bun` → your `bun` binary path (find with `which bun`)

```bash
sudo cp loyal-userbot-sync.service loyal-userbot-sync.timer \
       loyal-userbot-summary-publish.service loyal-userbot-summary-publish.timer \
       /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now loyal-userbot-sync.timer loyal-userbot-summary-publish.timer
```

## Update after changing unit files

```bash
sudo cp <changed-files> /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart <unit-name>.timer
```

## Verify

```bash
systemctl list-timers loyal-userbot-*.timer
```

## Trigger manually

```bash
sudo systemctl start loyal-userbot-sync.service
sudo systemctl start loyal-userbot-summary-publish.service
```

## Logs

```bash
sudo journalctl -u loyal-userbot-sync.service -n 100 --no-pager
sudo journalctl -u loyal-userbot-summary-publish.service -n 100 --no-pager
```

## Disable & remove

```bash
sudo systemctl disable --now loyal-userbot-sync.timer loyal-userbot-summary-publish.timer
sudo rm /etc/systemd/system/loyal-userbot-sync.{service,timer} \
        /etc/systemd/system/loyal-userbot-summary-publish.{service,timer}
sudo systemctl daemon-reload
```
