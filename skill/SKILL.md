---
name: premiere-editing
description: Edit talking-head and screen-demo recordings inside Adobe Premiere Pro the way a human editor would, using Premiere's own Transcribe and Pauses tools, a waveform pause pass, a transcript bad-take pass and spoken "chat" directions. Use for rough cuts of YouTube recordings, one take at a time, while the creator keeps recording.
---

# Premiere editing (public version)

This is the skill my editing agent follows. It runs as Claude Code (Opus 5.5) on a separate Mac with Premiere Pro open, so the
agent can click and take screenshots without touching my main computer. My personal setup (machine names, accounts, folders,
logins) has been taken out. Swap in your own.

## What you need

- A second Mac running Premiere Pro, signed in to your Adobe account. Adobe lets you activate Premiere on 2 computers.
- Claude Code on that Mac, running in a normal Terminal window on its desktop. Give Terminal **Accessibility** and
  **Screen Recording** permission in System Settings > Privacy & Security, then fully quit and reopen Terminal.
  (Agents launched over SSH or inside tmux can't click or take screenshots, and macOS fails silently when they try.)
- A way to run scripts inside Premiere. I use a small custom Premiere panel (a CEP extension) that receives JSX
  (ExtendScript) from the agent and logs every request. An open-source Premiere MCP server is a good place to start.
- A click tool for the parts of Premiere that only exist as buttons, e.g. `cliclick` (`brew install cliclick`).
  Premiere tabs ignore a plain click; press, wait about 80 ms, release: `cliclick -w 120 m:X,Y dd:X,Y w:80 du:X,Y`.
- Optional: a watcher on your recording machine that numbers each finished OBS take (1.0, 1.1, 1.2 …) and copies it to
  the editing Mac.

### Keep file paths identical on both Macs

Premiere projects store full file paths. If the editing Mac sees your footage at a different path, every clip goes offline
when you open its project on your main Mac. Fix: on the editing Mac, create a disk image (a sparse bundle works) and name it
exactly like your footage drive, so it mounts at the same `/Volumes/<Drive name>` path. Copy each take into the same folder
structure (rsync over the network is fine). The real drive stays on your main Mac. Delete the editing Mac's copies once a video
ships, after checking the originals are safe.

## The order, every take

1. **Organize.** Import the take into its section's bin. Append the untouched take to the section's `RAW` sequence.
   Edit a scratch copy, never the RAW.
2. **Transcribe in Premiere.** Text panel > **Transcript** tab > blue **Transcribe** button for any clip without a
   transcript. Use Premiere's transcript for every decision after this. A second transcription service is optional, as a
   check only.
3. **Premiere's Pauses pass (click route).**
   - Click the **funnel** icon next to the Transcript search box > choose **Pauses**. The panel shows a count, e.g. "1/26 results".
   - Click **Delete** > keep **Extract** selected > **Delete all**.
   - Premiere switches the search back to Text afterward, so click the funnel > **Pauses** again. It usually finds more.
   - Repeat Delete > Extract > Delete all until a refreshed Pauses search says **No results**. Then save.
   - These controls usually aren't exposed to accessibility, so find them in a fresh screenshot every time. Never reuse old
     coordinates after a panel moves. Check the filter label really says Pauses before deleting (it's easy to hit Speakers).
4. **Pause Cut (waveform pass).** Premiere's pause detection leaves a lot of gaps behind. Clean them up from the audio itself:
   - Export or read the audio of the current timeline and find quiet runs (FFmpeg `silencedetect` is a fine first pass,
     e.g. −40 dB for 0.3 s). Treat its output as candidates, not answers.
   - Also review short gaps between words, down to about 0.1 s, including the gap where two cuts meet.
   - Keep a small quiet margin before each word starts and after it ends (start around 30–120 ms and tune by ear on your
     voice) so no syllable gets clipped.
   - Check the original source audio on both sides of every cut. If a cut bisects a word, move the edit to restore it.
   - Apply cuts from the end of the timeline backward, cutting video and audio together. After each cut, re-read the
     timeline and confirm it changed by exactly the planned amount. Save after each small batch.
5. **Bad takes.** Read the full transcript. Cut false starts, restarts and repeated lines. Keep the last complete version.
6. **Spoken directions.** The creator talks to the editor while recording, using a cue word that transcription spells
   reliably ("chat"). "Chat, cut that" means: remove the cue and the mistake right before it, keep the retry.
   A cue at the start of a new take can refer to the end of the previous take; trim that one too and log it.
7. **Pacing.** Cut dead air tight by default. Two exceptions:
   - **App-build previews** (scrolling a website you built, clicking through an app): after the tight pass, measure how
     much the app area of the screen changes frame to frame (crop out the webcam and any terminal panes). Put back up to
     1.5 s of each removed gap wherever the screen is visibly moving, so the viewer can see the build. Static gaps and
     talking stay tight.
   - **Spoken commands to an app:** keep the footage until the screen finishes changing (a fraction of a second after it
     settles, max about 3 s).
8. **Assemble.** Append the finished take to the end of the section's single `— REVIEW` sequence, tighten the join, delete
   the scratch copy, relink every video/audio pair, save, and write one log line: what was cut and why.

One REVIEW per section, renamed as it grows (`2.0–2.6 — REVIEW`). No per-take sequences.

## Verify, don't assume

- A click that didn't change the result count or the sequence duration didn't work.
- "No results" only certifies Premiere's pause pass. The waveform pass still has to run.
- Matching video and audio timestamps don't prove they're linked. Select each pair and link it, then check the saved project.
- The agent can't hear. Report what was checked on the waveform and what still needs a human listen.
- ExtendScript is old JavaScript: quote reserved words used as object keys (`"in"`, `"final"`), or the script won't run.
- A request that times out isn't cancelled. Wait for its result before sending the next edit; never replay it blindly.

## When Premiere gets stuck

Save after every step so nothing is lost. If a script request hangs for more than about 5 minutes and Premiere stops
responding: check the last save time, quit Premiere (force quit if needed), clear the stuck request from your bridge, reopen
the last project, dismiss any startup dialogs (crash report: Ignore) and re-run that step as a new request.

## Finishing, when asked

All through scripts in Premiere unless noted:
- **B-roll:** place on the track above the speaker, scale to fill the frame, remove its audio.
- **Punch-in jump cuts:** on a hard cut, scale the incoming clip to about 110–115% and move it so the eyes stay at the same
  height across the cut. If the lighting changed between takes, match it with a Lumetri exposure tweak.
- **Quote cards and lower thirds:** render them as video files (Python works), place them on the upper tracks, 2–3 s each.
  To update one, overwrite the file and refresh the media; it keeps its place.
- **Voice:** run the dialogue through Adobe Podcast Enhance (about 40%), finish to −14 LUFS and −1.5 dBTP, put it on its own
  track. Music bed under it, no ducking.
- **Export:** export stills to check the work, then the final video.

## Teach it your taste

Every time you correct the agent, add the correction to this file in your own words, with the date. That's how it learns.
Examples from mine: "Cut dead air tight." "One review sequence per section, not a pile." "Lower thirds 2–3 seconds."
