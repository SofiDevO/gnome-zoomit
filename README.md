# gnome-zoomit

Zoom en vivo con click-through para GNOME Shell en Wayland, inspirado en
[ZoomIt](https://learn.microsoft.com/sysinternals/downloads/zoomit) de
Sysinternals.

A diferencia de las herramientas que capturan la pantalla con PipeWire, esta
extensión clona el árbol de actores del compositor. El resultado es zoom sobre
contenido vivo: video, GIFs, animaciones y ventanas interactivas siguen
funcionando, y los clics atraviesan el zoom hasta la ventana real.

## Características

- Zoom en vivo con `Clutter.Clone` de `Main.uiGroup`.
- Click-through: el puntero y los clics siguen llegando a la ventana de debajo.
- Anclaje al puntero: el píxel bajo el cursor no se mueve.
- Multi-monitor: la vista se recorta al monitor bajo el cursor.
- Atajos configurables desde las preferencias de la extensión.
- Rango de zoom configurable: 1x a 20x (10x por defecto).
- Sin captura de pantalla, sin PipeWire y sin `ydotool`.
- Compatible con video y GIFs en reproducción.

## Requisitos

| Componente | Versión |
|---|---|
| GNOME Shell | 48 (probado en 48.7) |
| Mutter | 48 |
| GJS | 1.82 |
| Sesión | Wayland (recomendado) |
| Distro | Debian 13 o cualquier distro con GNOME 48 |

No se ha probado en GNOME 49 ni en X11.

## Instalación

### Instalación manual

```bash
git clone https://github.com/TU_USUARIO/gnome-zoomit.git
cd gnome-zoomit
```

Sustituye `TU_USUARIO` por tu usuario de GitHub.

Copia la extensión al directorio de extensiones de usuario. El nombre del
directorio debe coincidir con el UUID `zoomit-poc@sofidev`:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
cp -r extension ~/.local/share/gnome-shell/extensions/zoomit-poc@sofidev
glib-compile-schemas ~/.local/share/gnome-shell/extensions/zoomit-poc@sofidev/schemas
```

Activa la extensión:

```bash
gnome-extensions enable zoomit-poc@sofidev
gnome-extensions info zoomit-poc@sofidev
```

En Wayland, GNOME Shell solo descubre extensiones nuevas al iniciar sesión.
Cierra sesión y vuelve a entrar. Después, la extensión aparece como
`gnome-zoomit` en Extension Manager.

El UUID `zoomit-poc@sofidev` se conserva para no romper instalaciones y
preferencias existentes; el nombre visible es `gnome-zoomit`.

### Instalación para desarrollo

Para trabajar sobre el repositorio sin copiar archivos:

```bash
ln -sfn "$PWD/extension" ~/.local/share/gnome-shell/extensions/zoomit-poc@sofidev
glib-compile-schemas extension/schemas
```

Cada cambio en `extension.js`, `prefs.js`, `metadata.json` o el esquema
requiere cerrar sesión y volver a entrar. En Wayland no existe `Alt+F2` + `r`.

## Uso

| Atajo | Acción |
|---|---|
| `Ctrl+Alt+Z` | Activar o desactivar el zoom |
| `Super+Arriba` | Acercar |
| `Super+Abajo` | Alejar |

`Super+Arriba` y `Super+Abajo` solo controlan el zoom mientras está activo.
Cuando el zoom está desactivado conservan su función normal de maximizar y
restaurar ventanas.

### Preferencias

Abre Extension Manager, busca `gnome-zoomit` y pulsa el engranaje. También:

```bash
gnome-extensions prefs zoomit-poc@sofidev
```

Desde ahí puedes:

- Grabar nuevos atajos para activar, acercar y alejar.
- Cambiar el factor mínimo, máximo y el paso.
- Restablecer los atajos por defecto.

## Cómo funciona

1. Se crea un `Clutter.Clone` de `Main.uiGroup`, que incluye
   `global.window_group`: ventanas, video y animaciones.
2. El clone se pinta dentro de un `St.Bin` recortado al monitor bajo el
   puntero.
3. `Shell.util_set_hidden_from_pick()` saca el actor del picking, así que los
   clics atraviesan el zoom y llegan a la ventana real.
4. Un fondo opaco evita que se vean sombras o bordes translúcidos del original.
5. El zoom usa el puntero como punto fijo. Con escala `f`, monitor `m` y
   puntero `p`, el desplazamiento es:

   ```text
   P = (p - m) - p * f
   ```

   Así el píxel bajo el cursor no se mueve y la región visible nunca sale del
   monitor.
6. El puntero se sigue a 30 Hz con un umbral de 2 px para reducir trabajo.
7. `Super+Arriba/Abajo` chocan con maximizar/restaurar de GNOME. Mientras el
   zoom está activo, la extensión aparta temporalmente esos atajos del WM y
   los restaura al desactivar. Si el shell termina de forma anormal, se
   recuperan al arrancar.

El mecanismo es el mismo que usa la lupa de accesibilidad de GNOME
(`js/ui/magnifier.js`).

## Estructura del proyecto

```text
gnome-zoomit/
├── README.md
├── extension/
│   ├── metadata.json
│   ├── extension.js
│   ├── prefs.js
│   ├── zoom.js
│   └── schemas/
│       ├── org.gnome.shell.extensions.zoomit.gschema.xml
│       └── gschemas.compiled
└── tests/
    └── test-zoom.mjs
```

## Tests

La matemática del zoom está aislada de GNOME y se prueba con Node:

```bash
node tests/test-zoom.mjs
```

Prueba en un shell anidado:

```bash
ZOOMIT_AUTOSTART=1 dbus-run-session -- gnome-shell --nested --wayland
```

La captura del shell anidado no está permitida por D-Bus; la comprobación
visual de video, GIF y click-through se hace en sesión real.

## Empaquetado

Para generar un zip instalable:

```bash
cd ~/lab/gnome-zoomit
gnome-extensions pack extension --force --extra-source=zoom.js
```

`gnome-extensions pack` no incluye automáticamente módulos JavaScript que no
sean `extension.js` o `prefs.js`. `zoom.js` debe pasarse con
`--extra-source=zoom.js`; si se omite, la extensión falla al importarlo.

El zip incluye el XML del schema, pero no el `gschemas.compiled`. Al instalar,
compila el schema si el instalador no lo hizo:

```bash
glib-compile-schemas \
    ~/.local/share/gnome-shell/extensions/zoomit-poc@sofidev/schemas
```

## Limitaciones

- Sin pan libre: la vista sigue al puntero; no se puede desplazar de forma
  independiente sin remapear la entrada del compositor.
- Sin anotaciones todavía.
- Sin cursor escalado: se usa el cursor real del compositor.
- El clone repinta el escritorio a 30 Hz; en hardware modesto puede notarse.
- Un atajo personalizado que choque con otro atajo de GNOME puede no disparar.
- Probado solo en GNOME Shell 48 / Wayland.

## Roadmap

- [ ] Anotaciones con Cairo sobre `St.DrawingArea`.
- [ ] Modo dibujo con actor reactivo.
- [ ] Empaquetado para extensions.gnome.org y `.deb`.
- [ ] Soporte para GNOME 49.
- [ ] Pan independiente del puntero.

## Estado

PoC funcional. Validado en GNOME Shell 48.7, Debian 13, Wayland y dos
monitores. El zoom, el click-through y los atajos configurables están
implementados; la validación visual final se hace en sesión real.

## Créditos

- Inspirado en [ZoomIt](https://learn.microsoft.com/sysinternals/downloads/zoomit)
  de Sysinternals.
- El mecanismo de clone y click-through sigue la lupa de accesibilidad de
  GNOME (`js/ui/magnifier.js`).

## Licencia

Pendiente de definir.
