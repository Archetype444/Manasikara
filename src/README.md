# Wox.Plugin.Manasikāra 2.0.1

Requires Wox 2.4.5 or newer and its Node.js plugin runtime. Open the `.wox`
file with Wox and confirm the update. The original plugin ID is retained, so
this replaces ZenFlow and keeps compatible settings. The command is now `mana`.

## Modes

| Command | Operation |
| --- | --- |
| `focus` | Continuous focus: minute chimes, a log prompt every 15 clock minutes, no breaks. |
| `deep` | Continuous deep focus: an initial low cue, then three-minute chimes; no logging or breaks. |
| `pom` | Choose a Pomodoro variant; the first result has no minute chimes or logging. |
| `pom focus` | Focus Pomodoro: minute chimes and a log prompt at the beginning and end of work. |
| `pom deep` | Deep Pomodoro: three-minute chimes and no logging. |
| `med` | Meditation with the selected recording at the end. |
| `timer` | Countdown with the selected timer ending sound. |
| `mana` | Current session, mode choices and controls. |
| `mana help` | Operating guide. |

`focus` and `deep` run indefinitely until stopped. Logging never ends or pauses
focus: each 15-minute cycle leads straight into the next. Their elapsed-time
display counts upwards. Adding an optional duration makes a bounded focus or
deep session; it still does not create a Pomodoro or start a break.

`pomodoro` is an alias for `pom`. A duration can come before or after a Pomodoro
variant. `focus pom` and `deep pom` also select the corresponding Pomodoro.
Short and long breaks use the settings in Wox. Automatic starts are optional.
The chosen Pomodoro variant and custom work duration carry through the cycle.
Breaks are quiet until their ending sound. Focus Pomodoro logs at work start
and work end only, including automatic work starts; it does not log every
15 minutes during work. Plain and deep Pomodoro never open a log prompt.

## Durations and controls

Bare numbers mean minutes. Durations accept seconds, minutes, hours, compounds,
decimals, fractions and English number words. Compact forms such as `med10`,
`timer30s`, `pom25` and `pom25 deep` work. `MM:SS` and `HH:MM:SS` are supported.
An `until` expression, such as `until 5pm`, uses the computer's local time.
An unspecified day chooses the next occurrence; `today` and `tomorrow` can
make the day explicit. A countdown can last one second to seven days.

- `mana pause` / `mana resume`: pause and resume the current session.
- `mana stop`: stop the session and silence any sound still playing.
- `mana +5` / `mana +30 seconds` / `mana extend <duration>`: extend a countdown.
- `mana skip`: end a Pomodoro or break early and prepare the next interval.
  It does not start that interval or count a completed work interval.
- Enter on a running session pauses it; Enter on a paused session resumes it.
  The Wox action menu provides Stop and the other applicable controls.

One session runs at a time. Starting another replaces the current session.

## Chime timing and logs

Chimes play on system-minute boundaries. The first boundary after starting or
resuming is minute 1. Focus uses pitches 1 through 15, then repeats. Deep gives
a low pitch at the first boundary, then pitches 3, 6, 9, 12 and 15 at the third,
sixth, ninth, twelfth and fifteenth boundaries. Thereafter it continues every
three minutes, repeating pitches 3, 6, 9, 12 and 15. Each resume restarts the
pitch cycle with its initial low cue. Missed chimes after sleep are skipped;
when an ending coincides with a chime, the ending sound takes priority.

A log prompt opens Wox with `l ` ready to type. Enter submits through your
existing capture plugin; Escape dismisses it. Manasikāra never writes a daily
note itself. If Wox is already visible, a prompt waits up to one minute to
avoid replacing your current query. Stopping or replacing a session cancels
its queued prompts. A Focus Pomodoro work-end prompt remains valid when its
automatic break starts. Log prompts can be disabled in Wox plugin settings.

Wox must remain running. Obsidian is not needed for timing. Sessions are saved
locally and restored after restarting Wox. A countdown that ended while Wox
was closed is cleared silently. On upgrade, an active old focus countdown is
restored as a Pomodoro, keeping its previous duration and chime mode.

## Sounds and settings

The selected defaults are unchanged:

- Chimes: Brass bowl, 35% volume.
- Meditation ending: the supplied Mudita Bell - Melodic Mirth, 65% volume.
  The complete recording plays once at its original pitch with a four-second
  fade-in. The original MP3 is included alongside its playback copy.
- Timer, Pomodoro and break endings: Soft bowl, 65% volume.

Sounds, volumes, default durations and automatic transitions are in
Wox Settings > Plugins > Wox.Plugin.Manasikāra. Zero volume mutes that category.
`mana sounds` can preview the bundled recordings. There is no daily progress
tracking. Other plugins, including TaskNotes capture, are unchanged.

The three bowl recordings are CC0; credits are in `sounds/CREDITS.txt`.
The supplied Mudita recording has its separate provenance in
`sounds/mudita/SOURCE.json` and is not represented as CC0.

## Verification

Automated checks cover command parsing, continuous and Pomodoro modes,
clock-minute scheduling, log prompts, pause/resume, upgrades, sound defaults,
recording integrity and the Windows audio protocol using a simulated process.
Actual playback and Wox window behaviour still require Windows. Audio errors
appear as notifications and in the plugin results.
