// Preferencias de gnome-zoomit. Se abren desde el icono de engranaje de
// Extension Manager o con: gnome-extensions prefs zoomit-poc@sofidev

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHORTCUTS = [
    {
        key: 'toggle-zoom',
        title: 'Activar / desactivar',
        subtitle: 'Muestra u oculta el zoom',
    },
    {
        key: 'zoom-in',
        title: 'Acercar',
        subtitle: 'Sube un paso el factor de zoom',
    },
    {
        key: 'zoom-out',
        title: 'Alejar',
        subtitle: 'Baja un paso el factor de zoom',
    },
];

const MODIFIER_KEYS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_Caps_Lock, Gdk.KEY_Num_Lock,
]);

export default class ZoomItPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._settings = this.getSettings();
        this._labels = new Map();

        window.set_default_size(560, 600);
        window.add(this._shortcutsPage(window));
        window.add(this._zoomPage());
    }

    _shortcutsPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'Atajos',
            icon_name: 'preferences-desktop-keyboard-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Teclas',
            description: 'Pulsa una fila para grabar una combinacion nueva. ' +
                'Super+Arriba y Super+Abajo pueden estar ocupados por ' +
                'maximizar y restaurar de GNOME.',
        });

        for (const {key, title, subtitle} of SHORTCUTS) {
            const row = new Adw.ActionRow({
                title,
                subtitle,
                activatable: true,
            });

            const label = new Gtk.ShortcutLabel({
                accelerator: this._settings.get_strv(key)[0] ?? '',
                disabled_text: 'Sin asignar',
                valign: Gtk.Align.CENTER,
            });

            this._labels.set(key, label);
            row.add_suffix(label);
            row.connect('activated', () => {
                this._record(window, key, label);
            });
            group.add(row);
        }

        const reset = new Adw.ButtonRow({
            title: 'Restablecer atajos',
            start_icon_name: 'edit-undo-symbolic',
        });
        reset.connect('activated', () => {
            for (const {key} of SHORTCUTS)
                this._settings.reset(key);
            this._refreshLabels();
        });
        group.add(reset);

        page.add(group);
        return page;
    }

    _zoomPage() {
        const page = new Adw.PreferencesPage({
            title: 'Zoom',
            icon_name: 'zoom-in-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Factor',
            description: '1x muestra el monitor completo. El maximo se ' +
                'aplica al acercar con el atajo.',
        });

        this._spinRow(group, 'factor-min', 'Minimo',
            'Factor mas bajo', 1.0, 5.0);
        this._spinRow(group, 'factor-max', 'Maximo',
            'Factor mas alto', 2.0, 20.0);
        this._spinRow(group, 'factor-step', 'Paso',
            'Cuanto cambia en cada pulsacion', 0.1, 2.0);

        page.add(group);
        return page;
    }

    _spinRow(group, key, title, subtitle, lower, upper) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            digits: 2,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: 0.25,
                page_increment: 1.0,
                value: this._settings.get_double(key),
            }),
        });

        row.connect('notify::value', () => {
            this._settings.set_double(key, row.get_value());
        });

        group.add(row);
    }

    _refreshLabels() {
        for (const [key, label] of this._labels)
            label.set_accelerator(this._settings.get_strv(key)[0] ?? '');
    }

    _record(window, key, label) {
        const dialog = new Adw.Window({
            transient_for: window,
            modal: true,
            title: 'Nuevo atajo',
            default_width: 400,
            default_height: 220,
            resizable: false,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });

        const title = new Gtk.Label({
            label: 'Pulsa la combinacion',
            css_classes: ['title-3'],
        });

        const preview = new Gtk.ShortcutLabel({
            accelerator: label.get_accelerator(),
            disabled_text: 'Sin asignar',
            halign: Gtk.Align.CENTER,
        });

        const hint = new Gtk.Label({
            label: 'Debe incluir Ctrl, Alt o Super. Esc cancela.',
            wrap: true,
            justify: Gtk.Justification.CENTER,
        });
        hint.add_css_class('dim-label');

        const cancel = new Gtk.Button({
            label: 'Cancelar',
            halign: Gtk.Align.CENTER,
        });
        cancel.connect('clicked', () => dialog.close());

        box.append(title);
        box.append(preview);
        box.append(hint);
        box.append(cancel);
        dialog.set_content(box);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_controller, keyval, _code, state) => {
            if (keyval === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            if (MODIFIER_KEYS.has(keyval))
                return Gdk.EVENT_PROPAGATE;

            const mods = state & Gtk.accelerator_get_default_mod_mask();
            const required = Gdk.ModifierType.CONTROL_MASK |
                Gdk.ModifierType.ALT_MASK |
                Gdk.ModifierType.SUPER_MASK;

            if ((mods & required) === 0) {
                hint.set_label('Anade Ctrl, Alt o Super');
                return Gdk.EVENT_STOP;
            }

            const accelerator = Gtk.accelerator_name(keyval, mods);
            const [ok] = Gtk.accelerator_parse(accelerator);
            if (!ok) {
                hint.set_label('Combinacion no valida');
                return Gdk.EVENT_STOP;
            }

            this._settings.set_strv(key, [accelerator]);
            label.set_accelerator(accelerator);
            dialog.close();
            return Gdk.EVENT_STOP;
        });

        dialog.add_controller(controller);
        dialog.present();
    }
}
