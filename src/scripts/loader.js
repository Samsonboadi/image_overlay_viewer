import { normalizeBase, computeProjectId } from './utils.js';

export const loaderMixin = {
    // --- Azure Storage Fetch Client ---
    async loadFromAzure(apiUrl, limit, offset) {
        const statusDiv = document.getElementById('azureStatus');
        statusDiv.textContent = '🔄 Contacting backend inventory...';
        statusDiv.style.color = 'var(--accent-secondary)';

        try {
            const cleanUrl = apiUrl.replace(/\/+$/, '');
            const response = await fetch(`${cleanUrl}/images?limit=${limit}&offset=${offset}`);

            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);

            const data = await response.json();
            if (data.error) throw new Error(data.error);

            const base_url = data.base_url;
            const imagePaths = data.images || [];

            if (imagePaths.length === 0) {
                statusDiv.textContent = '⚠️ No image records found in container';
                statusDiv.style.color = '#fbbf24';
                return;
            }

            this.images = [];
            this.masks = [];
            this.masksMap.clear();
            this.pendingMaskLoads.clear();
            this.isAzureMode = true;
            this.azureBaseUrl = base_url;

            statusDiv.textContent = `🔄 Loading ${imagePaths.length} cloud records...`;

            for (let i = 0; i < imagePaths.length; i++) {
                const path = imagePaths[i];
                const filename = path.split('/').pop();
                const absoluteUrl = base_url + path;
                // Lazy: actual Image asset loaded on first display to avoid slow startup
                this.images.push({ name: filename, url: absoluteUrl, img: null });
            }

            this.currentIndex = 0;
            this.stats.total = this.images.length;
            this.projectId = computeProjectId(this.images);

            this.updateSessionWithImages();

            if (this.pendingNewSession) {
                localStorage.removeItem(this.projectId);
                this.pendingNewSession = false;
                this.saveToLocalStorage();
            } else {
                const didRestore = this.tryRestoreFromLocalStorage();
                if (!didRestore) this.saveToLocalStorage();
                else this.showSessionResumeModal();
            }

            statusDiv.textContent = `✅ Loaded ${this.images.length} cloud images successfully`;
            statusDiv.style.color = '#34d399';

            this.showToast(`Fetched ${this.images.length} images from Azure`);
            this.updateUI();
            this.resizeCanvas();
            this.drawImage();

        } catch (error) {
            console.error('Azure Storage Loader Error:', error);
            statusDiv.textContent = `❌ Error: ${error.message}`;
            statusDiv.style.color = '#f87171';
            this.showToast('Cloud connection failed');
        }
    },

    async loadImages(files, isBatchAppend = false, fromDirectory = false) {
        let imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (!imageFiles.length) return;

        // Enforce batch size only for directory loads
        if (!isBatchAppend && fromDirectory && this.maxBatchSize > 0 && imageFiles.length > this.maxBatchSize) {
            this.pendingImageFiles = imageFiles.slice(this.maxBatchSize);
            imageFiles = imageFiles.slice(0, this.maxBatchSize);
        } else if (!isBatchAppend) {
            this.pendingImageFiles = [];
        }

        // Store all directory files (sorted), reset batch offset, compute stable project ID
        if (!isBatchAppend && fromDirectory) {
            this.allDirectoryFiles = [...imageFiles, ...this.pendingImageFiles].sort((a, b) => a.name.localeCompare(b.name));
            this.batchOffset = 0;
            const allNames = this.allDirectoryFiles.map(f => f.name).sort().join('|');
            let h = 5381;
            for (let i = 0; i < allNames.length; i++) { h = ((h << 5) + h) + allNames.charCodeAt(i); h |= 0; }
            this.stableProjectId = 'geominds_overlay_dir_' + (h >>> 0);
        } else if (!isBatchAppend) {
            this.stableProjectId = null;
        }

        // Deferred restore (JSON session loaded first): jump to batch containing lastViewedFilename
        if (!isBatchAppend && fromDirectory && this.deferredRestore && this.maxBatchSize > 0) {
            const allFiles = this.allDirectoryFiles;
            const { lastViewedFilename } = this.deferredRestore;
            let targetIdx = lastViewedFilename ? allFiles.findIndex(f => f.name === lastViewedFilename) : -1;
            if (targetIdx === -1) {
                const classifications = this.sessionData.classifications;
                const firstPendingIdx = allFiles.findIndex(f => { const c = classifications[f.name]; return !c || c.status === 'pending'; });
                targetIdx = firstPendingIdx >= 0 ? firstPendingIdx : 0;
            }
            const batchStart = Math.floor(targetIdx / this.maxBatchSize) * this.maxBatchSize;
            imageFiles = allFiles.slice(batchStart, batchStart + this.maxBatchSize);
            this.pendingImageFiles = allFiles.slice(batchStart + this.maxBatchSize);
            this.batchOffset = batchStart;
            if (batchStart > 0 && this.allDirectoryMaskFiles.length > 0) {
                this._deferredMaskFiles = this.allDirectoryMaskFiles.slice(batchStart, batchStart + this.maxBatchSize);
                this.pendingMaskFiles = this.allDirectoryMaskFiles.slice(batchStart + this.maxBatchSize);
                this.masks = [];
                this.masksMap.clear();
            }
        }

        // Auto-restore (no JSON): peek at stable session key to find lastViewedFilename and jump to its batch
        if (!isBatchAppend && fromDirectory && !this.deferredRestore && this.maxBatchSize > 0 && !this.pendingNewSession && this.stableProjectId) {
            try {
                const raw = localStorage.getItem(this.stableProjectId);
                if (raw) {
                    const data = JSON.parse(raw);
                    const lastViewed = data.lastViewedFilename;
                    if (lastViewed) {
                        const targetFileIdx = this.allDirectoryFiles.findIndex(f => f.name === lastViewed);
                        if (targetFileIdx >= 0) {
                            const batchStart = Math.floor(targetFileIdx / this.maxBatchSize) * this.maxBatchSize;
                            imageFiles = this.allDirectoryFiles.slice(batchStart, batchStart + this.maxBatchSize);
                            this.pendingImageFiles = this.allDirectoryFiles.slice(batchStart + this.maxBatchSize);
                            this.batchOffset = batchStart;
                            if (batchStart > 0 && this.allDirectoryMaskFiles.length > 0) {
                                this._deferredMaskFiles = this.allDirectoryMaskFiles.slice(batchStart, batchStart + this.maxBatchSize);
                                this.pendingMaskFiles = this.allDirectoryMaskFiles.slice(batchStart + this.maxBatchSize);
                                this.masks = [];
                                this.masksMap.clear();
                            }
                        }
                    }
                }
            } catch (e) {}
        }

        const totalDropped = imageFiles.length + this.pendingImageFiles.length;

        let append = isBatchAppend;
        if (!isBatchAppend && this.images.length > 0) {
            const choice = await this.showLoadConfirm(this.images.length, 'Images');
            if (choice === 'cancel') {
                this.pendingImageFiles = [];
                return;
            }
            append = choice === 'append';
        }

        const progressBar = document.getElementById('imageLoadProgress');
        const progressFill = document.getElementById('imageProgressFill');
        const statusDiv = document.getElementById('imageLoadStatus');

        progressBar.style.display = 'block';
        progressFill.style.width = '0%';

        statusDiv.textContent = this.pendingImageFiles.length > 0
            ? `Loading first ${imageFiles.length} of ${totalDropped} images...`
            : 'Loading images...';

        if (!append) this.images = [];

        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            const img = new Image();
            const url = URL.createObjectURL(file);

            statusDiv.textContent = `Loading image ${i + 1}/${imageFiles.length}: ${file.name}`;

            await new Promise((resolve) => {
                img.onload = () => {
                    this.images.push({ img, name: file.name, url });
                    progressFill.style.width = ((i + 1) / imageFiles.length * 100) + '%';
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = url;
            });

            await new Promise(resolve => setTimeout(resolve, 20));
        }

        progressBar.style.display = 'none';
        statusDiv.textContent = `✅ Loaded ${this.images.length} images`;

        this.images.sort((a, b) => a.name.localeCompare(b.name));
        if (!append) this.currentIndex = 0;

        const inBatchMode = this.pendingImageFiles.length > 0 || this.pendingMaskFiles.length > 0;

        if (!inBatchMode) {
            const { discardedImages, discardedMasks } = this._reconcileImageMaskPairs();

            this.stats.total = this.images.length;
            this.projectId = computeProjectId(this.images);
            this.updateSessionWithImages();

            if (this.pendingNewSession) {
                if (this.stableProjectId) localStorage.removeItem(this.stableProjectId);
                localStorage.removeItem(this.projectId);
                this.pendingNewSession = false;
                this.saveToLocalStorage();
            } else {
                const didRestore = this.tryRestoreFromLocalStorage();
                if (!didRestore) this.saveToLocalStorage();
                else if (!isBatchAppend) this.showSessionResumeModal();
            }

            if (discardedImages > 0 || discardedMasks > 0) {
                const parts = [];
                if (discardedImages > 0) parts.push(`${discardedImages} image${discardedImages > 1 ? 's' : ''}`);
                if (discardedMasks > 0) parts.push(`${discardedMasks} mask${discardedMasks > 1 ? 's' : ''}`);
                this.showToast(`Discarded ${parts.join(' and ')} without a match`);
            }
        } else {
            this.stats.total = this.images.length;
            this.projectId = computeProjectId(this.images);
            this.updateSessionWithImages();

            if (this.pendingNewSession) {
                if (this.stableProjectId) localStorage.removeItem(this.stableProjectId);
                localStorage.removeItem(this.projectId);
                this.pendingNewSession = false;
                this.saveToLocalStorage();
            } else {
                const didRestore = this.tryRestoreFromLocalStorage();
                if (!didRestore) this.saveToLocalStorage();
                else if (!isBatchAppend) this.showSessionResumeModal();
            }
        }

        this.updateUI();
        this.resizeCanvas();
        this.drawImage();

        if (this.deferredRestore) {
            const { lastViewedFilename } = this.deferredRestore;
            this.deferredRestore = null;
            let targetIdx = -1;
            if (lastViewedFilename) {
                const idx = this.images.findIndex(im => im.name === lastViewedFilename);
                if (idx >= 0) {
                    const c = this.sessionData.classifications[lastViewedFilename];
                    targetIdx = (c && c.status !== 'pending') ? this.findNextPendingIndex(idx + 1) : idx;
                    if (targetIdx === -1) targetIdx = idx;
                }
            }
            if (targetIdx === -1) {
                targetIdx = this.images.findIndex(im => { const c = this.sessionData.classifications[im.name]; return !c || c.status === 'pending'; });
                if (targetIdx === -1) targetIdx = 0;
            }
            this.currentIndex = targetIdx;
            this.resetView();
            this.drawImage();
            this.updateUI();
            this.showSessionResumeModal();
        }

        if (this._deferredMaskFiles) {
            const batch = this._deferredMaskFiles;
            this._deferredMaskFiles = null;
            await this.loadMasks(batch, true);
        }

        if (!isBatchAppend && !inBatchMode && this.masks.length === 0) {
            const maskFiles = await this.showMaskUploadModal();
            if (maskFiles) await this.loadMasks(maskFiles);
        }
    },

    async loadMasks(files, isBatchAppend = false, fromDirectory = false) {
        let maskFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (!maskFiles.length) return;

        // Enforce batch size only for directory loads
        if (!isBatchAppend && fromDirectory && this.maxBatchSize > 0 && maskFiles.length > this.maxBatchSize) {
            this.pendingMaskFiles = maskFiles.slice(this.maxBatchSize);
            maskFiles = maskFiles.slice(0, this.maxBatchSize);
        } else if (!isBatchAppend) {
            this.pendingMaskFiles = [];
        }

        // Store all directory mask files for batch-jump corrections
        if (!isBatchAppend && fromDirectory) {
            this.allDirectoryMaskFiles = [...maskFiles, ...this.pendingMaskFiles].sort((a, b) => a.name.localeCompare(b.name));
        }

        // If images were session-restored to a non-first batch, jump mask loading to match
        if (!isBatchAppend && fromDirectory && this.batchOffset > 0 && this.maxBatchSize > 0) {
            const allSortedMasks = this.allDirectoryMaskFiles.length > 0
                ? this.allDirectoryMaskFiles
                : [...maskFiles, ...this.pendingMaskFiles].sort((a, b) => a.name.localeCompare(b.name));
            maskFiles = allSortedMasks.slice(this.batchOffset, this.batchOffset + this.maxBatchSize);
            this.pendingMaskFiles = allSortedMasks.slice(this.batchOffset + this.maxBatchSize);
        }

        const totalDropped = maskFiles.length + this.pendingMaskFiles.length;

        let append = isBatchAppend;
        if (!isBatchAppend && this.masks.length > 0) {
            const choice = await this.showLoadConfirm(this.masks.length, 'Masks');
            if (choice === 'cancel') {
                this.pendingMaskFiles = [];
                return;
            }
            append = choice === 'append';
        }

        const progressBar = document.getElementById('maskLoadProgress');
        const progressFill = document.getElementById('maskProgressFill');
        const statusDiv = document.getElementById('maskLoadStatus');

        progressBar.style.display = 'block';
        progressFill.style.width = '0%';

        statusDiv.textContent = this.pendingMaskFiles.length > 0
            ? `Loading first ${maskFiles.length} of ${totalDropped} masks...`
            : 'Loading masks...';

        if (!append) {
            this.masks = [];
            this.masksMap.clear();
        }

        for (let i = 0; i < maskFiles.length; i++) {
            const file = maskFiles[i];
            const img = new Image();
            const url = URL.createObjectURL(file);

            statusDiv.textContent = `Loading mask ${i + 1}/${maskFiles.length}: ${file.name}`;

            await new Promise((resolve) => {
                img.onload = () => {
                    const maskObj = { img, name: file.name, url };
                    this.masks.push(maskObj);
                    this.masksMap.set(normalizeBase(file.name), maskObj);
                    progressFill.style.width = ((i + 1) / maskFiles.length * 100) + '%';
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = url;
            });

            await new Promise(resolve => setTimeout(resolve, 20));
        }

        progressBar.style.display = 'none';
        statusDiv.textContent = `✅ Loaded ${this.masks.length} masks`;

        this.masks.sort((a, b) => a.name.localeCompare(b.name));
        this.masksMap.clear();
        for (const m of this.masks) {
            this.masksMap.set(normalizeBase(m.name), m);
        }

        const inBatchMode = this.pendingMaskFiles.length > 0 || this.pendingImageFiles.length > 0;

        if (!inBatchMode) {
            const { discardedImages, discardedMasks } = this._reconcileImageMaskPairs();

            if (discardedImages > 0 || discardedMasks > 0) {
                const parts = [];
                if (discardedMasks > 0) parts.push(`${discardedMasks} mask${discardedMasks > 1 ? 's' : ''}`);
                if (discardedImages > 0) parts.push(`${discardedImages} image${discardedImages > 1 ? 's' : ''}`);
                this.showToast(`Discarded ${parts.join(' and ')} without a match`);
            }
        }

        this.updateUI();
        this.drawImage();

        if (!isBatchAppend && !inBatchMode && this.images.length === 0) {
            const imageFiles = await this.showImageUploadModal();
            if (imageFiles) await this.loadImages(imageFiles);
        }
    },

    findMaskForImage(imageName) {
        return this.masksMap.get(normalizeBase(imageName)) || null;
    },

    _reconcileImageMaskPairs() {
        if (!this.images.length || !this.masks.length) return { discardedImages: 0, discardedMasks: 0 };

        const maskBaseNames = new Set(this.masks.map(m => normalizeBase(m.name)));
        const imageBaseNames = new Set(this.images.map(im => normalizeBase(im.name)));

        const beforeImages = this.images.length;
        const beforeMasks = this.masks.length;

        this.images = this.images.filter(im => maskBaseNames.has(normalizeBase(im.name)));
        this.masks = this.masks.filter(m => imageBaseNames.has(normalizeBase(m.name)));

        this.masksMap.clear();
        for (const m of this.masks) {
            this.masksMap.set(normalizeBase(m.name), m);
        }

        return {
            discardedImages: beforeImages - this.images.length,
            discardedMasks: beforeMasks - this.masks.length
        };
    },
};
