// Tests de la matematica del zoom. Ejecutar: node tests/test-zoom.mjs
import assert from 'node:assert/strict';

import {cloneOffset, visibleRegion, clampFactor, FACTOR_MIN, FACTOR_MAX,
    EDGE_DRIFT} from '../extension/zoom.js';

const LEFT = {x: 0, y: 0, width: 1366, height: 768};
const RIGHT = {x: 1366, y: 0, width: 1920, height: 1080};
const EPS = 1e-6;

// Puntero en el centro del monitor izquierdo: queda en el centro de la vista
// y la region visible esta dentro del monitor.
{
    const o = cloneOffset(683, 384, LEFT, 2);
    assert.ok(Math.abs(o.x + 683 * 2 - 683) < EPS);
    assert.ok(Math.abs(o.y + 384 * 2 - 384) < EPS);

    const r = visibleRegion(o, LEFT, 2);
    assert.ok(Math.abs(r.x - 341.5) < EPS);
    assert.ok(Math.abs(r.width - 683) < EPS);
    assert.ok(r.x >= LEFT.x && r.x + r.width <= LEFT.x + LEFT.width);
}

// Monitor derecho: la region visible no toca el monitor izquierdo.
{
    const o = cloneOffset(2326, 540, RIGHT, 2);
    const r = visibleRegion(o, RIGHT, 2);
    assert.ok(r.x >= RIGHT.x, `la vista empieza en ${r.x}, invade el izquierdo`);
    assert.ok(r.x + r.width <= RIGHT.x + RIGHT.width);
}

// Borde izquierdo del monitor derecho: la vista empieza exactamente en 1366.
{
    const o = cloneOffset(RIGHT.x, 540, RIGHT, 2);
    const r = visibleRegion(o, RIGHT, 2);
    assert.ok(Math.abs(r.x - RIGHT.x) < EPS);
}

// Borde derecho: la vista termina exactamente en el borde del monitor.
{
    const edge = RIGHT.x + RIGHT.width;
    const o = cloneOffset(edge, 540, RIGHT, 2);
    const r = visibleRegion(o, RIGHT, 2);
    assert.ok(Math.abs(r.x + r.width - edge) < EPS);
}

// Factor fuera de rango se recorta.
{
    assert.equal(clampFactor(0.1), FACTOR_MIN);
    assert.equal(clampFactor(99), FACTOR_MAX);
    assert.equal(clampFactor(12, 1, 10), 10);
    assert.equal(clampFactor(0.5, 2, 8), 2);
    assert.equal(clampFactor(5, 8, 2), 5);   // limites invertidos
}

// El maximo configurable (10x) se respeta tambien en cloneOffset.
{
    const m = RIGHT;
    const px = m.x + m.width / 2;
    const py = m.y + m.height / 2;
    const o = cloneOffset(px, py, m, 99, 1, 10);
    const r = visibleRegion(o, m, o.factor);

    assert.equal(o.factor, 10);
    assert.ok(Math.abs(o.x + px * 10 - (px - m.x)) < EPS);
    assert.ok(r.x >= m.x - EPS && r.x + r.width <= m.x + m.width + EPS);
}

// Invariante del punto fijo y de la region contenida, para todo punto y
// factor validos, en ambos monitores. Con drift 0 se desactiva la asistencia
// de borde y se comprueba el anclaje puro al puntero.
for (const m of [LEFT, RIGHT]) {
    for (const f of [1, 1.25, 1.5, 2, 3, 4, 6]) {
        for (let px = m.x; px <= m.x + m.width; px += 41) {
            for (let py = m.y; py <= m.y + m.height; py += 53) {
                const o = cloneOffset(px, py, m, f, FACTOR_MIN, FACTOR_MAX, 0);
                const r = visibleRegion(o, m, f);

                // El puntero no se mueve de su pixel.
                assert.ok(Math.abs(o.x + px * f - (px - m.x)) < EPS,
                    `f=${f} px=${px}: el puntero se desplaza en X`);
                assert.ok(Math.abs(o.y + py * f - (py - m.y)) < EPS,
                    `f=${f} py=${py}: el puntero se desplaza en Y`);

                // La vista nunca sale del monitor.
                assert.ok(r.x >= m.x - EPS,
                    `f=${f} px=${px}: fuga a la izquierda (${r.x})`);
                assert.ok(r.x + r.width <= m.x + m.width + EPS,
                    `f=${f} px=${px}: fuga a la derecha`);
                assert.ok(r.y >= m.y - EPS,
                    `f=${f} py=${py}: fuga arriba`);
                assert.ok(r.y + r.height <= m.y + m.height + EPS,
                    `f=${f} py=${py}: fuga abajo`);
            }
        }
    }
}

