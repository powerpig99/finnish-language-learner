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

const SUBTITLE_LANGUAGE_HINT_WORDS = {
    fi: new Set([
        'minä', 'sinä', 'hän', 'me', 'te', 'he', 'on', 'ovat', 'oli', 'olisi', 'olla', 'ja', 'tai', 'mutta',
        'että', 'kun', 'jos', 'niin', 'kuin', 'mitä', 'mikä', 'missä', 'miksi', 'koska', 'kanssa', 'joka',
        'jotka', 'myös', 'vain', 'sitten', 'nyt', 'tässä', 'täällä', 'siellä', 'tuolla', 'tänne', 'sinne',
        'tänään', 'huomenna', 'eilen', 'aina', 'koskaan', 'joskus', 'ehkä', 'pitää', 'täytyy', 'voida',
        'haluta', 'tietää', 'nähdä', 'kuulla', 'sanoa', 'mennä', 'tulla', 'ottaa', 'antaa', 'hei', 'maailma',
    ]),
    sv: new Set([
        'jag', 'du', 'han', 'hon', 'den', 'det', 'vi', 'ni', 'de', 'är', 'var', 'vara', 'har', 'hade', 'och',
        'eller', 'men', 'att', 'när', 'om', 'så', 'som', 'vad', 'vilken', 'varför', 'för', 'med', 'på', 'av',
        'till', 'från', 'också', 'bara', 'sedan', 'nu', 'här', 'där', 'dit', 'idag', 'imorgon', 'igår',
        'alltid', 'aldrig', 'ibland', 'kanske', 'måste', 'kan', 'vill', 'vet', 'ser', 'hör', 'säger', 'går',
        'kommer', 'tar', 'ger',
    ]),
    en: new Set([
        'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
        'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall', 'and',
        'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how', 'what', 'which', 'who', 'this',
        'that', 'these', 'those', 'here', 'there', 'now', 'just', 'only', 'also', 'very', 'really', 'always',
        'never', 'sometimes', 'maybe', 'want', 'need', 'know', 'think', 'see', 'hear', 'say', 'go', 'come',
        'take', 'give', 'get', 'make', 'let', 'put', 'use', 'find', 'tell', 'hello', 'yeah', 'okay', 'ok',
        'i', 'you', 'we', 'they', 'my', 'your', 'our', 'their', 'with', 'from', 'got',
    ]),
    de: new Set([
        'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'ist', 'sind', 'war', 'waren', 'sein', 'haben', 'hat',
        'hatte', 'und', 'oder', 'aber', 'wenn', 'dann', 'weil', 'dass', 'als', 'wie', 'was', 'wer', 'wo',
        'warum', 'für', 'mit', 'auf', 'von', 'zu', 'aus', 'auch', 'nur', 'noch', 'schon', 'jetzt', 'hier',
        'dort', 'heute', 'morgen', 'gestern', 'immer', 'nie', 'manchmal', 'vielleicht', 'müssen', 'können',
        'wollen', 'wissen', 'sehen', 'hören', 'sagen', 'gehen', 'kommen', 'nehmen', 'geben',
    ]),
    fr: new Set([
        'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'est', 'sont', 'était', 'étaient', 'être',
        'avoir', 'a', 'ont', 'avait', 'et', 'ou', 'mais', 'si', 'alors', 'parce', 'que', 'quand', 'où',
        'pourquoi', 'comment', 'qui', 'quoi', 'ce', 'cette', 'ces', 'ici', 'là', 'maintenant', 'seulement',
        'aussi', 'très', 'vraiment', 'toujours', 'jamais', 'parfois', 'peut', 'être', 'vouloir', 'devoir',
        'pouvoir', 'savoir', 'voir', 'entendre', 'dire', 'aller', 'venir', 'prendre', 'donner',
    ]),
};

const SUBTITLE_LANGUAGE_HINT_CHARS = {
    fi: /[äö]/gu,
    sv: /[å]/gu,
    de: /[üßäö]/gu,
    fr: /[éèêëàâäùûüïîôœç]/gu,
};

function detectLikelySubtitleLineLanguage(rawSubtitleText) {
    const normalizedSubtitleText = normalizeSubtitleText(rawSubtitleText).toLowerCase();
    if (!normalizedSubtitleText || !hasTranslatableSubtitleContent(normalizedSubtitleText)) {
        return null;
    }
    const words = normalizedSubtitleText.match(/\p{L}+/gu) || [];
    let bestLanguage = null;
    let bestScore = 0;
    let secondBestScore = 0;

    for (const [languageCode, languageWords] of Object.entries(SUBTITLE_LANGUAGE_HINT_WORDS)) {
        let score = 0;
        for (const word of words) {
            if (languageWords.has(word)) {
                score += 1;
            }
        }
        const charPattern = SUBTITLE_LANGUAGE_HINT_CHARS[languageCode];
        if (charPattern) {
            score += (normalizedSubtitleText.match(charPattern) || []).length * 2;
        }
        if (score > bestScore) {
            secondBestScore = bestScore;
            bestScore = score;
            bestLanguage = languageCode;
        } else if (score > secondBestScore) {
            secondBestScore = score;
        }
    }

    if (!bestLanguage || bestScore < 2 || bestScore === secondBestScore) {
        return null;
    }
    return bestLanguage;
}

