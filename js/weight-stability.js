// js/weight-stability.js
// Módulo de estabilidad de peso compartido entre foreground y background.
// Detecta cuando el peso en la balanza es estable durante una ventana de tiempo.
// Vanilla JS (sin ES modules) para compatibilidad con el proyecto.

const WeightStability = (function() {
    'use strict';

    var buf = [];
    var WIN_MS = 1500;   // ventana de tiempo en ms
    var N = 3;           // lecturas mínimas requeridas
    var TOL = 0.05;      // tolerancia en lb (~23g)

    return {
        /**
         * Agrega una lectura al buffer y devuelve el peso estable si se cumple
         * la condición, o null si aún no hay estabilidad.
         * @param {number} w - Peso en lb
         * @returns {number|null} Peso estable promedio o null
         */
        push: function(w) {
            var now = Date.now();
            buf.push({ w: w, t: now });
            // Limpiar lecturas fuera de la ventana
            while (buf.length && now - buf[0].t > WIN_MS) buf.shift();
            if (buf.length < N) return null;
            // Verificar estabilidad con las últimas N lecturas
            var last = buf.slice(-N).map(function(x) { return x.w; });
            var min = Math.min.apply(null, last);
            var max = Math.max.apply(null, last);
            if (max - min > TOL) return null;
            // Ignorar peso cero o muy bajo
            var avg = last.reduce(function(a, b) { return a + b; }, 0) / N;
            if (avg < 0.1) return null;
            return parseFloat(avg.toFixed(2));
        },

        /**
         * Resetea el buffer (llamar después de registrar una venta).
         */
        reset: function() {
            buf.length = 0;
        },

        /**
         * Configura los parámetros de estabilidad.
         * @param {object} opts - { windowMs, minReadings, toleranceLb }
         */
        configure: function(opts) {
            if (opts.windowMs)     WIN_MS = opts.windowMs;
            if (opts.minReadings)  N      = opts.minReadings;
            if (opts.toleranceLb)  TOL    = opts.toleranceLb;
        }
    };
})();

// Exponer globalmente
window.WeightStability = WeightStability;
