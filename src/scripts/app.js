// src/scripts/app.js
import { generateSessionId, hexToRgb } from './utils.js';
import { classConfigMixin } from './classConfig.js';
import { sessionMixin } from './session.js';
import { loaderMixin } from './loader.js';
import { rendererMixin } from './renderer.js';
import { navigationMixin } from './navigation.js';
import { classificationMixin } from './classification.js';
import { exporterMixin } from './exporter.js';
import { modalsMixin } from './modals.js';

export class ModernImageOverlayApp {
    constructor() {
        this.images = [];
        this.masks = [];
        this.masksMap = new Map(); // normalised base name -> mask object
        this.currentIndex = 0;
        this.transparency = 0.5;
        this.zoom = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.lastMousePos = { x: 0, y: 0 };

        // Multi-class configuration parameters
        this.transparentBackground = true;
        this.backgroundColor = { r: 0, g: 0, b: 0 };
        this.maskClasses = [
            { label: 'Background', pixelValue: 0, color: { r: 0, g: 0, b: 0 }, visible: false },
            { label: 'Ditch', pixelValue: 1, color: { r: 0, g: 255, b: 0 }, visible: true }
        ];

        // Azure integration
        this.isAzureMode = false;
        this.azureBaseUrl = '';
        this.pendingMaskLoads = new Set();

        // Auto-advance control
        this.autoAdvance = true;
        this.deferredRestore = null;
        this.projectId = null;
        this.stableProjectId = null;

        // Batch loading
        this.maxBatchSize = 1000;
        this.pendingImageFiles = [];
        this.pendingMaskFiles = [];
        this.allDirectoryFiles = [];
        this.allDirectoryMaskFiles = [];
        this._deferredMaskFiles = null;
        this.batchOffset = 0;
        this.pendingNewSession = false;
        this.loadedSessionTotal = 0;

        // Session data
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
            total: 0
        };

        this.canvas = document.getElementById('imageCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.setupEventListeners();
        this.setupTouchEvents();
        this.renderClassList();
        this.updateUI();
        this.updateSessionStatus();
        this.loadUserPrefs();
    }

