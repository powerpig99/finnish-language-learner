/**
 * Unit tests for auto-pause timing resolution and scheduling.
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

function makeVideo({ currentTime = 0, playbackRate = 1, paused = false, tracks = [] } = {}) {
    return {
        currentTime,
        playbackRate,
        paused,
        textTracks: tracks,
        pauseCalls: 0,
        pause() {
            this.paused = true;
            this.pauseCalls += 1;
        },
    };
}

function buildAutoPauseHarness({ video, autoPauseEnabled = true, extensionEnabled = true } = {}) {
    const timers = new Map();
    let nextTimerId = 1;

    const context = {
        __autoPauseEnabled: autoPauseEnabled,
        __extensionEnabled: extensionEnabled,
        document: {
            querySelector: (selector) => {
                if (selector === 'video') {
                    return video;
                }
                return null;
            },
        },
        setTimeout: (fn, delay) => {
            const id = nextTimerId++;
            timers.set(id, { fn, delay: Number(delay) });
            return id;
        },
        clearTimeout: (id) => {
            timers.delete(id);
        },
    };

    const settingsPath = path.resolve(__dirname, '../../content/settings.js');
    const settingsSource = fs.readFileSync(settingsPath, 'utf8');
    const functionSources = [
        extractFunctionSource(settingsSource, 'function setCurrentSubtitleEndTime(endTime)'),
        extractFunctionSource(settingsSource, 'function getActiveCueEndTime(video)'),
        extractFunctionSource(settingsSource, 'function scheduleAutoPauseLookupRetry()'),
        extractFunctionSource(settingsSource, 'function scheduleAutoPause(fromRetry = false)'),
        extractFunctionSource(settingsSource, 'function clearAutoPause(resetRetry = true)'),
    ].join('\n\n');

    const harnessScript = `
let _autoPauseTimeout = null;
let _autoPauseLookupRetryCount = 0;
const AUTO_PAUSE_LOOKUP_RETRY_LIMIT = 3;
const AUTO_PAUSE_LOOKUP_RETRY_DELAY_MS = 120;
let _currentSubtitleEndTime = null;
let autoPauseEnabled = globalThis.__autoPauseEnabled;
let extensionEnabled = globalThis.__extensionEnabled;

${functionSources}

globalThis.__autoPauseApi = {
    setCurrentSubtitleEndTime,
    getActiveCueEndTime,
    scheduleAutoPause,
    clearAutoPause,
    getState: () => ({
        autoPauseTimeout: _autoPauseTimeout,
        autoPauseLookupRetryCount: _autoPauseLookupRetryCount,
        currentSubtitleEndTime: _currentSubtitleEndTime,
    }),
};
`;

    vm.createContext(context);
    vm.runInContext(harnessScript, context, { filename: 'auto-pause-harness.js' });

    return {
        api: context.__autoPauseApi,
        timers,
        runTimer(timerId) {
            const timer = timers.get(timerId);
            if (!timer) {
                throw new Error(`Timer not found: ${timerId}`);
            }
            timers.delete(timerId);
            timer.fn();
        },
    };
}

describe('auto-pause scheduling', () => {
    test('resolves end time from the best matching active cue when multiple cues are active', () => {
        const video = makeVideo({
            currentTime: 20,
            tracks: [
                {
                    mode: 'showing',
                    activeCues: [
                        { startTime: 19, endTime: 22 },
                        { startTime: 20, endTime: 21 },
                        { startTime: 15, endTime: 18 },
                    ],
                },
                {
                    mode: 'disabled',
                    activeCues: [{ startTime: 20, endTime: 30 }],
                },
            ],
        });

        const { api } = buildAutoPauseHarness({ video });
        const endTime = api.getActiveCueEndTime(video);

        assert.equal(endTime, 21);
    });

    test('schedules and pauses using active cue timing even with multiple active cues', () => {
        const video = makeVideo({
            currentTime: 10,
            tracks: [
                {
                    mode: 'showing',
                    activeCues: [
                        { startTime: 10, endTime: 12.0 },
                        { startTime: 10, endTime: 11.2 },
                    ],
                },
            ],
        });

        const { api, timers, runTimer } = buildAutoPauseHarness({ video });
        api.scheduleAutoPause();

        assert.equal(timers.size, 1);
        const [[timerId, timerMeta]] = Array.from(timers.entries());
        assert.ok(timerMeta.delay > 1900 && timerMeta.delay < 2000);

        video.currentTime = 11.96;
        runTimer(timerId);

        assert.equal(video.pauseCalls, 1);
    });

    test('seek-style retry still schedules pause once active cues appear', () => {
        const track = {
            mode: 'showing',
            activeCues: [],
        };
        const video = makeVideo({
            currentTime: 30.0,
            tracks: [track],
        });

        const { api, timers, runTimer } = buildAutoPauseHarness({ video });
        api.scheduleAutoPause();

        assert.equal(timers.size, 1);
        const [[retryTimerId, retryTimerMeta]] = Array.from(timers.entries());
        assert.equal(retryTimerMeta.delay, 120);

        track.activeCues = [{ startTime: 30.0, endTime: 31.2 }];
        video.currentTime = 30.1;
        runTimer(retryTimerId);

        assert.equal(timers.size, 1);
        const [[pauseTimerId, pauseTimerMeta]] = Array.from(timers.entries());
        assert.ok(pauseTimerMeta.delay > 1000 && pauseTimerMeta.delay < 1100);

        video.currentTime = 31.16;
        runTimer(pauseTimerId);

        assert.equal(video.pauseCalls, 1);
        assert.equal(api.getState().autoPauseLookupRetryCount, 0);
    });
});
