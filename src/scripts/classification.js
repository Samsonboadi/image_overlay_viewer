export const classificationMixin = {
    setImageStatus(status) {
        if (!this.images.length || this.currentIndex >= this.images.length) return;

        const currentImage = this.images[this.currentIndex];
        this.sessionData.classifications[currentImage.name] = {
            status,
            timestamp: new Date().toISOString(),
            notes: ''
        };

        this.updateStats();
        this.updateCurrentImageStatus();
        this.updateUI();
        this.persistSettings();
        this._batchJustCompleted = this._checkBatchComplete();
    },

    clearImageStatus() {
        if (!this.images.length || this.currentIndex >= this.images.length) return;

        const currentImage = this.images[this.currentIndex];
        this.sessionData.classifications[currentImage.name] = {
            status: 'pending',
            timestamp: null,
            notes: ''
        };

        this.updateStats();
        this.updateCurrentImageStatus();
        this.updateUI();
        this.persistSettings();
        this.showToast('Status cleared');
    },

    _checkBatchComplete() {
        if (this.pendingImageFiles.length === 0) return false;
        const allClassified = this.images.every(im => {
            const c = this.sessionData.classifications[im.name];
            return c && c.status !== 'pending';
        });
        if (allClassified) {
            this.showNextBatchModal();
            return true;
        }
        return false;
    },

    afterActionAdvance() {
        if (!this.autoAdvance) return;
        if (this._batchJustCompleted) {
            this._batchJustCompleted = false;
            return;
        }
        if (this.currentIndex < this.images.length - 1) {
            this.currentIndex++;
        }
        this.resetView();
        this.drawImage();
        this.updateUI();
    },

    updateCurrentImageStatus() {
        const statusDisplay = document.getElementById('statusDisplay');
        const statusActions = document.getElementById('statusActions');
        const statusPill = document.getElementById('statusPill');

        if (!this.images.length || this.currentIndex >= this.images.length) {
            statusPill.innerHTML = '';
            statusDisplay.style.display = 'none';
            statusActions.style.display = 'none';
            return;
        }

        const currentImage = this.images[this.currentIndex];
        const classification = this.sessionData.classifications[currentImage.name];

        if (classification) {
            const statusClass = `status-${classification.status}`;
            const statusText = classification.status.charAt(0).toUpperCase() + classification.status.slice(1);
            const timestamp = classification.timestamp ? new Date(classification.timestamp).toLocaleString() : '';
            statusPill.innerHTML = `<span class="status-indicator ${statusClass}">${statusText}</span>`;
            if (timestamp) {
                statusDisplay.innerHTML = `<div style="font-size: 11px; opacity: 0.7;">Updated: ${timestamp}</div>`;
                statusDisplay.style.display = 'block';
            } else {
                statusDisplay.style.display = 'none';
            }
        } else {
            statusPill.innerHTML = '<span class="status-indicator status-pending">Pending</span>';
            statusDisplay.style.display = 'none';
        }

        statusActions.style.display = 'grid';
    },
};
