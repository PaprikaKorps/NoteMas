/**
 * Notable - File System Access API Logic with Persistence
 */

// State
let directoryHandle = null;
let notes = [];
let activeNoteId = null;
let saveTimeout = null;
let eventListenersInitialized = false;
const collapsedCategories = new Set();
const DEFAULT_NOTE_FONT = 'Inter, "Segoe UI", sans-serif';
const DEFAULT_NOTE_FONT_SIZE = '18px';
const FONT_CANDIDATES = [
    'Inter', 'Segoe UI', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
    'Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Courier New',
    'Lucida Console', 'Monaco', 'Consolas', 'Impact', 'Comic Sans MS', 'Candara',
    'Franklin Gothic Medium', 'Gill Sans', 'system-ui', 'sans-serif', 'serif', 'monospace'
];

// DOM Elements
const folderOverlay = document.getElementById('folder-overlay');
const folderMessage = document.getElementById('folder-message');
const openFolderBtn = document.getElementById('open-folder-btn');
const notesListEl = document.getElementById('notes-list');
const newNoteBtn = document.getElementById('new-note-btn');
const editorPlaceholder = document.getElementById('editor-placeholder');
const editorContent = document.getElementById('editor-content');
const titleInput = document.getElementById('note-title-input');
const categoryInput = document.getElementById('note-category-input');
const categoryOptionsEl = document.getElementById('category-options');
const bodyInput = document.getElementById('note-body-input');
const fontSettingsBtn = document.getElementById('font-settings-btn');
const fontSelect = document.getElementById('note-font-select');
const fontSizeSelect = document.getElementById('note-font-size-select');
const fontMenu = document.getElementById('note-font-menu');
const exportBtn = document.getElementById('export-note-btn');
const deleteBtn = document.getElementById('delete-note-btn');
const saveStatus = document.getElementById('last-saved-indicator');

// IndexedDB Helper for Storing Handle
const dbName = 'notable-db';
const storeName = 'handles';

