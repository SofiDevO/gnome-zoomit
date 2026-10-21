// Matematica pura del zoom. Sin GTK, sin Clutter: testeable con node.

export const FACTOR_MIN = 1.0;
export const FACTOR_MAX = 10.0;

export function clampFactor(factor, min = FACTOR_MIN, max = FACTOR_MAX) {
    if (max < min)
        [min, max] = [max, min];

    return Math.min(max, Math.max(min, factor));
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
 * @param {number} pointerX
 * @param {number} pointerY
 * @param {{x: number, y: number, width: number, height: number}} monitor
 * @param {number} factor
 * @param {number} min
 * @param {number} max
 * @returns {{x: number, y: number, factor: number}}
 */
export function cloneOffset(pointerX, pointerY, monitor, factor,
    min = FACTOR_MIN, max = FACTOR_MAX) {
    const f = clampFactor(factor, min, max);

    return {
        x: (pointerX - monitor.x) - pointerX * f,
        y: (pointerY - monitor.y) - pointerY * f,
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
