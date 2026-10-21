// gnome-zoomit v3 — zoom en vivo con click-through sobre GNOME Wayland.
//
// Mecanismo (el mismo que usa la lupa de accesibilidad de GNOME):
//   1. Clutter.Clone de Main.uiGroup (que contiene global.window_group).
//   2. Shell.util_set_hidden_from_pick para que el actor no consuma clicks.
//   3. El clone cubre el monitor entero, asi que oculta el original por
//      oclusion. No se toca la opacidad de uiGroup: eso apagaria el otro
//      monitor y provocaba parpadeos.
//
// El zoom esta anclado al puntero y recortado al monitor bajo el cursor:
// el contenido bajo el puntero siempre coincide con el pixel fisico, de modo
// que los clicks caen donde deben sin remapear input.
//
// Atajos por defecto (configurables en las preferencias de la extension):
//   Super+Arriba / Super+Abajo   acercar / alejar
//   Ctrl+Alt+Z                   activar / desactivar
//
// Se registran con Main.wm.addKeybinding, que ademas de hacer el grab llama a
// allowKeybinding y recarga el atajo solo cuando cambia el GSettings.

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

export default class ZoomItPocExtension extends Extension {
    enable() {
        this._active = false;
        this._factor = FACTOR_DEFAULT;
        this._view = null;
        this._root = null;
        this._bg = null;
        this._clone = null;
        this._monitor = null;
        this._watch = null;
        this._bindings = [];
        this._zoomBindings = [];
        this._lastX = 0;
        this._lastY = 0;

        this._settings = this.getSettings();
        this._wmSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.wm.keybindings',
        });

        // Si el shell murio con el zoom activo, devuelve a GNOME sus atajos
        // de maximizar/restaurar antes de volver a apartarlos.
        this._restoreConflicts();

        this._bind('toggle-zoom', Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            () => this._toggle(), this._bindings);

        // Solo para pruebas en gnome-shell anidado.
        if (GLib.getenv('ZOOMIT_AUTOSTART')) {
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
                console.log('[zoomit] autostart');
                this._toggle();
                console.log(`[zoomit] activo=${this._active}`);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _bind(name, flags, handler, list) {
        const action = Main.wm.addKeybinding(
            name, this._settings, flags, Shell.ActionMode.ALL, handler);

        if (action === Meta.KeyBindingAction.NONE)
            console.warn(`[zoomit] no se pudo registrar el atajo ${name}`);

        list.push(name);
    }

    /**
     * Acercar/alejar solo existen mientras el zoom esta activo. Asi
     * Super+Arriba/Abajo no le roban a GNOME maximizar/restaurar cuando no
     * se esta usando el zoom.
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

            // Contenedor recortado al monitor.
            this._view = new St.Bin({
                clip_to_allocation: true,
                reactive: false,
            });

            this._root = new Clutter.Actor({clip_to_allocation: true});

            // Fondo opaco: evita que se vea el original por pixels
            // translucidos (sombras, esquinas redondeadas).
            // Clutter.Color no es un constructor en GJS; se usa CSS.
            this._bg = new St.Widget({style: 'background-color: black;'});

            this._clone = new Clutter.Clone({source: Main.uiGroup});

            this._root.add_child(this._bg);
            this._root.add_child(this._clone);
            this._view.set_child(this._root);

            // Al stage, nunca a uiGroup: si estuviera dentro, se clonaria
            // a si mismo.
            global.stage.add_child(this._view);

            // Click-through: fuera del picking.
            Shell.util_set_hidden_from_pick(this._view, true);

            this._applyMonitor(this._monitor);
            this._factor = clampFactor(this._factor, ...this._factorLimits());
            this._clone.set_scale(this._factor, this._factor);
            this._active = true;

            // Super+Arriba/Abajo chocan con maximizar/restaurar de GNOME.
            // Se apartan solo mientras el zoom esta activo.
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
        const m = monitor;

        this._view.set_position(m.x, m.y);
        this._view.set_size(m.width, m.height);
        this._root.set_size(m.width, m.height);
        this._bg.set_size(m.width, m.height);
    }

    _update(x, y, force = false) {
        if (!this._clone)
            return;

        const monitor = this._monitorAt(x, y);
        if (monitor !== this._monitor) {
            this._monitor = monitor;
            this._applyMonitor(monitor);
        }

        if (!force && x === this._lastX && y === this._lastY)
            return;

        if (!force &&
            Math.abs(x - this._lastX) < MOVE_THRESHOLD &&
            Math.abs(y - this._lastY) < MOVE_THRESHOLD)
            return;

        const m = this._monitor;

        // Punto fijo en el puntero: el pixel bajo el cursor no se mueve y la
        // region visible queda siempre dentro del monitor. Ver zoom.js.
        const offset = cloneOffset(x, y, m, this._factor,
            ...this._factorLimits());

        // Traslacion (no posicion): mantiene la asignacion del clone intacta
        // y evita que el culling lo descarte al desplazarlo.
        this._clone.set_translation(offset.x, offset.y, 0);

        this._lastX = x;
        this._lastY = y;
    }

    _zoom(direction) {
        if (!this._active)
            return;

        const [min, max] = this._factorLimits();
        const step = this._settings.get_double('factor-step');

        this._factor = clampFactor(this._factor + direction * step, min, max);

        if (this._clone)
            this._clone.set_scale(this._factor, this._factor);

        this._update(this._lastX, this._lastY, true);
    }

    _deactivate() {
        this._active = false;

        for (const name of this._zoomBindings)
            Main.wm.removeKeybinding(name);
        this._zoomBindings = [];

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

    disable() {
        this._deactivate();

        for (const name of this._bindings)
            Main.wm.removeKeybinding(name);
        this._bindings = [];

        this._wmSettings = null;
        this._settings = null;
    }
}
