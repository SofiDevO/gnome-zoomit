// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 SofiDevO
//
// gnome-zoomit v3 — live zoom with click-through on GNOME Wayland.
//
// Mechanism (the same one used by GNOME's accessibility magnifier):
//   1. Clutter.Clone of Main.uiGroup (which contains global.window_group).
//   2. Shell.util_set_hidden_from_pick so the actor does not consume clicks.
//   3. The clone covers the entire monitor, hiding the original through
//      occlusion. uiGroup opacity is left untouched: changing it would dim
//      the other monitor and cause flickering.
//
// Zoom is anchored to the pointer and clipped to the monitor under the cursor:
// away from the edges, the content under the pointer matches the physical
// pixel, so clicks land where expected without remapping input. Within
// EDGE_DRIFT / (f - 1) px of an edge the view snaps to that edge so dock and
// panel icons are not cropped.
//
// Default shortcuts (configurable in the extension preferences):
//   Super+Up / Super+Down   zoom in / out
//   Ctrl+Alt+Z              toggle
//
// They are registered with Main.wm.addKeybinding, which also grabs the key,
// calls allowKeybinding, and reloads the shortcut only when GSettings changes.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {cloneOffset, clampFactor} from './zoom.js';

const FACTOR_DEFAULT = 2.0;
const WATCH_MS = 33;
const MOVE_THRESHOLD = 2;
const AUTOSTART_DELAY_S = 3;