function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(storeName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function setHandle(handle) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(handle, 'dirHandle');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getHandle() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get('dirHandle');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function verifyPermission(handle) {
    const options = { mode: 'readwrite' };
    if ((await handle.queryPermission(options)) === 'granted') {
        return true;
    }
    // This will prompt the user if they haven't explicitly denied
    if ((await handle.requestPermission(options)) === 'granted') {
        return true;
    }
    return false;
}

function setFolderMessage(message) {
    if (!folderMessage) return;
    folderMessage.textContent = message;
}

function formatFontFamily(fontName) {
    const cleanName = (fontName || '').trim();
    if (!cleanName) return DEFAULT_NOTE_FONT;

    const serifFonts = ['Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Book Antiqua', 'Palatino'];
    const monoFonts = ['Courier New', 'Lucida Console', 'Consolas', 'Monaco', 'SFMono-Regular'];

    if (serifFonts.includes(cleanName)) {
        return `"${cleanName}", serif`;
    }
    if (monoFonts.includes(cleanName)) {
        return `"${cleanName}", monospace`;
    }
    if (cleanName.includes(' ') || cleanName.includes('-')) {
        return `"${cleanName}", sans-serif`;
    }
    return `${cleanName}, sans-serif`;
}

function getAvailableFonts() {
    const uniqueFonts = new Set(FONT_CANDIDATES);

    if (document.fonts && typeof document.fonts.forEach === 'function') {
        document.fonts.forEach(font => {
            if (font && font.family) {
                uniqueFonts.add(font.family);
            }
        });
    }

    const availableFonts = Array.from(uniqueFonts)
        .filter(font => !!font && font.trim() !== '')
        .filter(font => {
            if (font === 'sans-serif' || font === 'serif' || font === 'monospace') return true;
            try {
                if (document.fonts && typeof document.fonts.check === 'function') {
                    return document.fonts.check(`12px ${/[\s-]/.test(font) ? '"' + font + '"' : font}`);
                }
            } catch (e) {
                console.warn('Could not verify font availability for', font, e);
            }
            return true;
        })
        .sort((a, b) => a.localeCompare(b));

    return availableFonts.length ? availableFonts : FONT_CANDIDATES;
}

function populateFontOptions() {
    if (!fontSelect) return;

    const availableFonts = getAvailableFonts();
    const currentFont = fontSelect.value || DEFAULT_NOTE_FONT;
    fontSelect.innerHTML = '';

    availableFonts.forEach(font => {
        const option = document.createElement('option');
        option.value = formatFontFamily(font);
        option.textContent = font;
        fontSelect.appendChild(option);
    });

    const validCurrent = Array.from(fontSelect.options).some(option => option.value === currentFont);
    fontSelect.value = validCurrent ? currentFont : formatFontFamily('Segoe UI');
}

function supportsDirectoryPicker() {
    return typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
}

// Initialization
async function init() {
    if (!supportsDirectoryPicker()) {
        setFolderMessage('This app needs to run from a secure local web server (for example http://localhost) because the browser blocks the folder picker on file:// pages. Open the project using a local server and try again.');
        return;
    }

    try {
        const handle = await getHandle();
        if (handle) {
            const hasPermission = await verifyPermission(handle);
            if (hasPermission) {
                directoryHandle = handle;
                folderOverlay.classList.add('hidden');
                await loadNotes();
                renderNotesList();
                setupEventListeners();
                return;
            }
        }
    } catch (e) {
        console.error('Failed to load handle from DB or verify permission', e);
    }
    // If no handle or permission denied, keep overlay visible
}

openFolderBtn.addEventListener('click', async () => {
    if (!supportsDirectoryPicker()) {
        setFolderMessage('This app needs to run from a secure local web server (for example http://localhost) because the browser blocks the folder picker on file:// pages. Open the project using a local server and try again.');
        return;
    }

    try {
        directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        await setHandle(directoryHandle);
        folderOverlay.classList.add('hidden');
        await loadNotes();
        renderNotesList();
        setupEventListeners();
    } catch (e) {
        console.error('Directory selection cancelled or failed', e);
        setFolderMessage('You must select a folder to use the app. Please choose a folder in the browser dialog.');
    }
});

window.addEventListener('DOMContentLoaded', () => {
    populateFontOptions();
    init();
});

// Data Management
function sortNotes() {
    notes.sort((a, b) => {
        if (a.isPinned && b.isPinned) {
            return a.pinnedAt - b.pinnedAt; // oldest pinned first
        }
        if (a.isPinned) return -1;
        if (b.isPinned) return 1;
        
        // Secondary sort: Group by category
        const catA = a.category.toLowerCase();
        const catB = b.category.toLowerCase();
        if (catA < catB) return -1;
        if (catA > catB) return 1;
        
        // Tertiary sort: recently updated
        return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

async function loadNotes() {
    notes = [];
    for await (const entry of directoryHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
            try {
                const file = await entry.getFile();
                const contents = await file.text();
                const noteData = JSON.parse(contents);
                notes.push({
                    id: entry.name.replace('.json', ''),
                    handle: entry,
                    title: noteData.title || '',
                    category: noteData.category || 'Uncategorized',
                    body: noteData.body || '',
                    updatedAt: noteData.updatedAt || new Date().toISOString(),
                    isPinned: noteData.isPinned || false,
                    pinnedAt: noteData.pinnedAt || null,
                    fontFamily: noteData.fontFamily || DEFAULT_NOTE_FONT,
                    fontSize: noteData.fontSize || DEFAULT_NOTE_FONT_SIZE
                });
            } catch (e) {
                console.error('Failed to parse note:', entry.name);
            }
        }
    }
    sortNotes();
}

async function saveNoteToFile(note) {
    try {
        const writable = await note.handle.createWritable();
        const noteData = {
            title: note.title,
            category: note.category,
            body: note.body,
            updatedAt: note.updatedAt,
            isPinned: note.isPinned,
            pinnedAt: note.pinnedAt,
            fontFamily: note.fontFamily || DEFAULT_NOTE_FONT,
            fontSize: note.fontSize || DEFAULT_NOTE_FONT_SIZE
        };
        await writable.write(JSON.stringify(noteData, null, 2));
        await writable.close();
        showSaveStatus();
    } catch (e) {
        console.error('Failed to save file', e);
    }
}

window.togglePin = async function(event, id) {
    event.stopPropagation(); // prevent opening the note
    const note = notes.find(n => n.id === id);
    if (!note) return;
    
    if (note.isPinned) {
        note.isPinned = false;
        note.pinnedAt = null;
    } else {
        note.isPinned = true;
        note.pinnedAt = Date.now();
    }
    
    sortNotes();
    renderNotesList();
    await saveNoteToFile(note);
}

// Core Operations
async function createNote() {
    const newId = 'note_' + Date.now();
    try {
        const newFileHandle = await directoryHandle.getFileHandle(newId + '.json', { create: true });
        const newNote = {
            id: newId,
            handle: newFileHandle,
            title: '',
            category: 'Uncategorized',
            body: '',
            updatedAt: new Date().toISOString(),
            isPinned: false,
            pinnedAt: null,
            fontFamily: DEFAULT_NOTE_FONT,
            fontSize: DEFAULT_NOTE_FONT_SIZE
        };
        
        // Save initial state
        await saveNoteToFile(newNote);
        
        notes.push(newNote);
        sortNotes();
        renderNotesList();
        openNote(newNote.id);
    } catch (e) {
        console.error('Failed to create new file', e);
        alert('Could not create a new note file.');
    }
}

async function updateActiveNote() {
    if (!activeNoteId) return;
    
    const noteIndex = notes.findIndex(n => n.id === activeNoteId);
    if (noteIndex === -1) return;
    
    const note = notes[noteIndex];
    note.title = titleInput.value;
    note.category = categoryInput.value || 'Uncategorized';
    note.body = bodyInput.value;
    note.fontFamily = fontSelect.value || DEFAULT_NOTE_FONT;
    note.fontSize = fontSizeSelect.value || DEFAULT_NOTE_FONT_SIZE;
    note.updatedAt = new Date().toISOString();
    
    sortNotes();
    
    // Debounce save
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveNoteToFile(note);
        renderNotesList(); // re-render to update categories
    }, 500);
}

function applyNoteFont(fontFamily, fontSize) {
    const selectedFont = fontFamily || DEFAULT_NOTE_FONT;
    const selectedSize = fontSize || DEFAULT_NOTE_FONT_SIZE;
    titleInput.style.fontFamily = selectedFont;
    categoryInput.style.fontFamily = selectedFont;
    bodyInput.style.fontFamily = selectedFont;
    titleInput.style.fontSize = selectedSize;
    categoryInput.style.fontSize = selectedSize;
    bodyInput.style.fontSize = selectedSize;

    if (fontSelect) {
        const fontExists = Array.from(fontSelect.options).some(option => option.value === selectedFont);
        fontSelect.value = fontExists ? selectedFont : formatFontFamily('Segoe UI');
    }

    if (fontSizeSelect) {
        const sizeExists = Array.from(fontSizeSelect.options).some(option => option.value === selectedSize);
        fontSizeSelect.value = sizeExists ? selectedSize : DEFAULT_NOTE_FONT_SIZE;
    }
}

function toggleFontMenu(forceOpen) {
    if (!fontMenu) return;
    const shouldShow = typeof forceOpen === 'boolean' ? forceOpen : fontMenu.classList.contains('hidden');
    fontMenu.classList.toggle('hidden', !shouldShow);
}

async function changeNoteFont() {
    if (!activeNoteId) return;

    const noteIndex = notes.findIndex(n => n.id === activeNoteId);
    if (noteIndex === -1) return;

    const note = notes[noteIndex];
    note.fontFamily = fontSelect.value || DEFAULT_NOTE_FONT;
    note.fontSize = fontSizeSelect.value || DEFAULT_NOTE_FONT_SIZE;
    applyNoteFont(note.fontFamily, note.fontSize);
    toggleFontMenu(false);

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveNoteToFile(note);
    }, 200);
}

