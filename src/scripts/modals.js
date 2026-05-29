import { normalizeBase } from './utils.js';

export const modalsMixin = {
    setupModalDropZones() {
        // ---- MASK UPLOAD MODAL ----
        const maskDZ = document.getElementById('maskUploadDropZone');
        const maskInput = document.getElementById('maskUploadInput');

        maskDZ.addEventListener('dragover', (e) => { e.preventDefault(); maskDZ.classList.add('dragover'); });
        maskDZ.addEventListener('dragleave', () => maskDZ.classList.remove('dragover'));
        maskDZ.addEventListener('drop', (e) => {
            e.preventDefault();
            maskDZ.classList.remove('dragover');
            maskInput.value = '';
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length) this._runMaskAnalysis(files);
        });
        maskDZ.addEventListener('click', () => maskInput.click());
        maskInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
            maskInput.value = '';
            if (files.length) this._runMaskAnalysis(files);
        });
        document.getElementById('maskUploadConfirmBtn').addEventListener('click', () => {
            document.getElementById('maskUploadModal').classList.remove('open');
            if (this._maskModalResolve) { this._maskModalResolve(this._pendingMaskFiles); this._maskModalResolve = null; }
        });
        const closeMask = () => {
            document.getElementById('maskUploadModal').classList.remove('open');
            if (this._maskModalResolve) { this._maskModalResolve(null); this._maskModalResolve = null; }
        };
        document.getElementById('maskUploadSkipBtn').addEventListener('click', closeMask);
        document.getElementById('maskUploadSkipFooterBtn').addEventListener('click', closeMask);

        // ---- IMAGE UPLOAD MODAL ----
        const imageDZ = document.getElementById('imageUploadDropZone');
        const imageInput = document.getElementById('imageUploadInput');

        imageDZ.addEventListener('dragover', (e) => { e.preventDefault(); imageDZ.classList.add('dragover'); });
        imageDZ.addEventListener('dragleave', () => imageDZ.classList.remove('dragover'));
        imageDZ.addEventListener('drop', (e) => {
            e.preventDefault();
            imageDZ.classList.remove('dragover');
            imageInput.value = '';
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
            if (files.length) this._runImageAnalysis(files);
        });
        imageDZ.addEventListener('click', () => imageInput.click());
        imageInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
            imageInput.value = '';
            if (files.length) this._runImageAnalysis(files);
        });
        document.getElementById('imageUploadConfirmBtn').addEventListener('click', () => {
            document.getElementById('imageUploadModal').classList.remove('open');
            if (this._imageModalResolve) { this._imageModalResolve(this._pendingImageFiles); this._imageModalResolve = null; }
        });
        const closeImage = () => {
            document.getElementById('imageUploadModal').classList.remove('open');
            if (this._imageModalResolve) { this._imageModalResolve(null); this._imageModalResolve = null; }
        };
        document.getElementById('imageUploadSkipBtn').addEventListener('click', closeImage);
        document.getElementById('imageUploadSkipFooterBtn').addEventListener('click', closeImage);
    },

    _runMaskAnalysis(files) {
        this._pendingMaskFiles = files;
        const imageBaseNames = new Set(this.images.map(im => normalizeBase(im.name)));
        const matched = [], unmatched = [];
        for (const f of files) {
            (imageBaseNames.has(normalizeBase(f.name)) ? matched : unmatched).push(f.name);
        }
        const matchPct = Math.round((matched.length / this.images.length) * 100);
        const color = matchPct === 100 ? '#34d399' : matchPct >= 50 ? '#fbbf24' : '#f87171';
        document.getElementById('maskUploadMatchText').innerHTML =
            `<span style="color:${color}; font-weight:700;">${matched.length} / ${this.images.length} masks matched</span> (${matchPct}%)`;
        document.getElementById('maskUploadUnmatched').textContent = unmatched.length
            ? `No match: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? ` +${unmatched.length - 3} more` : ''}`
            : '';
        document.getElementById('maskUploadMatchSummary').style.display = 'block';
        document.getElementById('maskUploadConfirmBtn').style.display = matched.length > 0 ? 'block' : 'none';
    },

    _runImageAnalysis(files) {
        this._pendingImageFiles = files;
        const maskBaseNames = new Set(this.masks.map(m => normalizeBase(m.name)));
        const matched = [], unmatched = [];
        for (const f of files) {
            (maskBaseNames.has(normalizeBase(f.name)) ? matched : unmatched).push(f.name);
        }
        const matchPct = Math.round((matched.length / this.masks.length) * 100);
        const color = matchPct === 100 ? '#34d399' : matchPct >= 50 ? '#fbbf24' : '#f87171';
        document.getElementById('imageUploadMatchText').innerHTML =
            `<span style="color:${color}; font-weight:700;">${matched.length} / ${this.masks.length} images matched</span> (${matchPct}%)`;
        document.getElementById('imageUploadUnmatched').textContent = unmatched.length
            ? `No match: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? ` +${unmatched.length - 3} more` : ''}`
            : '';
        document.getElementById('imageUploadMatchSummary').style.display = 'block';
        document.getElementById('imageUploadConfirmBtn').style.display = matched.length > 0 ? 'block' : 'none';
    },

    showImageUploadModal() {
        return new Promise((resolve) => {
            this._imageModalResolve = resolve;
            this._pendingImageFiles = null;
            document.getElementById('imageUploadMatchSummary').style.display = 'none';
            document.getElementById('imageUploadConfirmBtn').style.display = 'none';
            document.getElementById('imageUploadInput').value = '';
            document.getElementById('imageUploadPrompt').textContent =
                `${this.masks.length} masks loaded. Upload their corresponding image files.`;
            document.getElementById('imageUploadModal').classList.add('open');
        });
    },

    showMaskUploadModal() {
        return new Promise((resolve) => {
            this._maskModalResolve = resolve;
            this._pendingMaskFiles = null;
            document.getElementById('maskUploadMatchSummary').style.display = 'none';
            document.getElementById('maskUploadConfirmBtn').style.display = 'none';
            document.getElementById('maskUploadProgress').style.display = 'none';
            document.getElementById('maskUploadProgressFill').style.width = '0%';
            document.getElementById('maskUploadInput').value = '';
            document.getElementById('maskUploadPrompt').textContent =
                `${this.images.length} images loaded. Upload their corresponding mask files.`;
            document.getElementById('maskUploadModal').classList.add('open');
        });
    },

    showSessionResumeModal() {
        const globalIdx = this.batchOffset + this.currentIndex + 1;
        const filename = this.images[this.currentIndex] ? this.images[this.currentIndex].name : '';
        const batchNum = (this.maxBatchSize > 0 && this.batchOffset > 0)
            ? Math.floor(this.batchOffset / this.maxBatchSize) + 1
            : null;

        const modal = document.getElementById('sessionResumeModal');
        const msgEl = document.getElementById('sessionResumeMessage');
        msgEl.innerHTML = '';

        const line1 = document.createElement('span');
        line1.style.cssText = 'display:block;';
        line1.textContent = `Continuing from image ${globalIdx}${batchNum ? ` (batch ${batchNum})` : ''}`;
        msgEl.appendChild(line1);

        if (filename) {
            const file = document.createElement('span');
            file.style.cssText = 'display:block;margin-top:6px;color:var(--text-dim);font-size:0.8rem;word-break:break-all;';
            file.textContent = filename;
            msgEl.appendChild(file);
        }

        const needsMasks = this.images.length > 0 && this.masks.length === 0;
        const needsImages = this.masks.length > 0 && this.images.length === 0;
        if (needsMasks || needsImages) {
            const reminder = document.createElement('span');
            reminder.style.cssText = 'display:block;margin-top:10px;color:#f59e0b;font-size:0.85rem;';
            reminder.textContent = `Please load the corresponding ${needsMasks ? 'masks' : 'images'}.`;
            msgEl.appendChild(reminder);
        }
        modal.classList.add('open');

        const close = () => {
            modal.classList.remove('open');
            document.removeEventListener('keydown', onKey);
        };
        const onKey = (e) => {
            if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); close(); }
        };
        modal.onclick = (e) => { if (e.target === modal) close(); };
        document.getElementById('sessionResumeContinueBtn').onclick = close;
        document.addEventListener('keydown', onKey);
    },

    showNextBatchModal(jumpToPendingAfterLoad = false, autoLoad = false) {
        const batchSize = this.maxBatchSize || Infinity;
        const nextImages = Math.min(batchSize, this.pendingImageFiles.length);
        const nextMasks = Math.min(batchSize, this.pendingMaskFiles.length);

        const pendingInBatch = this.images.filter(im => {
            const c = this.sessionData.classifications[im.name];
            return !c || c.status === 'pending';
        }).length;

        let msg = `You've reached the end of this batch. Load the next ${nextImages} image${nextImages !== 1 ? 's' : ''}`;
        if (nextMasks > 0) msg += ` and ${nextMasks} mask${nextMasks !== 1 ? 's' : ''}`;
        msg += `? (${this.pendingImageFiles.length} image${this.pendingImageFiles.length !== 1 ? 's' : ''} remaining)`;

        const modal = document.getElementById('nextBatchModal');
        const msgEl = document.getElementById('nextBatchMessage');
        msgEl.textContent = msg;
        if (pendingInBatch > 0) {
            const warn = document.createElement('span');
            warn.style.cssText = 'display:block;margin-top:10px;color:#f59e0b;';
            warn.textContent = `⚠️ ${pendingInBatch} image${pendingInBatch !== 1 ? 's' : ''} in this batch ${pendingInBatch !== 1 ? 'are' : 'is'} still pending.`;
            msgEl.appendChild(warn);
        }

        const firstPendingBtn = document.getElementById('nextBatchFirstPendingBtn');
        firstPendingBtn.style.display = pendingInBatch > 0 ? '' : 'none';

        let onKey = null;
        const close = () => {
            modal.classList.remove('open');
            if (onKey) document.removeEventListener('keydown', onKey);
        };

        const load = async () => {
            close();
            if (!jumpToPendingAfterLoad) {
                const prevLength = this.images.length;
                const imageBatch = this.pendingImageFiles.splice(0, this.maxBatchSize || this.pendingImageFiles.length);
                const maskBatch = this.pendingMaskFiles.splice(0, this.maxBatchSize || this.pendingMaskFiles.length);
                await this.loadImages(imageBatch, true);
                if (maskBatch.length > 0) await this.loadMasks(maskBatch, true);
                if (this.images.length > prevLength) {
                    let newIdx = prevLength;
                    for (let i = prevLength; i < this.images.length; i++) {
                        const c = this.sessionData.classifications[this.images[i].name];
                        if (!c || c.status === 'pending') { newIdx = i; break; }
                    }
                    this.currentIndex = newIdx;
                    this.resetView();
                    this.drawImage();
                    this.updateUI();
                    this.persistSettings();
                }
                return;
            }
            // jumpToPendingAfterLoad: keep loading batches until a pending image is found
            while (this.pendingImageFiles.length > 0) {
                const prevLength = this.images.length;
                const imageBatch = this.pendingImageFiles.splice(0, this.maxBatchSize || this.pendingImageFiles.length);
                const maskBatch = this.pendingMaskFiles.splice(0, this.maxBatchSize || this.pendingMaskFiles.length);
                await this.loadImages(imageBatch, true);
                if (maskBatch.length > 0) await this.loadMasks(maskBatch, true);
                const targetIdx = this.findNextPendingIndex(prevLength);
                if (targetIdx >= 0) {
                    this.currentIndex = targetIdx;
                    this.resetView();
                    this.drawImage();
                    this.updateUI();
                    this.persistSettings();
                    return;
                }
            }
            this.showToast('No pending images left');
        };

        if (autoLoad) {
            load();
            return;
        }

        modal.classList.add('open');

        onKey = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); load(); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        };

        modal.onclick = (e) => { if (e.target === modal) close(); };
        document.getElementById('nextBatchModalCloseBtn').onclick = close;
        document.getElementById('nextBatchCancelBtn').onclick = close;
        document.getElementById('nextBatchLoadBtn').onclick = load;
        firstPendingBtn.onclick = () => {
            close();
            const idx = this.findNextPendingIndex(0);
            if (idx !== -1) {
                this.currentIndex = idx;
                this.resetView();
                this.drawImage();
                this.updateUI();
            }
        };
        document.addEventListener('keydown', onKey);
    },

    showLoadConfirm(existingCount, type) {
        return new Promise((resolve) => {
            const modal = document.getElementById('loadConfirmModal');
            document.getElementById('loadConfirmTitle').textContent = `${type} already loaded`;
            document.getElementById('loadConfirmMessage').textContent =
                `${existingCount} ${type.toLowerCase()} already in the stack. Append the new files or replace the stack?`;
            modal.classList.add('open');

            const close = (result) => {
                modal.classList.remove('open');
                resolve(result);
            };

            document.getElementById('loadConfirmAppendBtn').onclick = () => close('append');
            document.getElementById('loadConfirmReplaceBtn').onclick = () => close('replace');
            document.getElementById('loadConfirmCancelBtn').onclick = () => close('cancel');
        });
    },

    showToast(message) {
        const toast = document.getElementById('toast');
        if (toast) {
            toast.innerHTML = `<span class="toast-icon">✨</span> ${message}`;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }
    },
};
