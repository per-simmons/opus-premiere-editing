# Opus Premiere Editing

The setup I use to have Claude Code (Opus 5.5) do the rough cut of my YouTube videos inside the real Adobe Premiere Pro,
while I keep recording. Write-up: https://www.aiformortals.co/blog/opus-5-5-edits-my-videos-premiere

Two parts:

| Folder | What it is |
|---|---|
| [`skill/`](skill/SKILL.md) | The editing skill my agent follows: Premiere's Transcribe and Pauses pass, the waveform Pause Cut, bad takes and "Chat, cut that", pacing, one REVIEW sequence per section, finishing. Drop it into your agent's skills folder. |
| [`bridge/`](bridge/) | The Premiere Pro bridge: a background Premiere (CEP) extension plus a small client and MCP server, so the agent can run scripts in Premiere instead of clicking around with computer use. |

## Quick start

1. Copy `skill/` into your agent's skills folder (for Claude Code: `~/.claude/skills/premiere-editing/`).
2. Install the bridge (below).
3. Open a Premiere project, point the agent at a folder of takes and ask it to follow the skill.

Easiest path: hand this repo to your agent and ask it to set everything up on your machine.

## The bridge

The extension runs invisibly inside Premiere and watches a spool folder (`~/.premiere-mcp-bridge-v2` by default). The client
drops a request in, the extension runs it in Premiere, and the result comes back with a journal entry per request ID.
It's built for safety: one request at a time, every request logged, a timed-out request is marked `uncertain` (never
silently retried), and nothing replays a mutation on its own.

```sh
cd bridge
npm test                     # mock-host tests
python3 install.py           # dry run
python3 install.py --install # copies the extension into ~/Library/Application Support/Adobe/CEP/extensions
```

Unsigned CEP extensions need Adobe's debug mode turned on for your CEP version, e.g.
`defaults write com.adobe.CSXS.11 PlayerDebugMode 1` (also `.12` on newer Premiere). Restart Premiere afterward.

By default the extension only accepts two reviewed commands (`snapshot`, `save_checkpoint`). To let the agent run its own
reviewed ExtendScript (that's how my edits run), opt in by placing `{"allowLegacyScripts": true}` in
`bridge-settings.json` inside the installed extension folder. Those scripts bypass the built-in guards, so have your agent
check the project path, sequence ID and timebase inside every script before it changes anything.

```sh
node client.cjs "$HOME/.premiere-mcp-bridge-v2" submit-legacy my-request-001 /absolute/path/to/script.jsx
node client.cjs "$HOME/.premiere-mcp-bridge-v2" status my-request-001
```

MCP: `node mcp-server.cjs` exposes `premiere_snapshot`, `premiere_save_checkpoint` and `premiere_request_status`.

Things the bridge can't do: Premiere's Transcribe button and the transcript Pauses filter have no scripting API, so the
agent clicks those with computer use (see the skill).

## Credits and license

The file transport is compatible with [hetpatel-11/Adobe_Premiere_Pro_MCP](https://github.com/hetpatel-11/Adobe_Premiere_Pro_MCP)
(MIT; notice kept in `bridge/LICENSE.upstream.md`). Adobe's `CSInterface.js` is not included. Use at your own risk on a
copy of your project first.