    setupEventListeners() {
        // Options modal
        const optionsBtn = document.getElementById('optionsToggleBtn');
        const optionsModal = document.getElementById('optionsModal');
        const optionsCloseBtn = document.getElementById('optionsModalCloseBtn');
        if (optionsBtn && optionsModal) {
            optionsBtn.addEventListener('click', () => optionsModal.classList.add('open'));
        }
        if (optionsCloseBtn && optionsModal) {
            optionsCloseBtn.addEventListener('click', () => {
                optionsModal.classList.remove('open');
                this.persistSettings();
            });
        }
        if (optionsModal) {
            optionsModal.addEventListener('click', (e) => {
                if (e.target === optionsModal) {
                    optionsModal.classList.remove('open');
                    this.persistSettings();
                }
            });
        }

        // Help modal
        const helpBtn = document.getElementById('helpToggleBtn');
        const helpModal = document.getElementById('helpModal');
        const helpCloseBtn = document.getElementById('helpModalCloseBtn');
        if (helpBtn && helpModal) {
            helpBtn.addEventListener('click', () => helpModal.classList.add('open'));
        }
        if (helpCloseBtn && helpModal) {
            helpCloseBtn.addEventListener('click', () => helpModal.classList.remove('open'));
        }
        if (helpModal) {
            helpModal.addEventListener('click', (e) => {
                if (e.target === helpModal) helpModal.classList.remove('open');
            });
        }

        // Collapsible Azure section
        const azureToggleHeader = document.getElementById('azureToggleHeader');
        const azureConnectionBox = document.getElementById('azureConnectionBox');
        if (azureToggleHeader && azureConnectionBox) {
            azureToggleHeader.addEventListener('click', () => {
                const isHidden = azureConnectionBox.style.display === 'none';
                azureConnectionBox.style.display = isHidden ? 'block' : 'none';
                azureToggleHeader.classList.toggle('open', isHidden);
            });
        }

        // Folder pickers
        document.getElementById('imageInput').addEventListener('change', (e) => {
            this.isAzureMode = false;
            this.loadImages(e.target.files, false, true);
            e.target.value = '';
        });
        document.getElementById('maskInput').addEventListener('change', (e) => {
            this.loadMasks(e.target.files, false, true);
            e.target.value = '';
        });

        // Azure loader
        document.getElementById('azureLoadBtn').addEventListener('click', () => {
            let endpoint = document.getElementById('azureApiUrl').value.trim();
            if (!endpoint) endpoint = 'https://image-backend-chgrh9eag3czcsck.westeurope-01.azurewebsites.net';
            const limit = parseInt(document.getElementById('azureLimit').value) || 50;
            const offset = parseInt(document.getElementById('azureOffset').value) || 0;
            this.loadFromAzure(endpoint, limit, offset);
        });

        // Session management
        document.getElementById('saveSessionBtn').addEventListener('click', () => this.saveSession());
        document.getElementById('loadSessionBtn').addEventListener('click', () => document.getElementById('sessionInput').click());
        document.getElementById('sessionInput').addEventListener('change', (e) => this.loadSession(e.target.files[0]));
        document.getElementById('newSessionBtn').addEventListener('click', () => this.newSession());

        // Status actions
        document.getElementById('approveBtn').addEventListener('click', () => {
            this.setImageStatus('approved');
            this.afterActionAdvance();
            this.saveToLocalStorage();
        });
        document.getElementById('rejectBtn').addEventListener('click', () => {
            this.setImageStatus('rejected');
            this.afterActionAdvance();
            this.saveToLocalStorage();
        });
        document.getElementById('skipCurrentBtn').addEventListener('click', () => {
            this.setImageStatus('skipped');
            this.afterActionAdvance();
            this.saveToLocalStorage();
        });
        document.getElementById('clearStatusBtn').addEventListener('click', () => {
            this.clearImageStatus();
            this.saveToLocalStorage();
        });

        document.getElementById('autoAdvanceCheckbox').addEventListener('change', (e) => {
            this.autoAdvance = e.target.checked;
            this.persistSettings();
        });
        document.getElementById('maxBatchSizeInput').addEventListener('change', (e) => {
            this.maxBatchSize = Math.max(0, parseInt(e.target.value) || 0);
            e.target.value = this.maxBatchSize;
            this.persistSettings();
        });
        document.getElementById('nextPendingBtn').addEventListener('click', () => this.jumpToNextPending());

        // Drop zones
        this.setupDropZone('imageDropZone', 'imageInput');
        this.setupDropZone('maskDropZone', 'maskInput');
        this.setupModalDropZones();

        // Sliders
        document.getElementById('transparencySlider').addEventListener('input', (e) => {
            this.transparency = e.target.value / 100;
            if (this.transparency === 0) this.maskToggledOff = false;
            document.getElementById('transparencyValue').textContent = e.target.value + '%';
            this.drawImage();
            this.persistSettings();
            this.updateUI();
        });
        document.getElementById('zoomSlider').addEventListener('input', (e) => {
            this.zoom = e.target.value / 100;
            document.getElementById('zoomValue').textContent = e.target.value + '%';
            this.drawImage();
        });
        document.getElementById('percentageSlider').addEventListener('input', (e) => {
            document.getElementById('percentageValue').textContent = e.target.value + '%';
        });

        // Mask class config
        document.getElementById('numClassesInput').addEventListener('change', (e) => {
            this.handleNumClassesChange(parseInt(e.target.value) || 1);
        });
        document.getElementById('backgroundColorPicker').addEventListener('change', (e) => {
            this.backgroundColor = hexToRgb(e.target.value);
            this.drawImage();
            this.persistSettings();
        });
        document.getElementById('transparentBackgroundCheckbox').addEventListener('change', (e) => {
            this.transparentBackground = e.target.checked;
            this.drawImage();
            this.persistSettings();
        });

        // Navigation & exporters
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        if (prevBtn) prevBtn.addEventListener('click', () => this.previousImage());
        if (nextBtn) nextBtn.addEventListener('click', () => this.nextImage());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportView());
        document.getElementById('exportResultsBtn').addEventListener('click', () => this.exportResults());
        document.getElementById('createSubsetBtn').addEventListener('click', () => this.createRandomSubset());
        document.getElementById('downloadProjectBtn').addEventListener('click', () => this.downloadCompleteProject());

