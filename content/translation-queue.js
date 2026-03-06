// ==================================
// TRANSLATION QUEUE
// ==================================
function normalizeSubtitleText(rawSubtitleText) {
    return String(rawSubtitleText || '').trim().replace(/\n/g, ' ');
}

function hasTranslatableSubtitleContent(normalizedSubtitleText) {
    // Use letter presence as the authoritative translation trigger.
    return /\p{L}/u.test(normalizedSubtitleText);
}

function shouldLogTranslationFailureAsWarning(errorMessage) {
    const normalizedError = String(errorMessage || '').toLowerCase();
    if (!normalizedError) {
        return false;
    }
    return normalizedError.includes('api key') ||
        normalizedError.includes('rate limit') ||
        normalizedError.includes('access denied') ||
        normalizedError.includes('quota') ||
        normalizedError.includes('not configured') ||
        /\berror:\s*4\d\d\b/.test(normalizedError);
}

let translationSessionGeneration = 0;

function getCurrentTranslationSessionGeneration() {
    return translationSessionGeneration;
}

function isCurrentTranslationSessionGeneration(generation) {
    return generation === translationSessionGeneration;
}

function advanceTranslationSessionGeneration() {
    translationSessionGeneration += 1;
    return translationSessionGeneration;
}

function setPassThroughSubtitleState(normalizedText) {
    if (!normalizedText) {
        return false;
    }
    const key = toTranslationKey(normalizedText);
    const existingEntry = subtitleState.get(key);
    if (existingEntry?.status === 'success' && existingEntry.text === normalizedText) {
        clearEchoBackRetryState(key);
        return false;
    }
    subtitleState.set(key, {
        status: 'success',
        text: normalizedText,
        generation: getCurrentTranslationSessionGeneration(),
        updatedAt: Date.now(),
    });
    clearEchoBackRetryState(key);
    dispatchTranslationResolved(key);
    return true;
}
const TRANSLATION_FAILURE_COOLDOWN_MS = 30000;
const ECHO_BACK_BASE_COOLDOWN_MS = 30000;
const ECHO_BACK_MAX_COOLDOWN_MS = 5 * 60 * 1000;
const ECHO_BACK_MAX_RETRIES = 4;
const BATCH_SUBTITLE_MAX_ATTEMPTS = 4;
const echoBackRetryCounts = new Map();

function clearEchoBackRetryState(key) {
    echoBackRetryCounts.delete(key);
}

function incrementEchoBackRetryCount(key) {
    const nextCount = (echoBackRetryCounts.get(key) || 0) + 1;
    echoBackRetryCounts.set(key, nextCount);
    return nextCount;
}

function calculateEchoBackCooldownMs(retryCount) {
    const backoffMultiplier = 2 ** Math.max(0, retryCount - 1);
    const nextCooldownMs = ECHO_BACK_BASE_COOLDOWN_MS * backoffMultiplier;
    return Math.min(ECHO_BACK_MAX_COOLDOWN_MS, nextCooldownMs);
}

function parseTranslationFailureOptions(cooldownOrOptions) {
    if (typeof cooldownOrOptions === 'number') {
        return {
            cooldownMs: cooldownOrOptions,
            isEchoBack: false,
        };
    }
    if (!cooldownOrOptions || typeof cooldownOrOptions !== 'object') {
        return {
            cooldownMs: TRANSLATION_FAILURE_COOLDOWN_MS,
            isEchoBack: false,
        };
    }
    return {
        cooldownMs: typeof cooldownOrOptions.cooldownMs === 'number'
            ? cooldownOrOptions.cooldownMs
            : TRANSLATION_FAILURE_COOLDOWN_MS,
        isEchoBack: cooldownOrOptions.isEchoBack === true,
    };
}

function isSourceAndTargetSameLanguage() {
    if (typeof detectedSourceLanguage !== 'string' || !detectedSourceLanguage.trim()) {
        return false;
    }
    return normalizeLanguageCode(detectedSourceLanguage) === normalizeLanguageCode(targetLanguage);
}

