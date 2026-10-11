# Validation

The 28 automated regression tests pass against source and the extracted `.wox`
package. They cover command parsing and natural-language durations, indefinite
sessions, all Pomodoro variants, exact wall-clock boundaries, log queues,
pause/resume, transitions, restart recovery, upgrade identity, MRU restoration,
settings and sound selections. The full supplied recording is checked by
SHA-256. Windows audio control is tested with a simulated persistent process.

These checks do not constitute live Wox validation. This build environment is
Linux with Node.js 24.19.0 and has no Wox executable or access to the user's
Windows desktop. No plugin was installed into a running Wox instance here.

## Representative Windows checks

After installing the `.wox`, keep Wox running and check:

1. `timer2s`: Enter hides Wox; Soft bowl plays at the end.
2. `med2s`: Enter hides Wox; the complete supplied recording plays gradually.
   `mana stop` silences it even after the countdown is finished.
3. `focus`: minute cues align with the system clock; the fifteenth cue opens
   `l `, and timing continues after submitting or dismissing the log.
4. `deep`: low cue at the first minute boundary, then cues at minutes 3, 6, 9,
   12 and 15. There are no log prompts or automatic breaks.
5. `pom`: plain Pomodoro has no minute cues or logging; breaks follow settings.
6. `pom focus`: logs at both the beginning and end of work; minute 15 during
   work does not create another log. A work-end log can appear during a break.
7. `pom deep`: three-minute work cues, no logs, quiet breaks.
8. Pause/resume, restart Wox and confirm the correct session is restored.
9. Keep a different Wox query open when a log becomes due; it must not be
   overwritten. Stop or replace a session with a waiting prompt; it must cancel.

## SDK audit

- Node runtime chosen by the official detector; no external runtime dependencies.
- Persistent CommonJS SDK entry, with bound callbacks and QueryResponse results.
- Wox 2.4.5 minimum retained for Plugin Tools.
- Original plugin ID retained for compatible settings/session upgrades.
- Preferences use the settings API; every preference is explicitly shared
  across platforms. Machine-local sessions and audio cache use GetCacheFolder.
- Distinct clock result icons, monochrome action icons, execution lightning.
- Stable identities and memory-only MRU restoration for durable start rows.
- No HTML previews, unnecessary hotkeys or query-selection feature.
- Toolkit metadata marks timer starts as UI-capable because focus can prompt.
- Scores use the documented range; running status stays above start choices.

Version 2.0.1 adds the requested full plugin name and verified GitHub author,
explicit settings scope, SDK-compatible scoring and action metadata. It keeps
the version 2.0 session and audio behaviour.
