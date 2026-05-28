export const navigationMixin = {
    resetView() {
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        document.getElementById('zoomSlider').value = 100;
        document.getElementById('zoomValue').textContent = '100%';
    },

    previousImage() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.resetView();
            this.drawImage();
            this.updateUI();
            this.updateCurrentImageStatus();
            this.persistSettings();
        } else if (this.batchOffset > 0) {
            this.loadPreviousBatch();
        }
    },

    async loadPreviousBatch() {
        if (!this.allDirectoryFiles.length || this.batchOffset <= 0) return;
        const batchSize = this.maxBatchSize || this.allDirectoryFiles.length;
        const oldBatchOffset = this.batchOffset;
        const newBatchOffset = Math.max(0, oldBatchOffset - batchSize);
        const prevFiles = this.allDirectoryFiles.slice(newBatchOffset, oldBatchOffset);

        this._autoLoadThreshold = this.pendingImageFiles.length;
        this.pendingImageFiles = this.allDirectoryFiles.slice(oldBatchOffset);
        this.batchOffset = newBatchOffset;
        this.images = [];

        const statusDiv = document.getElementById('imageLoadStatus');
        if (statusDiv) statusDiv.textContent = `Loading previous batch...`;

        for (let i = 0; i < prevFiles.length; i++) {
            const file = prevFiles[i];
            const img = new Image();
            const url = URL.createObjectURL(file);
            await new Promise((resolve) => {
                img.onload = () => { this.images.push({ img, name: file.name, url }); resolve(); };
                img.onerror = () => resolve();
                img.src = url;
            });
        }

        this.images.sort((a, b) => a.name.localeCompare(b.name));
        this.currentIndex = this.images.length - 1;

        this.updateStats();
        this.resetView();
        this.drawImage();
        this.updateUI();
        this.updateCurrentImageStatus();
        this.persistSettings();
        if (statusDiv) statusDiv.textContent = `✅ Loaded ${prevFiles.length} images`;
    },

    nextImage() {
        if (this.currentIndex < this.images.length - 1) {
            this.currentIndex++;
            this.resetView();
            this.drawImage();
            this.updateUI();
            this.updateCurrentImageStatus();
            this.persistSettings();
        } else if (this.pendingImageFiles.length > 0) {
            const autoLoad = this._autoLoadThreshold !== undefined && this.pendingImageFiles.length > this._autoLoadThreshold;
            this.showNextBatchModal(false, autoLoad);
        }
    },

    findNextPendingIndex(start) {
        const n = this.images.length;
        if (n === 0) return -1;
        for (let k = 0; k < n; k++) {
            const idx = (start + k) % n;
            const name = this.images[idx].name;
            const c = this.sessionData.classifications[name];
            if (!c || c.status === 'pending') return idx;
        }
        return -1;
    },

    jumpToNextPending() {
        const idx = this.findNextPendingIndex(this.currentIndex + 1);
        if (idx !== -1) {
            this.currentIndex = idx;
            this.resetView();
            this.drawImage();
            this.updateUI();
            return;
        }
        if (this.pendingImageFiles.length > 0) {
            this.showNextBatchModal(true);
            return;
        }
        this.showToast('No pending images left');
    },

    handleKeyboard(e) {
        const tag = e.target.tagName;
        const type = e.target.type;
        if (tag === 'TEXTAREA') return;
        if (tag === 'INPUT' && ['text', 'number', 'password', 'search', 'email', 'url'].includes(type)) return;

        switch (e.key.toLowerCase()) {
            case 'arrowleft':
                e.preventDefault();
                this.previousImage();
                break;
            case 'arrowright':
                e.preventDefault();
                this.nextImage();
                break;
            case 'a':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.setImageStatus('approved');
                    this.afterActionAdvance();
                    this.saveToLocalStorage();
                }
                break;
            case 'r':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.setImageStatus('rejected');
                    this.afterActionAdvance();
                    this.saveToLocalStorage();
                }
                break;
            case 's':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.setImageStatus('skipped');
                    this.afterActionAdvance();
                    this.saveToLocalStorage();
                }
                break;
            case 'z':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.resetView();
                    this.drawImage();
                }
                break;
            case 't':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    this.toggleMaskVisibility();
                }
                break;
            case 'j':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    document.getElementById('nextPendingBtn').click();
                }
                break;
        }
    },

    toggleMaskVisibility() {
        if (this.transparency > 0) {
            this.previousTransparency = this.transparency;
            this.transparency = 0;
            this.maskToggledOff = true;
        } else {
            this.transparency = (this.maskToggledOff && this.previousTransparency > 0)
                ? this.previousTransparency
                : 0.5;
            this.maskToggledOff = false;
        }

        const slider = document.getElementById('transparencySlider');
        if (slider) slider.value = Math.round(this.transparency * 100);
        const valSpan = document.getElementById('transparencyValue');
        if (valSpan) valSpan.textContent = Math.round(this.transparency * 100) + '%';

        this.drawImage();
        this.persistSettings();
        this.updateUI();
    },
};