function stripXmlLikeTags(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isLikelyWrappedEchoBackTranslation(originalText, translatedText) {
    if (!/<[^>]+>/.test(String(translatedText || ''))) {
        return false;
    }
    const normalizedOriginalKey = toTranslationKey(originalText);
    if (!normalizedOriginalKey) {
        return false;
    }
    const strippedTranslatedKey = toTranslationKey(stripXmlLikeTags(translatedText));
    if (!strippedTranslatedKey) {
        return false;
    }
    if (strippedTranslatedKey === normalizedOriginalKey) {
        return true;
    }
    const sourceIndex = strippedTranslatedKey.indexOf(normalizedOriginalKey);
    if (sourceIndex === -1) {
        return false;
    }
    const prefix = strippedTranslatedKey.slice(0, sourceIndex).trim();
    const suffix = strippedTranslatedKey
        .slice(sourceIndex + normalizedOriginalKey.length)
        .trim();
    const prefixWords = prefix ? prefix.split(/\s+/).length : 0;
    const suffixWords = suffix ? suffix.split(/\s+/).length : 0;
    return prefixWords + suffixWords <= 3;
}

function dispatchTranslationResolved(key) {
    document.dispatchEvent(new CustomEvent('dscTranslationResolved', { detail: { key } }));
}

function classifySubtitleTranslationResult(rawSubtitleText, translatedText, expectedGeneration = getCurrentTranslationSessionGeneration()) {
    const normalizedOriginalText = normalizeSubtitleText(rawSubtitleText);
    const key = toTranslationKey(normalizedOriginalText);
    const existingEntry = subtitleState.get(key);
    if (!existingEntry || existingEntry.status !== 'pending') {
        return { status: 'stale' };
    }
    if (typeof existingEntry.generation === 'number' && existingEntry.generation !== expectedGeneration) {
        return { status: 'stale' };
    }
    if (!hasTranslatableSubtitleContent(normalizedOriginalText)) {
        return {
            status: 'success',
            key,
            normalizedOriginalText,
            text: normalizedOriginalText,
        };
    }
    if (translatedText === null || translatedText === undefined) {
        return {
            status: 'empty_failure',
            key,
            normalizedOriginalText,
            error: 'Empty translation response',
        };
    }
    const normalizedTranslatedText = normalizeSubtitleText(translatedText);
    if (!normalizedTranslatedText) {
        return {
            status: 'empty_failure',
            key,
            normalizedOriginalText,
            error: 'Empty translation response',
        };
    }
    const isDirectEchoBack = toTranslationKey(normalizedTranslatedText) === toTranslationKey(normalizedOriginalText);
    const isWrappedEchoBack = isLikelyWrappedEchoBackTranslation(normalizedOriginalText, normalizedTranslatedText);
    if (!isSourceAndTargetSameLanguage() && (isDirectEchoBack || isWrappedEchoBack)) {
        return {
            status: 'echo_back_failure',
            key,
            normalizedOriginalText,
            error: 'Translation echoed original text',
        };
    }
    return {
        status: 'success',
        key,
        normalizedOriginalText,
        text: normalizedTranslatedText,
    };
}

function commitSubtitleTranslationSuccess(normalizedOriginalText, resolvedText, expectedGeneration = getCurrentTranslationSessionGeneration()) {
    const key = toTranslationKey(normalizedOriginalText);
    const existingEntry = subtitleState.get(key);
    if (!existingEntry || existingEntry.status !== 'pending') {
        return false;
    }
    if (typeof existingEntry.generation === 'number' && existingEntry.generation !== expectedGeneration) {
        return false;
    }
    subtitleState.set(key, {
        status: 'success',
        text: resolvedText,
        generation: expectedGeneration,
        updatedAt: Date.now(),
    });
    clearEchoBackRetryState(key);
    dispatchTranslationResolved(key);
    return true;
}

/**
 * Mark subtitle translation as pending for the authoritative batch workflow.
 * @param {string} rawSubtitleText
 * @param {number} generation
 * @returns {boolean}
 */
function enqueueTranslation(rawSubtitleText, generation = getCurrentTranslationSessionGeneration()) {
    const normalizedText = normalizeSubtitleText(rawSubtitleText);
    if (!normalizedText) {
        return false;
    }
    if (!hasTranslatableSubtitleContent(normalizedText)) {
        setPassThroughSubtitleState(normalizedText);
        return false;
    }
    const key = toTranslationKey(normalizedText);
    const currentEntry = subtitleState.get(key);
    const now = Date.now();
    const isSameGeneration = typeof currentEntry?.generation !== 'number' || currentEntry.generation === generation;
    if ((currentEntry?.status === 'pending' && isSameGeneration) || currentEntry?.status === 'success') {
        return false;
    }
    if (currentEntry?.status === 'failed' &&
        isSameGeneration &&
        typeof currentEntry.nextRetryAt === 'number' &&
        currentEntry.nextRetryAt > now) {
        return false;
    }
    subtitleState.set(key, {
        status: 'pending',
        generation,
        updatedAt: now,
    });
    return true;
}
/**
 * Transition subtitle state from pending to success.
 * @param {string} rawSubtitleText
 * @param {string} translatedText
 * @param {number} expectedGeneration
 * @returns {boolean}
 */
function markTranslationSuccess(rawSubtitleText, translatedText, expectedGeneration = getCurrentTranslationSessionGeneration()) {
    const result = classifySubtitleTranslationResult(rawSubtitleText, translatedText, expectedGeneration);
    if (result.status === 'stale') {
        return false;
    }
    if (result.status === 'success') {
        return commitSubtitleTranslationSuccess(result.normalizedOriginalText, result.text, expectedGeneration);
    }
    if (result.status === 'echo_back_failure') {
        return markTranslationFailed(rawSubtitleText, result.error, {
            isEchoBack: true,
        }, expectedGeneration);
    }
    return markTranslationFailed(rawSubtitleText, result.error, TRANSLATION_FAILURE_COOLDOWN_MS, expectedGeneration);
}
/**
 * Transition subtitle state from pending to failed.
 * @param {string} rawSubtitleText
 * @param {string} errorMessage
 * @param {number|{cooldownMs?: number, isEchoBack?: boolean}} [cooldownOrOptions]
 * @param {number} expectedGeneration
 * @returns {boolean}
 */
function markTranslationFailed(rawSubtitleText, errorMessage, cooldownOrOptions = TRANSLATION_FAILURE_COOLDOWN_MS, expectedGeneration = getCurrentTranslationSessionGeneration()) {
    const normalizedOriginalText = normalizeSubtitleText(rawSubtitleText);
    const key = toTranslationKey(normalizedOriginalText);
    const existingEntry = subtitleState.get(key);
    // Language change/reset can clear state while requests are in flight.
    // Ignore stale failures from old requests.
    if (!existingEntry || existingEntry.status !== 'pending') {
        return false;
    }
    if (typeof existingEntry.generation === 'number' && existingEntry.generation !== expectedGeneration) {
        return false;
    }
    if (!hasTranslatableSubtitleContent(normalizedOriginalText)) {
        subtitleState.set(key, {
            status: 'success',
            text: normalizedOriginalText,
            generation: expectedGeneration,
            updatedAt: Date.now(),
        });
        clearEchoBackRetryState(key);
        dispatchTranslationResolved(key);
        return true;
    }
    const { cooldownMs, isEchoBack } = parseTranslationFailureOptions(cooldownOrOptions);
    const now = Date.now();
    let nextRetryAt = now + Math.max(0, cooldownMs);
    let failureMessage = String(errorMessage || 'Translation failed');
    if (isEchoBack) {
        const echoRetryCount = incrementEchoBackRetryCount(key);
        const isRetryExhausted = echoRetryCount >= ECHO_BACK_MAX_RETRIES;
        nextRetryAt = isRetryExhausted
            ? Number.POSITIVE_INFINITY
            : now + calculateEchoBackCooldownMs(echoRetryCount);
        if (isRetryExhausted) {
            failureMessage = `${failureMessage} (retry limit reached)`;
        }
    }
    else {
        clearEchoBackRetryState(key);
    }
    subtitleState.set(key, {
        status: 'failed',
        error: failureMessage,
        generation: expectedGeneration,
        nextRetryAt,
        updatedAt: now,
    });
    dispatchTranslationResolved(key);
    return true;
}
function clearSubtitleTranslationState() {
    advanceTranslationSessionGeneration();
    subtitleState.clear();
    echoBackRetryCounts.clear();
    pendingBatchSubtitles.length = 0;
    batchTranslationProgress = { current: 0, total: 0 };
    hasShownBatchTranslationIndicator = false;
    if (typeof hideBatchTranslationIndicator === 'function') {
        hideBatchTranslationIndicator();
    }
    if (typeof clearActiveTranslationSpans === 'function') {
        clearActiveTranslationSpans();
    }
}
// Batch translation state
let isBatchTranslating = false;
const pendingBatchSubtitles = [];
let batchTranslationProgress = { current: 0, total: 0 };
let hasShownBatchTranslationIndicator = false;
function buildFullSubtitleKey(startTime, endTime, text) {
    return `${startTime.toFixed(3)}|${endTime.toFixed(3)}|${toTranslationKey(text)}`;
}
function resetNavigationSubtitleTimeline() {
    clearSubtitleTranslationState();
    if (typeof currentMovieName !== 'undefined') {
        currentMovieName = null;
    }
    fullSubtitles.length = 0;
    ControlIntegration.setSubtitles(fullSubtitles);
}
function mergeSubtitlesIntoNavigationCache(subtitles) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
        return;
    }
    const existingFullSubtitleKeys = new Set(fullSubtitles.map(sub => buildFullSubtitleKey(sub.startTime, sub.endTime, sub.text)));
    for (const sub of subtitles) {
        if (sub.startTime === undefined || sub.endTime === undefined) {
            continue;
        }
        const fullSubtitleKey = buildFullSubtitleKey(sub.startTime, sub.endTime, sub.text);
        if (!existingFullSubtitleKeys.has(fullSubtitleKey)) {
            existingFullSubtitleKeys.add(fullSubtitleKey);
            fullSubtitles.push({ startTime: sub.startTime, endTime: sub.endTime, text: sub.text });
        }
    }
    fullSubtitles.sort((a, b) => a.startTime - b.startTime);
    // Sync ACCUMULATED subtitles with ControlIntegration for skip/repeat functionality
    // Note: Call setSubtitles even if panel isn't mounted yet - it just stores the data
    ControlIntegration.setSubtitles(fullSubtitles);
}
function queuePendingBatchSubtitles(subtitles, generation = getCurrentTranslationSessionGeneration()) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
        return;
    }
    pendingBatchSubtitles.push({ subtitles, generation });
}