// Asistencia de borde: con el puntero a 40 px del borde (2x), la vista se pega
// al borde en vez de recortar los primeros ~100 px del escritorio.
{
    const f = 2;
    const d = 40;
    const left = visibleRegion(cloneOffset(LEFT.x + d, LEFT.y + d, LEFT, f), LEFT, f);
    assert.ok(Math.abs(left.x - LEFT.x) < EPS, `borde izquierdo en ${left.x}`);
    assert.ok(Math.abs(left.y - LEFT.y) < EPS, `borde superior en ${left.y}`);

    const edgeX = RIGHT.x + RIGHT.width - d;
    const edgeY = RIGHT.y + RIGHT.height - d;
    const right = visibleRegion(cloneOffset(edgeX, edgeY, RIGHT, f), RIGHT, f);
    assert.ok(Math.abs(right.x + right.width - (RIGHT.x + RIGHT.width)) < EPS);
    assert.ok(Math.abs(right.y + right.height - (RIGHT.y + RIGHT.height)) < EPS);
}

// A 4x la zona de pegado es mas estrecha: 20 px siguen pegados al borde y
// 200 px ya usan el anclaje normal.
{
    const f = 4;
    const near = visibleRegion(cloneOffset(LEFT.x + 20, 384, LEFT, f), LEFT, f);
    assert.ok(Math.abs(near.x - LEFT.x) < EPS);

    const far = cloneOffset(LEFT.x + 200, 384, LEFT, f);
    assert.ok(Math.abs(far.x + (LEFT.x + 200) * f - 200) < EPS);
}

// La transicion no tiene saltos: la vista se mueve menos de 4 px por cada px
// que avanza el puntero.
{
    const f = 2;
    let prev = visibleRegion(cloneOffset(LEFT.x, 384, LEFT, f), LEFT, f).x;
    for (let d = 1; d <= 400; d++) {
        const x = visibleRegion(cloneOffset(LEFT.x + d, 384, LEFT, f), LEFT, f).x;
        assert.ok(Math.abs(x - prev) < 4, `salto de ${x - prev} px en d=${d}`);
        prev = x;
    }
}

// El desvio del puntero respecto al contenido queda en torno a EDGE_DRIFT
// (con el suavizado, como maximo ~1.1 * EDGE_DRIFT).
for (const f of [1.5, 2, 3, 4, 6, 10]) {
    for (let d = 0; d <= 500; d++) {
        const o = cloneOffset(LEFT.x + d, 384, LEFT, f);
        const drift = Math.abs(o.x + (LEFT.x + d) * f - (LEFT.x + d));
        assert.ok(drift <= EDGE_DRIFT * 1.1 + EPS,
            `f=${f} d=${d}: desvio ${drift}`);
    }
}

// Con la asistencia activa la vista sigue sin salir del monitor.
for (const m of [LEFT, RIGHT]) {
    for (const f of [1, 1.25, 1.5, 2, 3, 4, 6, 10]) {
        for (let px = m.x; px <= m.x + m.width; px += 37) {
            for (let py = m.y; py <= m.y + m.height; py += 47) {
                const r = visibleRegion(cloneOffset(px, py, m, f), m, f);
                assert.ok(r.x >= m.x - EPS, `fuga izquierda f=${f} px=${px}`);
                assert.ok(r.x + r.width <= m.x + m.width + EPS);
                assert.ok(r.y >= m.y - EPS, `fuga arriba f=${f} py=${py}`);
                assert.ok(r.y + r.height <= m.y + m.height + EPS);
            }
        }
    }
}

console.log('zoom.js: todos los tests pasan');