function shouldRejectIdenticalTranslation(originalText) {
    if (isSourceAndTargetSameLanguage()) {
        return false;
    }
    const lineLanguage = detectLikelySubtitleLineLanguage(originalText);
    if (!lineLanguage) {
        return false;
    }
    return lineLanguage !== normalizeLanguageCode(targetLanguage);
}

function isModelResponseValidationFailureType(failureType) {
    const normalizedFailureType = String(failureType || '').toLowerCase();
    return normalizedFailureType === 'echo_back_failure' ||
        normalizedFailureType === 'language_label_failure' ||
        normalizedFailureType === 'empty_failure';
}

function shouldLogTranslationFailureAsWarning(failureTypeOrErrorMessage, maybeErrorMessage = null) {
    const normalizedFailureType = maybeErrorMessage === null
        ? ''
        : String(failureTypeOrErrorMessage || '').toLowerCase();
    const normalizedError = String(maybeErrorMessage === null ? failureTypeOrErrorMessage : maybeErrorMessage || '').toLowerCase();
    if (!normalizedError) {
        return isModelResponseValidationFailureType(normalizedFailureType);
    }
    if (isModelResponseValidationFailureType(normalizedFailureType)) {
        return true;
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

function countLetterWords(text) {
    const matches = String(text || '').match(/\p{L}+/gu);
    return Array.isArray(matches) ? matches.length : 0;
}

function isKnownSourceOrTargetLanguageLabel(text) {
    const normalizedText = normalizeSubtitleText(text);
    if (!normalizedText) {
        return false;
    }
    // Treat only simple label-like output as a language label, not normal subtitle sentences.
    if (!/^[\p{L}\s()/-]+$/u.test(normalizedText)) {
        return false;
    }
    const normalizedCandidateLanguage = normalizeLanguageCode(normalizedText);
    if (!normalizedCandidateLanguage) {
        return false;
    }
    if (normalizedCandidateLanguage === normalizeLanguageCode(targetLanguage)) {
        return true;
    }
    if (typeof detectedSourceLanguage !== 'string' || !detectedSourceLanguage.trim()) {
        return false;
    }
    return normalizedCandidateLanguage === normalizeLanguageCode(detectedSourceLanguage);
}

function isLikelyLanguageLabelOnlyTranslation(originalText, translatedText) {
    const normalizedOriginalText = normalizeSubtitleText(originalText);
    if (countLetterWords(normalizedOriginalText) < 3) {
        return false;
    }
    return isKnownSourceOrTargetLanguageLabel(translatedText);
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
    dispatchTranslationStateChanged(key);
    document.dispatchEvent(new CustomEvent('dscTranslationResolved', { detail: { key } }));
}

function dispatchTranslationStateChanged(key) {
    document.dispatchEvent(new CustomEvent('dscTranslationStateChanged', { detail: { key } }));
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
    if ((isDirectEchoBack || isWrappedEchoBack) && shouldRejectIdenticalTranslation(normalizedOriginalText)) {
        return {
            status: 'echo_back_failure',
            key,
            normalizedOriginalText,
            error: 'Translation echoed original text',
        };
    }
    if (isLikelyLanguageLabelOnlyTranslation(normalizedOriginalText, normalizedTranslatedText)) {
        return {
            status: 'language_label_failure',
            key,
            normalizedOriginalText,
            error: 'Translation returned a language label instead of translated subtitle',
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
function enqueueTranslation(rawSubtitleText, generation = getCurrentTranslationSessionGeneration(), options = {}) {
    const normalizedText = normalizeSubtitleText(rawSubtitleText);
    if (!normalizedText) {
        return false;
    }
    if (!hasTranslatableSubtitleContent(normalizedText)) {
        setPassThroughSubtitleState(normalizedText);
        return false;
    }
    const forceRetry = options?.forceRetry === true;
    const key = toTranslationKey(normalizedText);
    const currentEntry = subtitleState.get(key);
    const now = Date.now();
    const isSameGeneration = typeof currentEntry?.generation !== 'number' || currentEntry.generation === generation;
    if (currentEntry?.status === 'pending' && isSameGeneration) {
        return false;
    }
    if (currentEntry?.status === 'success' && !forceRetry) {
        return false;
    }
    if (currentEntry?.status === 'failed' &&
        isSameGeneration &&
        !forceRetry &&
        typeof currentEntry.nextRetryAt === 'number' &&
        currentEntry.nextRetryAt > now) {
        return false;
    }
    subtitleState.set(key, {
        status: 'pending',
        generation,
        updatedAt: now,
    });
    dispatchTranslationStateChanged(key);
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
function queuePendingBatchSubtitles(subtitles, generation = getCurrentTranslationSessionGeneration(), options = {}) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
        return;
    }
    pendingBatchSubtitles.push({
        subtitles,
        generation,
        forceRetry: options.forceRetry === true,
        suppressIndicator: options.suppressIndicator === true,
    });
}

function appendBatchRetryLimitReached(errorMessage) {
    const message = String(errorMessage || 'Translation failed').trim();
    return `${message} (batch retry limit reached)`;
}

function buildSubtitleTranslationFailureSummary(payload) {
    const compactSubtitles = Array.isArray(payload.subtitles)
        ? payload.subtitles.slice(0, 3)
        : payload.subtitles;
    const compactProviderResponses = Array.isArray(payload.providerResponses)
        ? payload.providerResponses.slice(0, 3)
        : payload.providerResponses;
    const summaryParts = [
        isModelResponseValidationFailureType(payload.failureType)
            ? 'YleDualSubExtension: Subtitle translation rejected'
            : 'YleDualSubExtension: Subtitle translation failed',
        `provider=${payload.provider || 'unknown'}`,
        `failureType=${payload.failureType || 'unknown'}`,
        `targetLanguage=${payload.targetLanguage || 'unknown'}`,
        `attempts=${typeof payload.attempts === 'number' ? payload.attempts : 'n/a'}`,
        `error=${JSON.stringify(String(payload.error || 'Translation failed'))}`,
        `subtitles=${JSON.stringify(compactSubtitles)}`,
        `providerResponses=${JSON.stringify(compactProviderResponses)}`,
    ];
    if (payload.movieName) {
        summaryParts.push(`movieName=${JSON.stringify(payload.movieName)}`);
    }
    return summaryParts.join(' ');
}

function logSubtitleTranslationFailure({
    provider,
    failureType,
    errorMessage,
    subtitles,
    providerResponses = null,
    attempts = null,
}) {
    const payload = {
        provider: provider || 'unknown',
        movieName: typeof currentMovieName === 'string' ? currentMovieName : null,
        targetLanguage,
        failureType,
        error: String(errorMessage || 'Translation failed'),
        attempts,
        subtitles: Array.isArray(subtitles) ? subtitles.slice() : [],
        providerResponses: Array.isArray(providerResponses) ? providerResponses.slice() : providerResponses,
    };
    const logFailure = shouldLogTranslationFailureAsWarning(failureType, errorMessage)
        ? console.warn
        : console.error;
    logFailure(buildSubtitleTranslationFailureSummary(payload), payload);
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
async function handleBatchTranslation(subtitles, options = {}) {
    if (!Array.isArray(subtitles) || subtitles.length === 0) {
        return;
    }
    // New movie/navigation resets fullSubtitles before first batch event.
    // Reset indicator gate so pre-translation notice appears once per movie.
    if (!isBatchTranslating && fullSubtitles.length === 0) {
        hasShownBatchTranslationIndicator = false;
    }
    mergeSubtitlesIntoNavigationCache(subtitles);
    queuePendingBatchSubtitles(subtitles, getCurrentTranslationSessionGeneration(), options);
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
            const forceRetry = queuedBatch?.forceRetry === true;
            const suppressIndicator = queuedBatch?.suppressIndicator === true;
            if (!Array.isArray(currentBatch) || currentBatch.length === 0) {
                continue;
            }
            const translationProvider = getCurrentTranslationProvider();
            const toTranslateSubtitles = currentBatch.filter(sub => enqueueTranslation(sub.text, batchGeneration, { forceRetry }));
            if (toTranslateSubtitles.length === 0) {
                continue;
            }
            batchTranslationProgress = { current: 0, total: toTranslateSubtitles.length };
            if (!suppressIndicator && !hasShownBatchTranslationIndicator) {
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
                if (!suppressIndicator && isCurrentTranslationSessionGeneration(batchGeneration)) {
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

async function requestVisibleSubtitleTranslation(rawSubtitleText) {
    const normalizedText = normalizeSubtitleText(rawSubtitleText);
    if (!normalizedText || !hasTranslatableSubtitleContent(normalizedText)) {
        return false;
    }
    const key = toTranslationKey(normalizedText);
    const currentEntry = subtitleState.get(key);
    if (currentEntry?.status === 'success' || currentEntry?.status === 'pending') {
        return false;
    }
    await handleBatchTranslation([{ text: normalizedText }], {
        forceRetry: currentEntry?.status === 'failed',
        suppressIndicator: true,
    });
    return true;
}

async function requestManualSubtitleRetranslation(rawSubtitleText) {
    const normalizedText = normalizeSubtitleText(rawSubtitleText);
    if (!normalizedText || !hasTranslatableSubtitleContent(normalizedText)) {
        return false;
    }
    const key = toTranslationKey(normalizedText);
    if (subtitleState.get(key)?.status === 'pending') {
        return false;
    }
    clearEchoBackRetryState(key);
    await handleBatchTranslation([{ text: normalizedText }], {
        forceRetry: true,
        suppressIndicator: true,
    });
    return true;
}

async function retryFailedSubtitleTranslation(rawSubtitleText) {
    const normalizedText = normalizeSubtitleText(rawSubtitleText);
    if (!normalizedText) {
        return false;
    }
    const key = toTranslationKey(normalizedText);
    const currentEntry = subtitleState.get(key);
    if (currentEntry?.status !== 'failed') {
        return false;
    }
    return requestManualSubtitleRetranslation(normalizedText);
}