async function deleteActiveNote() {
    if (!activeNoteId) return;
    
    if (confirm('Are you sure you want to delete this note file permanently?')) {
        try {
            const note = notes.find(n => n.id === activeNoteId);
            await directoryHandle.removeEntry(note.handle.name);
            notes = notes.filter(n => n.id !== activeNoteId);
            activeNoteId = null;
            renderNotesList();
            updateEditorView();
        } catch (e) {
            console.error('Failed to delete file', e);
            alert('Could not delete the note file.');
        }
    }
}

async function exportActiveNote() {
    if (!activeNoteId) return;
    const note = notes.find(n => n.id === activeNoteId);
    if (!note) return;

    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: (note.title || 'Untitled Note') + '.txt',
            types: [{
                description: 'Text Files',
                accept: { 'text/plain': ['.txt'] }
            }]
        });
        
        const writable = await handle.createWritable();
        const content = `Title: ${note.title || 'Untitled Note'}\nCategory: ${note.category || 'Uncategorized'}\n\n${note.body}`;
        await writable.write(content);
        await writable.close();
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Failed to export file', e);
            alert('Could not export the file.');
        }
    }
}

// UI Updates
function openNote(id) {
    activeNoteId = id;
    renderNotesList();
    updateEditorView();
}

function updateEditorView() {
    if (!activeNoteId) {
        editorPlaceholder.classList.remove('hidden');
        editorContent.classList.add('hidden');
        titleInput.value = '';
        categoryInput.value = '';
        bodyInput.value = '';
        titleInput.style.fontFamily = DEFAULT_NOTE_FONT;
        categoryInput.style.fontFamily = DEFAULT_NOTE_FONT;
        bodyInput.style.fontFamily = DEFAULT_NOTE_FONT;
        titleInput.style.fontSize = DEFAULT_NOTE_FONT_SIZE;
        categoryInput.style.fontSize = DEFAULT_NOTE_FONT_SIZE;
        bodyInput.style.fontSize = DEFAULT_NOTE_FONT_SIZE;
        if (fontSelect) {
           fontSelect.value = formatFontFamily('Segoe UI');
        }
        if (fontSizeSelect) {
           fontSizeSelect.value = DEFAULT_NOTE_FONT_SIZE;
        }
        toggleFontMenu(false);
        return;
    }
    
    const note = notes.find(n => n.id === activeNoteId);
    if (note) {
        editorPlaceholder.classList.add('hidden');
        editorContent.classList.remove('hidden');
        titleInput.value = note.title;
        categoryInput.value = note.category === 'Uncategorized' ? '' : note.category;
        bodyInput.value = note.body;
        applyNoteFont(note.fontFamily || DEFAULT_NOTE_FONT, note.fontSize || DEFAULT_NOTE_FONT_SIZE);
        
        if(!titleInput.value && !categoryInput.value && !bodyInput.value) {
           titleInput.focus(); 
        }
    }
}