function appendBatchRetryLimitReached(errorMessage) {
    const message = String(errorMessage || 'Translation failed').trim();
    return `${message} (batch retry limit reached)`;
}

function logSubtitleTranslationFailure({
    provider,
    failureType,
    errorMessage,
    subtitles,
    providerResponses = null,
    attempts = null,
}) {
    const logFailure = shouldLogTranslationFailureAsWarning(errorMessage)
        ? console.warn
        : console.error;
    logFailure('YleDualSubExtension: Subtitle translation failed', {
        provider: provider || 'unknown',
        movieName: typeof currentMovieName === 'string' ? currentMovieName : null,
        targetLanguage,
        failureType,
        error: String(errorMessage || 'Translation failed'),
        attempts,
        subtitles: Array.isArray(subtitles) ? subtitles.slice() : [],
        providerResponses: Array.isArray(providerResponses) ? providerResponses.slice() : providerResponses,
    });
}

async function processSubtitleChunkWithRetries(chunk, batchGeneration, translationProvider) {
    const toCacheSubtitleRecords = [];
    let completedCount = 0;
    let pendingSubtitles = chunk.slice();
    const lastFailureDetails = new Map();

    for (let attempt = 1; attempt <= BATCH_SUBTITLE_MAX_ATTEMPTS && pendingSubtitles.length > 0; attempt++) {
        const texts = pendingSubtitles.map(sub => sub.text);
        const isFinalAttempt = attempt === BATCH_SUBTITLE_MAX_ATTEMPTS;

        if (attempt > 1 && translationProvider === 'google') {
            await sleep(500);
        }

        try {
            const [isSucceeded, translationResponse] = await fetchBatchTranslation(texts);
            if (!isSucceeded) {
                if (!isFinalAttempt) {
                    continue;
                }
                const finalErrorMessage = appendBatchRetryLimitReached(translationResponse);
                logSubtitleTranslationFailure({
                    provider: translationProvider,
                    failureType: 'provider_request_failed',
                    errorMessage: finalErrorMessage,
                    subtitles: texts,
                    attempts: attempt,
                });
                for (const rawSubtitleText of texts) {
                    if (markTranslationFailed(rawSubtitleText, finalErrorMessage, TRANSLATION_FAILURE_COOLDOWN_MS, batchGeneration)) {
                        completedCount += 1;
                    }
                }
                break;
            }

            const translatedTexts = Array.isArray(translationResponse) ? translationResponse : [];
            const nextPendingSubtitles = [];

            for (let i = 0; i < texts.length; i++) {
                const subtitle = pendingSubtitles[i];
                const rawSubtitleText = texts[i];
                const result = classifySubtitleTranslationResult(rawSubtitleText, translatedTexts[i], batchGeneration);

                if (result.status === 'stale') {
                    continue;
                }
                if (result.status === 'success') {
                    if (!commitSubtitleTranslationSuccess(result.normalizedOriginalText, result.text, batchGeneration)) {
                        continue;
                    }
                    completedCount += 1;
                    if (currentMovieName) {
                        toCacheSubtitleRecords.push({
                            movieName: currentMovieName,
                            originalLanguage: "FI",
                            targetLanguage,
                            originalText: toTranslationKey(rawSubtitleText),
                            translatedText: result.text,
                        });
                    }
                    continue;
                }
                lastFailureDetails.set(rawSubtitleText, {
                    failureType: result.status,
                    providerResponse: translatedTexts[i] ?? null,
                    error: result.error,
                });
                if (!isFinalAttempt) {
                    nextPendingSubtitles.push(subtitle);
                    continue;
                }
                const finalErrorMessage = appendBatchRetryLimitReached(result.error);
                if (markTranslationFailed(
                    rawSubtitleText,
                    finalErrorMessage,
                    TRANSLATION_FAILURE_COOLDOWN_MS,
                    batchGeneration
                )) {
                    completedCount += 1;
                }
                const failureDetail = lastFailureDetails.get(rawSubtitleText);
                logSubtitleTranslationFailure({
                    provider: translationProvider,
                    failureType: failureDetail?.failureType || result.status,
                    errorMessage: finalErrorMessage,
                    subtitles: [rawSubtitleText],
                    providerResponses: [failureDetail?.providerResponse ?? translatedTexts[i] ?? null],
                    attempts: attempt,
                });
            }

            pendingSubtitles = nextPendingSubtitles;
        }
        catch (error) {
            if (!isFinalAttempt) {
                continue;
            }
            const errorMessage = appendBatchRetryLimitReached(error.message || String(error));
            logSubtitleTranslationFailure({
                provider: translationProvider,
                failureType: 'provider_exception',
                errorMessage,
                subtitles: texts,
                attempts: attempt,
            });
            for (const rawSubtitleText of texts) {
                if (markTranslationFailed(rawSubtitleText, errorMessage, TRANSLATION_FAILURE_COOLDOWN_MS, batchGeneration)) {
                    completedCount += 1;
                }
            }
            break;
        }
    }

    return { completedCount, toCacheSubtitleRecords };
}

