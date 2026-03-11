/**
 * Unit tests for keyboard shortcut routing.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { describe, test } = require('node:test');

function buildControlKeyboardHarness(callbacks = {}) {
    class FakeElement {}

    const context = {
        window: {
            addEventListener: () => {},
            removeEventListener: () => {},
        },
        console,
        Element: FakeElement,
    };

    const scriptPath = path.resolve(__dirname, '../../controls/control-keyboard.js');
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');

    vm.createContext(context);
    vm.runInContext(scriptSource, context, { filename: 'control-keyboard.js' });

    const ControlKeyboard = context.window.ControlKeyboard;
    return new ControlKeyboard({
        callbacks,
        config: ControlKeyboard.getDefaultConfig(),
    });
}

function makeKeyboardEvent({
    key,
    code,
    shiftKey = false,
    repeat = false,
} = {}) {
    return {
        key,
        code,
        shiftKey,
        repeat,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        target: null,
        preventDefaultCalled: false,
        stopPropagationCalled: false,
        stopImmediatePropagationCalled: false,
        preventDefault() {
            this.preventDefaultCalled = true;
        },
        stopPropagation() {
            this.stopPropagationCalled = true;
        },
        stopImmediatePropagation() {
            this.stopImmediatePropagationCalled = true;
        },
    };
}

describe('ControlKeyboard shortcut routing', () => {
    test('8BitDo Zero 2 keyboard profile routes alternate keys to the expected actions', () => {
        const calls = [];
        const keyboard = buildControlKeyboardHarness({
            onPrevSubtitle: () => {
                calls.push('previousSubtitle');
            },
            onNextSubtitle: () => {
                calls.push('nextSubtitle');
            },
            onRepeatSubtitle: () => {
                calls.push('repeatSubtitle');
            },
            onRetrySubtitleTranslation: () => {
                calls.push('retrySubtitleTranslation');
            },
            onPlayPause: () => {
                calls.push('togglePlayPause');
            },
            onSpeedChange: (delta) => {
                calls.push(`speed:${delta}`);
            },
            onDualSubToggle: () => {
                calls.push('toggleDualSub');
            },
            onAutoPauseToggle: () => {
                calls.push('toggleAutoPause');
            },
        });

        const events = [
            makeKeyboardEvent({ key: 'i', code: 'KeyI' }),
            makeKeyboardEvent({ key: 'g', code: 'KeyG' }),
            makeKeyboardEvent({ key: 'h', code: 'KeyH' }),
            makeKeyboardEvent({ key: 'c', code: 'KeyC' }),
            makeKeyboardEvent({ key: 'j', code: 'KeyJ' }),
            makeKeyboardEvent({ key: 'k', code: 'KeyK' }),
            makeKeyboardEvent({ key: 'm', code: 'KeyM' }),
            makeKeyboardEvent({ key: 'd', code: 'KeyD' }),
            makeKeyboardEvent({ key: 'o', code: 'KeyO' }),
        ];

        for (const event of events) {
            keyboard._handleKeyDown(event);
            keyboard._handleKeyUp(event);
            assert.equal(event.preventDefaultCalled, true);
        }

        assert.deepEqual(calls, [
            'previousSubtitle',
            'nextSubtitle',
            'repeatSubtitle',
            'retrySubtitleTranslation',
            'togglePlayPause',
            'speed:-0.25',
            'speed:0.25',
            'toggleDualSub',
            'toggleAutoPause',
        ]);
    });

    test('plain R key repeats the subtitle without forcing re-translation', () => {
        let repeatCalls = 0;
        let retryCalls = 0;
        const keyboard = buildControlKeyboardHarness({
            onRepeatSubtitle: () => {
                repeatCalls += 1;
            },
            onRetrySubtitleTranslation: () => {
                retryCalls += 1;
            },
        });

        const event = makeKeyboardEvent({ key: 'r', code: 'KeyR', shiftKey: false });
        keyboard._handleKeyDown(event);

        assert.equal(repeatCalls, 1);
        assert.equal(retryCalls, 0);
        assert.equal(event.preventDefaultCalled, true);
    });

    test('Shift+R forces subtitle re-translation instead of repeating audio', () => {
        let repeatCalls = 0;
        let retryCalls = 0;
        const keyboard = buildControlKeyboardHarness({
            onRepeatSubtitle: () => {
                repeatCalls += 1;
            },
            onRetrySubtitleTranslation: () => {
                retryCalls += 1;
            },
        });

        const event = makeKeyboardEvent({ key: 'R', code: 'KeyR', shiftKey: true });
        keyboard._handleKeyDown(event);

        assert.equal(repeatCalls, 0);
        assert.equal(retryCalls, 1);
        assert.equal(event.preventDefaultCalled, true);
    });

    test('uppercase R without Shift still repeats the subtitle', () => {
        let repeatCalls = 0;
        let retryCalls = 0;
        const keyboard = buildControlKeyboardHarness({
            onRepeatSubtitle: () => {
                repeatCalls += 1;
            },
            onRetrySubtitleTranslation: () => {
                retryCalls += 1;
            },
        });

        const event = makeKeyboardEvent({ key: 'R', code: 'KeyR', shiftKey: false });
        keyboard._handleKeyDown(event);

        assert.equal(repeatCalls, 1);
        assert.equal(retryCalls, 0);
        assert.equal(event.preventDefaultCalled, true);
    });
});