export default class ZoomitExtension extends Extension {
    enable() {
        this._active = false;
        this._factor = FACTOR_DEFAULT;
        this._view = null;
        this._root = null;
        this._bg = null;
        this._clone = null;
        this._monitor = null;
        this._watch = null;
        this._autostartId = 0;
        this._bindings = [];
        this._zoomBindings = [];
        this._lastX = 0;
        this._lastY = 0;

        this._settings = this.getSettings();
        this._wmSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.wm.keybindings',
        });

        // If the shell exited while zoom was active, restore GNOME's
        // maximize/restore shortcuts before suspending them again.
        this._restoreConflicts();

        this._bind('toggle-zoom', Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            () => this._toggle(), this._bindings);

        // Only for tests in a nested gnome-shell.
        if (GLib.getenv('ZOOMIT_AUTOSTART')) {
            this._autostartId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, AUTOSTART_DELAY_S, () => {
                    this._autostartId = 0;
                    this._toggle();
                    return GLib.SOURCE_REMOVE;
                });
        }
    }

    disable() {
        this._deactivate();

        this._removeBindings(this._bindings);

        if (this._autostartId) {
            GLib.Source.remove(this._autostartId);
            this._autostartId = 0;
        }

        this._wmSettings = null;
        this._settings = null;
    }

    _bind(name, flags, handler, list) {
        const action = Main.wm.addKeybinding(
            name, this._settings, flags, Shell.ActionMode.ALL, () => {
                handler();
                // Meta forwards the event to the focused window unless the
                // handler reports it as consumed.
                return true;
            });

        if (action === Meta.KeyBindingAction.NONE)
            console.warn(`[zoomit] no se pudo registrar el atajo ${name}`);

        list.push(name);
    }

    _removeBindings(list) {
        for (const name of list)
            Main.wm.removeKeybinding(name);
        list.length = 0;
    }

    _setFactor(factor, min, max) {
        this._factor = clampFactor(factor, min, max);
        this._clone.set_scale(this._factor, this._factor);
    }

    /**
    * Zoom-in/out shortcuts exist only while zoom is active. This way,
    * Super+Up/Down do not take GNOME's maximize/restore actions when zoom
    * is not in use.
     */
    _suspendConflicts() {
        if (this._settings.get_boolean('conflicts-suspended'))
            this._restoreConflicts();

        const zoomIn = this._settings.get_strv('zoom-in');
        const zoomOut = this._settings.get_strv('zoom-out');
        const maximize = this._wmSettings.get_strv('maximize');
        const unmaximize = this._wmSettings.get_strv('unmaximize');
        const newMaximize = maximize.filter(a => !zoomIn.includes(a));
        const newUnmaximize = unmaximize.filter(a => !zoomOut.includes(a));

        if (newMaximize.length === maximize.length &&
            newUnmaximize.length === unmaximize.length)
            return;

        this._settings.set_strv('saved-maximize', maximize);
        this._settings.set_strv('saved-unmaximize', unmaximize);
        this._settings.set_boolean('conflicts-suspended', true);

        this._wmSettings.set_strv('maximize', newMaximize);
        this._wmSettings.set_strv('unmaximize', newUnmaximize);
    }

    _restoreConflicts() {
        if (!this._settings.get_boolean('conflicts-suspended'))
            return;

        this._wmSettings.set_strv('maximize',
            this._settings.get_strv('saved-maximize'));
        this._wmSettings.set_strv('unmaximize',
            this._settings.get_strv('saved-unmaximize'));

        this._settings.set_boolean('conflicts-suspended', false);
        this._settings.set_strv('saved-maximize', []);
        this._settings.set_strv('saved-unmaximize', []);
    }

    _factorLimits() {
        return [
            this._settings.get_double('factor-min'),
            this._settings.get_double('factor-max'),
        ];
    }

    _toggle() {
        if (this._active)
            this._deactivate();
        else
            this._activate();
    }

    _activate() {
        try {
            const [px, py] = global.get_pointer();
            this._monitor = this._monitorAt(px, py);

            // Container clipped to the monitor.
            this._view = new St.Bin({
                clip_to_allocation: true,
                reactive: false,
            });

            this._root = new Clutter.Actor({clip_to_allocation: true});

            // Opaque background: prevents the original from showing through
            // translucent pixels (shadows, rounded corners).
            // Clutter.Color is not a constructor in GJS; use CSS instead.
            this._bg = new St.Widget({style: 'background-color: black;'});

            this._clone = new Clutter.Clone({source: Main.uiGroup});

            this._root.add_child(this._bg);
            this._root.add_child(this._clone);
            this._view.set_child(this._root);

            // Add to the stage, never to uiGroup: otherwise it would clone
            // itself.
            global.stage.add_child(this._view);

            // Click-through: exclude it from picking.
            Shell.util_set_hidden_from_pick(this._view, true);

            this._applyMonitor(this._monitor);
            this._setFactor(this._factor, ...this._factorLimits());
            this._active = true;

            // Super+Up/Down conflict with GNOME's maximize/restore actions.
            // Suspend them only while zoom is active.
            this._suspendConflicts();
            this._bind('zoom-in', Meta.KeyBindingFlags.NONE,
                () => this._zoom(1), this._zoomBindings);
            this._bind('zoom-out', Meta.KeyBindingFlags.NONE,
                () => this._zoom(-1), this._zoomBindings);

            this._update(px, py, true);

            this._watch = PointerWatcher.getPointerWatcher()
                .addWatch(WATCH_MS, (x, y) => this._update(x, y));
        } catch (e) {
            console.error(`[zoomit] fallo al activar: ${e}`);
            this._deactivate();
            throw e;
        }
    }

    _monitorAt(x, y) {
        return Main.layoutManager.monitors.find(m =>
            x >= m.x && x < m.x + m.width &&
            y >= m.y && y < m.y + m.height)
            ?? this._monitor
            ?? Main.layoutManager.primaryMonitor;
    }

    _applyMonitor(monitor) {
        this._view.set_position(monitor.x, monitor.y);
        this._view.set_size(monitor.width, monitor.height);
        this._root.set_size(monitor.width, monitor.height);
        this._bg.set_size(monitor.width, monitor.height);
    }

    _update(x, y, force = false) {
        if (!this._clone)
            return;

        const monitor = this._monitorAt(x, y);
        if (monitor !== this._monitor) {
            this._monitor = monitor;
            this._applyMonitor(monitor);
        }

        if (!force &&
            Math.abs(x - this._lastX) < MOVE_THRESHOLD &&
            Math.abs(y - this._lastY) < MOVE_THRESHOLD)
            return;

        // Keep the pointer as a fixed point away from the edges; near them the
        // view snaps to the boundary so docks and panels stay visible. See
        // zoom.js.
        const [min, max] = this._factorLimits();
        const offset = cloneOffset(x, y, this._monitor, this._factor, min, max);

        // The limits may have changed through preferences while zooming.
        // Keep scale in sync with the offset that was actually applied.
        if (offset.factor !== this._factor)
            this._setFactor(offset.factor, min, max);

        // Use translation (not position): this keeps the clone's allocation
        // intact and prevents culling from discarding it when moved.
        this._clone.set_translation(offset.x, offset.y, 0);

        this._lastX = x;
        this._lastY = y;
    }

    _zoom(direction) {
        if (!this._active)
            return;

        const [min, max] = this._factorLimits();
        const step = this._settings.get_double('factor-step');

        this._setFactor(this._factor + direction * step, min, max);
        this._update(this._lastX, this._lastY, true);
    }

    _deactivate() {
        this._active = false;

        this._removeBindings(this._zoomBindings);

        this._restoreConflicts();

        if (this._watch) {
            this._watch.remove();
            this._watch = null;
        }

        if (this._view) {
            this._view.destroy();
            this._view = null;
        }

        this._root = null;
        this._bg = null;
        this._clone = null;
        this._monitor = null;
    }
}
