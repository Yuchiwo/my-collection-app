document.addEventListener('DOMContentLoaded', () => {
    // --- IndexedDB Management ---
    const DB_NAME = 'ghost_pioneer_db';
    const DB_VERSION = 1;

    class DBManager {
        constructor() {
            this.db = null;
        }

        async init() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onerror = (event) => {
                    console.error("IndexedDB error:", event.target.error);
                    reject(event.target.error);
                };

                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    resolve();
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    // Create object store for items
                    if (!db.objectStoreNames.contains('items')) {
                        db.createObjectStore('items', { keyPath: 'id' });
                    }
                    // Create object store for metadata (like sort order)
                    if (!db.objectStoreNames.contains('meta')) {
                        db.createObjectStore('meta', { keyPath: 'key' });
                    }
                };
            });
        }

        async getAllItems() {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['items'], 'readonly');
                const store = transaction.objectStore('items');
                const request = store.getAll();

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        async saveItem(item) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['items'], 'readwrite');
                const store = transaction.objectStore('items');
                const request = store.put(item);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        async deleteItem(id) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['items'], 'readwrite');
                const store = transaction.objectStore('items');
                const request = store.delete(id);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        async saveOrder(orderArray) {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['meta'], 'readwrite');
                const store = transaction.objectStore('meta');
                const request = store.put({ key: 'customOrder', value: orderArray });

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        async getOrder() {
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['meta'], 'readonly');
                const store = transaction.objectStore('meta');
                const request = store.get('customOrder');

                request.onsuccess = () => resolve(request.result ? request.result.value : null);
                request.onerror = () => reject(request.error);
            });
        }
    }

    const db = new DBManager();

    // --- Image Compression ---
    function compressImage(file, maxWidth = 800, quality = 0.7) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = (err) => reject(err);
            };
            reader.onerror = (err) => reject(err);
        });
    }

    // DOM Elements
    const board = document.getElementById('board');
    const emptyState = document.getElementById('emptyState');
    const addBtn = document.getElementById('addBtn');
    const modal = document.getElementById('itemModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const addForm = document.getElementById('addForm');
    const imageInput = document.getElementById('imageInput');
    const imagePreview = document.getElementById('imagePreview');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    const sortSelect = document.getElementById('sortSelect');
    const filterBar = document.getElementById('filterBar');
    const modalTagContainer = document.getElementById('modalTagContainer');
    const cardSizeSlider = document.getElementById('cardSizeSlider');

    // Lightbox Elements
    const lightbox = document.getElementById('lightbox');
    const lightboxImage = document.getElementById('lightboxImage');
    const lightboxClose = document.getElementById('lightboxClose');

    // State
    let items = []; // Application State (Source of Truth for rendering)
    let currentSortMode = 'custom';
    let currentFilterTag = null;
    let customOrder = []; // Array of IDs

    // --- Card Size Logic ---
    function initCardSize() {
        let savedSize = localStorage.getItem('cardMinSize');

        // Detect Mobile
        const isMobile = window.innerWidth < 600;

        // S24 & standard mobile optimization:
        // Force reset if mobile but size is "desktop-like" (> 180px)
        // 140px is safe for 2 columns on almost all screens (140+140+10gap+24padding = 314px)
        if (isMobile) {
            if (!savedSize || parseInt(savedSize) > 180) {
                savedSize = 140;
                localStorage.setItem('cardMinSize', savedSize); // Auto-fix storage
            }
        }

        const defaultSize = isMobile ? 140 : 280;
        const finalSize = savedSize ? savedSize : defaultSize;

        board.style.setProperty('--card-min-width', `${finalSize}px`);
        cardSizeSlider.value = finalSize;

        cardSizeSlider.addEventListener('input', (e) => {
            const val = e.target.value;
            board.style.setProperty('--card-min-width', `${val}px`);
        });

        cardSizeSlider.addEventListener('change', (e) => {
            localStorage.setItem('cardMinSize', e.target.value);
        });
    }
    initCardSize();

    // --- App Initialization & Migration ---
    async function initApp() {
        try {
            await db.init();

            // Check Migration
            const lsData = localStorage.getItem('collectionItems');
            if (lsData) {
                console.log("Migrating from LocalStorage...");
                try {
                    const lsItems = JSON.parse(lsData);
                    const orderIds = [];
                    for (const item of lsItems) {
                        await db.saveItem(item); // Bulk add to DB
                        orderIds.push(item.id);
                    }
                    await db.saveOrder(orderIds); // Save initial order

                    // Clear LS
                    localStorage.removeItem('collectionItems');
                    console.log("Migration Complete.");
                } catch (e) {
                    console.error("Migration Failed:", e);
                }
            }

            await reloadData();
        } catch (e) {
            console.error("App Init Failed:", e);
            alert("データベースの読み込みに失敗しました。");
        }
    }

    async function reloadData() {
        // Load All Items
        const allItems = await db.getAllItems();

        // Load Order
        customOrder = await db.getOrder() || [];

        // Sort items based on customOrder (restore list)
        // If items exist not in order (newly added failure?), append them
        // Map for O(1) access
        const map = new Map();
        allItems.forEach(i => map.set(i.id, i));

        const orderedItems = [];

        // Add by order
        customOrder.forEach(id => {
            if (map.has(id)) {
                orderedItems.push(map.get(id));
                map.delete(id);
            }
        });

        // Add any remaining (orphans) to the beginning (like unshift)
        for (const item of map.values()) {
            orderedItems.unshift(item);
            customOrder.unshift(item.id); // Valid state fix
        }

        if (map.size > 0) {
            // Need to save fixed order?
            await db.saveOrder(customOrder);
        }

        items = orderedItems;
        render();
    }

    // --- Helper Functions ---
    function getAllUniqueTags() {
        const tags = new Set();
        items.forEach(item => {
            if (item.tags && Array.isArray(item.tags)) {
                item.tags.forEach(t => tags.add(t));
            }
        });
        return Array.from(tags).sort();
    }

    // --- Tag Input Management ---
    function setupTagInput(container, initialTags = [], onUpdate, getSuggestions = null) {
        container.innerHTML = '';
        let tags = [...initialTags];

        const dropdown = document.createElement('div');
        dropdown.className = 'tag-suggestions-dropdown hidden';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tag-input-field';
        input.placeholder = tags.length === 0 ? 'タグを追加...' : '';

        function renderChips() {
            const existingChips = container.querySelectorAll('.tag-chip');
            existingChips.forEach(c => c.remove());

            tags.forEach((tag, index) => {
                const chip = document.createElement('span');
                chip.className = 'tag-chip';
                chip.innerHTML = `${escapeHtml(tag)} <button type="button" class="remove-tag-btn">×</button>`;
                chip.querySelector('button').addEventListener('click', (e) => {
                    e.stopPropagation();
                    tags.splice(index, 1);
                    renderChips();
                    if (onUpdate) onUpdate(tags);
                });
                container.insertBefore(chip, input);
            });
            input.placeholder = tags.length === 0 ? 'タグを追加...' : '';
        }

        function showSuggestions() {
            if (!getSuggestions) return;
            const allTags = getSuggestions();
            const query = input.value.toLowerCase().trim();
            const matches = allTags.filter(t => t.toLowerCase().includes(query) && !tags.includes(t));

            if (matches.length === 0) {
                dropdown.classList.add('hidden');
                return;
            }

            dropdown.innerHTML = '';
            matches.forEach(tag => {
                const item = document.createElement('div');
                item.className = 'suggestion-item';
                item.textContent = `#${tag}`;
                item.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    addTag(tag);
                });
                dropdown.appendChild(item);
            });
            dropdown.classList.remove('hidden');
        }

        function hideSuggestions() {
            setTimeout(() => { dropdown.classList.add('hidden'); }, 100);
        }

        function addTag(val) {
            val = val.trim();
            if (val && !tags.includes(val)) {
                tags.push(val);
                renderChips();
                input.value = '';
                if (onUpdate) onUpdate(tags);
                input.focus();
                showSuggestions();
            }
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addTag(input.value);
                hideSuggestions();
            } else if (e.key === 'Backspace' && input.value === '' && tags.length > 0) {
                tags.pop();
                renderChips();
                if (onUpdate) onUpdate(tags);
            }
        });

        input.addEventListener('input', showSuggestions);
        input.addEventListener('focus', showSuggestions);
        input.addEventListener('blur', hideSuggestions);

        container.addEventListener('click', (e) => {
            if (e.target !== input && e.target !== dropdown && !dropdown.contains(e.target)) {
                input.focus();
            }
        });

        container.appendChild(input);
        container.appendChild(dropdown);
        renderChips();

        return {
            getTags: () => tags,
            reset: () => {
                tags = [];
                renderChips();
                input.value = '';
            }
        };
    }

    const modalTagManager = setupTagInput(modalTagContainer, [], null, getAllUniqueTags);

    // --- Core Logic ---

    // Note: We no longer have a sync saveItems(). Updates are async.
    // However, we update `items` in memory synchronously so the UI feels instant.

    async function addItem(item) {
        items.unshift(item); // Optimistic Update
        customOrder.unshift(item.id);

        render(); // Correctly shows new item

        // Async Persist
        try {
            await db.saveItem(item);
            await db.saveOrder(customOrder);
        } catch (e) {
            console.error("Save Failed:", e);
            alert("保存に失敗しました。");
        }
    }

    async function deleteItem(id) {
        if (!confirm('このコレクションを削除しますか？')) return;

        items = items.filter(i => i.id !== id);
        customOrder = customOrder.filter(uid => uid !== id);
        render();

        try {
            await db.deleteItem(id);
            await db.saveOrder(customOrder);
        } catch (e) {
            console.error("Delete Failed:", e);
        }
    }

    async function updateItemRating(id, newRating) {
        const item = items.find(i => i.id === id);
        if (item) {
            item.rating = newRating;

            // Optimistic DOM update
            const card = board.querySelector(`.collection-card[data-id="${id}"]`);
            if (card) {
                const starBtns = card.querySelectorAll('.star-btn');
                starBtns.forEach(btn => {
                    const ratingValue = parseInt(btn.dataset.rating);
                    if (ratingValue <= newRating) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            }

            await db.saveItem(item);
        }
    }

    async function updateItemTags(id, newTags) {
        const item = items.find(i => i.id === id);
        if (item) {
            item.tags = newTags;

            const needsReFilter = currentFilterTag !== null;
            if (needsReFilter) {
                render();
            } else {
                const card = board.querySelector(`.collection-card[data-id="${id}"]`);
                if (card) {
                    const container = card.querySelector('.tag-input-container') || card.querySelector('.card-tags');
                    if (container) {
                        container.className = `card-tags ${newTags.length > 0 ? '' : 'empty'}`;
                        container.style.marginBottom = '';

                        let tagsHtml = '';
                        if (newTags.length > 0) {
                            newTags.forEach(tag => {
                                const escaped = tag.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
                                tagsHtml += `<span class="tag-badge">#${escaped}</span>`;
                            });
                        }
                        container.innerHTML = tagsHtml;
                        renderFilterBar();
                    }
                }
            }

            await db.saveItem(item);
        }
    }

    // --- Sorting & Filtering ---
    sortSelect.addEventListener('change', (e) => {
        currentSortMode = e.target.value;
        render();
    });

    function getDisplayItems() {
        let displayItems = [...items];

        if (currentFilterTag) {
            displayItems = displayItems.filter(item => item.tags && item.tags.includes(currentFilterTag));
        }

        if (currentSortMode !== 'custom') {
            displayItems.sort((a, b) => {
                switch (currentSortMode) {
                    case 'rating-desc': return b.rating - a.rating;
                    case 'rating-asc': return a.rating - b.rating;
                    case 'date-desc': return new Date(b.createdAt) - new Date(a.createdAt);
                    case 'date-asc': return new Date(a.createdAt) - new Date(b.createdAt);
                    default: return 0;
                }
            });
        }
        return displayItems;
    }

    // --- Rendering ---
    function render() {
        renderFilterBar();
        board.querySelectorAll('.collection-card').forEach(el => el.remove());
        const displayItems = getDisplayItems();

        if (displayItems.length === 0) {
            emptyState.classList.remove('hidden');
            if (currentFilterTag) {
                emptyState.querySelector('p').innerHTML = `タグ「#${currentFilterTag}」がついた<br>アイテムはありません。`;
            } else {
                emptyState.querySelector('p').innerHTML = `まだコレクションがありません。<br>右下のボタンから追加してみましょう！`;
            }
        } else {
            emptyState.classList.add('hidden');
            displayItems.forEach(item => {
                const card = createCardElement(item);
                board.appendChild(card);
            });
        }
    }

    function renderFilterBar() {
        const allTags = getAllUniqueTags();
        filterBar.innerHTML = '';
        if (allTags.length === 0) return;

        const allBtn = document.createElement('button');
        allBtn.className = `filter-pill ${currentFilterTag === null ? 'active' : ''}`;
        allBtn.textContent = 'すべて';
        allBtn.addEventListener('click', () => {
            currentFilterTag = null;
            render();
        });
        filterBar.appendChild(allBtn);

        allTags.forEach(tag => {
            const btn = document.createElement('button');
            btn.className = `filter-pill ${currentFilterTag === tag ? 'active' : ''}`;
            btn.textContent = `#${tag}`;
            btn.addEventListener('click', () => {
                currentFilterTag = tag;
                render();
            });
            filterBar.appendChild(btn);
        });
    }

    function createCardElement(item) {
        const div = document.createElement('div');
        div.className = 'collection-card';

        const isCustomAndNoFilter = currentSortMode === 'custom' && currentFilterTag === null;

        if (isCustomAndNoFilter) {
            div.draggable = true;
        } else {
            div.draggable = false;
            div.classList.add('no-drag');
            div.title = "並び替え・絞り込み中は移動できません";
        }

        div.dataset.id = item.id;

        let starsHtml = '<div class="star-display">';
        for (let i = 1; i <= 5; i++) {
            const activeClass = i <= item.rating ? 'active' : '';
            starsHtml += `<button type="button" class="star-btn ${activeClass}" data-rating="${i}" aria-label="${i} stars">★</button>`;
        }
        starsHtml += '</div>';

        const dateObj = new Date(item.createdAt);
        const dateStr = dateObj.toLocaleString('ja-JP', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });

        const memoContent = item.memo ? escapeHtml(item.memo) : 'ひとことメモを追加する...';
        const memoClass = item.memo ? 'card-memo' : 'card-memo placeholder';

        const hasTags = item.tags && item.tags.length > 0;
        let tagsHtml = `<div class="card-tags ${hasTags ? '' : 'empty'}">`;
        if (hasTags) {
            item.tags.forEach(tag => {
                tagsHtml += `<span class="tag-badge">#${escapeHtml(tag)}</span>`;
            });
        }
        tagsHtml += '</div>';

        div.innerHTML = `
            <div class="card-image-container">
                <img src="${item.image}" alt="collection item" class="card-image" loading="lazy">
            </div>
            <div class="card-content">
                <div class="card-date">${dateStr}</div>
                ${tagsHtml}
                <p class="${memoClass}" data-id="${item.id}">${memoContent}</p>
            </div>
            <div class="card-footer">
                ${starsHtml}
                <button class="delete-btn" aria-label="削除">
                    <span class="material-icons-round">delete_outline</span>
                </button>
            </div>
        `;

        const starBtns = div.querySelectorAll('.star-btn');
        starBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const newRating = parseInt(btn.dataset.rating);
                updateItemRating(item.id, newRating);
            });
        });

        const deleteBtn = div.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', () => deleteItem(item.id));

        const img = div.querySelector('.card-image');
        img.addEventListener('click', () => openLightbox(item.image));

        const memoP = div.querySelector('.card-memo');
        memoP.addEventListener('click', () => startEditingMemo(item.id, memoP));

        const tagsDiv = div.querySelector('.card-tags');
        tagsDiv.addEventListener('click', (e) => {
            if (tagsDiv.querySelector('.tag-input-container')) return;
            startEditingTags(item.id, tagsDiv, item.tags || []);
        });

        if (div.draggable) {
            // Touch Events for Mobile Reordering
            div.addEventListener('touchstart', handleTouchStart, { passive: false });
            div.addEventListener('touchmove', handleTouchMove, { passive: false });
            div.addEventListener('touchend', handleTouchEnd);

            // Mouse Events
            div.addEventListener('dragstart', handleDragStart);
            div.addEventListener('dragover', handleDragOver);
            div.addEventListener('drop', handleDrop);
            div.addEventListener('dragend', handleDragEnd);
        }

        return div;
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // --- UI Interactions ---

    addBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        addForm.reset();
        resetImagePreview();
        modalTagManager.reset();
        document.getElementById('star3').checked = true;
    });

    function closeModal() {
        modal.classList.add('hidden');
    }

    closeModalBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Image Handling + Compression
    imageInput.addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        // Old check removed: if (file.size > 2 * 1024 * 1024) ...
        // Now we compress so we handle large files.
        // Maybe show Loading Spinner? 

        try {
            // Show preview immediately using raw file? Or wait for compress?
            // Wait for compress is safer for "what you see is what you get".
            const compressedBase64 = await compressImage(file);

            imagePreview.src = compressedBase64;
            imagePreview.classList.remove('hidden');
            imagePreviewContainer.querySelector('span').style.opacity = '0';
        } catch (err) {
            console.error("Compression failed", err);
            alert("画像の処理に失敗しました。");
            this.value = '';
        }
    });

    function resetImagePreview() {
        imagePreview.src = '';
        imagePreview.classList.add('hidden');
        imagePreviewContainer.querySelector('span').style.opacity = '1';
    }

    addForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const memo = document.getElementById('memoInput').value;
        const tags = modalTagManager.getTags();
        const ratingInputs = document.querySelectorAll('input[name="rating"]');
        let rating = 3;
        for (const input of ratingInputs) {
            if (input.checked) {
                rating = parseInt(input.value);
                break;
            }
        }

        if (!imagePreview.src || imagePreview.src === window.location.href) {
            alert('画像を選択してください');
            return;
        }

        const newItem = {
            id: Date.now().toString(),
            image: imagePreview.src, // Already compressed
            memo: memo,
            rating: rating,
            tags: tags,
            createdAt: new Date().toISOString()
        };

        addItem(newItem);
        closeModal();
    });

    // --- Lightbox ---
    function openLightbox(src) {
        lightboxImage.src = src;
        lightbox.classList.remove('hidden');
    }

    function closeLightbox() {
        lightbox.classList.add('hidden');
        setTimeout(() => { lightboxImage.src = ''; }, 300);
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });

    // --- Inline Editing (Memo) ---
    function startEditingMemo(id, element) {
        const item = items.find(i => i.id === id);
        if (!item) return;

        const textarea = document.createElement('textarea');
        textarea.className = 'memo-editor';
        textarea.value = item.memo;
        textarea.maxLength = 140;

        element.replaceWith(textarea);
        textarea.focus();

        textarea.addEventListener('blur', async () => {
            const newMemo = textarea.value.trim();
            item.memo = newMemo;

            await db.saveItem(item);
            render(); // Or in-place update for text is easy too, but render is fine.
        });
    }

    // --- Inline Editing (Tags) ---
    function startEditingTags(id, container, currentTags) {
        container.className = 'tag-input-container';
        container.style.marginBottom = '8px';

        let isEditing = true;
        const finishEditing = (finalTags) => {
            if (!isEditing) return;
            isEditing = false;
            updateItemTags(id, finalTags);
            document.removeEventListener('click', outsideClickListener);
        };

        const tagManager = setupTagInput(container, currentTags, null, getAllUniqueTags);
        const input = container.querySelector('input');

        const outsideClickListener = (e) => {
            // If target is no longer in DOM, it was likely removed by our own logic
            if (!document.body.contains(e.target)) return;

            // If focus is still on the input, we are interacting with the component (e.g. suggestion mousedown)
            // This is the most robust check against detached elements or bubble issues.
            if (document.activeElement === input) return;

            if (!container.contains(e.target)) {
                finishEditing(tagManager.getTags());
            }
        };

        setTimeout(() => {
            document.addEventListener('click', outsideClickListener);
        }, 0);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value === '') {
                finishEditing(tagManager.getTags());
            }
        });

        input.focus();
    }

    // --- Drag & Drop ---
    let draggedItem = null;

    function handleDragStart(e) {
        if (currentSortMode !== 'custom' || currentFilterTag !== null) {
            e.preventDefault();
            return false;
        }
        draggedItem = this;
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.id);
    }

    function handleDragOver(e) {
        if (currentSortMode !== 'custom' || currentFilterTag !== null) return false;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = this;
        if (target !== draggedItem && target.classList.contains('collection-card')) {
            const cards = Array.from(board.querySelectorAll('.collection-card'));
            const draggedIndex = cards.indexOf(draggedItem);
            const targetIndex = cards.indexOf(target);
            if (draggedIndex < targetIndex) {
                target.parentNode.insertBefore(draggedItem, target.nextSibling);
            } else {
                target.parentNode.insertBefore(draggedItem, target);
            }
        }
        return false;
    }

    function handleDragEnd(e) {
        this.classList.remove('dragging');
        draggedItem = null;
        saveOrderAfterSort();
    }

    function handleDrop(e) { e.stopPropagation(); e.preventDefault(); return false; }

    function saveOrderAfterSort() {
        const cards = Array.from(board.querySelectorAll('.collection-card'));
        const newItems = [];
        const newOrder = [];
        cards.forEach(card => {
            const id = card.dataset.id;
            const item = items.find(i => i.id === id);
            if (item) {
                newItems.push(item);
                newOrder.push(id);
            }
        });

        items = newItems;
        customOrder = newOrder;
        db.saveOrder(customOrder).catch(console.error);
    }

    // --- Touch Drag & Drop (Mobile Protection) ---
    let touchTimer = null;
    let touchItem = null;
    let touchClone = null;
    let startX = 0;
    let startY = 0;

    function handleTouchStart(e) {
        if (currentSortMode !== 'custom' || currentFilterTag !== null) return;
        if (e.touches.length > 1) return;

        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.card-tags')) return;

        touchItem = this;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;

        touchTimer = setTimeout(() => {
            startTouchDrag(touch);
        }, 500);
    }

    function handleTouchMove(e) {
        if (!touchItem) return;

        const touch = e.touches[0];
        const moveX = Math.abs(touch.clientX - startX);
        const moveY = Math.abs(touch.clientY - startY);

        if (touchTimer && (moveX > 10 || moveY > 10)) {
            clearTimeout(touchTimer);
            touchTimer = null;
            touchItem = null;
        }

        if (touchClone) {
            e.preventDefault();
            touchClone.style.transform = `translate(${touch.clientX}px, ${touch.clientY}px)`;

            touchClone.hidden = true;
            const elemBelow = document.elementFromPoint(touch.clientX, touch.clientY);
            touchClone.hidden = false;

            if (elemBelow) {
                const targetCard = elemBelow.closest('.collection-card');
                if (targetCard && targetCard !== touchItem && board.contains(targetCard)) {
                    const cards = Array.from(board.querySelectorAll('.collection-card'));
                    const draggedIndex = cards.indexOf(touchItem);
                    const targetIndex = cards.indexOf(targetCard);

                    if (draggedIndex < targetIndex) {
                        targetCard.parentNode.insertBefore(touchItem, targetCard.nextSibling);
                    } else {
                        targetCard.parentNode.insertBefore(touchItem, targetCard);
                    }
                    if (navigator.vibrate) navigator.vibrate(50);
                }
            }
        }
    }

    function handleTouchEnd(e) {
        if (touchTimer) {
            clearTimeout(touchTimer);
            touchTimer = null;
        }

        if (touchClone) {
            touchClone.remove();
            touchClone = null;
            touchItem.classList.remove('dragging');
            touchItem.style.opacity = '1';
            saveOrderAfterSort();
        }
        touchItem = null;
    }

    function startTouchDrag(touch) {
        if (!touchItem) return;
        touchTimer = null;

        if (navigator.vibrate) navigator.vibrate(100);

        const rect = touchItem.getBoundingClientRect();
        touchClone = touchItem.cloneNode(true);
        touchClone.style.position = 'fixed';
        touchClone.style.top = '0';
        touchClone.style.left = '0';
        touchClone.style.width = `${rect.width}px`;
        touchClone.style.height = `${rect.height}px`;
        touchClone.style.zIndex = '9999';
        touchClone.style.opacity = '0.9';
        touchClone.style.pointerEvents = 'none';
        touchClone.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
        touchClone.classList.add('dragging-clone');

        document.body.appendChild(touchClone);

        touchItem.style.opacity = '0.5';
    }

    // Start App
    initApp();
});
