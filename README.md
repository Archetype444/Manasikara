# Wox.Plugin.Manasikāra

Made by AI but a bloody good plugin. this is for those, like me, who get distracted easily AND like to meditate. Have fun!

## Install and use

Requires Wox 2.4.5 or newer and Node.js 20 or newer. Open the `.wox` file from
`deliverables/` with Wox and confirm the update. The original plugin ID is
retained, so it updates ZenFlow/Manasikāra rather than installing a second copy.

| Command | Mode |
| --- | --- |
| `focus` | Continuous minute chimes and a log prompt every 15 clock minutes. |
| `deep` | Continuous deep focus: an initial low cue, then three-minute chimes; no logs. |
| `pom` | Plain Pomodoro, without minute chimes or logging. |
| `pom focus` | Minute chimes and logging at the beginning and end of work. |
| `pom deep` | Three-minute chimes and no logging. |
| `med` | Meditation. |
| `timer` | Countdown timer. |
| `mana` | Current session and available modes. |
| `mana help` | Operating guide. |

Durations accept natural language, seconds, hours, compound values and
until-times. Compact commands such as `med10` and `timer30s` are supported.
`mana pause`, `mana resume`, `mana stop`, `mana +5` and `mana skip` control the
applicable session. The full operating guide is in [src/README.md](src/README.md)
and the Wox plugin description.

Settings are in Wox Settings > Plugins > Wox.Plugin.Manasikāra. The `l ` log
prompt requires the separate capture plugin already installed by the user.

## Implementation and build

This is a persistent, host-loaded CommonJS SDK plugin, not a process-per-query
script. It uses Node's standard library and Wox Public API methods. There are
no runtime npm or pip dependencies and no import of `@wox-launcher/wox-plugin`.

A packaged SDK plugin is used because it includes 52 PCM sound files, the
original user-selected meditation recording and their provenance. An inline
single-file version would embed the same large audio library inside JavaScript
and materialize it into cache; the package keeps these assets inspectable.

The complete creator and submission skills used for the audit are in
`docs/wox-skills/`, including their scripts, assets and references. They were
downloaded from Wox-launcher/Wox on 11 October 2026.

No installation step is needed for JavaScript dependencies. To test:

```sh
node --test tests/regression.test.js
```

To package with Python's standard library:

```sh
python3 tools/package.py --chime brass --meditation mudita --finish bowl
```

On Windows, use `python` instead of `python3` if that is your installed command.
The Makefile provides `make init`, `make test` and `make package` equivalents.

## GitHub and releases

The intended repository name is `Wox.Plugin.Manasikara`; GitHub repository
names use the ASCII spelling while the plugin retains the macron in its name.
Source repository: https://github.com/Archetype444/Wox.Plugin.Manasikara.
A release asset has not yet been published.

Publication of the remaining sound files, including the supplied Mudita
meditation recording, is pending explicit approval. Those files are currently
omitted, so this checkout cannot yet build or pass the sound-integrity tests.
The complete local package retains the full sound library.

The GitHub Actions workflow tests and builds the package on pushes, pull
requests and manual runs. A matching version tag, such as `v2.0.1`, publishes
the tested `.wox` as a GitHub release asset. It uses the workflow's built-in
token; no account token belongs in source code or settings.

The workflow sets `Website` to the actual repository URL before packaging.
Local metadata points to this repository. To change the repository URL:

```sh
python3 tools/set_repository.py --url https://github.com/OWNER/REPOSITORY
```

The placeholder above is command documentation, not shipped plugin metadata.

## Validation and distribution

All 28 automated checks pass, including package extraction, command parsing,
mode transitions, clock-minute cues, log routing, restart recovery, selected
sound integrity and a simulated Windows audio worker. A running Wox instance
and live Windows playback were unavailable in the build environment. See
[docs/VALIDATION.md](docs/VALIDATION.md) for the remaining live checks.

No Wox store entry or submission PR has been made. Store publication requires
a public repository, an installable `.wox` release, a stable public icon URL,
duplicate checking and separate user approval. See
[docs/STORE-READINESS.md](docs/STORE-READINESS.md).

Sound licensing and provenance are in `src/sounds/CREDITS.txt` and
`src/sounds/mudita/SOURCE.json`. The three bowl profiles are CC0. The supplied
Mudita recording is not claimed to be CC0. Downloaded Wox skill material
retains its upstream GNU GPL v3 license in `docs/wox-skills/LICENSE`.
