(function (root) {
    const DIRECTORY_NAME = 'md-copies';

    function toNoteFileData(note) {
        return {
            title: note.title,
            category: note.category,
            body: note.body,
            updatedAt: note.updatedAt,
            isPinned: note.isPinned,
            pinnedAt: note.pinnedAt,
            fontFamily: note.fontFamily,
            fontSize: note.fontSize,
            markdownCopy: note.markdownCopy === true
        };
    }

    function isEnabled(noteData) {
        return noteData.markdownCopy === true;
    }

    function filenameForNote(noteId) {
        return `${noteId}.md`;
    }

    function contentForNote(title, bodyText) {
        return `${title || ''}\n\n${bodyText || ''}`;
    }

    const api = {
        DIRECTORY_NAME,
        contentForNote,
        filenameForNote,
        isEnabled,
        toNoteFileData
    };

    root.NoteMarkdownCopy = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(globalThis);
