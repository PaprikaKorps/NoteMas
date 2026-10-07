const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const markdownCopy = require('../markdown-copy.js');

function createAppContext() {
    const files = new Map();
    const directories = [];
    const removed = [];
    const alerts = [];
    let failMarkdownWrite = false;
    const fsApi = {
        mkdir: async (path) => directories.push(path),
        writeTextFile: async (path, content) => {
            if (failMarkdownWrite && path.endsWith('.md')) throw new Error('Markdown write failed');
            files.set(path, content);
        },
        exists: async (path) => files.has(path),
        remove: async (path) => {
            removed.push(path);
            files.delete(path);
        }
    };
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) {
            elements.set(id, {
                addEventListener() {},
                classList: { add() {}, remove() {} },
                style: {},
                options: []
            });
        }
        return elements.get(id);
    };
    const parseHTML = (html) => {
        const root = { nodeType: 1, tagName: 'DIV', childNodes: [] };
        const stack = [root];
        for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi)) {
            if (match[2] !== undefined) {
                stack.at(-1).childNodes.push({ nodeType: 3, nodeValue: match[2] });
            } else if (match[0].startsWith('</')) {
                if (stack.length > 1) stack.pop();
            } else {
                const element = { nodeType: 1, tagName: match[1].toUpperCase(), childNodes: [] };
                stack.at(-1).childNodes.push(element);
                if (!['BR', 'INPUT', 'IMG', 'HR'].includes(element.tagName) && !match[0].endsWith('/>')) {
                    stack.push(element);
                }
            }
        }
        return root;
    };
    const context = {
        window: {
            __TAURI__: { fs: fsApi, dialog: {} },
            NoteMarkdownCopy: markdownCopy,
            addEventListener() {}
        },
        document: {
            getElementById: getElement,
            createElement: () => ({
                nodeType: 1,
                tagName: 'DIV',
                childNodes: [],
                set innerHTML(value) {
                    this.childNodes = parseHTML(value).childNodes;
                }
            }),
            addEventListener() {}
        },
        console: { ...console, error() {} },
        alert: (message) => alerts.push(message),
        setTimeout: () => 1,
        clearTimeout() {},
        Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }
    };

    vm.createContext(context);
    vm.runInContext(fs.readFileSync(require.resolve('../app.js'), 'utf8'), context);
    vm.runInContext('tauriDirPath = "/notes"; renderNotesList = () => {}; updateEditorView = () => {};', context);

    return {
        alerts,
        directories,
        files,
        removed,
        run: (code) => vm.runInContext(code, context),
        setFailMarkdownWrite: (value) => { failMarkdownWrite = value; }
    };
}

test('stores the Markdown-copy preference independently per note', () => {
    const included = markdownCopy.toNoteFileData({ title: 'Included', markdownCopy: true });
    const excluded = markdownCopy.toNoteFileData({ title: 'Excluded', markdownCopy: false });

    assert.equal(included.markdownCopy, true);
    assert.equal(excluded.markdownCopy, false);
    assert.equal(markdownCopy.isEnabled(included), true);
    assert.equal(markdownCopy.isEnabled(excluded), false);
});

test('treats legacy note data without the preference as disabled', () => {
    assert.equal(markdownCopy.isEnabled({ title: 'Legacy note' }), false);
});

test('formats the title and note text exactly, including empty bodies and Markdown', () => {
    assert.equal(markdownCopy.contentForNote('Note title', ''), 'Note title\n\n');
    assert.equal(markdownCopy.contentForNote('Note title', '# Heading\n\n**Text**'), 'Note title\n\n# Heading\n\n**Text**');
});

test('uses the JSON note identifier as the Markdown filename basename', () => {
    assert.equal(markdownCopy.filenameForNote('note_1786228929486'), 'note_1786228929486.md');
    assert.equal(markdownCopy.DIRECTORY_NAME, 'md-copies');
});

test('includes the Markdown-copy helper in Tauri dev and production bundles', () => {
    const tauriConfig = JSON.parse(fs.readFileSync(require.resolve('../src-tauri/tauri.conf.json'), 'utf8'));
    assert.match(tauriConfig.build.beforeDevCommand, /markdown-copy\.js/);
    assert.match(tauriConfig.build.beforeBuildCommand, /markdown-copy\.js/);
});

