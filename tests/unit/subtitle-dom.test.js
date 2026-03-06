/**
 * Unit tests for tracked subtitle DOM state transitions.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function buildSubtitleDomHarness() {
    const listeners = new Map();
    const context = {
        Map,
        subtitleState: new Map(),
        document: {
            addEventListener: (type, handler) => {
                listeners.set(type, handler);
            },
            dispatchEvent: (event) => {
                const handler = listeners.get(event.type);
                if (typeof handler === 'function') {
                    handler(event);
                }
            },
        },
    };

    const source = fs.readFileSync(path.resolve(__dirname, '../../content/subtitle-dom.js'), 'utf8');
    const start = source.indexOf('/** @type {Map<string, Set<HTMLElement>>} */');
    const end = source.indexOf('/**\n * Add both Finnish and target language subtitles to the displayed subtitles wrapper');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Failed to locate tracked subtitle DOM snippet');
    }
    const snippet = source.slice(start, end);

    vm.createContext(context);
    vm.runInContext(`
${snippet}
globalThis.__api = {
    trackActiveTranslationSpan,
    updateTrackedTranslationSpans,
    getTrackedCount: (key) => activeTranslationSpans.get(key)?.size || 0,
};
`, context, { filename: 'subtitle-dom-snippet.js' });

    return context;
}

function makeSpan(originalText) {
    return {
        isConnected: true,
        dataset: {
            originalText,
        },
        style: {
            opacity: '',
        },
        textContent: originalText,
        title: '',
        removeAttribute(name) {
            if (name === 'title') {
                this.title = '';
            }
        },
    };
}

describe('tracked subtitle DOM state transitions', () => {
    test('failed spans stay tracked and pending retries show translating', () => {
        const context = buildSubtitleDomHarness();
        const key = 'hei maailma';
        const span = makeSpan('Hei maailma');

        context.__api.trackActiveTranslationSpan(key, span);
        context.subtitleState.set(key, {
            status: 'failed',
            error: 'Translation echoed original text',
        });
        context.__api.updateTrackedTranslationSpans(key);

        assert.equal(span.textContent, 'Hei maailma');
        assert.equal(span.style.opacity, '0.6');
        assert.match(span.title, /Translation failed/);
        assert.equal(context.__api.getTrackedCount(key), 1);

        context.subtitleState.set(key, {
            status: 'pending',
        });
        context.document.dispatchEvent({
            type: 'dscTranslationStateChanged',
            detail: { key },
        });

        assert.equal(span.textContent, 'Translating...');
        assert.equal(span.style.opacity, '');
        assert.equal(span.title, '');
        assert.equal(context.__api.getTrackedCount(key), 1);
    });
});
