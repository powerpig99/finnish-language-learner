/**
 * Unit tests for movie cache lifecycle timing resets.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function extractFunctionSource(fileSource, signature) {
    const start = fileSource.indexOf(signature);
    if (start === -1) {
        throw new Error(`Could not find function signature: ${signature}`);
    }

    const braceStart = fileSource.indexOf('{', start);
    if (braceStart === -1) {
        throw new Error(`Could not find opening brace for: ${signature}`);
    }

    let depth = 0;
    for (let index = braceStart; index < fileSource.length; index++) {
        const char = fileSource[index];
        if (char === '{') {
            depth += 1;
            continue;
        }
        if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                return fileSource.slice(start, index + 1);
            }
        }
    }

    throw new Error(`Could not find closing brace for: ${signature}`);
}

function toTranslationKey(text) {
    return String(text || '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function buildHarness({
    currentMovieName = null,
    fullSubtitles = [],
    resolvedMovieTitle = null,
    providedMovieName = undefined,
    loadSubtitlesByMovieNameImpl = async () => [],
} = {}) {
    const setSubtitlesCalls = [];
    const upsertMovieMetadataCalls = [];
    const subtitleState = new Map();
    const now = Date.now();
    let translationGeneration = 0;
    const context = {
        Date: { now: () => now },
        openDatabase: async () => ({ tag: 'db' }),
        loadSubtitlesByMovieName: loadSubtitlesByMovieNameImpl,
        upsertMovieMetadata: async (...args) => {
            upsertMovieMetadataCalls.push(args);
        },
        getVideoTitle: () => resolvedMovieTitle,
        getCurrentTranslationSessionGeneration: () => translationGeneration,
        isCurrentTranslationSessionGeneration: (generation) => generation === translationGeneration,
        ControlIntegration: {
            setSubtitles: (subtitles) => {
                setSubtitlesCalls.push(Array.isArray(subtitles) ? subtitles.map((sub) => ({ ...sub })) : subtitles);
            },
        },
        fullSubtitles: fullSubtitles.map((sub) => ({ ...sub })),
        currentMovieName,
        targetLanguage: 'EN-US',
        subtitleState,
        toTranslationKey,
        hasTranslatableSubtitleContent: () => true,
    };

    const source = fs.readFileSync(path.resolve(__dirname, '../../contentscript.js'), 'utf8');
    const functionSource = extractFunctionSource(source, 'async function loadMovieCacheAndUpdateMetadata(movieName)');

    vm.createContext(context);
    vm.runInContext(`
${functionSource}
globalThis.__api = { loadMovieCacheAndUpdateMetadata };
`, context, { filename: 'movie-cache-lifecycle-harness.js' });

    return {
        context,
        setSubtitlesCalls,
        subtitleState,
        upsertMovieMetadataCalls,
        setGeneration: (nextGeneration) => {
            translationGeneration = nextGeneration;
        },
        invoke: () => context.__api.loadMovieCacheAndUpdateMetadata(providedMovieName),
    };
}

describe('loadMovieCacheAndUpdateMetadata lifecycle', () => {
    test('does not clear subtitle timing cache when movie title is unavailable', async () => {
        const harness = buildHarness({
            currentMovieName: 'movie-a',
            fullSubtitles: [{ startTime: 1, endTime: 2, text: 'line a' }],
            resolvedMovieTitle: null,
        });

        await harness.invoke();

        assert.equal(harness.context.fullSubtitles.length, 1);
        assert.equal(harness.context.currentMovieName, 'movie-a');
        assert.equal(harness.setSubtitlesCalls.length, 0);
    });

    test('does not clear subtitle timing cache during metadata load when movie changes', async () => {
        const harness = buildHarness({
            currentMovieName: 'movie-a',
            fullSubtitles: [{ startTime: 1, endTime: 2, text: 'line a' }],
            resolvedMovieTitle: 'movie-b',
        });

        await harness.invoke();

        assert.equal(harness.context.fullSubtitles.length, 1);
        assert.equal(harness.context.currentMovieName, 'movie-b');
        assert.equal(harness.setSubtitlesCalls.length, 0);
    });

    test('keeps subtitle timing cache when function is called again for same movie', async () => {
        const harness = buildHarness({
            currentMovieName: 'movie-a',
            fullSubtitles: [{ startTime: 5, endTime: 6, text: 'line a' }],
            providedMovieName: 'movie-a',
        });

        await harness.invoke();

        assert.equal(harness.context.fullSubtitles.length, 1);
        assert.equal(harness.context.currentMovieName, 'movie-a');
        assert.equal(harness.setSubtitlesCalls.length, 0);
    });

    test('ignores stale cache population after navigation generation changes', async () => {
        let resolveSubtitles = null;
        const harness = buildHarness({
            currentMovieName: 'movie-a',
            providedMovieName: 'movie-a',
            loadSubtitlesByMovieNameImpl: async () => await new Promise((resolve) => {
                resolveSubtitles = resolve;
            }),
        });

        const loadPromise = harness.invoke();
        for (let attempt = 0; attempt < 5 && typeof resolveSubtitles !== 'function'; attempt++) {
            await Promise.resolve();
        }

        harness.setGeneration(1);
        harness.context.currentMovieName = 'movie-b';
        assert.equal(typeof resolveSubtitles, 'function');
        resolveSubtitles([{
            originalText: 'vanha rivi',
            translatedText: 'old line',
        }]);

        await loadPromise;

        assert.equal(harness.context.currentMovieName, 'movie-b');
        assert.equal(harness.subtitleState.size, 0);
        assert.equal(harness.upsertMovieMetadataCalls.length, 0);
    });
});