test('writes the opted-in note copy alongside the saved JSON note', async () => {
    const app = createAppContext();
    await app.run(`saveNoteToFile({
        id: 'note_123',
        title: 'Reference',
        body: '# Heading\\n\\nBody',
        category: 'Research',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isPinned: false,
        pinnedAt: null,
        markdownCopy: true
    })`);

    assert.equal(app.directories[0], '/notes/md-copies');
    assert.equal(app.files.get('/notes/md-copies/note_123.md'), 'Reference\n\n# Heading\n\nBody');
    assert.equal(JSON.parse(app.files.get('/notes/note_123.json')).markdownCopy, true);
});

test('checkbox changes persist per note and immediately create or remove its copy', async () => {
    const app = createAppContext();
    app.run(`
        activeNoteId = 'note_123';
        notes = [{
            id: 'note_123',
            title: 'Reference',
            body: 'Initial text',
            category: 'Research',
            updatedAt: '2026-01-01T00:00:00.000Z',
            isPinned: false,
            pinnedAt: null,
            markdownCopy: false
        }];
        titleInput.value = 'Renamed';
        categoryInput.value = 'Research';
        bodyInput.innerHTML = 'Updated body';
        markdownCopyCheckbox.checked = true;
    `);

    await app.run('changeMarkdownCopy()');
    assert.equal(app.files.get('/notes/md-copies/note_123.md'), 'Renamed\n\nUpdated body');
    assert.equal(JSON.parse(app.files.get('/notes/note_123.json')).markdownCopy, true);

    app.run(`notes[0].title = 'Retitled'; notes[0].body = 'Autosaved content';`);
    await app.run('saveNoteToFile(notes[0])');
    assert.equal(app.files.get('/notes/md-copies/note_123.md'), 'Retitled\n\nAutosaved content');

    app.run('markdownCopyCheckbox.checked = false');
    await app.run('changeMarkdownCopy()');
    assert.equal(app.files.has('/notes/md-copies/note_123.md'), false);
    assert.equal(JSON.parse(app.files.get('/notes/note_123.json')).markdownCopy, false);
});

test('exports rich-text note content as text rather than HTML', async () => {
    const app = createAppContext();
    await app.run(`saveNoteToFile({
        id: 'note_456',
        title: 'Formatted',
        body: '<h1>Heading</h1><p>Paragraph</p>',
        category: 'Research',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isPinned: false,
        pinnedAt: null,
        markdownCopy: true
    })`);

    assert.equal(app.files.get('/notes/md-copies/note_456.md'), 'Formatted\n\nHeading\nParagraph');
});

test('deleting an opted-in note also deletes its Markdown copy', async () => {
    const app = createAppContext();
    app.run(`
        activeNoteId = 'note_123';
        notes = [{
            id: 'note_123',
            title: 'Reference',
            body: 'Body',
            category: 'Research',
            updatedAt: '2026-01-01T00:00:00.000Z',
            isPinned: false,
            pinnedAt: null,
            markdownCopy: true
        }];
        requestDeleteConfirmation = async () => true;
    `);
    app.files.set('/notes/note_123.json', '{}');
    app.files.set('/notes/md-copies/note_123.md', 'Reference\n\nBody');

    await app.run('deleteActiveNote()');

    assert.deepEqual(app.removed.sort(), ['/notes/md-copies/note_123.md', '/notes/note_123.json']);
    assert.equal(app.files.has('/notes/md-copies/note_123.md'), false);
});

test('reports Markdown write failures after preserving the JSON note', async () => {
    const app = createAppContext();
    app.setFailMarkdownWrite(true);
    await app.run(`saveNoteToFile({
        id: 'note_123',
        title: 'Reference',
        body: 'Body',
        category: 'Research',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isPinned: false,
        pinnedAt: null,
        markdownCopy: true
    })`);

    assert.equal(JSON.parse(app.files.get('/notes/note_123.json')).markdownCopy, true);
    assert.equal(app.alerts.length, 1);
    assert.match(app.alerts[0], /Markdown copy could not be updated/);
});
