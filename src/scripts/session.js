import { generateSessionId, rgbToHex } from './utils.js';

export const sessionMixin = {
    saveToLocalStorage() {
        const key = this.stableProjectId || this.projectId;
        if (!key) return;
        const payload = {
            sessionId: this.sessionData.sessionId,
            classifications: this.sessionData.classifications,
            settings: this.sessionData.settings,
            currentIndex: this.currentIndex,
            lastViewedFilename: this.images[this.currentIndex] ? this.images[this.currentIndex].name : null,
            savedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(key, JSON.stringify(payload));
        } catch (e) {}
    },

    tryRestoreFromLocalStorage() {
        const key = this.stableProjectId || this.projectId;
        if (!key) return false;
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            const data = JSON.parse(raw);
            this.sessionData.classifications = {
                ...this.sessionData.classifications,
                ...(data.classifications || {})
            };
            if (data.settings) this.applySettings(data.settings);
            if (data.lastViewedFilename) {
                const idx = this.images.findIndex(im => im.name === data.lastViewedFilename);
                if (idx >= 0) {
                    const c = this.sessionData.classifications[data.lastViewedFilename];
                    if (c && c.status !== 'pending') {
                        const nextPending = this.findNextPendingIndex(idx + 1);
                        if (nextPending >= 0) {
                            this.currentIndex = nextPending;
                        } else {
                            this.currentIndex = this.pendingImageFiles.length > 0 ? this.images.length - 1 : idx;
                        }
                    } else {
                        this.currentIndex = idx;
                    }
                }
            } else if (typeof data.currentIndex === 'number') {
                this.currentIndex = Math.min(Math.max(0, data.currentIndex), Math.max(0, this.images.length - 1));
            }
            this.updateStats();
            this.updateUI();
            return true;
        } catch (e) {
            return false;
        }
    },

    applySettings(s) {
        if (s.maskClasses && Array.isArray(s.maskClasses)) {
            this.maskClasses = s.maskClasses;
            this.renderClassList();
        }
        if (s.backgroundColor) {
            this.backgroundColor = s.backgroundColor;
            const bgPicker = document.getElementById('backgroundColorPicker');
            if (bgPicker) bgPicker.value = rgbToHex(this.backgroundColor);
        }
        if (typeof s.transparentBackground === 'boolean') {
            this.transparentBackground = s.transparentBackground;
            const bgCheck = document.getElementById('transparentBackgroundCheckbox');
            if (bgCheck) bgCheck.checked = this.transparentBackground;
        }
        if (typeof s.transparency === 'number') {
            this.transparency = s.transparency;
            const slider = document.getElementById('transparencySlider');
            if (slider) slider.value = this.transparency * 100;
            const valSpan = document.getElementById('transparencyValue');
            if (valSpan) valSpan.textContent = Math.round(this.transparency * 100) + '%';
        }
        if (typeof s.autoAdvance === 'boolean') {
            this.autoAdvance = s.autoAdvance;
            const advCheck = document.getElementById('autoAdvanceCheckbox');
            if (advCheck) advCheck.checked = this.autoAdvance;
        }
        if (typeof s.maxBatchSize === 'number') {
            this.maxBatchSize = s.maxBatchSize;
            const batchInput = document.getElementById('maxBatchSizeInput');
            if (batchInput) batchInput.value = this.maxBatchSize;
        }
    },

    persistSettings() {
        this.sessionData.settings = {
            maskClasses: this.maskClasses,
            backgroundColor: this.backgroundColor,
            transparentBackground: this.transparentBackground,
            transparency: this.transparency,
            autoAdvance: this.autoAdvance,
            maxBatchSize: this.maxBatchSize,
            currentIndex: this.currentIndex,
            lastViewedFilename: this.images[this.currentIndex] ? this.images[this.currentIndex].name : null
        };
        this.saveToLocalStorage();
        this.saveUserPrefs();
    },

    saveSession() {
        if (!this.images.length) {
            this.showToast('No data to save');
            return;
        }

        this.persistSettings();
        this.sessionData.lastSaved = new Date().toISOString();

        const dataStr = JSON.stringify(this.sessionData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `image_analysis_session_${this.sessionData.sessionId}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.showToast('Session saved successfully');
        this.updateSessionStatus();
    },

    loadSession(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                let sessionId, classifications, settings;

                if (data.sessionId && data.classifications) {
                    sessionId = data.sessionId;
                    classifications = data.classifications;
                    settings = data.settings || {};
                } else if (data.sessionInfo && data.details) {
                    sessionId = data.sessionInfo.sessionId;
                    settings = data.sessionInfo.settings || {};
                    classifications = {};
                    (data.details || []).forEach(d => {
                        classifications[d.filename] = {
                            status: d.status,
                            timestamp: d.timestamp,
                            notes: d.notes || ''
                        };
                    });
                } else {
                    throw new Error('Unrecognised session file format');
                }

                this.sessionData = {
                    sessionId,
                    createdAt: data.createdAt || data.sessionInfo?.createdAt || new Date().toISOString(),
                    classifications,
                    settings
                };

                if (this.images.length) {
                    if (settings) this.applySettings(settings);
                    let restored = false;

                    if (settings.lastViewedFilename) {
                        const idx = this.images.findIndex(im => im.name === settings.lastViewedFilename);
                        if (idx >= 0) {
                            this.currentIndex = idx;
                            restored = true;
                        }
                    }

                    if (!restored && typeof settings.currentIndex === 'number') {
                        this.currentIndex = Math.min(Math.max(0, settings.currentIndex), Math.max(0, this.images.length - 1));
                    }

                    this.loadedSessionTotal = Object.keys(classifications).length;
                    this.updateStats();
                    this.updateUI();
                    this.updateSessionStatus();
                    this.drawImage();
                    this.saveToLocalStorage();
                    this.showToast(`Session loaded (${Object.keys(classifications).length} images)`);
                } else {
                    this.loadedSessionTotal = Object.keys(classifications).length;
                    this.deferredRestore = {
                        lastViewedFilename: settings.lastViewedFilename || null,
                        currentIndex: settings.currentIndex || 0
                    };
                    if (settings) this.applySettings(settings);
                    this.showToast(`Session loaded (${Object.keys(classifications).length} images). Select a directory to resume.`);
                }

                document.getElementById('optionsModal').classList.remove('open');

            } catch (error) {
                console.error('Error loading session:', error);
                this.showToast('Error: ' + error.message);
            }
        };
        reader.readAsText(file);
    },

    newSession() {
        if (Object.keys(this.sessionData.classifications).length > 0) {
            const modal = document.getElementById('newSessionConfirmModal');
            modal.classList.add('open');
            const close = () => { modal.classList.remove('open'); document.removeEventListener('keydown', onKey); };
            const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
            modal.onclick = (e) => { if (e.target === modal) close(); };
            document.getElementById('newSessionConfirmCancelBtn').onclick = close;
            document.getElementById('newSessionConfirmCancelFooterBtn').onclick = close;
            document.getElementById('newSessionConfirmOkBtn').onclick = () => { close(); this._doNewSession(); };
            document.addEventListener('keydown', onKey);
            return;
        }
        this._doNewSession();
    },

    _doNewSession() {
        this.sessionData = {
            sessionId: generateSessionId(),
            createdAt: new Date().toISOString(),
            classifications: {},
            settings: {}
        };

        this.stats = {
            approved: 0,
            rejected: 0,
            skipped: 0,
            pending: 0,
            total: this.images.length
        };

        this.images = [];
        this.masks = [];
        this.masksMap.clear();
        this.currentIndex = 0;
        this.pendingImageFiles = [];
        this.pendingMaskFiles = [];
        this.allDirectoryFiles = [];
        this.allDirectoryMaskFiles = [];
        this._deferredMaskFiles = null;
        this.batchOffset = 0;
        this.deferredRestore = null;
        this.pendingNewSession = true;
        this.loadedSessionTotal = 0;
        document.getElementById('imageLoadStatus').textContent = '';
        document.getElementById('maskLoadStatus').textContent = '';
        this.updateSessionWithImages();

        if (this.stableProjectId) {
            localStorage.removeItem(this.stableProjectId);
            this.stableProjectId = null;
        }
        if (this.projectId) {
            localStorage.removeItem(this.projectId);
        }

        this.resetView();
        this.drawImage();
        this.updateUI();
        this.persistSettings();
        this.showToast('New session started');
        document.getElementById('optionsModal').classList.remove('open');
    },

    updateSessionWithImages() {
        this.images.forEach(image => {
            if (!this.sessionData.classifications[image.name]) {
                this.sessionData.classifications[image.name] = {
                    status: 'pending',
                    timestamp: null,
                    notes: ''
                };
            }
        });
        this.updateStats();
        this.updateSessionStatus();
    },

    updateStats() {
        this.stats = {
            approved: 0,
            rejected: 0,
            skipped: 0,
            pending: 0,
            total: this.images.length
        };

        Object.values(this.sessionData.classifications).forEach(classification => {
            if (classification && classification.status && this.stats[classification.status] !== undefined) {
                this.stats[classification.status]++;
            }
        });
    },

    updateSessionStatus() {
        const sessionStatus = document.getElementById('sessionStatus');
        const totalClassified = this.stats.approved + this.stats.rejected + this.stats.skipped;
        const totalImages = this.stats.total;

        if (totalImages > 0) {
            const progress = Math.round((totalClassified / totalImages) * 100);
            sessionStatus.textContent = `Progress: ${totalClassified}/${totalImages} (${progress}%)`;
        } else {
            sessionStatus.textContent = 'No images loaded';
        }
    },

    saveUserPrefs() {
        try {
            localStorage.setItem('geominds_overlay_user_prefs', JSON.stringify({
                maxBatchSize: this.maxBatchSize,
                autoAdvance: this.autoAdvance,
                transparency: this.transparency,
                maskClasses: this.maskClasses,
                backgroundColor: this.backgroundColor,
                transparentBackground: this.transparentBackground,
            }));
        } catch (e) {}
    },

    loadUserPrefs() {
        try {
            const raw = localStorage.getItem('geominds_overlay_user_prefs');
            if (!raw) return;
            this.applySettings(JSON.parse(raw));
        } catch (e) {}
    },
};
