# Slipstream Arena

Slipstream Arena is an original arena shooter for the browser.
It uses the gameplay rules of the classic arena shooters of 1999:

- Fast movement with air strafe speed gain, rocket jumps, and jump pads.
- Six weapons, armor, health, and one power item (the Amplifier) on timers.
- Free-for-all deathmatch with a frag limit and a time limit.
- Bots for offline play and for the dedicated server.

The client uses [three.js](https://threejs.org/) (WebGL). The dedicated server uses Node.js and WebSocket.
The client and the server use the same simulation code in `shared/`.

## Requirements

- Node.js 22 or later.
- A browser with WebGL 2.

## Quick start

```sh
npm install
npm start
```

`npm start` builds the client and starts the dedicated server.
Open `http://localhost:27960` in a browser. Then select "Play offline" or "Connect".

## Controls

| Key | Action |
| --- | --- |
| W, A, S, D | Move |
| Space | Jump |
| Mouse | Aim |
| Left mouse button | Fire |
| 1 to 6, mouse wheel | Select a weapon |
| Tab | Show the scores |
| Enter | Chat |
| Esc | Open the menu |

To gain speed, jump again and again. In the air, hold forward and one strafe key, and turn slowly to the strafe side.
The HUD shows the speed in units per second ("ups"). The ground speed limit is 320.

## Offline play

The menu has the bot setup for the offline mode:

- "Bots" sets the bots to on or off.
- "Bot count" sets the number of bots (1 to 15).
- "Bot skill" sets the skill (1 to 5).

During an offline game, press Esc, change the setup, and select "Apply bot setup".

## Graphics quality

The "Graphics" option in the menu limits the render resolution. The default is "Medium" (approximately 1080p).
On a 4K screen with an integrated GPU, "Native resolution" can decrease the frame rate below 60.

## Dedicated server

```sh
npm run build      # Build the web client one time.
npm run server -- --port 27960 --bots 4 --fraglimit 20
```

The server serves the web client and accepts WebSocket connections on the same port.
The server stops the simulation when no human player is connected.

| Option | Environment | Default | Description |
| --- | --- | --- | --- |
| `--port` | `PORT` | 27960 | TCP port for HTTP and WebSocket. |
| `--host` | `HOST` | 0.0.0.0 | Network address. |
| `--name` | `SERVER_NAME` | Slipstream Arena server | Server name. |
| `--maxclients` | `MAX_CLIENTS` | 12 | Maximum number of human players. |
| `--bots` | `BOTS` | 4 | Number of bots (0 to 15). 0 sets the bots to off. |
| `--botskill` | `BOT_SKILL` | 3 | Bot skill (1 to 5). |
| `--botfill` | `BOT_FILL` | on | `on`: a bot leaves when a player joins. `off`: the bot count is constant. |
| `--fraglimit` | `FRAG_LIMIT` | 20 | Frags that end a match. 0 sets no limit. |
| `--timelimit` | `TIME_LIMIT` | 10 | Match time in minutes. 0 sets no limit. |

With `--botfill on`, `--bots 4` means: the server keeps a minimum of 4 players. Bots fill the free places.

### Server console

Type these commands in the terminal of the server:

| Command | Description |
| --- | --- |
| `status` | Show the players and the bot setup. |
| `bots <count> [skill]` | Set the number of bots. `bots 0` sets the bots to off. |
| `botfill <on\|off>` | Set the bot fill mode. |
| `fraglimit <n>`, `timelimit <minutes>` | Change the match limits. |
| `restart` | Start the match again. |
| `say <text>` | Send a message to all players. |
| `quit` | Stop the server. |

Set `SERVER_CONSOLE=1` to use the console when the input is not a terminal.

### Status endpoint

`GET /status` returns the server name, the map, and the player counts as JSON.

### Docker

```sh
docker compose up --build -d
```

Change the settings in `compose.yaml`. To use the console in a container, add `stdin_open: true`, `tty: true`,
and run `docker attach <container>`.

### Internet hosting

- Open the TCP port of the server in the firewall.
- A page that loads over HTTPS can connect only to `wss://`. Put the server behind a reverse proxy with TLS
  (for example Caddy or nginx). The proxy must pass WebSocket connections.

## Development

```sh
npm run dev      # Vite development server for the client, with reload.
npm run server   # Dedicated server. The development client can connect to ws://localhost:27960.
npm test         # Simulation tests.
```

Useful URL parameters: `?offline` starts an offline game, `?connect=ws://host:27960` connects to a server,
`?quality=low` (or `medium`, `high`, `native`) sets the graphics quality.

## Structure

| Path | Content |
| --- | --- |
| `shared/` | Simulation: map, collision, movement, game rules, bots, game host. No browser or Node.js API. |
| `server/` | Dedicated server: HTTP, WebSocket, options, console. |
| `client/` | Web client: renderer, input, prediction, HUD, sound. |
| `test/` | Tests for the simulation and the host. |

### Network model

- The server is authoritative. It runs 60 ticks each second and sends 30 snapshots each second.
- The client sends one input command for each tick. It predicts its own movement with the shared movement code,
  and corrects the prediction from each snapshot.
- The client shows the other players a short time in the past and interpolates between two snapshots.
- The transport is WebSocket (TCP) with JSON messages, because a browser cannot use UDP sockets.
  A bad connection with packet loss can cause short stops.
- The server does not compensate hitscan weapons for latency. With a high ping, aim ahead of the target.

### Native client

The client build uses relative paths. A desktop wrapper (for example Electron or Tauri) can load `dist/index.html`
without code changes. The offline mode runs fully in the client. A wrapper is not part of this repository.
