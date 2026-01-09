import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, db as firestore, collection, addDoc, getDocs, doc, getDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, setDoc } from './firebase-config.js';

const DB_NAME = 'ghost_pioneer_db';
const DB_VERSION = 1;

document.addEventListener('DOMContentLoaded', () => {
    // --- IndexedDB Management ---


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

    const dbLocal = new DBManager();

    // --- Firestore Helpers ---
    async function saveToFirestore(item) {
        if (!currentUser) return;
        try {
            const itemRef = doc(firestore, 'users', currentUser.uid, 'items', item.id);
            await setDoc(itemRef, item);
        } catch (e) {
            console.error("Firestore Save Error:", e);
        }
    }

    async function deleteFromFirestore(id) {
        if (!currentUser) return;
        try {
            await deleteDoc(doc(firestore, 'users', currentUser.uid, 'items', id));
        } catch (e) {
            console.error("Firestore Delete Error:", e);
        }
    }

    async function getFirestoreItems() {
        if (!currentUser) return [];
        const q = query(collection(firestore, 'users', currentUser.uid, 'items'));
        const querySnapshot = await getDocs(q);
        const remoteItems = [];
        querySnapshot.forEach((doc) => {
            remoteItems.push(doc.data());
        });
        return remoteItems;
    }

    async function saveFirestoreOrder(order) {
        if (!currentUser) return;
        try {
            await setDoc(doc(firestore, 'users', currentUser.uid, 'meta', 'order'), { value: order });
        } catch (e) {
            console.error("Firestore Order Save Error:", e);
        }
    }

    async function getFirestoreOrder() {
        if (!currentUser) return [];
        try {
            const docRef = doc(firestore, 'users', currentUser.uid, 'meta', 'order');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                return docSnap.data().value;
            }
            return [];
        } catch (e) {
            console.error("Firestore Order Fetch Error:", e);
            return [];
        }
    }

    // --- DB Proxy (Hybrid) ---
    // Handles switching between Local (IndexedDB) and Cloud (Firestore)
    const db = {
        init: async () => await dbLocal.init(),
        getAllItems: async () => {
            // Strategy: Load from Local first for speed, then sync with Cloud?
            // For now: specific mode switch.
            if (dbMode === 'cloud') {
                const cloudItems = await getFirestoreItems();
                // Merge/Sync logic could go here. For now, Cloud source of truth if connected.
                if (cloudItems.length > 0) return cloudItems;
                // If cloud empty, maybe first sync? fallback to local?
                return await dbLocal.getAllItems();
            }
            return await dbLocal.getAllItems();
        },
        saveItem: async (item) => {
            await dbLocal.saveItem(item); // Always save local (Cache/Offline)
            if (dbMode === 'cloud') {
                await saveToFirestore(item);
            }
        },
        deleteItem: async (id) => {
            await dbLocal.deleteItem(id);
            if (dbMode === 'cloud') {
                await deleteFromFirestore(id);
            }
        },
        saveOrder: async (order) => {
            await dbLocal.saveOrder(order);
            if (dbMode === 'cloud') {
                await saveFirestoreOrder(order);
            }
        },
        getOrder: async () => {
            if (dbMode === 'cloud') {
                const cloudOrder = await getFirestoreOrder();
                if (cloudOrder && cloudOrder.length > 0) return cloudOrder;
            }
            return await dbLocal.getOrder();
        }
    };


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
    let currentUser = null;
    let dbMode = 'local';

    // --- Card Size Logic ---
    function initCardSize() {
        let savedSize = localStorage.getItem('cardMinSize');

        // Detect Mobile
        const isMobile = window.innerWidth < 600;

        // S24 & standard mobile optimization:
        // Force reset if mobile but size is "desktop-like" (> 180px)
        // 140px is safe for 2 columns on almost all screens (140+140+10gap+24padding = 314px)
        if (isMobile) {
            // Optimize slider range for mobile:
            // "Right side doing nothing" fix: Cap max size to 240px.
            // Anything > ~200px is already 1 column on mobile, so 400px is wasteful.
            cardSizeSlider.max = 240;

            if (!savedSize || parseInt(savedSize) > 240) {
                savedSize = 140;
                localStorage.setItem('cardMinSize', savedSize); // Auto-fix storage
            }
        }

        const defaultSize = isMobile ? 140 : 280;
        const finalSize = savedSize ? savedSize : defaultSize;

        board.style.setProperty('--card-min-width', `${finalSize}px`);
        cardSizeSlider.value = finalSize;

        if (finalSize <= 100) board.classList.add('compact-mode');

        cardSizeSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            board.style.setProperty('--card-min-width', `${val}px`);

            if (val <= 100) {
                board.classList.add('compact-mode');
            } else {
                board.classList.remove('compact-mode');
            }
        });

        cardSizeSlider.addEventListener('change', (e) => {
            localStorage.setItem('cardMinSize', e.target.value);
        });
    }
    initCardSize();

    // --- Backup & Restore Logic ---
    const backupBtn = document.getElementById('backupBtn');
    const restoreBtn = document.getElementById('restoreBtn');
    const restoreInput = document.getElementById('restoreInput');
    const syncBtn = document.getElementById('syncBtn');

    // Sync (Migration) Logic
    syncBtn.addEventListener('click', async () => {
        if (!currentUser) return;
        if (!confirm('端末のデータをクラウドに上書きコピーしますか？\n（クラウド上のデータは保護されますが、念のため実行します）')) return;

        try {
            syncBtn.disabled = true;
            syncBtn.classList.add('spinning'); // Add CSS animation later if wanted

            const localItems = await dbLocal.getAllItems();
            const total = localItems.length;
            let count = 0;

            console.log(`Starting migration of ${total} items...`);

            for (const item of localItems) {
                await saveToFirestore(item);
                count++;
                if (count % 5 === 0) console.log(`Uploaded ${count}/${total}...`);
            }

            // Sync Order too
            const localOrder = await dbLocal.getOrder();
            if (localOrder && localOrder.length > 0) {
                await saveFirestoreOrder(localOrder);
            }

            alert(`同期完了！\n${count}個のデータをクラウドに保存しました。`);
        } catch (e) {
            console.error("Sync failed:", e);
            alert("同期中にエラーが発生しました。");
        } finally {
            syncBtn.disabled = false;
            syncBtn.classList.remove('spinning');
        }
    });

    backupBtn.addEventListener('click', async () => {
        try {
            const allItems = await db.getAllItems();
            const order = await db.getOrder();
            const data = {
                version: 1,
                timestamp: new Date().toISOString(),
                items: allItems,
                customOrder: order
            };

            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `my_collection_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            alert('バックアップファイルを作成しました。\nGoogleドライブ等に保存すると他の端末で共有できます。');
        } catch (err) {
            console.error('Backup failed:', err);
            alert('バックアップに失敗しました');
        }
    });

    restoreBtn.addEventListener('click', () => {
        restoreInput.click();
    });

    restoreInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!confirm('現在のデータを上書きして、ファイルを読み込みますか？\n（現在のデータは消えます）')) {
            this.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (!data.items || !Array.isArray(data.items)) {
                    throw new Error('Invalid data format');
                }

                // Clear existing
                // Since our DBManager doesn't have clearAll, we delete one by one or we should add a clear method?
                // For now, let's just delete all current items in state to be safe, then verify on reload.
                // Actually, migration logic handles empty, but we need to actively clear DB.
                // Let's iterate delete. Performance might be meh but safe.
                const currentItems = await db.getAllItems();
                await Promise.all(currentItems.map(item => db.deleteItem(item.id)));

                // Add new items
                // This might trigger UI updates if we called addItem, but we want bulk insert.
                // db.saveItem is simpler.
                await Promise.all(data.items.map(item => db.saveItem(item)));

                if (data.customOrder) {
                    await db.saveOrder(data.customOrder);
                }

                alert('データの読み込みが完了しました。\nアプリを再読み込みします。');
                location.reload();

            } catch (err) {
                console.error('Restore failed:', err);
                alert('ファイルの読み込みに失敗しました。\n正しいバックアップファイルか確認してください。');
            }
        };
        reader.readAsText(file);
    });

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

                    if (navigator.storage && navigator.storage.persist) {
                        navigator.storage.persist().then(granted => {
                            if (granted) console.log("Storage persisted.");
                        });
                    }
                    console.log("Migration Complete.");
                } catch (e) {
                    console.error("Migration Failed:", e);
                }
            }

            await reloadData();
            handleShareTarget(); // Check for shared content
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
            if (e.isComposing) return; // Ignore Enter key during IME composition (Japanese)

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

        input.addEventListener('blur', () => {
            // Auto-add text as tag when leaving the field (Visual feedback)
            if (input.value.trim()) addTag(input.value);
            hideSuggestions();
        });

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
            addPendingTag: () => {
                if (input.value.trim()) addTag(input.value);
            },
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

        // Link Indicator
        const linkIconHtml = item.link
            ? `<div class="card-link-icon"><span class="material-icons-round" style="font-size: 14px;">link</span></div>`
            : '';

        div.innerHTML = `
            <div class="card-image-container">
                ${linkIconHtml}
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
        img.addEventListener('click', () => {
            if (item.link) {
                window.open(item.link, '_blank');
            } else {
                openLightbox(item.image);
            }
        });

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

    // Tab Logic
    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    let currentTab = 'file';

    console.log('Initializing Tabs:', tabs.length);

    tabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault(); // Prevent form submission if inside form
            console.log('Tab Clicked:', btn.dataset.tab);

            currentTab = btn.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            tabContents.forEach(c => {
                c.id === `tab-${currentTab}` ? c.classList.add('active') : c.classList.remove('active');
            });
        });
    });

    addBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        addForm.reset();
        resetImagePreview();
        modalTagManager.reset();
        document.getElementById('star3').checked = true;

        // Reset Tab
        currentTab = 'file';
        tabs[0].click();
    });

    function closeModal() {
        modal.classList.add('hidden');
    }

    closeModalBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Link Fetching
    const linkInput = document.getElementById('linkInput');
    const fetchLinkBtn = document.getElementById('fetchLinkBtn');
    const linkStatus = document.getElementById('linkPreviewStatus');

    async function fetchLinkInfo() {
        const url = linkInput.value.trim();
        if (!url) return;

        linkStatus.textContent = '情報を取得中...';

        try {
            const api = `https://api.microlink.io?url=${encodeURIComponent(url)}`;
            const res = await fetch(api);
            const data = await res.json();

            if (data.status === 'success') {
                const meta = data.data;
                const imgUrl = meta.image ? meta.image.url : null;
                const title = meta.title || '';

                if (imgUrl) {
                    try {
                        const imgRes = await fetch(imgUrl);
                        const blob = await imgRes.blob();
                        const base64 = await new Promise(r => {
                            const reader = new FileReader();
                            reader.onload = () => r(reader.result);
                            reader.readAsDataURL(blob);
                        });
                        imagePreview.src = base64;
                    } catch (e) {
                        // Fallback for CORS images
                        imagePreview.src = imgUrl;
                    }

                    imagePreview.classList.remove('hidden');
                    // imagePreviewContainer.querySelector('span').style.opacity = '0'; // Only relevant for file tab, but safe to ignore
                    linkStatus.textContent = '取得成功: ' + title;

                    // Auto-fill title if empty
                    const memoInput = document.getElementById('memoInput');
                    if (!memoInput.value) memoInput.value = title;
                } else {
                    linkStatus.textContent = '画像が見つかりませんでした。';
                    // Keep placeholder logic in submit if needed, or set placeholder here?
                    // Let's reset preview to empty so submit handler generates placeholder if user doesn't strictly need OGP image
                    if (imagePreview.src.startsWith('data:')) {
                        // Keep existing placeholder if any
                    } else {
                        imagePreview.classList.add('hidden');
                    }
                }
            } else {
                linkStatus.textContent = '情報の取得に失敗しました。';
            }
        } catch (e) {
            console.error(e);
            linkStatus.textContent = 'エラーが発生しました。';
        }
    }

    fetchLinkBtn.addEventListener('click', fetchLinkInfo);

    // Image Handling + Compression
    imageInput.addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
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
        if (linkStatus) linkStatus.textContent = '';
    }

    // Helper: Generate Placeholder for Link
    function generateLinkPlaceholder() {
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 300;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, 300, 300);

        // Icon
        ctx.font = '100px "Material Icons Round"';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Draw "link" icon text (or simple text if font not ready, but usually works)
        ctx.fillText('link', 150, 150);

        return canvas.toDataURL('image/png');
    }

    addForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const memo = document.getElementById('memoInput').value;
        modalTagManager.addPendingTag();
        const tags = modalTagManager.getTags();
        const ratingInputs = document.querySelectorAll('input[name="rating"]');
        let rating = 3;
        for (const input of ratingInputs) {
            if (input.checked) {
                rating = parseInt(input.value);
                break;
            }
        }

        let finalImage = imagePreview.src;
        let linkUrl = null;

        if (currentTab === 'link') {
            linkUrl = document.getElementById('linkInput').value.trim();
            if (!linkUrl) {
                alert('URLを入力してください');
                return;
            }
            // If user fetched image, finalImage is set.
            // If not, or if fetch failed, use placeholder.
            if (!finalImage || finalImage === window.location.href || finalImage.includes('display: none')) { // Check visibility roughly
                finalImage = generateLinkPlaceholder();
            }
            // Ensure we don't accidentally use the placeholder from a previous file upload if we switched tabs?
            // Actually, resetImagePreview called on modal open clears it.
            // If user uploads image on Tab A, then switches to Tab B -> we should probably clear imagePreview or handle it.
            // For simplicity: If Tab B (Link), we trust imagePreview ONLY IF it was set by fetch (which we can't easily track without state, but if user clicked fetch it replaces src).
            // Let's assume if imagePreview is hidden, we use placeholder.
            if (imagePreview.classList.contains('hidden')) {
                finalImage = generateLinkPlaceholder();
            }
        } else {
            // File Tab
            if (!finalImage || finalImage === window.location.href || imagePreview.classList.contains('hidden')) {
                alert('画像を選択してください');
                return;
            }
        }

        const newItem = {
            id: Date.now().toString(),
            image: finalImage,
            memo: memo,
            rating: rating,
            tags: tags,
            link: linkUrl,
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
        // Find parent card to handle z-index
        const card = container.closest('.collection-card');
        if (card) card.classList.add('active-editing');

        container.className = 'tag-input-container';
        container.style.marginBottom = '8px';

        let isEditing = true;
        const finishEditing = (finalTags) => {
            if (!isEditing) return;
            tagManager.addPendingTag(); // Capture any text left in input
            finalTags = tagManager.getTags(); // Refresh tags
            isEditing = false;
            if (card) card.classList.remove('active-editing');
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

    // --- Share Target Logic ---
    function handleShareTarget() {
        const urlParams = new URLSearchParams(window.location.search);
        const title = urlParams.get('title');
        const text = urlParams.get('text');
        const url = urlParams.get('url');

        if (title || text || url) {
            console.log("Share Target Received:", title, text, url);

            modal.classList.remove('hidden');
            addForm.reset();
            resetImagePreview();

            // If URL is shared, switch to Link tab
            if (url) {
                const linkTabBtn = document.querySelector('.tab-btn[data-tab="link"]');
                if (linkTabBtn) linkTabBtn.click();
                const linkInput = document.getElementById('linkInput');
                if (linkInput) linkInput.value = url;
            }

            // Use text or title for Memo
            const memoInput = document.getElementById('memoInput');
            if (memoInput) {
                memoInput.value = text || title || '';
            }

            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }

    // --- Firebase Auth Logic ---
    function setupAuth() {
        const loginBtn = document.getElementById('loginBtn');
        const logoutBtn = document.getElementById('logoutBtn');
        const userProfile = document.getElementById('userProfile');
        const userAvatar = document.getElementById('userAvatar');
        const userName = document.getElementById('userName');

        if (!loginBtn) return;

        console.log("Setting up Auth Listeners");

        loginBtn.addEventListener('click', () => {
            // alert("ログイン処理を開始します..."); // Remove debug alert
            signInWithPopup(auth, googleProvider)
                .then((result) => {
                    console.log("Logged in:", result.user);
                }).catch((error) => {
                    console.error("Login failed:", error);
                    alert("ログインに失敗しました: " + error.message);
                });
        });

        logoutBtn.addEventListener('click', () => {
            if (confirm('ログアウトしますか？')) {
                signOut(auth).then(() => {
                    console.log("Logged out");
                    window.location.reload();
                });
            }
        });

        onAuthStateChanged(auth, (user) => {
            if (user) {
                currentUser = user;
                dbMode = 'cloud';

                loginBtn.classList.add('hidden');
                logoutBtn.classList.remove('hidden');
                if (syncBtn) syncBtn.classList.remove('hidden'); // Show Sync
                userProfile.style.display = 'flex';

                // Fallback for missing photoURL
                const avatarUrl = user.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
                userAvatar.src = avatarUrl;
                userName.textContent = user.displayName || 'User';

                console.log("Switched to Cloud Mode. User:", user.displayName, user.uid);
            } else {
                currentUser = null;
                dbMode = 'local';

                loginBtn.classList.remove('hidden');
                logoutBtn.classList.add('hidden');
                if (syncBtn) syncBtn.classList.add('hidden'); // Hide Sync
                userProfile.style.display = 'none';
            }
        });
    }

    // Start App
    setupAuth();
    initApp();
});

// --- Firebase Auth Logic ---
function setupAuth() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const userProfile = document.getElementById('userProfile');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');

    if (!loginBtn) return;

    console.log("Setting up Auth Listeners");

    loginBtn.addEventListener('click', () => {
        alert("ログイン処理を開始します...");
        signInWithPopup(auth, googleProvider)
            .then((result) => {
                console.log("Logged in:", result.user);
            }).catch((error) => {
                console.error("Login failed:", error);
                alert("ログインに失敗しました: " + error.message);
            });
    });

    logoutBtn.addEventListener('click', () => {
        if (confirm('ログアウトしますか？')) {
            signOut(auth).then(() => {
                console.log("Logged out");
                window.location.reload();
            });
        }
    });

    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            dbMode = 'cloud';

            loginBtn.classList.add('hidden');
            logoutBtn.classList.remove('hidden');
            userProfile.style.display = 'flex';

            // Fallback for missing photoURL
            const avatarUrl = user.photoURL || 'https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y';
            userAvatar.src = avatarUrl;
            userName.textContent = user.displayName || 'User';

            console.log("Switched to Cloud Mode. User:", user.displayName, user.uid);
        } else {
            currentUser = null;
            dbMode = 'local';

            loginBtn.classList.remove('hidden');
            logoutBtn.classList.add('hidden');
            userProfile.style.display = 'none';
        }
    });
}