        document.getElementById('navPrevBtn').addEventListener('click', () => this.previousImage());
        document.getElementById('navNextBtn').addEventListener('click', () => this.nextImage());

        // Canvas interaction
        this.canvas.addEventListener('mousedown', (e) => this.startDrag(e));
        this.canvas.addEventListener('mousemove', (e) => this.drag(e));
        this.canvas.addEventListener('mouseup', () => this.endDrag());
        this.canvas.addEventListener('wheel', (e) => this.handleZoom(e), { passive: false });

        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    setupTouchEvents() {
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.startDrag({ clientX: touch.clientX, clientY: touch.clientY });
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            this.drag({ clientX: touch.clientX, clientY: touch.clientY });
        }, { passive: false });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.endDrag();
        }, { passive: false });

        let lastDistance = 0;
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                lastDistance = Math.sqrt(dx * dx + dy * dy);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2) {
                e.preventDefault();
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (lastDistance > 0) {
                    this.zoom = Math.max(0.1, Math.min(5, this.zoom * (distance / lastDistance)));
                    document.getElementById('zoomSlider').value = this.zoom * 100;
                    document.getElementById('zoomValue').textContent = Math.round(this.zoom * 100) + '%';
                    this.drawImage();
                }
                lastDistance = distance;
            }
        }, { passive: false });
    }

    setupDropZone(dropZoneId, inputId) {
        const dropZone = document.getElementById(dropZoneId);
        const input = document.getElementById(inputId);

        dropZone.addEventListener('click', () => input.click());
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');

            const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
            if (dropZoneId === 'imageDropZone') {
                this.isAzureMode = false;
                this.loadImages(files);
            } else {
                this.loadMasks(files);
            }
        });
    }

    updateUI() {
        const hasImages = this.images.length > 0;

        const canGoPrev = this.currentIndex > 0 || this.batchOffset > 0;
        const canGoNext = this.currentIndex < this.images.length - 1 || this.pendingImageFiles.length > 0;

        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        if (prevBtn) prevBtn.disabled = !hasImages || !canGoPrev;
        if (nextBtn) nextBtn.disabled = !hasImages || !canGoNext;
        document.getElementById('navPrevBtn').disabled = !hasImages || !canGoPrev;
        document.getElementById('navNextBtn').disabled = !hasImages || !canGoNext;
        document.getElementById('nextPendingBtn').disabled = this.findNextPendingIndex(0) === -1 && this.pendingImageFiles.length === 0;

        document.getElementById('exportBtn').disabled = !hasImages;
        document.getElementById('exportResultsBtn').disabled = !hasImages;
        document.getElementById('createSubsetBtn').disabled = !hasImages;
        document.getElementById('downloadProjectBtn').disabled = !hasImages;

        const accumulatedTotal = Math.max(this.batchOffset + this.images.length, this.loadedSessionTotal);
        document.getElementById('currentIndex').textContent = hasImages ? this.batchOffset + this.currentIndex + 1 : 0;
        document.getElementById('totalImages').textContent = accumulatedTotal;
        document.getElementById('approvedCount').textContent = this.stats.approved;
        document.getElementById('rejectedCount').textContent = this.stats.rejected;
        document.getElementById('skippedCount').textContent = this.stats.skipped;
        document.getElementById('pendingCount').textContent = this.stats.pending;

        const imageInfo = document.getElementById('imageInfo');
        if (hasImages) {
            const currentImage = this.images[this.currentIndex];
            const globalIndex = this.batchOffset + this.currentIndex + 1;
            imageInfo.textContent = `${currentImage.name} (${globalIndex}/${accumulatedTotal})`;
        } else {
            imageInfo.textContent = 'No images loaded';
        }

        this.updateCurrentImageStatus();
        this.updateSessionStatus();

        const badge = document.getElementById('maskStatusBadge');
        if (badge) badge.style.display = this.transparency === 0 ? 'flex' : 'none';
    }
}

Object.assign(ModernImageOverlayApp.prototype,
    classConfigMixin,
    sessionMixin,
    loaderMixin,
    rendererMixin,
    navigationMixin,
    classificationMixin,
    exporterMixin,
    modalsMixin
);