/**
 * Handle batch translation of all subtitles with context
 * @param {Array<{text: string, startTime: number, endTime: number}>} subtitles - All subtitles with timing
 * @returns {Promise<void>}
 */
async function handleBatchTranslation(subtitles) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
        return;
    }
    // New movie/navigation resets fullSubtitles before first batch event.
    // Reset indicator gate so pre-translation notice appears once per movie.
    if (!isBatchTranslating && fullSubtitles.length === 0) {
        hasShownBatchTranslationIndicator = false;
    }
    mergeSubtitlesIntoNavigationCache(subtitles);
    queuePendingBatchSubtitles(subtitles, getCurrentTranslationSessionGeneration());
    if (isBatchTranslating) {
        return;
    }
    isBatchTranslating = true;
    let didShowIndicatorThisRun = false;
    try {
        while (pendingBatchSubtitles.length > 0) {
            const queuedBatch = pendingBatchSubtitles.shift();
            const currentBatch = queuedBatch?.subtitles;
            const batchGeneration = typeof queuedBatch?.generation === 'number'
                ? queuedBatch.generation
                : getCurrentTranslationSessionGeneration();
            if (!Array.isArray(currentBatch) || currentBatch.length === 0) {
                continue;
            }
            const translationProvider = getCurrentTranslationProvider();
            const toTranslateSubtitles = currentBatch.filter(sub => enqueueTranslation(sub.text, batchGeneration));
            if (toTranslateSubtitles.length === 0) {
                continue;
            }
            batchTranslationProgress = { current: 0, total: toTranslateSubtitles.length };
            if (!hasShownBatchTranslationIndicator) {
                showBatchTranslationIndicator();
                hasShownBatchTranslationIndicator = true;
                didShowIndicatorThisRun = true;
            }
            // Process in chunks of 10 for better reliability with Google Translate
            const CHUNK_SIZE = 10;
            const chunks = [];
            for (let i = 0; i < toTranslateSubtitles.length; i += CHUNK_SIZE) {
                chunks.push(toTranslateSubtitles.slice(i, i + CHUNK_SIZE));
            }
            for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
                const chunk = chunks[chunkIndex];
                // Delay only for free Google scraper endpoint to reduce rate-limit pressure.
                if (chunkIndex > 0 && translationProvider === 'google') {
                    await sleep(500);
                }
                const { completedCount, toCacheSubtitleRecords } = await processSubtitleChunkWithRetries(
                    chunk,
                    batchGeneration,
                    translationProvider
                );
                if (globalDatabaseInstance && toCacheSubtitleRecords.length > 0) {
                    saveSubtitlesBatch(globalDatabaseInstance, toCacheSubtitleRecords).catch((error) => {
                        console.error("YleDualSubExtension: Error saving batch to cache:", error);
                    });
                }
                if (isCurrentTranslationSessionGeneration(batchGeneration)) {
                    batchTranslationProgress.current += completedCount;
                    updateBatchTranslationIndicator();
                }
            }
        }
    }
    finally {
        isBatchTranslating = false;
        if (didShowIndicatorThisRun) {
            hideBatchTranslationIndicator();
        }
    }
}
