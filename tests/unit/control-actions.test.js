/**
 * Unit tests for subtitle navigation controls.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function buildControlActionsHarness(video) {
    const context = {
        window: {},
        document: {
            querySelector: (selector) => {
                if (selector === 'video') {
                    return video;
                }
                return null;
            },
        },
    };

    const scriptPath = path.resolve(__dirname, '../../controls/control-actions.js');
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');

    vm.createContext(context);
    vm.runInContext(scriptSource, context, { filename: 'control-actions.js' });

    return context.window.ControlActions;
}

function makeVideo({ currentTime = 0, paused = false, textTracks = [] } = {}) {
    return {
        currentTime,
        paused,
        textTracks,
        playCalls: 0,
        play() {
            this.paused = false;
            this.playCalls += 1;
        },
    };
}

describe('ControlActions subtitle navigation', () => {
    test('skipToNextSubtitle uses prefetched subtitle timing for long-gap jumps', () => {
        const video = makeVideo({
            currentTime: 11,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToNextSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
        ]);

        assert.equal(video.currentTime, 35);
    });

    test('skipToPreviousSubtitle uses prefetched subtitle timing', () => {
        const video = makeVideo({
            currentTime: 36,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToPreviousSubtitle([
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ]);

        assert.equal(video.currentTime, 2);
    });

    test('skipToNextSubtitle falls back to active text-track cues when prefetched timings are unavailable', () => {
        const video = makeVideo({
            currentTime: 10,
            textTracks: [
                {
                    mode: 'showing',
                    cues: [{ startTime: 5 }, { startTime: 12 }, { startTime: 20 }],
                },
            ],
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToNextSubtitle([]);

        assert.equal(video.currentTime, 12);
    });

    test('prefetched timings stay authoritative and ignore active cue micro-splits', () => {
        const video = makeVideo({
            currentTime: 35.1,
            textTracks: [
                {
                    mode: 'showing',
                    cues: [{ startTime: 34.9 }, { startTime: 35.0 }, { startTime: 35.2 }],
                },
            ],
        });
        const controlActions = buildControlActionsHarness(video);
        const subtitles = [
            { startTime: 2, endTime: 3, text: 'one' },
            { startTime: 35, endTime: 37, text: 'two' },
            { startTime: 50, endTime: 52, text: 'three' },
        ];

        controlActions.skipToPreviousSubtitle(subtitles);
        assert.equal(video.currentTime, 2);

        video.currentTime = 35.1;
        controlActions.skipToNextSubtitle(subtitles);
        assert.equal(video.currentTime, 50);
    });

    test('skipToNextSubtitle deduplicates near-identical prefetched start times', () => {
        const video = makeVideo({
            currentTime: 4,
            textTracks: [],
        });
        const controlActions = buildControlActionsHarness(video);

        controlActions.skipToNextSubtitle([
            { startTime: 5.0000, endTime: 6, text: 'one' },
            { startTime: 5.0004, endTime: 6, text: 'duplicate window' },
            { startTime: 8.0, endTime: 9, text: 'two' },
        ]);

        assert.equal(video.currentTime, 5.0);
    });
});
