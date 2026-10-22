# gnome-zoomit

Live zoom with click-through for GNOME Shell on Wayland, inspired by
[ZoomIt](https://learn.microsoft.com/sysinternals/downloads/zoomit) from
Sysinternals.

Unlike tools that capture the screen with PipeWire, this extension clones the
compositor actor tree. The result is zooming over live content: video, GIFs,
animations, and interactive windows continue to work, and clicks pass through
the zoom to the real window.

## Features

- Live zoom using `Clutter.Clone` from `Main.uiGroup`.
- Click-through: the pointer and clicks still reach the window underneath.
- Pointer anchoring: the pixel under the cursor does not move, except near a
  screen edge, where the view snaps to the edge so dock and panel icons stay
  visible.
- Multi-monitor: the view is clipped to the monitor under the cursor.
- Configurable shortcuts from the extension preferences.
- Configurable zoom range: 1x to 20x (10x by default).
- No screen capture, no PipeWire, and no `ydotool`.
- Compatible with playing video and GIFs.

## Requirements

| Component | Version |
|---|---|
| GNOME Shell | 48 (tested on 48.7) |
| Mutter | 48 |
| GJS | 1.82 |
| Session | Wayland (recommended) |
| Distro | Debian 13 or any distro with GNOME 48 |

It has not been tested on GNOME 49 or X11.

## Installation

### Manual installation

```bash
git clone https://github.com/SofiDevO/gnome-zoomit.git
cd gnome-zoomit
```

Copy the extension into the user extensions directory. The directory name must
match the UUID exactly: `gnome-zoomit@SofiDevO`.

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
cp -r extension ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO
glib-compile-schemas ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO/schemas
```

This creates a self-contained copy. The installed extension no longer depends on
the repository: you can delete the clone later and it keeps working.

Enable the extension:

```bash
gnome-extensions enable gnome-zoomit@SofiDevO
gnome-extensions info gnome-zoomit@SofiDevO
```

On Wayland, GNOME Shell only discovers new extensions when you log in. Log out
and back in. After that, the extension appears as `gnome-zoomit` in Extension
Manager.

Check that it is enabled:

```bash
gnome-extensions list --enabled | grep gnome-zoomit
```

The UUID `gnome-zoomit@SofiDevO` identifies the extension and its preferences
directory. If you change it in `extension/metadata.json`, you must also rename
the installed directory; otherwise the extension and its settings will no longer
be found.

### Updating an installed copy

After pulling or writing fixes in the repository, deploy them to the installed
copy:

```bash
rm -rf ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO
cp -r extension ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO
glib-compile-schemas ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO/schemas
```

Log out and back in so GNOME Shell loads the new code. The repository can be
removed afterwards without affecting the installed extension.

### Development installation

Only for working on the code. This creates a symlink, so the installed extension
depends on the repository: deleting or moving the checkout breaks it.

To work on the repository without copying files:

```bash
rm -rf ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO
ln -sfn "$PWD/extension" ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO
glib-compile-schemas extension/schemas
```

The `rm -rf` prevents `ln` from creating the symlink inside a previous copy.
Do not use the symlink for a normal installation; use the copy above instead.

Any change to `extension.js`, `prefs.js`, `metadata.json`, or the schema requires
logging out and back in. On Wayland there is no `Alt+F2` + `r`.

## Usage

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+Z` | Toggle zoom on or off |
| `Super+Up` | Zoom in |
| `Super+Down` | Zoom out |

`Super+Up` and `Super+Down` only control zoom while it is active. When zoom is
disabled they keep their normal GNOME maximize and restore behavior.

### Preferences

Open Extension Manager, search for `gnome-zoomit`, and click the gear icon.
Alternatively:

```bash
gnome-extensions prefs gnome-zoomit@SofiDevO
```

From there you can:

- Record new shortcuts to activate, zoom in, and zoom out.
- Change the minimum, maximum, and step factors.
- Restore the default shortcuts.

## How it works

1. A `Clutter.Clone` of `Main.uiGroup` is created, which includes
   `global.window_group`: windows, video, and animations.
2. The clone is painted inside an `St.Bin` clipped to the monitor under the
   pointer.
3. `Shell.util_set_hidden_from_pick()` removes the actor from picking, so clicks
   pass through the zoom and reach the real window below.
4. An opaque background prevents shadows or translucent edges from the original
   from showing through.
5. The zoom uses the pointer as the fixed point. With scale `f`, monitor `m`,
   and pointer `p`, the offset is:

   ```text
   P = (p - m) - p * f
   ```

   This keeps the pixel under the cursor fixed, and the visible region never
   leaves the monitor.

   Close to an edge, that anchoring would crop exactly what you want to point
   at: at 2x, with the cursor 50 px from the left edge, the view starts at
   25 px and hides the first 25 px of the dock. The extension pins the view to
   the edge in a band of `EDGE_DRIFT / (f - 1)` pixels (96 px at 2x) and blends
   back to pointer anchoring over the next band, using `smoothstep` so there is
   no jump. Inside the pinned band the view stands still and the cursor moves
   over the magnified image; the offset between the cursor and the content
   below it peaks at about 1.1 × `EDGE_DRIFT` (~105 px) and is zero at the exact
   edge.
6. The pointer is tracked at 30 Hz with a 2 px threshold to reduce work.
7. `Super+Up/Down` conflicts with GNOME maximize/restore. While zoom is active,
   the extension temporarily removes those shortcuts from the WM and restores
   them when disabled. If the shell exits abnormally, they are restored on
   startup.

The mechanism is the same one used by GNOME's accessibility magnifier
(`js/ui/magnifier.js`).

## Project structure

```text
gnome-zoomit/
├── README.md
├── extension/
│   ├── metadata.json
│   ├── extension.js
│   ├── prefs.js
│   ├── zoom.js
│   └── schemas/
│       └── org.gnome.shell.extensions.zoomit.gschema.xml
└── tests/
    └── test-zoom.mjs
```

## Tests

The zoom math is isolated from GNOME and is tested with Node:

```bash
node tests/test-zoom.mjs
```

Try it in a nested shell:

```bash
ZOOMIT_AUTOSTART=1 dbus-run-session -- gnome-shell --nested --wayland
```

Capturing the nested shell is not allowed by D-Bus; visual verification of video,
GIF, and click-through is done in a real session.

## Packaging

To generate an installable zip from the repo root:

```bash
cd gnome-zoomit
gnome-extensions pack extension --force --extra-source=zoom.js
```

The zip is generated as `gnome-zoomit@SofiDevO.shell-extension.zip`.

`gnome-extensions pack` does not automatically include JavaScript modules other
than `extension.js` or `prefs.js`. `zoom.js` must be passed with
`--extra-source=zoom.js`; if omitted, the extension fails to import it.

The zip includes the schema XML but not the compiled gschema artifact
(`gschemas.compiled`, a local build artifact not versioned). When installing, compile
the schema if the installer did not already do so:

```bash
glib-compile-schemas \
    ~/.local/share/gnome-shell/extensions/gnome-zoomit@SofiDevO/schemas
```

## Limitations

- No free panning: the view follows the pointer; it cannot be moved
  independently without remapping compositor input.
- No annotations yet.
- No scaled cursor: the real compositor cursor is used. Inside the edge band
  the cursor is over magnified content while clicks still land at the physical
  pointer position, so a click near a screen edge can hit a different element
  than the one under the cursor.
- The clone repaints the desktop at 30 Hz; on modest hardware it can be noticed.
- A custom shortcut that conflicts with another GNOME shortcut may not trigger.
- Tested only on GNOME Shell 48 / Wayland.

## Roadmap

- [ ] Cairo annotations on `St.DrawingArea`.
- [ ] Drawing mode with reactive actor.
- [ ] Packaging for extensions.gnome.org and `.deb`.
- [ ] GNOME 49 support.
- [ ] Independent panning from the pointer.

## Status

Working PoC. Validated on GNOME Shell 48.7, Debian 13, Wayland, and dual
monitors. Zoom, click-through, and configurable shortcuts are implemented; the
final visual validation is done in a real session.

## Credits

- Inspired by [ZoomIt](https://learn.microsoft.com/sysinternals/downloads/zoomit)
  from Sysinternals.
- The clone and click-through mechanism follows GNOME's accessibility magnifier
  (`js/ui/magnifier.js`).

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).
