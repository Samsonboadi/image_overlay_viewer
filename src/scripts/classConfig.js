import { rgbToHex, hexToRgb, DEFAULT_CLASS_COLORS } from './utils.js';

export const classConfigMixin = {
    renderClassList() {
        const container = document.getElementById('classListContainer');
        if (!container) return;

        container.innerHTML = '';
        this.maskClasses.forEach((cls, idx) => {
            const row = document.createElement('div');
            row.className = 'class-row';
            row.innerHTML = `
                <input type="text" value="${cls.label}" placeholder="Class label" data-idx="${idx}" data-field="label" title="Class label">
                <input type="number" value="${cls.pixelValue}" min="0" max="255" data-idx="${idx}" data-field="pixelValue" title="Pixel value (0-255)">
                <input type="color" value="${rgbToHex(cls.color)}" data-idx="${idx}" data-field="color" title="Overlay color">
                <button class="class-visibility-btn ${cls.visible ? '' : 'hidden'}" data-idx="${idx}" title="Toggle visibility">${cls.visible ? '👁️' : '🚫'}</button>
            `;
            container.appendChild(row);
        });

        container.querySelectorAll('input[data-field="label"]').forEach(el => {
            el.addEventListener('change', (e) => {
                this.maskClasses[+e.target.dataset.idx].label = e.target.value;
                this.persistSettings();
            });
        });
        container.querySelectorAll('input[data-field="pixelValue"]').forEach(el => {
            el.addEventListener('change', (e) => {
                const val = Math.max(0, Math.min(255, parseInt(e.target.value) || 0));
                e.target.value = val;
                this.maskClasses[+e.target.dataset.idx].pixelValue = val;
                this.drawImage();
                this.persistSettings();
            });
        });
        container.querySelectorAll('input[data-field="color"]').forEach(el => {
            el.addEventListener('change', (e) => {
                this.maskClasses[+e.target.dataset.idx].color = hexToRgb(e.target.value);
                this.drawImage();
                this.persistSettings();
            });
        });
        container.querySelectorAll('.class-visibility-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = +e.currentTarget.dataset.idx;
                this.maskClasses[idx].visible = !this.maskClasses[idx].visible;
                this.renderClassList();
                this.drawImage();
                this.persistSettings();
            });
        });

        const numInput = document.getElementById('numClassesInput');
        if (numInput) numInput.value = this.maskClasses.length;
        this.updateClassInfo();
    },

    updateClassInfo() {
        const info = document.getElementById('classInfo');
        if (!info) return;

        const vals = this.maskClasses.map(c => c.pixelValue);
        const dupes = vals.filter((v, i) => vals.indexOf(v) !== i);
        if (dupes.length > 0) {
            info.textContent = `⚠️ Duplicate values: ${[...new Set(dupes)].join(', ')}`;
            info.style.color = '#ef4444';
        } else {
            info.textContent = `${this.maskClasses.length} class${this.maskClasses.length !== 1 ? 'es' : ''} configured`;
            info.style.color = 'var(--text-dim)';
        }
    },

    handleNumClassesChange(newCount) {
        newCount = Math.max(1, Math.min(50, newCount));
        const current = this.maskClasses.length;
        if (newCount > current) {
            for (let i = current; i < newCount; i++) {
                this.maskClasses.push({
                    label: `Class ${i}`,
                    pixelValue: i,
                    color: hexToRgb(DEFAULT_CLASS_COLORS[i % DEFAULT_CLASS_COLORS.length]),
                    visible: true
                });
            }
        } else if (newCount < current) {
            this.maskClasses = this.maskClasses.slice(0, newCount);
        }
        this.renderClassList();
        this.drawImage();
        this.persistSettings();
    },
};
