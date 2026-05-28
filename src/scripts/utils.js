// Pure utility functions — no DOM, no state, no side effects.

export const DEFAULT_CLASS_COLORS = [
    '#ff0000', '#00cc44', '#3498db', '#f1c40f', '#e74c3c',
    '#9b59b6', '#1abc9c', '#e67e22', '#2ecc71', '#d35400',
    '#8e44ad', '#16a085', '#c0392b', '#2980b9', '#27ae60',
    '#f39c12', '#7f8c8d', '#2c3e50', '#1a5276', '#d4ac0d'
];

export function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export function normalizeBase(name) {
    return (name || '').toLowerCase().replace(/\.[^/.]+$/, '');
}

export function rgbToHex(rgb) {
    return '#' + ((1 << 24) + (rgb.r << 16) + (rgb.g << 8) + rgb.b).toString(16).slice(1);
}

export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 255, g: 0, b: 0 };
}

export function computeProjectId(images) {
    const names = images.map(i => i.name).sort().join('|');
    let hash = 5381;
    for (let i = 0; i < names.length; i++) {
        hash = ((hash << 5) + hash) + names.charCodeAt(i);
        hash |= 0;
    }
    return 'geominds_overlay_' + (hash >>> 0);
}

export function buildClassLookup(maskClasses) {
    const map = new Map();
    for (const cls of maskClasses) {
        if (!map.has(cls.pixelValue)) {
            map.set(cls.pixelValue, { color: cls.color, visible: cls.visible });
        }
    }
    return map;
}
