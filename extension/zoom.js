// SPDX-License-Identifier: GPL-2.0-or-later
// Copyright (C) 2026 SofiDevO
//
// Matematica pura del zoom. Sin GTK, sin Clutter: testeable con node.

export const FACTOR_MIN = 1.0;
export const FACTOR_MAX = 10.0;

/**
 * Desvio de referencia, en pixeles de pantalla, entre el puntero y el contenido
 * que hay debajo cuando la vista se pega a un borde. La banda de pegado mide
 * `EDGE_DRIFT / (f - 1)` px; por el suavizado, el desvio real nunca supera
 * ~1.1 * EDGE_DRIFT.
 */
export const EDGE_DRIFT = 96;

export function clampFactor(factor, min = FACTOR_MIN, max = FACTOR_MAX) {
    if (max < min)
        [min, max] = [max, min];

    return Math.min(max, Math.max(min, factor));
}

const smoothstep = t => {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
};

/**
 * Borde visible izquierdo/superior (coordenadas absolutas) para un eje.
 *
 * Lejos de los bordes se usa el anclaje al puntero. Al acercarse a un borde
 * la vista se pega a el para no recortar iconos, docks o la barra superior.
 * La zona de pegado mide `drift / (f - 1)` px y la transicion se completa al
 * doble, con smoothstep para que no haya saltos.
 */
function axisAnchor(pointer, start, end, factor, drift) {
    const fixed = start + (pointer - start) * (factor - 1) / factor;

    if (factor <= 1 || drift <= 0)
        return fixed;

    const span = end - start;
    // Un cuarto del monitor como maximo: evita que las zonas de ambos bordes
    // se solapen con factores pequenos (cerca de 1x).
    const margin = Math.min(drift / (factor - 1), span / 4);
    const fromStart = pointer - start;
    const fromEnd = end - pointer;
    const pinnedEnd = end - span / factor;

    if (fromStart <= margin)
        return start;

    if (fromStart < margin * 2)
        return start + (fixed - start) * smoothstep((fromStart - margin) / margin);

    if (fromEnd <= margin)
        return pinnedEnd;

    if (fromEnd < margin * 2) {
        return pinnedEnd +
            (fixed - pinnedEnd) * smoothstep((fromEnd - margin) / margin);
    }

    return fixed;
}

/**
 * Desplazamiento del clone dentro de la vista.
 *
 * El zoom tiene un punto fijo: el pixel del escritorio que esta bajo el
 * puntero sigue bajo el puntero despues de ampliar. Por eso el puntero se
 * mueve por el contenido en vez de que el contenido salte al centro de la
 * pantalla.
 *
 * Con escala f y origen P, un punto s se pinta en P + s*f. Para que el
 * puntero p caiga en su posicion local (p - monitor):
 *
 *   P = (p - monitor) - p*f
 *
 * La region visible resultante es
 *   [p - (p - monitor.x)/f,  p + (monitor.x + width - p)/f]
 * que, para cualquier p dentro del monitor, queda contenida en el monitor:
 * no invade el monitor vecino y no hace falta recortar.
 *
 * Cerca de los bordes ese anclaje recortaria justo lo que se quiere senalar
 * (un icono del dock, la barra superior). Ahi la vista se pega al borde y el
 * puntero se mueve sobre la imagen ampliada; el desvio ronda `EDGE_DRIFT` y
 * decae hasta 0 al salir de la zona.
 *
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {{x: number, y: number, width: number, height: number}} monitor
 * @param {number} factor
 * @param {number} min
 * @param {number} max
 * @param {number} drift
 * @returns {{x: number, y: number, factor: number}}
 */
export function cloneOffset(pointerX, pointerY, monitor, factor,
    min = FACTOR_MIN, max = FACTOR_MAX, drift = EDGE_DRIFT) {
    const f = clampFactor(factor, min, max);
    const left = axisAnchor(pointerX, monitor.x, monitor.x + monitor.width, f, drift);
    const top = axisAnchor(pointerY, monitor.y, monitor.y + monitor.height, f, drift);

    return {
        x: -left * f,
        y: -top * f,
        factor: f,
    };
}

/**
 * Region del escritorio que se ve con ese desplazamiento, en coordenadas
 * absolutas. Util para tests y para depurar.
 */
export function visibleRegion(offset, monitor, factor) {
    return {
        x: -offset.x / factor,
        y: -offset.y / factor,
        width: monitor.width / factor,
        height: monitor.height / factor,
    };
}