function createNoteItemHTML(note) {
    const date = new Date(note.updatedAt);
    const formattedDate = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
    
    const displayTitle = note.title.trim() || 'Untitled Note';
    const displayBody = note.body.trim() || 'No additional text';
    
    let categoryTag = '';
    if (note.category && note.category.toLowerCase() !== 'uncategorized') {
        categoryTag = `<div class="note-item-category">${escapeHTML(note.category)}</div>`;
    }
    
    return `
        ${categoryTag}
        <div class="note-item-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
            <div class="note-item-title" style="margin-bottom: 0;">${escapeHTML(displayTitle)}</div>
            <button class="pin-btn ${note.isPinned ? 'pinned' : ''}" aria-label="Pin note" title="Pin note" onclick="togglePin(event, '${note.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="${note.isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 11V7a4 4 0 0 0-8 0v4L4 14h16l-4-3z"></path>
                    <path d="M12 22v-8"></path>
                </svg>
            </button>
        </div>
        <div class="note-item-date">${formattedDate}</div>
    `;
}

function renderNotesList() {
    notesListEl.innerHTML = '';
    
    if (notes.length === 0) {
        notesListEl.innerHTML = `
            <div style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 0.9rem;">
                No notes yet. Create one!
            </div>
        `;
        return;
    }
    
    const pinnedNotes = notes.filter(n => n.isPinned);
    const unpinnedNotes = notes.filter(n => !n.isPinned);
    
    // Helper to render a group of notes
    const renderGroup = (catName, notesInGroup, isPinnedGroup = false) => {
        const header = document.createElement('div');
        const isCollapsed = collapsedCategories.has(catName);
        header.className = `category-header ${isCollapsed ? 'collapsed' : ''}`;
        
        // Add arrow icon and text
        header.innerHTML = `
            <span>${isPinnedGroup ? '📌 ' + catName : escapeHTML(catName)}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron">
                <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
        `;
        
        const container = document.createElement('div');
        container.className = `category-notes-container ${isCollapsed ? 'collapsed' : ''}`;
        
        header.addEventListener('click', () => {
            if (collapsedCategories.has(catName)) {
                collapsedCategories.delete(catName);
                header.classList.remove('collapsed');
                container.classList.remove('collapsed');
            } else {
                collapsedCategories.add(catName);
                header.classList.add('collapsed');
                container.classList.add('collapsed');
            }
        });
        
        notesListEl.appendChild(header);
        notesListEl.appendChild(container);
        
        notesInGroup.forEach(note => {
            const item = document.createElement('div');
            item.className = `note-item ${note.id === activeNoteId ? 'active' : ''}`;
            item.innerHTML = createNoteItemHTML(note);
            item.addEventListener('click', () => openNote(note.id));
            container.appendChild(item);
        });
    };
    
    // Render Pinned Section
    if (pinnedNotes.length > 0) {
        renderGroup('Pinned', pinnedNotes, true);
    }
    
    // Group Unpinned Notes
    const grouped = {};
    unpinnedNotes.forEach(note => {
        const cat = (note.category && note.category.trim() !== '') ? note.category.trim() : 'Uncategorized';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(note);
    });
    
    // Render Groups
    const categories = Object.keys(grouped).sort();
    categories.forEach(cat => {
        renderGroup(cat, grouped[cat]);
    });
    
    // Update Datalist options
    const uniqueCategories = new Set();
    notes.forEach(note => {
        if (note.category && note.category.toLowerCase() !== 'uncategorized') {
            uniqueCategories.add(note.category);
        }
    });
    if (categoryOptionsEl) {
        categoryOptionsEl.innerHTML = '';
        uniqueCategories.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat;
            categoryOptionsEl.appendChild(option);
        });
    }
}

function showSaveStatus() {
    saveStatus.classList.add('show');
    setTimeout(() => {
        saveStatus.classList.remove('show');
    }, 2000);
}

// Utility
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Event Listeners (called after initialization)
function setupEventListeners() {
    if (eventListenersInitialized) return;

    populateFontOptions();

    newNoteBtn.addEventListener('click', createNote);
    exportBtn.addEventListener('click', exportActiveNote);
    deleteBtn.addEventListener('click', deleteActiveNote);
    titleInput.addEventListener('input', updateActiveNote);
    categoryInput.addEventListener('input', updateActiveNote);
    bodyInput.addEventListener('input', updateActiveNote);
    fontSettingsBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleFontMenu();
    });
    fontSelect.addEventListener('change', changeNoteFont);
    fontSizeSelect.addEventListener('change', changeNoteFont);
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.font-settings-container')) {
            toggleFontMenu(false);
        }
    });

    eventListenersInitialized = true;
}
