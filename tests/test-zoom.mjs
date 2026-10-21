// Tests de la matematica del zoom. Ejecutar: node tests/test-zoom.mjs
import assert from 'node:assert/strict';

import {cloneOffset, visibleRegion, clampFactor, FACTOR_MIN, FACTOR_MAX}
    from '../extension/zoom.js';

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
// factor validos, en ambos monitores.
for (const m of [LEFT, RIGHT]) {
    for (const f of [1, 1.25, 1.5, 2, 3, 4, 6]) {
        for (let px = m.x; px <= m.x + m.width; px += 41) {
            for (let py = m.y; py <= m.y + m.height; py += 53) {
                const o = cloneOffset(px, py, m, f);
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

console.log('zoom.js: todos los tests pasan');
