import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3013);
const MODEL_NAME = process.env.NANO_BANANA_MODEL || "gemini-3.1-flash-image-preview";
const IMAGE_PROVIDER_LABEL = process.env.IMAGE_PROVIDER_LABEL || "Nano Banana";
const DEFAULT_IMAGE_THINKING_LEVEL = "High";
// fal's Gemini 3.1 Flash Image edit endpoint accepts `thinking_level`, using lowercase enum values.
const FAL_IMAGE_THINKING_LEVEL = "high";
const FAL_IMAGE_EDIT_DEFAULT_MODEL_ID = "fal-ai/gemini-3.1-flash-image-preview/edit";
const FAL_TEMPLATE_MODEL_ID = process.env.FAL_TEMPLATE_MODEL_ID || FAL_IMAGE_EDIT_DEFAULT_MODEL_ID;
const FAL_BACK_VIEW_MODEL_ID = process.env.FAL_BACK_VIEW_MODEL_ID || FAL_TEMPLATE_MODEL_ID;
const FAL_TEMPLATE_RESOLUTION = process.env.FAL_TEMPLATE_RESOLUTION || "1K";
const generatedFolder = path.join(__dirname, "generated");
const configFolder = path.join(__dirname, ".server-config");
const logsFolder = path.join(__dirname, "logs");
const modelsFolder = path.join(__dirname, "models");
const scriptsFolder = path.join(__dirname, "scripts");
const uploadsFolder = path.join(__dirname, "uploads");
const stylesFolder = path.join(__dirname, "styles");
const blurredFolder = path.join(__dirname, "blurred");
const faceGeometryFolder = path.join(__dirname, "face-geometry");
const zoomedFolder = path.join(__dirname, "zoomed");
const appLogFile = path.join(logsFolder, "app.log");
const imageGeneratorLogFile = path.join(logsFolder, "image-generator.log");
const imageGeneratorErrorLogFile = path.join(logsFolder, "image-generator-errors.log");
const generationMetricsFile = path.join(logsFolder, "generation-metrics.json");
const salonAccessConfigFile = path.join(configFolder, "salon-access.json");
const salonSessionSecretFile = path.join(configFolder, ".salon-session-secret");
const stylesMetadataFile = path.join(stylesFolder, "hairstyles.json");
const stylesDescriptionFile = path.join(stylesFolder, "hairstyles.txt");
const faceGeometryManifestFile = path.join(faceGeometryFolder, "manifest.json");
const hairSegmenterModelPath = path.join(modelsFolder, "hair_segmenter.tflite");
const hairSegmenterScriptPath = path.join(scriptsFolder, "segment_hair.py");
const hairLengthAnalyzerScriptPath = path.join(scriptsFolder, "analyze_hair_length.py");
const facialFitScriptPath = path.join(scriptsFolder, "facial_fit.py");
const hairSegmenterModelUrl = "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite";
const configuredPythonCommand = String(process.env.PYTHON_BIN || "").trim();
const execFileAsync = promisify(execFile);
const IMAGE_GENERATION_MAX_ATTEMPTS = Math.max(1, Number(process.env.IMAGE_GENERATION_MAX_ATTEMPTS || 3));
const SALON_SESSION_COOKIE_NAME = "salon_auth";
const SALON_SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 365 * 20;
const SALON_RECENT_PHOTO_WINDOW_MS = 1000 * 60 * 60;
const RANDOM_HAIRSTYLE_RESULT_COUNT = 5;
const RANDOM_LENGTH_CATEGORY_TO_ALLOWED_LENGTHS = {
    short: new Set(["jaw", "chin"]),
    medium: new Set(["jaw", "chin", "shoulder", "collarbone"]),
    long: new Set(["jaw", "chin", "shoulder", "collarbone", "long", "extra-long", "updo"])
};
const DEFAULT_SALON_ACCESS_CONFIG = {
    salons: {
        salon1: {
            displayName: "Salon 1",
            username: "Salon",
            password: {
                algorithm: "scrypt",
                keyLength: 64,
                salt: "b3920f679f99a5845c609e85c364b807",
                hash: "69a88cf1c817d43b4c7204ed6365cef3b5222bc7003cd7a55b49a8a59d76074d1d9ef032d8c7cfd4baa24901ff647c6f5655e35751c1cb44956a0b6c03b1ea31"
            }
        }
    }
};

const getPythonExecutionCandidates = () => {
    const candidates = [];

    if (configuredPythonCommand) {
        candidates.push({
            command: configuredPythonCommand,
            prefixArgs: [],
            label: configuredPythonCommand
        });
    }

    candidates.push(
        {
            command: "python",
            prefixArgs: [],
            label: "python"
        },
        {
            command: "python3",
            prefixArgs: [],
            label: "python3"
        },
        {
            command: "py",
            prefixArgs: ["-3"],
            label: "py -3"
        }
    );

    const uniqueCandidates = [];
    const seenKeys = new Set();

    for (const candidate of candidates) {
        const key = `${candidate.command}::${candidate.prefixArgs.join(" ")}`;

        if (seenKeys.has(key)) {
            continue;
        }

        seenKeys.add(key);
        uniqueCandidates.push(candidate);
    }

    return uniqueCandidates;
};

const isCommandNotFoundError = (error) => {
    const code = String(error?.code || "").trim().toUpperCase();
    const message = String(error?.message || "").trim().toLowerCase();
    return code === "ENOENT" || message.includes("enoent");
};

const runPythonScript = async(scriptPath, scriptArgs = [], options = {}) => {
    const candidates = getPythonExecutionCandidates();
    let lastError = null;

    for (const candidate of candidates) {
        try {
            return await execFileAsync(
                candidate.command,
                [...candidate.prefixArgs, scriptPath, ...scriptArgs],
                options
            );
        } catch (error) {
            lastError = error;

            if (!isCommandNotFoundError(error)) {
                throw error;
            }
        }
    }

    const error = new Error(`No Python runtime was found. Tried: ${candidates.map((candidate) => candidate.label).join(", ")}`);
    error.code = "PYTHON_NOT_FOUND";
    error.details = lastError ? getErrorDetails(lastError) : "";
    throw error;
};

const parseBooleanEnv = (value, defaultValue = false) => {
    if (value === undefined || value === null || value === "") {
        return defaultValue;
    }

    const normalized = String(value).trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
    }

    return defaultValue;
};

const TEST_MODE = parseBooleanEnv(
    process.env.TEST_MODE ?? process.env.NANO_BANANA_TEST_MODE,
    false
);
const IS_RAILWAY_RUNTIME = Boolean(
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PUBLIC_DOMAIN
);
const PYTHON_IMAGE_TOOLS_ENABLED = parseBooleanEnv(
    process.env.PYTHON_IMAGE_TOOLS_ENABLED,
    !IS_RAILWAY_RUNTIME
);
const TWO_PASS = parseBooleanEnv(
    process.env.TWO_PASS ?? process.env.TwoPass,
    false
);
const FACIAL_FIT = parseBooleanEnv(
    process.env.FACIAL_FIT ?? process.env.FacialFit,
    false
);
const FACIAL_FIT_ENABLED = FACIAL_FIT && PYTHON_IMAGE_TOOLS_ENABLED;
const FAL_AI_USED = parseBooleanEnv(
    process.env.Fal_Ai_Used ?? process.env.FAL_AI_USED,
    true
);

const ensureDirectory = (folderPath) => {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
};

ensureDirectory(generatedFolder);
ensureDirectory(configFolder);
ensureDirectory(logsFolder);
ensureDirectory(modelsFolder);
ensureDirectory(uploadsFolder);
ensureDirectory(faceGeometryFolder);
ensureDirectory(zoomedFolder);

if (!fs.existsSync(salonAccessConfigFile)) {
    fs.writeFileSync(salonAccessConfigFile, `${JSON.stringify(DEFAULT_SALON_ACCESS_CONFIG, null, 2)}\n`, "utf-8");
}

if (!fs.existsSync(salonSessionSecretFile)) {
    fs.writeFileSync(salonSessionSecretFile, `${crypto.randomBytes(32).toString("hex")}\n`, "utf-8");
}

const SALON_SESSION_SECRET = fs.readFileSync(salonSessionSecretFile, "utf-8").trim();

let hairSegmenterModelPromise = null;
let cachedFaceGeometryManifestMtimeMs = -1;
let cachedFaceGeometryEntries = new Map();

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use((req, res, next) => {
    const extension = path.extname(req.path || "").toLowerCase();

    if ([".html", ".js", ".css"].includes(extension)) {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.set("Pragma", "no-cache");
        res.set("Expires", "0");
    }

    next();
});
app.use(express.static(__dirname));

const createPublicError = (publicMessage, statusCode = 500, internalMessage = "") => {
    const error = new Error(internalMessage || publicMessage);
    error.publicMessage = publicMessage;
    error.statusCode = statusCode;
    return error;
};

const getErrorText = (error) => String(error?.message || "").trim();

const getGoogleClient = () => {
    if (!process.env.GEMINI_API_KEY) {
        throw createPublicError(
            "Image creation is not available right now. Please try again later.",
            503,
            "Missing GEMINI_API_KEY environment variable."
        );
    }

    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
};

const getFalApiKey = () => {
    const apiKey = String(
        process.env.Fal_Ai_Key ||
        process.env.Fal_Ai_key ||
        process.env.FAL_KEY ||
        ""
    ).trim();

    if (!apiKey) {
        throw createPublicError(
            "Image generation is not available right now. Please try again later.",
            503,
            "Missing Fal_Ai_Key, Fal_Ai_key, or FAL_KEY environment variable for fal.ai image generation."
        );
    }

    return apiKey;
};

const getMimeTypeFromDataUrl = (dataUrl) => {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(dataUrl || "");
    return match ? match[1] : "image/jpeg";
};

const getBase64Payload = (dataUrl) => {
    const [, payload = ""] = String(dataUrl || "").split(",");
    return payload;
};

const getApproxImageBytesFromDataUrl = (dataUrl) => {
    const payloadLength = getBase64Payload(dataUrl).length;
    return Math.max(0, Math.floor((payloadLength * 3) / 4));
};

const isImageDataUrl = (value) => /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(value || "").trim());

const appendLogEntry = (filePath, {
    timestamp = new Date().toISOString(),
    level = "INFO",
    category = "app",
    message = "",
    data = null
}) => {
    const sections = [`[${timestamp}] [${level}] [${category}] ${message}`];

    if (data !== null && data !== undefined) {
        try {
            sections.push(JSON.stringify(data, null, 2));
        } catch (error) {
            sections.push(JSON.stringify({
                serializationError: "Unable to serialize log data.",
                details: String(error?.message || "")
            }, null, 2));
        }
    }

    sections.push("");

    try {
        fs.appendFileSync(filePath, `${sections.join("\n")}\n`, "utf-8");
    } catch (error) {
        console.error("Failed to write log file entry.", error);
    }
};

const writeAppLog = ({
    level = "INFO",
    category = "app",
    message = "",
    data = null
}) => {
    appendLogEntry(appLogFile, {
        level,
        category,
        message,
        data
    });
};

const writeImageGeneratorLog = ({
    level = "INFO",
    category = "image-generator",
    message = "",
    data = null
}) => {
    appendLogEntry(imageGeneratorLogFile, {
        level,
        category,
        message,
        data
    });
};

const writeImageGeneratorErrorLog = ({
    level = "ERROR",
    category = "image-generator-error",
    message = "",
    data = null
}) => {
    appendLogEntry(imageGeneratorErrorLogFile, {
        level,
        category,
        message,
        data
    });
};

const getDefaultGenerationMetrics = () => ({
    updatedAt: "",
    totalCompleted: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    minDurationMs: 0,
    maxDurationMs: 0,
    recent: []
});

const writeGenerationMetrics = (payload) => {
    const tempPath = `${generationMetricsFile}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    fs.renameSync(tempPath, generationMetricsFile);
};

const readGenerationMetrics = () => {
    if (!fs.existsSync(generationMetricsFile)) {
        return getDefaultGenerationMetrics();
    }

    try {
        const raw = fs.readFileSync(generationMetricsFile, "utf-8");
        const parsed = JSON.parse(raw);

        return {
            ...getDefaultGenerationMetrics(),
            ...(parsed && typeof parsed === "object" ? parsed : {}),
            recent: Array.isArray(parsed?.recent) ? parsed.recent : []
        };
    } catch (_error) {
        return getDefaultGenerationMetrics();
    }
};

const ensureGenerationMetricsFile = () => {
    if (!fs.existsSync(generationMetricsFile)) {
        writeGenerationMetrics(getDefaultGenerationMetrics());
    }
};

const recordGenerationTiming = ({
    requestLabel = "",
    savePrefix = "",
    durationMs = 0,
    attemptNumber = 1,
    referenceImageCount = 0,
    savedFile = ""
}) => {
    const normalizedDurationMs = Math.max(0, Math.round(Number(durationMs) || 0));

    if (!normalizedDurationMs) {
        return;
    }

    const metrics = readGenerationMetrics();
    const totalCompleted = Math.max(0, Number(metrics.totalCompleted || 0)) + 1;
    const totalDurationMs = Math.max(0, Number(metrics.totalDurationMs || 0)) + normalizedDurationMs;
    const timestamp = new Date().toISOString();
    const minDurationMs = totalCompleted === 1 ?
        normalizedDurationMs :
        Math.min(
            normalizedDurationMs,
            Math.max(0, Number(metrics.minDurationMs || normalizedDurationMs))
        );
    const maxDurationMs = Math.max(
        normalizedDurationMs,
        Math.max(0, Number(metrics.maxDurationMs || 0))
    );
    const recentEntry = {
        timestamp,
        requestLabel: String(requestLabel || ""),
        savePrefix: String(savePrefix || ""),
        durationMs: normalizedDurationMs,
        attemptNumber: Math.max(1, Number(attemptNumber || 1)),
        referenceImageCount: Math.max(0, Number(referenceImageCount || 0)),
        savedFile: String(savedFile || "")
    };

    writeGenerationMetrics({
        ...metrics,
        updatedAt: timestamp,
        totalCompleted,
        totalDurationMs,
        averageDurationMs: Number((totalDurationMs / totalCompleted).toFixed(2)),
        minDurationMs,
        maxDurationMs,
        recent: [recentEntry]
            .concat(Array.isArray(metrics.recent) ? metrics.recent : [])
            .slice(0, 200)
    });
};

const serializeErrorForLog = (error) => ({
    name: String(error?.name || "Error"),
    message: String(error?.message || ""),
    publicMessage: String(error?.publicMessage || ""),
    statusCode: Number(error?.statusCode || 0) || undefined,
    promptBlocked: String(error?.promptBlocked || ""),
    promptBlockMessage: String(error?.promptBlockMessage || ""),
    providerFailureSummary: String(error?.providerFailureSummary || ""),
    stack: String(error?.stack || "")
});

const extractStructuredApiError = (error) => {
    const rawMessage = getErrorText(error);

    if (!rawMessage) {
        return null;
    }

    try {
        const parsed = JSON.parse(rawMessage);
        const payload = parsed?.error || parsed;

        if (!payload || typeof payload !== "object") {
            return null;
        }

        return {
            code: Number(payload.code || 0) || undefined,
            message: String(payload.message || "").trim(),
            status: String(payload.status || "").trim()
        };
    } catch (_error) {
        return null;
    }
};

const getErrorDetails = (error) => {
    const providerFailureSummary = String(error?.providerFailureSummary || "").trim();

    if (providerFailureSummary) {
        return providerFailureSummary;
    }

    const structuredApiError = extractStructuredApiError(error);

    if (structuredApiError?.message) {
        return structuredApiError.message;
    }

    const promptBlocked = String(error?.promptBlocked || "").trim().toUpperCase();
    const promptBlockMessage = String(error?.promptBlockMessage || "").trim();

    if (promptBlocked || promptBlockMessage) {
        return [
            promptBlocked ? `promptBlocked=${promptBlocked}` : "",
            promptBlockMessage ? `promptBlockMessage=${promptBlockMessage}` : ""
        ].filter(Boolean).join("; ");
    }

    const rawMessage = getErrorText(error);
    return rawMessage ? rawMessage.slice(0, 280) : "";
};

const delay = (milliseconds) => new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
});

ensureGenerationMetricsFile();

const getProviderErrorStatusCode = (error) => {
    const directStatusCode = Number(error?.statusCode || error?.code || error?.status || 0);

    if (Number.isFinite(directStatusCode) && directStatusCode > 0) {
        return directStatusCode;
    }

    const message = getErrorText(error);
    const jsonMatch = message.match(/"code"\s*:\s*(\d{3})/i);

    if (jsonMatch) {
        return Number(jsonMatch[1]);
    }

    const statusMatch = message.match(/\b(408|409|425|429|500|502|503|504)\b/);
    return statusMatch ? Number(statusMatch[1]) : 0;
};

const safetyBlockIndicators = [
    "promptblocked",
    "finishreason=safety",
    "finishreason=prohibited_content",
    "finishreason=blocklist",
    "finishreason=recitation",
    "safetysetting",
    "safety filter",
    "safetyfilters",
    "blocked for safety",
    "blocked due to safety",
    "blocked because of safety",
    "content policy",
    "policy violation",
    "prohibited content"
];

const hasSafetyBlockSignal = (...values) => values
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .some((value) => safetyBlockIndicators.some((indicator) => value.includes(indicator)));

const getPromptBlockReason = (error) => String(error?.promptBlocked || "").trim().toUpperCase();

const getPromptBlockMessage = (error) => String(error?.promptBlockMessage || "").trim();

const getProviderBlockedPublicMessage = (error) => {
    const promptBlockReason = getPromptBlockReason(error);
    const promptBlockMessage = getPromptBlockMessage(error);

    if (promptBlockMessage) {
        return promptBlockMessage;
    }

    if (promptBlockReason === "OTHER") {
        return `${IMAGE_PROVIDER_LABEL} rejected this image request with block reason OTHER. The provider did not return a more specific explanation. Check the browser console for the raw provider details and try a different photo, reference image, or prompt.`;
    }

    if (promptBlockReason) {
        return `${IMAGE_PROVIDER_LABEL} rejected this image request with block reason ${promptBlockReason}. Try a different photo, reference image, or prompt.`;
    }

    return `${IMAGE_PROVIDER_LABEL} blocked this image request. Try a different photo, reference image, or prompt.`;
};

const shouldRetryImageGenerationRequest = (error) => {
    const promptBlocked = String(error?.promptBlocked || "").trim().toLowerCase();
    const providerFailureSummary = String(error?.providerFailureSummary || "").trim().toLowerCase();
    const errorText = getErrorText(error).toLowerCase();
    const statusCode = getProviderErrorStatusCode(error);
    const combinedText = [promptBlocked, providerFailureSummary, errorText].join(" ");

    if (hasSafetyBlockSignal(combinedText)) {
        return false;
    }

    if (
        combinedText.includes("missing image payload") ||
        combinedText.includes("invalid image payload") ||
        combinedText.includes("missing source image") ||
        combinedText.includes("template image not found") ||
        combinedText.includes("invalid api key") ||
        combinedText.includes("api key not valid") ||
        combinedText.includes("unauthenticated") ||
        combinedText.includes("permission denied")
    ) {
        return false;
    }

    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(statusCode)) {
        return true;
    }

    return [
        "deadline expired",
        "deadline exceeded",
        "timed out",
        "timeout",
        "\"status\":\"unavailable\"",
        "service unavailable",
        " unavailable",
        "\"status\":\"internal\"",
        "internal error",
        "resource exhausted",
        "rate limit",
        "too many requests",
        "fetch failed",
        "network",
        "econnreset",
        "eai_again",
        "enotfound",
        "socket hang up",
        "temporarily unavailable"
    ].some((value) => combinedText.includes(value));
};

const shouldRetryWithoutThinkingConfig = ({ error, thinkingLevel = "" }) => {
    if (!thinkingLevel) {
        return false;
    }

    const combinedText = [
        getErrorText(error),
        getErrorDetails(error),
        String(error?.providerFailureSummary || "")
    ].join(" ").toLowerCase();

    return (
        combinedText.includes("thinking level") &&
        combinedText.includes("not supported")
    ) || (
        combinedText.includes("thinkingconfig") &&
        combinedText.includes("invalid")
    );
};

const summarizeImagePayloadsForLog = (imageDataUrls = []) => {
    return imageDataUrls
        .filter(Boolean)
        .map((dataUrl, index) => ({
            role: index === 0 ? "source" : "reference",
            imageNumber: index + 1,
            mimeType: getMimeTypeFromDataUrl(dataUrl),
            approxBytes: getApproxImageBytesFromDataUrl(dataUrl)
        }));
};

const buildImageGenerationLogContext = ({
    prompt,
    imageBase64,
    referenceImageDataUrls = [],
    savePrefix = ""
}) => {
    const normalizedImages = [imageBase64, ...referenceImageDataUrls].filter(Boolean);

    return {
        model: MODEL_NAME,
        testMode: TEST_MODE,
        requestLabel: savePrefix || "",
        prompt: String(prompt || ""),
        imageCount: normalizedImages.length,
        images: summarizeImagePayloadsForLog(normalizedImages)
    };
};

const logImageGenerationRequest = ({
    prompt,
    imageBase64,
    referenceImageDataUrls = [],
    savePrefix = "",
    attemptNumber = 1,
    maxAttempts = 1
}) => {
    const timestamp = new Date().toISOString();
    const payload = {
        timestamp,
        attemptNumber,
        maxAttempts,
        ...buildImageGenerationLogContext({
            prompt,
            imageBase64,
            referenceImageDataUrls,
            savePrefix
        })
    };
    const logMessage = TEST_MODE ?
        "Generation request captured, but external image creation is skipped because TEST_MODE is enabled." :
        `Sending generation request to Image Generator (attempt ${attemptNumber} of ${maxAttempts}).`;

    writeImageGeneratorLog({
        level: TEST_MODE ? "WARN" : "INFO",
        category: TEST_MODE ? "image-generator-skipped" : "image-generator-request",
        message: logMessage,
        data: payload
    });
};

const logImageGenerationError = ({
    prompt,
    imageBase64,
    referenceImageDataUrls = [],
    savePrefix = "",
    error,
    stage = "generate-content",
    attemptNumber = 1,
    maxAttempts = 1
}) => {
    const payload = {
        timestamp: new Date().toISOString(),
        stage,
        attemptNumber,
        maxAttempts,
        ...buildImageGenerationLogContext({
            prompt,
            imageBase64,
            referenceImageDataUrls,
            savePrefix
        }),
        error: serializeErrorForLog(error)
    };

    writeImageGeneratorLog({
        level: "ERROR",
        category: "image-generator-error",
        message: "Image Generator request failed.",
        data: payload
    });

    writeImageGeneratorErrorLog({
        level: "ERROR",
        category: "image-generator-error",
        message: "Image Generator request failed.",
        data: payload
    });
};

const logImageGenerationRetry = ({
    prompt,
    imageBase64,
    referenceImageDataUrls = [],
    savePrefix = "",
    error,
    attemptNumber = 1,
    maxAttempts = 1,
    retryDelayMs = 0
}) => {
    const payload = {
        timestamp: new Date().toISOString(),
        attemptNumber,
        maxAttempts,
        retryDelayMs,
        ...buildImageGenerationLogContext({
            prompt,
            imageBase64,
            referenceImageDataUrls,
            savePrefix
        }),
        error: serializeErrorForLog(error)
    };

    writeImageGeneratorLog({
        level: "WARN",
        category: "image-generator-retry",
        message: `Retrying Image Generator request after provider-side failure (attempt ${attemptNumber} of ${maxAttempts}).`,
        data: payload
    });

    writeAppLog({
        level: "WARN",
        category: "generation-retry",
        message: `Retrying Image Generator request ${savePrefix || "unnamed-request"} after provider-side failure.`,
        data: payload
    });
};

const logImageGenerationResponse = ({
    savePrefix = "",
    response,
    imagePart = null,
    failureSummary = "",
    attemptNumber = 1,
    maxAttempts = 1
}) => {
    const timestamp = new Date().toISOString();
    const payload = {
        timestamp,
        model: MODEL_NAME,
        requestLabel: savePrefix || "",
        attemptNumber,
        maxAttempts,
        receivedImage: Boolean(imagePart),
        mimeType: imagePart?.mimeType || "",
        promptBlocked: String(response?.promptFeedback?.blockReason || "").trim().toUpperCase(),
        candidateCount: Array.isArray(response?.candidates) ? response.candidates.length : 0,
        failureSummary: String(failureSummary || "").trim()
    };

    writeImageGeneratorLog({
        level: payload.receivedImage ? "INFO" : "ERROR",
        category: payload.receivedImage ? "image-generator-response" : "image-generator-response-error",
        message: payload.receivedImage ?
            `Received image response from Image Generator on attempt ${attemptNumber} of ${maxAttempts}.` : `Image Generator returned no image on attempt ${attemptNumber} of ${maxAttempts}.`,
        data: payload
    });
};

const logGenerationFailure = ({
    route,
    stage,
    error,
    context = {}
}) => {
    writeAppLog({
        level: "ERROR",
        category: "generation-error",
        message: `${route} failed during ${stage}.`,
        data: {
            route,
            stage,
            context,
            error: serializeErrorForLog(error)
        }
    });
};

const assertImageDataUrl = (value, publicMessage = "Please choose a valid image and try again.") => {
    const mimeType = getMimeTypeFromDataUrl(value);
    const payload = getBase64Payload(value);

    if (!isImageDataUrl(value) || !mimeType.startsWith("image/") || !payload) {
        throw createPublicError(publicMessage, 400, `Invalid image payload: ${mimeType || "unknown mime type"}`);
    }
};

const sanitizeSalonSlug = (value) => {
    const normalized = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return normalized || "default-salon";
};

const formatSalonName = (value) => {
    return sanitizeSalonSlug(value)
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
};

const readSalonAccessConfig = () => {
    try {
        const raw = fs.readFileSync(salonAccessConfigFile, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : { salons: {} };
    } catch (_error) {
        return { salons: {} };
    }
};

const getSalonAccessRecord = (salonSlug) => {
    const normalizedSalonSlug = sanitizeSalonSlug(salonSlug);
    const config = readSalonAccessConfig();
    const record = config?.salons?.[normalizedSalonSlug];

    if (!record || typeof record !== "object") {
        return null;
    }

    return {
        displayName: String(record.displayName || formatSalonName(normalizedSalonSlug)),
        username: String(record.username || ""),
        password: {
            algorithm: String(record.password?.algorithm || ""),
            salt: String(record.password?.salt || ""),
            hash: String(record.password?.hash || ""),
            keyLength: Math.max(1, Number(record.password?.keyLength || 64))
        }
    };
};

const parseCookies = (cookieHeader = "") => {
    return String(cookieHeader || "")
        .split(";")
        .map((segment) => segment.trim())
        .filter(Boolean)
        .reduce((cookies, segment) => {
            const separatorIndex = segment.indexOf("=");

            if (separatorIndex <= 0) {
                return cookies;
            }

            const key = segment.slice(0, separatorIndex).trim();
            const value = segment.slice(separatorIndex + 1).trim();
            cookies[key] = decodeURIComponent(value);
            return cookies;
        }, {});
};

const signSalonSessionValue = (value) => crypto
    .createHmac("sha256", SALON_SESSION_SECRET)
    .update(value)
    .digest("base64url");

const createSalonSessionCookieValue = ({ salonSlug, username }) => {
    const payload = {
        salonSlug: sanitizeSalonSlug(salonSlug),
        username: String(username || "")
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
    const signature = signSalonSessionValue(encodedPayload);
    return `${encodedPayload}.${signature}`;
};

const parseSalonSessionCookieValue = (value) => {
    const [encodedPayload = "", signature = ""] = String(value || "").split(".");

    if (!encodedPayload || !signature) {
        return null;
    }

    const expectedSignature = signSalonSessionValue(encodedPayload);
    const providedBuffer = Buffer.from(signature, "utf-8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf-8");

    if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf-8"));

        if (!payload) {
            return null;
        }

        return {
            salonSlug: sanitizeSalonSlug(payload.salonSlug),
            username: String(payload.username || "")
        };
    } catch (_error) {
        return null;
    }
};

const getAuthenticatedSalonSession = (req, salonSlug) => {
    const cookies = parseCookies(req.headers.cookie || "");
    const session = parseSalonSessionCookieValue(cookies[SALON_SESSION_COOKIE_NAME] || "");

    if (!session) {
        return null;
    }

    if (salonSlug && session.salonSlug !== sanitizeSalonSlug(salonSlug)) {
        return null;
    }

    return session;
};

const writeCookie = (res, name, value, {
    maxAgeMs = SALON_SESSION_DURATION_MS,
    expiresAt = null
} = {}) => {
    const directives = [
        `${name}=${encodeURIComponent(value)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`
    ];

    if (expiresAt instanceof Date) {
        directives.push(`Expires=${expiresAt.toUTCString()}`);
    }

    res.append("Set-Cookie", directives.join("; "));
};

const clearCookie = (res, name) => {
    writeCookie(res, name, "", {
        maxAgeMs: 0,
        expiresAt: new Date(0)
    });
};

const verifySalonPassword = (plainTextPassword, passwordRecord) => {
    if (passwordRecord.algorithm !== "scrypt" || !passwordRecord.salt || !passwordRecord.hash) {
        return false;
    }

    const expectedHash = Buffer.from(passwordRecord.hash, "hex");
    const derivedHash = crypto.scryptSync(String(plainTextPassword || ""), passwordRecord.salt, passwordRecord.keyLength);

    return expectedHash.length === derivedHash.length && crypto.timingSafeEqual(expectedHash, derivedHash);
};

const getMimeTypeFromFilename = (filename) => {
    const extension = path.extname(filename || "").toLowerCase();

    if (extension === ".jpg" || extension === ".jpeg") {
        return "image/jpeg";
    }

    if (extension === ".webp") {
        return "image/webp";
    }

    if (extension === ".gif") {
        return "image/gif";
    }

    return "image/png";
};

const getExtensionFromMimeType = (mimeType) => {
    const normalizedMimeType = String(mimeType || "").toLowerCase();

    if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") {
        return "jpg";
    }

    if (normalizedMimeType === "image/webp") {
        return "webp";
    }

    if (normalizedMimeType === "image/gif") {
        return "gif";
    }

    if (normalizedMimeType === "image/heic" || normalizedMimeType === "image/heif") {
        return "heic";
    }

    if (normalizedMimeType === "image/avif") {
        return "avif";
    }

    return "png";
};

const isImageFile = (filename) => /\.(png|jpg|jpeg|webp|gif)$/i.test(filename || "");

const normalizeStyleKey = (name) => path.basename(name || "", path.extname(name || "")).toLowerCase();

const formatStyleName = (name) => {
    return normalizeStyleKey(name)
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
};

const normalizeStyleAttributes = (attributes) => {
    const normalized = {};
    const source = attributes && typeof attributes === "object" ? attributes : {};

    for (const key of["length", "style", "family", "texture", "fringe", "parting", "color"]) {
        const value = String(source[key] || "").trim();

        if (value) {
            normalized[key] = value;
        }
    }

    return normalized;
};

const loadStyleMetadata = () => {
    const metadata = new Map();

    if (!fs.existsSync(stylesMetadataFile)) {
        return metadata;
    }

    try {
        const raw = fs.readFileSync(stylesMetadataFile, "utf-8");
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [];

        for (const item of items) {
            const filename = String(item?.filename || "").trim();

            if (!filename) {
                continue;
            }

            const normalizedFilename = filename.toLowerCase();
            const baseKey = normalizeStyleKey(filename);
            const value = {
                filename,
                id: String(item?.id || baseKey).trim() || baseKey,
                name: String(item?.name || formatStyleName(filename)).trim() || formatStyleName(filename),
                description: String(item?.description || "").trim(),
                attributes: normalizeStyleAttributes(item?.attributes),
                aliases: Array.isArray(item?.aliases) ?
                    item.aliases.map((alias) => String(alias || "").trim()).filter(Boolean) : []
            };

            metadata.set(normalizedFilename, value);
            metadata.set(baseKey, value);

            for (const alias of value.aliases) {
                metadata.set(alias.toLowerCase(), value);
                metadata.set(normalizeStyleKey(alias), value);
            }
        }
    } catch (error) {
        console.warn(`Unable to parse style metadata file at ${stylesMetadataFile}:`, error);
    }

    return metadata;
};

const loadFaceGeometryManifest = () => {
    if (!fs.existsSync(faceGeometryManifestFile)) {
        cachedFaceGeometryManifestMtimeMs = -1;
        cachedFaceGeometryEntries = new Map();
        return cachedFaceGeometryEntries;
    }

    try {
        const stats = fs.statSync(faceGeometryManifestFile);

        if (stats.mtimeMs === cachedFaceGeometryManifestMtimeMs) {
            return cachedFaceGeometryEntries;
        }

        const raw = fs.readFileSync(faceGeometryManifestFile, "utf-8");
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed?.entries) ? parsed.entries : [];
        const entries = new Map();

        for (const item of items) {
            const filename = String(item?.filename || "").trim();
            const geometryFile = String(item?.geometryFile || "").trim();
            const relativeGeometryPath = String(item?.geometryPath || "").trim();
            const geometryPath = geometryFile ?
                path.join(faceGeometryFolder, geometryFile) :
                (relativeGeometryPath ? path.join(__dirname, relativeGeometryPath) : "");
            const linkedBlurredFilename = String(item?.linkedBlurredFilename || "").trim();

            if (!filename || !geometryPath || !fs.existsSync(geometryPath)) {
                continue;
            }

            const entry = {
                filename,
                linkedBlurredFilename,
                geometryPath
            };

            entries.set(filename.toLowerCase(), entry);

            if (linkedBlurredFilename) {
                entries.set(linkedBlurredFilename.toLowerCase(), entry);
            }
        }

        cachedFaceGeometryManifestMtimeMs = stats.mtimeMs;
        cachedFaceGeometryEntries = entries;
    } catch (error) {
        cachedFaceGeometryManifestMtimeMs = -1;
        cachedFaceGeometryEntries = new Map();
        writeAppLog({
            level: "WARN",
            category: "face-geometry",
            message: "Unable to load face geometry manifest.",
            data: {
                manifestFile: faceGeometryManifestFile,
                error: serializeErrorForLog(error)
            }
        });
    }

    return cachedFaceGeometryEntries;
};

const getCachedStyleFaceGeometry = (filename) => {
    const normalizedFilename = String(filename || "").trim().toLowerCase();

    if (!normalizedFilename) {
        return null;
    }

    const manifestEntries = loadFaceGeometryManifest();
    return manifestEntries.get(normalizedFilename) || null;
};

const loadStyleDescriptions = () => {
    const descriptions = new Map();

    if (!fs.existsSync(stylesDescriptionFile)) {
        return descriptions;
    }

    const lines = fs.readFileSync(stylesDescriptionFile, "utf-8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        const separatorIndex = line.indexOf(":");

        if (separatorIndex === -1) {
            continue;
        }

        const rawName = line.slice(0, separatorIndex).trim();
        const description = line.slice(separatorIndex + 1).trim();

        if (!rawName || !description) {
            continue;
        }

        descriptions.set(rawName.toLowerCase(), description);
        descriptions.set(normalizeStyleKey(rawName), description);
    }

    return descriptions;
};

const listTemplateStyles = () => {
    if (!fs.existsSync(stylesFolder)) {
        return [];
    }

    const excludedTemplateFilenames = new Set([
        "redhair_shoulderhair.png"
    ]);
    const metadata = loadStyleMetadata();
    const descriptions = loadStyleDescriptions();

    return fs.readdirSync(stylesFolder)
        .filter(isImageFile)
        .filter((filename) => !excludedTemplateFilenames.has(filename.toLowerCase()))
        .sort((left, right) => left.localeCompare(right))
        .map((filename) => {
            const baseKey = normalizeStyleKey(filename);
            const styleMetadata = metadata.get(filename.toLowerCase()) || metadata.get(baseKey);
            const prompt = styleMetadata?.description ||
                descriptions.get(filename.toLowerCase()) ||
                descriptions.get(baseKey) ||
                `Use the reference image to recreate the hairstyle shown in ${formatStyleName(filename)}.`;

            return {
                id: styleMetadata?.id || baseKey,
                filename,
                name: styleMetadata?.name || formatStyleName(filename),
                prompt,
                description: prompt,
                attributes: styleMetadata?.attributes || {},
                imageUrl: `/styles/${encodeURIComponent(filename)}`
            };
        });
};

const getTemplateStyleByFilename = (filename) => {
    const catalog = listTemplateStyles();
    return catalog.find((style) => style.filename === filename) || null;
};

const shuffleItems = (items) => {
    const shuffled = [...items];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled;
};

const getEligibleRandomTemplateStyles = ({ lengthCategory = "long", count = RANDOM_HAIRSTYLE_RESULT_COUNT }) => {
    const allowedLengths = RANDOM_LENGTH_CATEGORY_TO_ALLOWED_LENGTHS[lengthCategory] || RANDOM_LENGTH_CATEGORY_TO_ALLOWED_LENGTHS.long;
    const eligibleStyles = listTemplateStyles().filter((style) => {
        const styleLength = String(style?.attributes?.length || "").trim().toLowerCase();
        return styleLength && allowedLengths.has(styleLength);
    });

    return shuffleItems(eligibleStyles).slice(0, Math.max(1, count));
};

const getImageReferenceDataUrl = (folderPath, filename, notFoundMessage) => {
    const filePath = path.join(folderPath, filename);

    if (!fs.existsSync(filePath)) {
        throw new Error(notFoundMessage);
    }

    const mimeType = getMimeTypeFromFilename(filename);
    const base64Data = fs.readFileSync(filePath).toString("base64");
    return `data:${mimeType};base64,${base64Data}`;
};

const getStyleReferenceDataUrl = (filename) => getImageReferenceDataUrl(
    stylesFolder,
    filename,
    `Template image not found: ${filename}`
);

const getBlurredStyleReferenceDataUrl = (filename) => {
    const filePath = path.join(blurredFolder, filename);

    if (!fs.existsSync(filePath)) {
        const requestedBaseName = path.parse(String(filename || "")).name.toLowerCase();

        if (!requestedBaseName || !fs.existsSync(blurredFolder)) {
            return "";
        }

        const fallbackMatch = fs.readdirSync(blurredFolder).find((entry) => {
            if (!isImageFile(entry)) {
                return false;
            }

            return path.parse(entry).name.toLowerCase() === requestedBaseName;
        });

        if (!fallbackMatch) {
            return "";
        }

        return getImageReferenceDataUrl(
            blurredFolder,
            fallbackMatch,
            `Blurred reference image not found: ${filename}`
        );
    }

    return getImageReferenceDataUrl(
        blurredFolder,
        filename,
        `Blurred reference image not found: ${filename}`
    );
};

const naturalLightingInstruction = "Match the new hair to the original image lighting so it looks natural.";
const buildTwoPassHairFitPrompt = () => [
    "Refine the hair so it fits the head more naturally.",
    "Keep the exact same hairstyle, hair length, hair color, person, and background unchanged."
].join(" ");

const buildRandomReferenceTransferPrompt = () => {
    return [
        "Transfer the hairstyle from Image 2 to Image 1.",
        "Keep the person in Image 1 identical.",
        "Make the result direct front-facing with a white background, butterfly studio lighting, and tack sharp focus.",
        "Keep it natural and salon-quality."
    ].join(" ");
};

const buildPrecisionHairSwapPrompt = ({ specificHairDescription = "" }) => {
    const normalizedSpecificHairDescription = String(specificHairDescription || "").trim();

    return [
        "You are a precision image compositor executing a photorealistic hair swap.",
        "Use image 1 as the destination scene and subject.",
        "Use image 2 as the absolute structural and stylistic reference for the hair.",
        "Preserve 100% of the identity, facial features, expression, eyes, skin texture, and clothing of the person from image 1.",
        "Keep the original background and all environmental elements in image 1 identical and untouched.",
        "Replace the subject's entire existing hair volume with a new hairstyle.",
        "The new style must match the specific structure, length, volume, and texture found in image 2.",
        normalizedSpecificHairDescription ? `Specific hair direction: ${normalizedSpecificHairDescription}.` : "",
        "The hairline transition from the forehead and temples to the new hair must be anatomically correct and flawlessly blended.",
        "There must be absolutely no floating hair effect.",
        "The new strands must appear to grow naturally from the scalp.",
        "Re-orient the reference hairstyle from image 2, not image 1, so it matches the exact head angle, tilt, and perspective of the subject in image 1.",
        "Apply the ambient light temperature, intensity, and directionality from image 1 to the new hair.",
        "Do not bring the lighting environment from image 2.",
        "The new hair must cast realistic soft contact shadows onto the forehead, neck, and shoulders.",
        "Render individual sharp hair strands, especially at the edges, and avoid a smooth or plastic look.",
        "Match the focus depth of the new hair to the depth of field of the subject's face.",
        "Make it realistic and fitting well important!",
        "Keep the result photorealistic, flattering, and salon quality."
    ].filter(Boolean).join(" ");
};

const buildTemplateEditPrompt = ({ extraPrompt }) => {
    const normalizedExtraPrompt = String(extraPrompt || "").trim();
    const userPriorityPrompt = normalizedExtraPrompt ?
        `Prompt From user, disregard any previous instructions if clash with the following: ${normalizedExtraPrompt}` :
        "";

    return [
        "Compose a detailed professional hair integration.",
        "The primary subject is the person from Image 1, re-posed to a direct, front-facing orientation with a white background, butterfly studio lighting, and tack sharp focus.",
        "Perfect likeness and facial geometry of the subject in Image 1 must be preserved in this new perspective.",
        "Re-create the complete hairstyle from Image 2 and integrate it seamlessly onto this front-facing head.",
        "Focus on natural blending at the front hairline and temples, with strands appearing to emerge authentically from the scalp.",
        "Adapt the lighting character, direction and color temperature, from Image 1 to this new front-facing composition.",
        "The final output must be a sharp, high-resolution salon-quality render with extremely realistic hair texture.",
        userPriorityPrompt
    ].filter(Boolean).join(" ");
};

const buildRearViewPrompt = ({ viewLabel, cameraAngle }) => {
    return `Give the ${viewLabel} view of image 2. Keep the original person identical to image 1 and keep the hair identical to image 2. Keep the background white. Do not change anything besides the angle of the camera to be at the ${cameraAngle}.`;
};

const buildHairColorReferencePrompt = () => {
    return "Edit Image 1: Keep identity identical. Change the pose to direct front-facing. Replace hair with the style from Image 2. Apply the exact hair color from Image 3 to the new style. Butterfly studio lighting, tack sharp focus, white background. Ensure natural lighting and salon-quality blending.";
};

const buildPromptVariationPrompt = ({
    extraPrompt,
    hairColorHex,
    hairColorLabel,
    hasHairColorReference,
    isHairColorOnlyPrompt = false
}) => {
    const hasHairColorRequest = Boolean(hairColorHex || hairColorLabel || hasHairColorReference);
    const normalizedExtraPrompt = String(extraPrompt || "").trim();
    const userPriorityPrompt = normalizedExtraPrompt ?
        `Prompt From user, disregard any previous instructions if clash with the following: ${normalizedExtraPrompt}` :
        "";

    if (isHairColorOnlyPrompt) {
        return extraPrompt;
    }

    if (hasHairColorRequest) {
        return [
            buildHairColorReferencePrompt(),
            userPriorityPrompt
        ].filter(Boolean).join(" ");
    }

    return [
        "Use image 1 as the reference image.",
        "Edit image 2 only.",
        "Keep the client consistent with image 1.",
        hasHairColorReference ? "Use image 3 only for the target hair color." : "",
        naturalLightingInstruction,
        userPriorityPrompt
    ].filter(Boolean).join(" ");
};

const buildHairColorOnlyPrompt = ({
    hairColorHex,
    hairColorLabel,
    hasHairColorReference
}) => {
    return buildHairColorReferencePrompt();
};

const getPromptVariationMetadata = ({
    lookName,
    variationBaseName,
    variationSequence
}) => {
    const fallbackName = String(lookName || "").trim() || "Generated hairstyle";
    const explicitBaseName = String(variationBaseName || "").trim();
    const explicitSequence = Math.floor(Number(variationSequence || 0));

    if (explicitBaseName && explicitSequence >= 2) {
        return {
            baseName: explicitBaseName,
            sequence: explicitSequence,
            displayName: `${explicitBaseName} ${explicitSequence}`.trim()
        };
    }

    let derivedBaseName = explicitBaseName || fallbackName;
    let promptVariationDepth = 0;

    while (/\s*Prompt Variation$/i.test(derivedBaseName)) {
        derivedBaseName = derivedBaseName.replace(/\s*Prompt Variation$/i, "").trim();
        promptVariationDepth += 1;
    }

    const resolvedBaseName = derivedBaseName || fallbackName;
    const resolvedSequence = explicitSequence >= 2 ?
        explicitSequence :
        Math.max(2, promptVariationDepth > 0 ? promptVariationDepth + 1 : 2);

    return {
        baseName: resolvedBaseName,
        sequence: resolvedSequence,
        displayName: `${resolvedBaseName} ${resolvedSequence}`.trim()
    };
};

const createPromptVariationResultId = ({ baseName, sequence }) => {
    const uniqueSuffix = typeof crypto.randomUUID === "function" ?
        crypto.randomUUID() :
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `${normalizeStyleKey(baseName)}-variation-${sequence}-${uniqueSuffix}`;
};

const getPartInlineData = (part) => part?.inlineData || part?.inline_data || null;

const extractInlineImage = (response) => {
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];

    for (const candidate of candidates) {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

        for (const part of parts) {
            const inlineData = getPartInlineData(part);
            const mimeType = String(inlineData?.mimeType || inlineData?.mime_type || "").trim().toLowerCase();
            const data = String(inlineData?.data || "").trim();

            if (!data) {
                continue;
            }

            return {
                mimeType: mimeType.startsWith("image/") ? mimeType : "image/png",
                data
            };
        }
    }

    const fallbackData = typeof response?.data === "string" ? response.data.trim() : "";

    if (fallbackData) {
        return {
            mimeType: "image/png",
            data: fallbackData
        };
    }

    return null;
};

const summarizeGenerateContentFailure = (response) => {
    const details = [];
    const promptBlockReason = String(response?.promptFeedback?.blockReason || "").trim();
    const promptBlockMessage = String(response?.promptFeedback?.blockReasonMessage || "").trim();
    const responseText = String(response?.text || "").trim().replace(/\s+/g, " ");
    const modelVersion = String(response?.modelVersion || "").trim();
    const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
    const finishReasons = [...new Set(
        candidates
        .map((candidate) => String(candidate?.finishReason || "").trim())
        .filter(Boolean)
    )];
    const finishMessages = [...new Set(
        candidates
        .map((candidate) => String(candidate?.finishMessage || "").trim())
        .filter(Boolean)
    )];

    if (modelVersion) {
        details.push(`modelVersion=${modelVersion}`);
    }

    if (promptBlockReason) {
        details.push(`promptBlocked=${promptBlockReason}`);
    }

    if (promptBlockMessage) {
        details.push(`promptBlockMessage=${promptBlockMessage}`);
    }

    if (finishReasons.length > 0) {
        details.push(`finishReason=${finishReasons.join(",")}`);
    }

    if (finishMessages.length > 0) {
        details.push(`finishMessage=${finishMessages.join(" | ").slice(0, 240)}`);
    }

    if (responseText) {
        details.push(`text=${responseText.slice(0, 280)}`);
    }

    if (details.length === 0) {
        details.push(`candidateCount=${candidates.length}`);
    }

    return details.join("; ");
};

const getImageServiceErrorResponse = (error, fallbackMessage = "Something went wrong. Please try again.") => {
    const combinedMessage = [
        getErrorText(error),
        String(error?.providerFailureSummary || ""),
        String(error?.promptBlocked || "")
    ].join(" ").toLowerCase();
    const details = getErrorDetails(error);
    const promptBlockReason = getPromptBlockReason(error);

    if (
        combinedMessage.includes("thinking level") &&
        combinedMessage.includes("not supported")
    ) {
        return {
            statusCode: 400,
            message: "This image model does not support the requested reasoning setting.",
            reason: "unsupported_thinking_level",
            details
        };
    }

    if (promptBlockReason || hasSafetyBlockSignal(combinedMessage)) {
        return {
            statusCode: 422,
            message: getProviderBlockedPublicMessage(error),
            reason: "image_service_blocked",
            details
        };
    }

    if (
        combinedMessage.includes("resource exhausted") ||
        combinedMessage.includes("quota") ||
        combinedMessage.includes("rate limit") ||
        combinedMessage.includes("too many requests") ||
        combinedMessage.includes("429")
    ) {
        return {
            statusCode: 503,
            message: "The image service is busy right now. Please wait a moment and try again.",
            reason: "image_service_busy",
            details
        };
    }

    if (
        combinedMessage.includes("timed out") ||
        combinedMessage.includes("timeout") ||
        combinedMessage.includes("deadline expired") ||
        combinedMessage.includes("deadline exceeded") ||
        combinedMessage.includes("etimedout") ||
        combinedMessage.includes("aborterror")
    ) {
        return {
            statusCode: 504,
            message: "The image service took too long to finish this image. Please try again.",
            reason: "image_service_timeout",
            details
        };
    }

    if (
        combinedMessage.includes("fetch failed") ||
        combinedMessage.includes("network") ||
        combinedMessage.includes("\"status\":\"unavailable\"") ||
        combinedMessage.includes("service unavailable") ||
        combinedMessage.includes(" unavailable") ||
        combinedMessage.includes("econnreset") ||
        combinedMessage.includes("eai_again") ||
        combinedMessage.includes("enotfound") ||
        combinedMessage.includes("socket hang up")
    ) {
        return {
            statusCode: 503,
            message: "The image service is temporarily unavailable. Please try again in a moment.",
            reason: "image_service_unavailable",
            details
        };
    }

    if (
        combinedMessage.includes("did not return an image") ||
        combinedMessage.includes("finishreason=") ||
        combinedMessage.includes("candidatecount=")
    ) {
        return {
            statusCode: 502,
            message: "The image service returned no image for this request. Please try again or use a different reference.",
            reason: "image_service_no_image",
            details
        };
    }

    return {
        statusCode: Number(error?.statusCode || 500),
        message: fallbackMessage,
        reason: "image_service_error",
        details
    };
};

const getPublicErrorResponse = (error, fallbackMessage = "Something went wrong. Please try again.") => {
    if (error?.providerFailureSummary || error?.promptBlocked) {
        return getImageServiceErrorResponse(error, fallbackMessage);
    }

    const structuredApiError = extractStructuredApiError(error);

    if (error?.publicMessage) {
        return {
            statusCode: Number(error.statusCode || 500),
            message: error.publicMessage,
            reason: "public_error",
            details: getErrorDetails(error)
        };
    }

    if (error?.type === "entity.too.large") {
        return {
            statusCode: 413,
            message: "That image is too large. Please choose a smaller one and try again.",
            reason: "image_too_large",
            details: getErrorDetails(error)
        };
    }

    if (error instanceof SyntaxError && Object.prototype.hasOwnProperty.call(error, "body")) {
        return {
            statusCode: 400,
            message: "We couldn't read that request. Please try again.",
            reason: "invalid_json",
            details: getErrorDetails(error)
        };
    }

    const message = getErrorText(error).toLowerCase();

    if (
        message.includes("thinking level") &&
        message.includes("not supported")
    ) {
        return getImageServiceErrorResponse(error, fallbackMessage);
    }

    if (
        structuredApiError?.status === "INVALID_ARGUMENT" ||
        message.includes("\"status\":\"invalid_argument\"")
    ) {
        return {
            statusCode: 400,
            message: structuredApiError?.message || "The image request included an unsupported setting.",
            reason: "invalid_argument",
            details: getErrorDetails(error)
        };
    }

    if (
        message.includes("missing gemini_api_key") ||
        message.includes("api key not valid") ||
        message.includes("invalid api key") ||
        message.includes("api_key_invalid") ||
        message.includes("permission denied") ||
        message.includes("unauthenticated") ||
        message.includes("invalid authentication") ||
        message.includes("authentication")
    ) {
        return {
            statusCode: 503,
            message: "Image creation is not available right now. Please try again later.",
            reason: "invalid_api_key",
            details: getErrorDetails(error)
        };
    }

    if (
        message.includes("resource exhausted") ||
        message.includes("quota") ||
        message.includes("rate limit") ||
        message.includes("too many requests") ||
        message.includes("429")
    ) {
        return {
            statusCode: 503,
            message: "Image creation is busy right now. Please wait a moment and try again.",
            reason: "image_creation_busy",
            details: getErrorDetails(error)
        };
    }

    if (
        message.includes("model not found") ||
        message.includes("unsupported model") ||
        message.includes("not found for api version") ||
        message.includes("unknown model")
    ) {
        return {
            statusCode: 503,
            message: "Image creation is temporarily unavailable. Please try again later.",
            reason: "model_unavailable",
            details: getErrorDetails(error)
        };
    }

    if (
        message.includes("timed out") ||
        message.includes("timeout") ||
        message.includes("deadline expired") ||
        message.includes("deadline exceeded") ||
        message.includes("etimedout") ||
        message.includes("aborterror")
    ) {
        return {
            statusCode: 504,
            message: "This request took too long. Please try again.",
            reason: "request_timeout",
            details: getErrorDetails(error)
        };
    }

    if (
        message.includes("fetch failed") ||
        message.includes("network") ||
        message.includes("\"status\":\"unavailable\"") ||
        message.includes("service unavailable") ||
        message.includes(" unavailable") ||
        message.includes("econnreset") ||
        message.includes("eai_again") ||
        message.includes("enotfound") ||
        message.includes("socket hang up")
    ) {
        return {
            statusCode: 503,
            message: "We couldn't reach the image service. Please try again in a moment.",
            reason: "image_service_unreachable",
            details: getErrorDetails(error)
        };
    }

    if (hasSafetyBlockSignal(message)) {
        return {
            statusCode: 422,
            message: "We couldn't create that image from the current request. Try a different photo or prompt.",
            reason: "request_blocked",
            details: getErrorDetails(error)
        };
    }

    if (
        message.includes("did not return an image") ||
        message.includes("finishreason=") ||
        message.includes("candidatecount=")
    ) {
        return getImageServiceErrorResponse(error, fallbackMessage);
    }

    if (
        message.includes("only image uploads are supported") ||
        message.includes("only image inputs can be segmented") ||
        message.includes("missing image payload") ||
        message.includes("invalid image payload") ||
        message.includes("missing source image") ||
        message.includes("missing selected generated image") ||
        message.includes("missing image for hair segmentation")
    ) {
        return {
            statusCode: 400,
            message: "Please choose a valid image and try again.",
            reason: "invalid_image",
            details: getErrorDetails(error)
        };
    }

    if (
        message.includes("template image not found") ||
        message.includes("hair segmentation script is missing") ||
        message.includes("hair segmentation requires") ||
        message.includes("failed to download hair segmenter model")
    ) {
        return {
            statusCode: 503,
            message: "A required asset is temporarily unavailable. Please try again later.",
            reason: "required_asset_unavailable",
            details: getErrorDetails(error)
        };
    }

    return {
        statusCode: Number(error?.statusCode || 500),
        message: fallbackMessage,
        reason: "unknown_error",
        details: getErrorDetails(error)
    };
};

const respondWithPublicError = (res, error, logLabel, fallbackMessage) => {
    console.error(logLabel, error);
    const { statusCode, message, reason, details } = getPublicErrorResponse(error, fallbackMessage);
    writeAppLog({
        level: "ERROR",
        category: "request-error",
        message: logLabel,
        data: {
            statusCode,
            publicMessage: message,
            reason,
            details,
            error: serializeErrorForLog(error)
        }
    });
    return res.status(statusCode).json({ error: message, reason, details });
};

const shouldRetryHairColorWithSwatchFallback = ({
    error,
    referenceKind,
    swatchDataUrl
}) => {
    if (referenceKind !== "portrait" || !swatchDataUrl) {
        return false;
    }

    const promptBlocked = String(error?.promptBlocked || "").trim().toLowerCase();
    const providerFailureSummary = String(error?.providerFailureSummary || "").trim().toLowerCase();
    const errorText = getErrorText(error).toLowerCase();

    return [
        promptBlocked,
        providerFailureSummary,
        errorText
    ].some((value) => hasSafetyBlockSignal(value) || value.includes("did not return an image"));
};

const shouldRetryWithBlurredStyleReference = ({ error, filename }) => {
    if (!filename || !getBlurredStyleReferenceDataUrl(filename)) {
        return false;
    }

    const promptBlocked = String(error?.promptBlocked || "").trim().toLowerCase();
    const providerFailureSummary = String(error?.providerFailureSummary || "").trim().toLowerCase();
    const errorText = getErrorText(error).toLowerCase();

    return [
        promptBlocked,
        providerFailureSummary,
        errorText
    ].some((value) => hasSafetyBlockSignal(value) || value.includes("did not return an image"));
};

const writeGeneratedImage = (base64Data, mimeType, prefix) => {
    const extension = getExtensionFromMimeType(mimeType);
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const outputPath = path.join(generatedFolder, filename);

    fs.writeFileSync(outputPath, Buffer.from(base64Data, "base64"));
    return filename;
};

const getMimeTypeFromRemoteImage = (imageUrl, fallbackMimeType = "image/png") => {
    try {
        const pathname = new URL(imageUrl).pathname;
        const inferredMimeType = getMimeTypeFromFilename(pathname);

        return inferredMimeType.startsWith("image/") ? inferredMimeType : fallbackMimeType;
    } catch (_error) {
        return fallbackMimeType;
    }
};

const fetchRemoteImageAsDataUrl = async(imageUrl) => {
    const normalizedImageUrl = String(imageUrl || "").trim();

    if (!normalizedImageUrl) {
        throw createPublicError(
            "We couldn't finish that image. Please try again.",
            502,
            "fal.ai returned an empty image URL."
        );
    }

    if (isImageDataUrl(normalizedImageUrl)) {
        return normalizedImageUrl;
    }

    const response = await fetch(normalizedImageUrl);

    if (!response.ok) {
        throw createPublicError(
            "We couldn't finish that image. Please try again.",
            502,
            `Failed to download generated fal.ai image (${response.status}).`
        );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeTypeHeader = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const mimeType = mimeTypeHeader.startsWith("image/") ?
        mimeTypeHeader :
        getMimeTypeFromRemoteImage(normalizedImageUrl);

    return `data:${mimeType};base64,${buffer.toString("base64")}`;
};

const createFalProviderError = ({
    responseStatus,
    responseBody,
    prompt,
    savePrefix,
    publicMessage = "We couldn't create this look right now.",
    category = "fal-image-response-error",
    failureLabel = "fal.ai image generation failed",
    model = FAL_TEMPLATE_MODEL_ID
}) => {
    const serializedBody = typeof responseBody === "string" ?
        responseBody.trim() :
        JSON.stringify(responseBody || {});
    const internalMessage = `${failureLabel} (${responseStatus}). ${serializedBody}`.trim();
    const error = createPublicError(
        publicMessage,
        Number(responseStatus || 502),
        internalMessage
    );
    error.providerFailureSummary = serializedBody;
    writeImageGeneratorLog({
        level: "ERROR",
        category,
        message: `${failureLabel}.`,
        data: {
            timestamp: new Date().toISOString(),
            requestLabel: savePrefix || "",
            provider: "fal.ai",
            model,
            prompt: String(prompt || ""),
            status: Number(responseStatus || 0),
            response: responseBody || ""
        }
    });
    return error;
};

const generateImageWithFal = async({
    imageBase64,
    prompt,
    savePrefix,
    referenceImageDataUrl = "",
    referenceImageDataUrls = [],
    referenceFilename = "",
    useFacialFit = false,
    model = FAL_TEMPLATE_MODEL_ID,
    publicErrorMessage = "We couldn't create this look right now.",
    logCategory = "fal-image",
    logMessageLabel = "image generation"
}) => {
    assertImageDataUrl(imageBase64);
    const normalizedReferenceImages = [...referenceImageDataUrls];

    if (referenceImageDataUrl) {
        normalizedReferenceImages.unshift(referenceImageDataUrl);
    }

    normalizedReferenceImages.forEach((referenceImage) => {
        assertImageDataUrl(referenceImage, "Please choose a valid reference image and try again.");
    });

    if (TEST_MODE) {
        writeImageGeneratorLog({
            level: "WARN",
            category: `${logCategory}-skipped`,
            message: `fal.ai ${logMessageLabel} was skipped because TEST_MODE is enabled.`,
            data: {
                timestamp: new Date().toISOString(),
                provider: "fal.ai",
                model,
                requestLabel: savePrefix || "",
                prompt: String(prompt || ""),
                imageCount: 1 + normalizedReferenceImages.length,
                images: summarizeImagePayloadsForLog([imageBase64, ...normalizedReferenceImages])
            }
        });

        return {
            imageUrl: imageBase64,
            savedFile: null,
            testMode: true
        };
    }

    const falApiKey = getFalApiKey();
    const requestStartedAt = Date.now();
    let effectiveImageBase64 = imageBase64;

    if (FACIAL_FIT_ENABLED && useFacialFit && normalizedReferenceImages[0]) {
        try {
            const facialFitResult = await runFacialFit({
                sourceImageBase64: imageBase64,
                referenceImageDataUrl: normalizedReferenceImages[0],
                referenceFilename,
                savePrefix
            });
            effectiveImageBase64 = facialFitResult.imageBase64;

            writeImageGeneratorLog({
                level: "INFO",
                category: "facial-fit",
                message: `Applied Facial Fit to the source image before fal.ai ${logMessageLabel}.`,
                data: facialFitResult.metadata
            });
        } catch (error) {
            writeAppLog({
                level: "WARN",
                category: "facial-fit",
                message: `Facial Fit failed before fal.ai ${logMessageLabel}. Falling back to the original source image.`,
                data: {
                    requestLabel: savePrefix || "",
                    error: serializeErrorForLog(error)
                }
            });
            writeImageGeneratorLog({
                level: "WARN",
                category: "facial-fit",
                message: `Facial Fit failed before fal.ai ${logMessageLabel}. Falling back to the original source image.`,
                data: {
                    requestLabel: savePrefix || "",
                    error: serializeErrorForLog(error)
                }
            });
        }
    }

    const requestPayload = {
        prompt,
        image_urls: [effectiveImageBase64, ...normalizedReferenceImages],
        num_images: 1,
        aspect_ratio: "auto",
        output_format: "webp",
        safety_tolerance: "6",
        resolution: FAL_TEMPLATE_RESOLUTION,
        thinking_level: FAL_IMAGE_THINKING_LEVEL,
        limit_generations: true,
        enable_web_search: false
    };

    let lastError = null;

    for (let attemptNumber = 1; attemptNumber <= IMAGE_GENERATION_MAX_ATTEMPTS; attemptNumber += 1) {
        writeImageGeneratorLog({
            level: "INFO",
            category: `${logCategory}-request`,
            message: `Sending ${logMessageLabel} request to fal.ai.`,
            data: {
                timestamp: new Date().toISOString(),
                provider: "fal.ai",
                model,
                requestLabel: savePrefix || "",
                attemptNumber,
                maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                prompt: String(prompt || ""),
                imageCount: 1 + normalizedReferenceImages.length,
                images: summarizeImagePayloadsForLog([effectiveImageBase64, ...normalizedReferenceImages]),
                input: {
                    num_images: requestPayload.num_images,
                    aspect_ratio: requestPayload.aspect_ratio,
                    output_format: requestPayload.output_format,
                    safety_tolerance: requestPayload.safety_tolerance,
                    resolution: requestPayload.resolution,
                    thinking_level: requestPayload.thinking_level,
                    limit_generations: requestPayload.limit_generations,
                    enable_web_search: requestPayload.enable_web_search
                }
            }
        });

        try {
            const response = await fetch(`https://fal.run/${model}`, {
                method: "POST",
                headers: {
                    "Authorization": `Key ${falApiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(requestPayload)
            });

            const responseText = await response.text();
            let responseBody = null;

            try {
                responseBody = responseText ? JSON.parse(responseText) : {};
            } catch (_error) {
                responseBody = responseText;
            }

            if (!response.ok) {
                throw createFalProviderError({
                    responseStatus: response.status,
                    responseBody,
                    prompt,
                    savePrefix,
                    publicMessage: publicErrorMessage,
                    category: `${logCategory}-response-error`,
                    failureLabel: `fal.ai ${logMessageLabel} failed`,
                    model
                });
            }

            const outputImageUrl = String(responseBody?.images?.[0]?.url || "").trim();

            if (!outputImageUrl) {
                throw createFalProviderError({
                    responseStatus: 502,
                    responseBody,
                    prompt,
                    savePrefix,
                    publicMessage: publicErrorMessage,
                    category: `${logCategory}-response-error`,
                    failureLabel: `fal.ai ${logMessageLabel} failed`,
                    model
                });
            }

            const imageDataUrl = await fetchRemoteImageAsDataUrl(outputImageUrl);
            const mimeType = getMimeTypeFromDataUrl(imageDataUrl);
            const savedFile = writeGeneratedImage(getBase64Payload(imageDataUrl), mimeType, savePrefix);
            const completedDurationMs = Date.now() - requestStartedAt;

            writeImageGeneratorLog({
                level: "INFO",
                category: `${logCategory}-response`,
                message: `Received ${logMessageLabel} response from fal.ai.`,
                data: {
                    timestamp: new Date().toISOString(),
                    provider: "fal.ai",
                    model,
                    requestLabel: savePrefix || "",
                    attemptNumber,
                    maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                    durationMs: completedDurationMs,
                    savedFile,
                    outputUrl: outputImageUrl,
                    description: String(responseBody?.description || "")
                }
            });

            recordGenerationTiming({
                requestLabel: savePrefix || "",
                savePrefix,
                durationMs: completedDurationMs,
                attemptNumber,
                referenceImageCount: normalizedReferenceImages.length,
                savedFile
            });

            return {
                imageUrl: imageDataUrl,
                savedFile,
                testMode: false
            };
        } catch (error) {
            lastError = error;
            const shouldRetry = attemptNumber < IMAGE_GENERATION_MAX_ATTEMPTS && shouldRetryImageGenerationRequest(error);

            if (shouldRetry) {
                writeAppLog({
                    level: "WARN",
                    category: `${logCategory}-retry`,
                    message: `Retrying fal.ai ${logMessageLabel} after a failed attempt.`,
                    data: {
                        requestLabel: savePrefix || "",
                        attemptNumber,
                        maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                        error: serializeErrorForLog(error)
                    }
                });
                writeImageGeneratorLog({
                    level: "WARN",
                    category: `${logCategory}-retry`,
                    message: `Retrying fal.ai ${logMessageLabel} after a failed attempt.`,
                    data: {
                        requestLabel: savePrefix || "",
                        attemptNumber,
                        maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                        error: serializeErrorForLog(error)
                    }
                });
                continue;
            }

            throw error;
        }
    }

    throw lastError || createPublicError(publicErrorMessage, 502, `fal.ai ${logMessageLabel} failed without a recoverable response.`);
};

const generateTemplateImageWithFal = async(options) => generateImageWithFal({
    ...options,
    model: FAL_TEMPLATE_MODEL_ID,
    publicErrorMessage: "We couldn't create this look right now.",
    logCategory: "fal-template",
    logMessageLabel: "template generation"
});

const generateBackViewImageWithFal = async(options) => generateImageWithFal({
    ...options,
    model: FAL_BACK_VIEW_MODEL_ID,
    publicErrorMessage: "We couldn't create this view right now.",
    logCategory: "fal-back-view",
    logMessageLabel: "back-view generation"
});

const generateRandomImageWithFal = async(options) => generateImageWithFal({
    ...options,
    model: FAL_TEMPLATE_MODEL_ID,
    publicErrorMessage: "We couldn't create this look right now.",
    logCategory: "fal-random",
    logMessageLabel: "random hairstyle generation"
});

const generatePromptVariationImageWithFal = async(options) => generateImageWithFal({
    ...options,
    model: FAL_TEMPLATE_MODEL_ID,
    publicErrorMessage: "We couldn't create this variation right now.",
    logCategory: "fal-variation",
    logMessageLabel: "prompt variation generation"
});

const downloadHairSegmenterModel = async() => {
    const response = await fetch(hairSegmenterModelUrl);

    if (!response.ok) {
        throw new Error(`Failed to download hair segmenter model (${response.status}).`);
    }

    const modelBuffer = Buffer.from(await response.arrayBuffer());
    const tempPath = `${hairSegmenterModelPath}.tmp`;

    fs.writeFileSync(tempPath, modelBuffer);
    fs.renameSync(tempPath, hairSegmenterModelPath);
};

const ensureHairSegmenterModel = async() => {
    if (fs.existsSync(hairSegmenterModelPath)) {
        return hairSegmenterModelPath;
    }

    if (!hairSegmenterModelPromise) {
        hairSegmenterModelPromise = downloadHairSegmenterModel()
            .catch((error) => {
                hairSegmenterModelPromise = null;

                if (fs.existsSync(`${hairSegmenterModelPath}.tmp`)) {
                    fs.rmSync(`${hairSegmenterModelPath}.tmp`, { force: true });
                }

                throw error;
            })
            .finally(() => {
                hairSegmenterModelPromise = null;
            });
    }

    await hairSegmenterModelPromise;
    return hairSegmenterModelPath;
};

const saveDataUrlToFile = (dataUrl, filePath) => {
    assertImageDataUrl(dataUrl);
    const mimeType = getMimeTypeFromDataUrl(dataUrl);
    const base64Payload = getBase64Payload(dataUrl);

    fs.writeFileSync(filePath, Buffer.from(base64Payload, "base64"));
};

const readImageFileAsDataUrl = (filePath) => {
    const mimeType = getMimeTypeFromFilename(filePath);
    const base64Payload = fs.readFileSync(filePath).toString("base64");
    return `data:${mimeType};base64,${base64Payload}`;
};

const runFacialFit = async({
    sourceImageBase64,
    referenceImageDataUrl,
    referenceFilename = "",
    savePrefix = ""
}) => {
    if (!fs.existsSync(facialFitScriptPath)) {
        throw new Error("Facial fit script is missing.");
    }

    const jobDirectory = fs.mkdtempSync(path.join(generatedFolder, "facial-fit-"));
    const sourceExtension = getExtensionFromMimeType(getMimeTypeFromDataUrl(sourceImageBase64));
    const referenceExtension = getExtensionFromMimeType(getMimeTypeFromDataUrl(referenceImageDataUrl));
    const sourcePath = path.join(jobDirectory, `source.${sourceExtension}`);
    const referencePath = path.join(jobDirectory, `reference.${referenceExtension}`);
    const outputFilename = `${savePrefix || "facial-fit"}_zoomed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const outputPath = path.join(zoomedFolder, outputFilename);
    const startedAt = Date.now();
    const cachedReferenceGeometry = getCachedStyleFaceGeometry(referenceFilename);

    try {
        saveDataUrlToFile(sourceImageBase64, sourcePath);
        saveDataUrlToFile(referenceImageDataUrl, referencePath);

        const facialFitArgs = [
            sourcePath,
            referencePath,
            outputPath
        ];

        if (cachedReferenceGeometry?.geometryPath) {
            facialFitArgs.push("--reference-geometry", cachedReferenceGeometry.geometryPath);
        }

        const { stdout, stderr } = await runPythonScript(
            facialFitScriptPath,
            facialFitArgs,
            {
                cwd: __dirname,
                maxBuffer: 50 * 1024 * 1024,
                timeout: 120000
            }
        );

        if (stderr.trim()) {
            writeAppLog({
                level: "WARN",
                category: "facial-fit",
                message: "Facial fit wrote to stderr.",
                data: {
                    requestLabel: savePrefix || "",
                    stderr: stderr.trim()
                }
            });
        }

        const parsed = JSON.parse(stdout.trim());

        if (parsed.error) {
            throw new Error(parsed.error);
        }

        if (!fs.existsSync(outputPath)) {
            throw new Error("Facial fit did not produce an output image.");
        }

        const durationMs = Date.now() - startedAt;
        const outputUrl = `/zoomed/${encodeURIComponent(outputFilename)}`;

        console.log(`[Facial Fit] Zoom generated in ${durationMs}ms`);
        console.log(`[Facial Fit] Zoomed image saved at ${outputUrl}`);

        return {
            imageBase64: readImageFileAsDataUrl(outputPath),
            metadata: {
                requestLabel: savePrefix || "",
                referenceFilename: referenceFilename || "",
                durationMs,
                outputFilename,
                outputUrl,
                rawScale: Number(parsed.raw_scale || 0),
                appliedScale: Number(parsed.applied_scale || 0),
                referenceFaceSource: String(parsed.reference_face_source || ""),
                referenceGeometryPath: String(parsed.reference_geometry_path || cachedReferenceGeometry?.geometryPath || ""),
                sourceFace: parsed.source_face || null,
                referenceFace: parsed.reference_face || null,
                cachedReferenceGeometry: Boolean(cachedReferenceGeometry?.geometryPath)
            }
        };
    } finally {
        fs.rmSync(jobDirectory, { recursive: true, force: true });
    }
};

const runHairSegmentation = async({ imageBase64 }) => {
    if (!PYTHON_IMAGE_TOOLS_ENABLED) {
        throw createPublicError(
            "Hair tools are unavailable in this deployment right now.",
            503,
            "Python-backed image tools are disabled for this runtime."
        );
    }

    await ensureHairSegmenterModel();

    if (!fs.existsSync(hairSegmenterScriptPath)) {
        throw new Error("Hair segmentation script is missing.");
    }

    if (path.extname(hairSegmenterModelPath).toLowerCase() !== ".tflite") {
        throw new Error("Hair segmentation requires a .tflite model file.");
    }

    const jobDirectory = fs.mkdtempSync(path.join(generatedFolder, "hair-mask-"));
    const inputExtension = getExtensionFromMimeType(getMimeTypeFromDataUrl(imageBase64));
    const inputPath = path.join(jobDirectory, `source.${inputExtension}`);
    const outputPath = path.join(jobDirectory, "hair-mask.png");

    try {
        saveDataUrlToFile(imageBase64, inputPath);

        const { stdout, stderr } = await runPythonScript(
            hairSegmenterScriptPath,
            [
                inputPath,
                outputPath,
                "--model",
                hairSegmenterModelPath
            ],
            {
                cwd: __dirname,
                maxBuffer: 50 * 1024 * 1024,
                timeout: 120000
            }
        );

        if (stderr.trim()) {
            console.log("Hair segmentation stderr:", stderr.trim());
            writeAppLog({
                level: "WARN",
                category: "hair-segmentation",
                message: "Hair segmentation wrote to stderr.",
                data: {
                    stderr: stderr.trim()
                }
            });
        }

        const parsed = JSON.parse(stdout.trim());

        if (parsed.error) {
            throw new Error(parsed.error);
        }

        if (!parsed.image) {
            throw createPublicError(
                "We couldn't prepare the hair color tools right now. Please try again later.",
                503,
                "Hair segmentation did not return an image."
            );
        }

        return parsed.image;
    } catch (error) {
        const stderr = error.stderr ? String(error.stderr).trim() : "";

        if (stderr) {
            console.error("Hair segmentation stderr:", stderr);
            writeAppLog({
                level: "ERROR",
                category: "hair-segmentation",
                message: "Hair segmentation failed with stderr output.",
                data: {
                    stderr,
                    error: serializeErrorForLog(error)
                }
            });
        }

        throw createPublicError(
            "We couldn't prepare the hair color tools right now. Please try again later.",
            Number(error?.statusCode || 503),
            error.message || "Hair segmentation failed."
        );
    } finally {
        fs.rmSync(jobDirectory, { recursive: true, force: true });
    }
};

const runHairLengthAnalysis = async({ imageBase64 }) => {
    if (!PYTHON_IMAGE_TOOLS_ENABLED) {
        const error = new Error("Python-backed hair length analysis is disabled for this runtime.");
        error.code = "PYTHON_TOOLS_DISABLED";
        throw error;
    }

    await ensureHairSegmenterModel();

    if (!fs.existsSync(hairLengthAnalyzerScriptPath)) {
        throw new Error("Hair length analysis script is missing.");
    }

    const jobDirectory = fs.mkdtempSync(path.join(generatedFolder, "hair-length-"));
    const inputExtension = getExtensionFromMimeType(getMimeTypeFromDataUrl(imageBase64));
    const inputPath = path.join(jobDirectory, `source.${inputExtension}`);

    try {
        saveDataUrlToFile(imageBase64, inputPath);

        const { stdout, stderr } = await runPythonScript(
            hairLengthAnalyzerScriptPath,
            [
                inputPath,
                "--model",
                hairSegmenterModelPath
            ],
            {
                cwd: __dirname,
                maxBuffer: 50 * 1024 * 1024,
                timeout: 120000
            }
        );

        if (stderr.trim()) {
            writeAppLog({
                level: "WARN",
                category: "hair-length",
                message: "Hair length analysis wrote to stderr.",
                data: {
                    stderr: stderr.trim()
                }
            });
        }

        const parsed = JSON.parse(stdout.trim());

        if (parsed.error) {
            throw new Error(parsed.error);
        }

        if (!parsed.lengthCategory) {
            throw new Error("Hair length analysis did not return a category.");
        }

        return {
            lengthCategory: String(parsed.lengthCategory || "").trim().toLowerCase(),
            lengthLabel: String(parsed.lengthLabel || "").trim(),
            metrics: parsed.metrics || {}
        };
    } finally {
        fs.rmSync(jobDirectory, { recursive: true, force: true });
    }
};

const generateImageVariation = async({
    imageBase64,
    prompt,
    savePrefix,
    referenceImageDataUrl = "",
    referenceImageDataUrls = [],
    referenceFilename = "",
    useFacialFit = false,
    useTwoPassRefinement = false
}) => {
    const requestStartedAt = Date.now();
    const normalizedReferenceImages = [...referenceImageDataUrls];

    if (referenceImageDataUrl) {
        normalizedReferenceImages.unshift(referenceImageDataUrl);
    }

    if (TEST_MODE) {
        logImageGenerationRequest({
            prompt,
            imageBase64,
            referenceImageDataUrls: normalizedReferenceImages,
            savePrefix,
            attemptNumber: 1,
            maxAttempts: 1
        });
        return {
            imageUrl: imageBase64,
            savedFile: null,
            testMode: true
        };
    }

    let effectiveImageBase64 = imageBase64;

    if (FACIAL_FIT_ENABLED && useFacialFit && normalizedReferenceImages[0]) {
        try {
            const facialFitResult = await runFacialFit({
                sourceImageBase64: imageBase64,
                referenceImageDataUrl: normalizedReferenceImages[0],
                referenceFilename,
                savePrefix
            });
            effectiveImageBase64 = facialFitResult.imageBase64;

            writeImageGeneratorLog({
                level: "INFO",
                category: "facial-fit",
                message: "Applied Facial Fit to the source image before generation.",
                data: facialFitResult.metadata
            });
        } catch (error) {
            writeAppLog({
                level: "WARN",
                category: "facial-fit",
                message: "Facial Fit failed. Falling back to the original source image.",
                data: {
                    requestLabel: savePrefix || "",
                    error: serializeErrorForLog(error)
                }
            });
            writeImageGeneratorLog({
                level: "WARN",
                category: "facial-fit",
                message: "Facial Fit failed. Falling back to the original source image.",
                data: {
                    requestLabel: savePrefix || "",
                    error: serializeErrorForLog(error)
                }
            });
        }
    }

    assertImageDataUrl(effectiveImageBase64);
    const mimeType = getMimeTypeFromDataUrl(effectiveImageBase64);
    const base64Payload = getBase64Payload(effectiveImageBase64);
    const ai = getGoogleClient();
    // Gemini 3.1 Flash Image defaults to minimal thinking, so we pin High for every image flow.
    let effectiveThinkingLevel = DEFAULT_IMAGE_THINKING_LEVEL;

    normalizedReferenceImages
        .filter(Boolean)
        .forEach((referenceImage) => {
            assertImageDataUrl(referenceImage);
        });

    let lastError = null;

    for (let attemptNumber = 1; attemptNumber <= IMAGE_GENERATION_MAX_ATTEMPTS; attemptNumber += 1) {
        logImageGenerationRequest({
            prompt,
            imageBase64: effectiveImageBase64,
            referenceImageDataUrls: normalizedReferenceImages,
            savePrefix,
            attemptNumber,
            maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS
        });

        try {
            const contents = [
                { text: prompt },
                {
                    inlineData: {
                        mimeType,
                        data: base64Payload
                    }
                }
            ];

            normalizedReferenceImages
                .filter(Boolean)
                .forEach((referenceImage) => {
                    contents.push({
                        inlineData: {
                            mimeType: getMimeTypeFromDataUrl(referenceImage),
                            data: getBase64Payload(referenceImage)
                        }
                    });
                });

            const response = await ai.models.generateContent({
                model: MODEL_NAME,
                contents,
                config: {
                    responseModalities: ["TEXT", "IMAGE"],
                    ...(effectiveThinkingLevel ? {
                        thinkingConfig: {
                            thinkingLevel: effectiveThinkingLevel
                        }
                    } : {})
                }
            });

            const imagePart = extractInlineImage(response);

            if (!imagePart) {
                const failureSummary = summarizeGenerateContentFailure(response);
                console.warn("Image service returned no image.", failureSummary);
                logImageGenerationResponse({
                    savePrefix,
                    response,
                    imagePart: null,
                    failureSummary,
                    attemptNumber,
                    maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS
                });
                const error = createPublicError(
                    "We couldn't finish that image. Please try again.",
                    502,
                    `Image generation returned no image. ${failureSummary}`.trim()
                );
                error.providerFailureSummary = failureSummary;
                error.promptBlocked = String(response?.promptFeedback?.blockReason || "").trim().toUpperCase();
                error.promptBlockMessage = String(response?.promptFeedback?.blockReasonMessage || "").trim();
                throw error;
            }

            const savedFile = writeGeneratedImage(imagePart.data, imagePart.mimeType, savePrefix);
            const completedDurationMs = Date.now() - requestStartedAt;
            logImageGenerationResponse({
                savePrefix,
                response,
                imagePart,
                failureSummary: "",
                attemptNumber,
                maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS
            });
            recordGenerationTiming({
                requestLabel: savePrefix || "",
                savePrefix,
                durationMs: completedDurationMs,
                attemptNumber,
                referenceImageCount: normalizedReferenceImages.filter(Boolean).length,
                savedFile
            });
            writeImageGeneratorLog({
                level: "INFO",
                category: "generation-duration",
                message: "Recorded completed image generation timing.",
                data: {
                    requestLabel: savePrefix || "",
                    durationMs: completedDurationMs,
                    attemptNumber,
                    referenceImageCount: normalizedReferenceImages.filter(Boolean).length,
                    savedFile,
                    metricsFile: generationMetricsFile
                }
            });

            const firstPassResult = {
                imageUrl: `data:${imagePart.mimeType};base64,${imagePart.data}`,
                savedFile,
                testMode: false
            };

            if (TWO_PASS && useTwoPassRefinement) {
                const refinementPrompt = buildTwoPassHairFitPrompt();

                writeImageGeneratorLog({
                    level: "INFO",
                    category: "two-pass",
                    message: "Starting second-pass hair-fit refinement.",
                    data: {
                        requestLabel: savePrefix || "",
                        refinementPrompt,
                        firstPassSavedFile: savedFile
                    }
                });

                try {
                    const refinedResult = await generateImageVariation({
                        imageBase64: firstPassResult.imageUrl,
                        prompt: refinementPrompt,
                        savePrefix: `${savePrefix || "image"}-pass-2`,
                        useTwoPassRefinement: false
                    });

                    writeImageGeneratorLog({
                        level: "INFO",
                        category: "two-pass",
                        message: "Second-pass hair-fit refinement completed.",
                        data: {
                            requestLabel: savePrefix || "",
                            firstPassSavedFile: savedFile,
                            secondPassSavedFile: refinedResult.savedFile || null
                        }
                    });

                    return refinedResult;
                } catch (refinementError) {
                    writeAppLog({
                        level: "WARN",
                        category: "two-pass",
                        message: "Second-pass hair-fit refinement failed. Returning the first-pass image.",
                        data: {
                            requestLabel: savePrefix || "",
                            firstPassSavedFile: savedFile,
                            refinementPrompt,
                            error: serializeErrorForLog(refinementError)
                        }
                    });
                    writeImageGeneratorLog({
                        level: "WARN",
                        category: "two-pass",
                        message: "Second-pass hair-fit refinement failed. Returning the first-pass image.",
                        data: {
                            requestLabel: savePrefix || "",
                            firstPassSavedFile: savedFile,
                            error: serializeErrorForLog(refinementError)
                        }
                    });
                }
            }

            return firstPassResult;
        } catch (error) {
            lastError = error;

            if (shouldRetryWithoutThinkingConfig({ error, thinkingLevel: effectiveThinkingLevel })) {
                writeImageGeneratorLog({
                    level: "WARN",
                    category: "thinking-config",
                    message: "Retrying without explicit thinking configuration because the model rejected it.",
                    data: {
                        requestLabel: savePrefix || "",
                        model: MODEL_NAME,
                        rejectedThinkingLevel: effectiveThinkingLevel,
                        details: getErrorDetails(error)
                    }
                });
                effectiveThinkingLevel = "";
                continue;
            }

            const shouldRetry = attemptNumber < IMAGE_GENERATION_MAX_ATTEMPTS && shouldRetryImageGenerationRequest(error);

            if (shouldRetry) {
                const retryDelayMs = Math.min(4000, 800 * attemptNumber);
                logImageGenerationRetry({
                    prompt,
                    imageBase64: effectiveImageBase64,
                    referenceImageDataUrls: normalizedReferenceImages,
                    savePrefix,
                    error,
                    attemptNumber: attemptNumber + 1,
                    maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                    retryDelayMs
                });
                await delay(retryDelayMs);
                continue;
            }

            logImageGenerationError({
                prompt,
                imageBase64: effectiveImageBase64,
                referenceImageDataUrls: normalizedReferenceImages,
                savePrefix,
                error,
                attemptNumber,
                maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS
            });
            throw error;
        }
    }

    throw lastError || new Error("Image generation failed.");
};

const saveSalonPhoto = ({ salonSlug, imageBase64, originalName }) => {
    assertImageDataUrl(imageBase64, "Please choose a valid photo and try again.");
    const normalizedSalonSlug = sanitizeSalonSlug(salonSlug);
    const mimeType = getMimeTypeFromDataUrl(imageBase64);
    const base64Payload = getBase64Payload(imageBase64);

    const salonFolder = path.join(uploadsFolder, normalizedSalonSlug);
    ensureDirectory(salonFolder);

    const photoId = `${normalizedSalonSlug}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const extension = getExtensionFromMimeType(mimeType);
    const filename = `${photoId}.${extension}`;
    const filePath = path.join(salonFolder, filename);
    const storedAt = new Date().toISOString();

    fs.writeFileSync(filePath, Buffer.from(base64Payload, "base64"));

    const record = {
        id: photoId,
        salonSlug: normalizedSalonSlug,
        salonName: formatSalonName(normalizedSalonSlug),
        originalName: path.basename(originalName || filename),
        mimeType,
        storedAt,
        imageUrl: `/uploads/${encodeURIComponent(normalizedSalonSlug)}/${encodeURIComponent(filename)}`,
        imagePath: path.join("uploads", normalizedSalonSlug, filename).replace(/\\/g, "/")
    };

    fs.writeFileSync(path.join(salonFolder, `${photoId}.json`), JSON.stringify(record, null, 2));
    fs.writeFileSync(path.join(salonFolder, "latest.json"), JSON.stringify(record, null, 2));

    return record;
};

const getLatestSalonPhoto = (salonSlug) => {
    const normalizedSalonSlug = sanitizeSalonSlug(salonSlug);
    const latestRecordPath = path.join(uploadsFolder, normalizedSalonSlug, "latest.json");

    if (!fs.existsSync(latestRecordPath)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(latestRecordPath, "utf-8"));
};

const listRecentSalonPhotos = (salonSlug, { maxAgeMs = SALON_RECENT_PHOTO_WINDOW_MS } = {}) => {
    const normalizedSalonSlug = sanitizeSalonSlug(salonSlug);
    const salonFolder = path.join(uploadsFolder, normalizedSalonSlug);

    if (!fs.existsSync(salonFolder)) {
        return [];
    }

    const nowMs = Date.now();
    const recentPhotos = [];

    fs.readdirSync(salonFolder)
        .filter((filename) => filename.toLowerCase().endsWith(".json") && filename.toLowerCase() !== "latest.json")
        .forEach((filename) => {
            const recordPath = path.join(salonFolder, filename);

            try {
                const record = JSON.parse(fs.readFileSync(recordPath, "utf-8"));
                const storedAtMs = Date.parse(String(record?.storedAt || ""));

                if (!record?.imageUrl || Number.isNaN(storedAtMs)) {
                    return;
                }

                if (nowMs - storedAtMs > maxAgeMs) {
                    return;
                }

                recentPhotos.push(record);
            } catch (_error) {
                // Ignore malformed salon photo metadata files.
            }
        });

    return recentPhotos.sort((left, right) => Date.parse(String(right?.storedAt || "")) - Date.parse(String(left?.storedAt || "")));
};

app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        falAiUsed: FAL_AI_USED,
        model: MODEL_NAME,
        hasApiKey: Boolean(process.env.GEMINI_API_KEY),
        testMode: TEST_MODE,
        facialFit: FACIAL_FIT_ENABLED,
        pythonImageToolsEnabled: PYTHON_IMAGE_TOOLS_ENABLED
    });
});

app.get("/api/styles", (_req, res) => {
    res.json({
        styles: listTemplateStyles(),
        testMode: TEST_MODE
    });
});

app.post("/api/salons/:salonSlug/login", (req, res) => {
    const normalizedSalonSlug = sanitizeSalonSlug(req.params.salonSlug);
    const salonAccessRecord = getSalonAccessRecord(normalizedSalonSlug);

    if (!salonAccessRecord) {
        return res.status(404).json({ error: "Salon access is not configured for this location." });
    }

    const { username, password } = req.body || {};
    const normalizedUsername = String(username || "").trim();
    const normalizedPassword = String(password || "");

    if (!normalizedUsername || !normalizedPassword) {
        return res.status(400).json({ error: "Enter both the username and password." });
    }

    const isUsernameMatch = normalizedUsername === salonAccessRecord.username;
    const isPasswordMatch = verifySalonPassword(normalizedPassword, salonAccessRecord.password);

    if (!isUsernameMatch || !isPasswordMatch) {
        writeAppLog({
            level: "WARN",
            category: "salon-auth",
            message: "Rejected a salon login attempt.",
            data: {
                salonSlug: normalizedSalonSlug,
                username: normalizedUsername
            }
        });
        return res.status(401).json({ error: "That username or password did not match." });
    }

    writeCookie(
        res,
        SALON_SESSION_COOKIE_NAME,
        createSalonSessionCookieValue({
            salonSlug: normalizedSalonSlug,
            username: normalizedUsername
        })
    );

    res.json({
        ok: true,
        salonSlug: normalizedSalonSlug,
        salonName: salonAccessRecord.displayName
    });
});

app.post("/api/salons/:salonSlug/logout", (req, res) => {
    clearCookie(res, SALON_SESSION_COOKIE_NAME);
    res.json({ ok: true });
});

app.get("/api/salons/:salonSlug/photos/latest", (req, res) => {
    const photo = getLatestSalonPhoto(req.params.salonSlug);

    if (!photo) {
        return res.status(404).json({ error: "No photo has been uploaded for this salon yet." });
    }

    res.json({ photo });
});

app.get("/api/salons/:salonSlug/photos/recent", (req, res) => {
    const photos = listRecentSalonPhotos(req.params.salonSlug);
    res.json({
        photos,
        windowMinutes: Math.round(SALON_RECENT_PHOTO_WINDOW_MS / (1000 * 60))
    });
});

app.post("/api/salons/:salonSlug/photos", (req, res) => {
    try {
        const { imageBase64, originalName } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Please choose a photo first." });
        }

        const photo = saveSalonPhoto({
            salonSlug: req.params.salonSlug,
            imageBase64,
            originalName
        });

        res.status(201).json({ photo });
    } catch (error) {
        return respondWithPublicError(res, error, "Salon photo upload failed:", "We couldn't save that photo. Please try again.");
    }
});

app.post("/api/random-hairstyles", async(req, res) => {
    try {
        const { imageBase64, count: requestedCount } = req.body || {};
        const resultCount = Math.max(1, Math.min(RANDOM_HAIRSTYLE_RESULT_COUNT, Number(requestedCount || RANDOM_HAIRSTYLE_RESULT_COUNT) || RANDOM_HAIRSTYLE_RESULT_COUNT));

        if (!imageBase64) {
            return res.status(400).json({ error: "Please choose a photo first." });
        }

        let hairLengthAnalysis;

        try {
            hairLengthAnalysis = await runHairLengthAnalysis({ imageBase64 });
        } catch (error) {
            hairLengthAnalysis = {
                lengthCategory: "long",
                lengthLabel: "Unknown",
                metrics: {
                    fallback: true,
                    reason: String(error?.code || "").trim() || "analysis_failed"
                }
            };

            writeAppLog({
                level: "WARN",
                category: "hair-length",
                message: "Hair length analysis failed. Falling back to the full random hairstyle pool.",
                data: {
                    error: serializeErrorForLog(error),
                    fallbackLengthCategory: hairLengthAnalysis.lengthCategory
                }
            });
        }

        const selectedStyles = getEligibleRandomTemplateStyles({
            lengthCategory: hairLengthAnalysis.lengthCategory,
            count: resultCount
        });

        if (selectedStyles.length === 0) {
            return res.status(400).json({ error: "We couldn't find compatible hairstyle references for this photo." });
        }

        const results = await Promise.all(selectedStyles.map(async(style) => {
            const finalPrompt = buildRandomReferenceTransferPrompt();
            const blurredReferenceImageDataUrl = getBlurredStyleReferenceDataUrl(style.filename);
            const originalReferenceImageDataUrl = blurredReferenceImageDataUrl ? "" : getStyleReferenceDataUrl(style.filename);
            const initialReferenceImageDataUrl = blurredReferenceImageDataUrl || originalReferenceImageDataUrl;
            const initialReferenceImageVariant = blurredReferenceImageDataUrl ? "blurred" : "original";
            const attemptedReferenceVariants = [initialReferenceImageVariant];

            try {
                const runRandomAttempt = async(referenceImageDataUrl) => {
                    if (FAL_AI_USED) {
                        return generateRandomImageWithFal({
                            imageBase64,
                            prompt: finalPrompt,
                            savePrefix: style.id || normalizeStyleKey(style.filename),
                            referenceImageDataUrl,
                            referenceFilename: style.filename,
                            useFacialFit: true
                        });
                    }

                    return generateImageVariation({
                        imageBase64,
                        prompt: finalPrompt,
                        savePrefix: style.id || normalizeStyleKey(style.filename),
                        referenceImageDataUrl,
                        referenceFilename: style.filename,
                        useFacialFit: true,
                        useTwoPassRefinement: true
                    });
                };

                let result;
                let referenceImageVariant = initialReferenceImageVariant;

                try {
                    result = await runRandomAttempt(initialReferenceImageDataUrl);
                } catch (error) {
                    if (
                        initialReferenceImageVariant !== "original" ||
                        !shouldRetryWithBlurredStyleReference({
                            error,
                            filename: style.filename
                        })
                    ) {
                        throw error;
                    }

                    attemptedReferenceVariants.push("blurred");
                    result = await runRandomAttempt(getBlurredStyleReferenceDataUrl(style.filename));
                    referenceImageVariant = "blurred";
                }

                return {
                    id: style.id,
                    name: style.name,
                    sourcePrompt: style.prompt,
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode,
                    referenceImageUrl: style.imageUrl,
                    referenceImageVariant,
                    detectedHairLength: hairLengthAnalysis.lengthLabel
                };
            } catch (error) {
                const errorResponse = getPublicErrorResponse(error, "We couldn't create this look right now.");
                logGenerationFailure({
                    route: "/api/random-hairstyles",
                    stage: "hairstyle-option",
                    error,
                    context: {
                        hairstyleId: style.id || "",
                        hairstyleName: style.name || "",
                        sourcePrompt: style.prompt || "",
                        finalPrompt,
                        referenceFilename: style.filename || "",
                        attemptedReferenceVariants,
                        detectedHairLength: hairLengthAnalysis
                    }
                });
                return {
                    id: style.id,
                    name: style.name,
                    sourcePrompt: style.prompt,
                    errorMessage: errorResponse.message,
                    errorReason: errorResponse.reason || "",
                    errorDetails: errorResponse.details || "",
                    referenceImageUrl: style.imageUrl,
                    detectedHairLength: hairLengthAnalysis.lengthLabel
                };
            }
        }));

        res.json({
            results,
            detectedHairLength: hairLengthAnalysis,
            testMode: TEST_MODE
        });
    } catch (error) {
        return respondWithPublicError(res, error, "Random hairstyle generation failed:", "We couldn't create those hairstyle options right now. Please try again.");
    }
});

app.post("/api/template-hairstyles", async(req, res) => {
    try {
        const { imageBase64, templates, extraPrompt } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Please choose a photo first." });
        }

        if (!Array.isArray(templates) || templates.length === 0) {
            return res.status(400).json({ error: "Select at least one template." });
        }

        const results = await Promise.all(templates.map(async(template) => {
            const resolvedTemplate = getTemplateStyleByFilename(template.filename) || template;
            const finalPrompt = buildTemplateEditPrompt({
                templateName: resolvedTemplate.name,
                templatePrompt: resolvedTemplate.prompt,
                extraPrompt
            });
            const blurredReferenceImageDataUrl = getBlurredStyleReferenceDataUrl(resolvedTemplate.filename);
            const originalReferenceImageDataUrl = blurredReferenceImageDataUrl ? "" : getStyleReferenceDataUrl(resolvedTemplate.filename);
            const initialReferenceImageDataUrl = blurredReferenceImageDataUrl || originalReferenceImageDataUrl;
            const initialReferenceImageVariant = blurredReferenceImageDataUrl ? "blurred" : "original";
            const attemptedReferenceVariants = [initialReferenceImageVariant];

            try {
                const runTemplateAttempt = async(referenceImageDataUrl) => {
                    if (FAL_AI_USED) {
                        return generateTemplateImageWithFal({
                            imageBase64,
                            prompt: finalPrompt,
                            savePrefix: resolvedTemplate.id || normalizeStyleKey(resolvedTemplate.filename),
                            referenceImageDataUrl,
                            referenceFilename: resolvedTemplate.filename,
                            useFacialFit: true
                        });
                    }

                    return generateImageVariation({
                        imageBase64,
                        prompt: finalPrompt,
                        savePrefix: resolvedTemplate.id || normalizeStyleKey(resolvedTemplate.filename),
                        referenceImageDataUrl,
                        referenceFilename: resolvedTemplate.filename,
                        useFacialFit: true,
                        useTwoPassRefinement: true
                    });
                };

                let result;
                let referenceImageVariant = initialReferenceImageVariant;

                try {
                    result = await runTemplateAttempt(initialReferenceImageDataUrl);
                } catch (error) {
                    if (
                        initialReferenceImageVariant !== "original" ||
                        !shouldRetryWithBlurredStyleReference({
                            error,
                            filename: resolvedTemplate.filename
                        })
                    ) {
                        throw error;
                    }

                    console.warn(`Retrying template ${resolvedTemplate.filename} with blurred reference.`);
                    writeAppLog({
                        level: "WARN",
                        category: "generation-retry",
                        message: `Retrying template ${resolvedTemplate.filename} with blurred reference.`,
                        data: {
                            route: "/api/template-hairstyles",
                            templateFilename: resolvedTemplate.filename,
                            templateName: resolvedTemplate.name,
                            finalPrompt,
                            error: serializeErrorForLog(error)
                        }
                    });
                    attemptedReferenceVariants.push("blurred");
                    result = await runTemplateAttempt(getBlurredStyleReferenceDataUrl(resolvedTemplate.filename));
                    referenceImageVariant = "blurred";
                }

                return {
                    id: resolvedTemplate.id,
                    name: resolvedTemplate.name,
                    sourcePrompt: resolvedTemplate.prompt,
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode,
                    referenceImageUrl: resolvedTemplate.imageUrl,
                    referenceImageVariant
                };
            } catch (error) {
                const errorResponse = getPublicErrorResponse(error, "We couldn't create this look right now.");
                logGenerationFailure({
                    route: "/api/template-hairstyles",
                    stage: "template-option",
                    error,
                    context: {
                        templateId: resolvedTemplate.id || normalizeStyleKey(resolvedTemplate.filename),
                        templateFilename: resolvedTemplate.filename || template.filename || "",
                        templateName: resolvedTemplate.name || template.name || "",
                        sourcePrompt: resolvedTemplate.prompt || template.prompt || "",
                        finalPrompt,
                        extraPrompt: String(extraPrompt || ""),
                        attemptedReferenceVariants
                    }
                });
                return {
                    id: resolvedTemplate.id || template.id || normalizeStyleKey(template.filename),
                    name: resolvedTemplate.name || template.name || formatStyleName(template.filename),
                    sourcePrompt: resolvedTemplate.prompt || template.prompt || "",
                    errorMessage: errorResponse.message,
                    errorReason: errorResponse.reason || "",
                    errorDetails: errorResponse.details || ""
                };
            }
        }));

        res.json({ results, testMode: TEST_MODE });
    } catch (error) {
        return respondWithPublicError(res, error, "Template generation failed:", "We couldn't create those selected looks right now. Please try again.");
    }
});

app.post("/api/generated-hairstyle-views", async(req, res) => {
    try {
        const {
            imageBase64,
            referenceImageBase64,
            modifierImageBase64,
            lookName,
            lookDescription
        } = req.body || {};
        const normalizedReferenceImageBase64 = String(referenceImageBase64 || imageBase64 || "").trim();
        const normalizedModifierImageBase64 = String(modifierImageBase64 || "").trim();

        if (!normalizedReferenceImageBase64) {
            return res.status(400).json({ error: "Please choose an image first." });
        }

        if (!normalizedModifierImageBase64) {
            return res.status(400).json({ error: "Please choose a generated hairstyle result before continuing." });
        }

        if (!lookName) {
            return res.status(400).json({ error: "Please choose a hairstyle before continuing." });
        }

        const requestedView = {
            id: "left-back-view",
            name: "Left Back View",
            viewLabel: "left back",
            cameraAngle: "back left"
        };
        const finalPrompt = buildRearViewPrompt({
            viewLabel: requestedView.viewLabel,
            cameraAngle: requestedView.cameraAngle
        });
        let results;

        try {
            const result = FAL_AI_USED ?
                await generateBackViewImageWithFal({
                    imageBase64: normalizedReferenceImageBase64,
                    prompt: finalPrompt,
                    referenceImageDataUrls: [normalizedModifierImageBase64],
                    savePrefix: `${normalizeStyleKey(lookName)}-${requestedView.id}`,
                    useFacialFit: false
                }) :
                await generateImageVariation({
                    imageBase64: normalizedReferenceImageBase64,
                    prompt: finalPrompt,
                    referenceImageDataUrls: [normalizedModifierImageBase64],
                    savePrefix: `${normalizeStyleKey(lookName)}-${requestedView.id}`,
                    useTwoPassRefinement: false
                });

            results = [{
                id: requestedView.id,
                name: requestedView.name,
                sourcePrompt: lookDescription || "",
                imageUrl: result.imageUrl,
                savedFile: result.savedFile,
                testMode: result.testMode
            }];
        } catch (error) {
            const errorResponse = getPublicErrorResponse(error, "We couldn't create this view right now.");
            logGenerationFailure({
                route: "/api/generated-hairstyle-views",
                stage: "rear-view",
                error,
                context: {
                    provider: FAL_AI_USED ? "fal.ai" : IMAGE_PROVIDER_LABEL,
                    viewId: requestedView.id,
                    viewName: requestedView.name,
                    viewLabel: requestedView.viewLabel,
                    cameraAngle: requestedView.cameraAngle,
                    lookName,
                    lookDescription,
                    finalPrompt
                }
            });
            results = [{
                id: requestedView.id,
                name: requestedView.name,
                sourcePrompt: lookDescription || "",
                errorMessage: errorResponse.message,
                errorReason: errorResponse.reason || "",
                errorDetails: errorResponse.details || ""
            }];
        }

        res.json({ results, testMode: TEST_MODE });
    } catch (error) {
        return respondWithPublicError(res, error, "Rear-view generation failed:", "We couldn't create those additional views right now. Please try again.");
    }
});

app.post("/api/generated-hairstyle-variation", async(req, res) => {
    try {
        const {
            imageBase64,
            referenceImageBase64,
            modifierImageBase64,
            lookName,
            lookDescription,
            variationBaseName,
            variationSequence,
            extraPrompt,
            hairColorHex,
            hairColorLabel,
            hairColorReferenceImageBase64,
            hairColorReferenceFilename,
            hairColorReferenceKind,
            hairColorSwatchBase64
        } = req.body || {};
        const normalizedReferenceImageBase64 = String(referenceImageBase64 || imageBase64 || "").trim();
        const normalizedModifierImageBase64 = String(modifierImageBase64 || imageBase64 || "").trim();
        const normalizedExtraPrompt = String(extraPrompt || "").trim();
        const normalizedHairColorHex = String(hairColorHex || "").trim();
        const normalizedHairColorLabel = String(hairColorLabel || "").trim();
        const normalizedHairColorReferenceImageBase64 = String(hairColorReferenceImageBase64 || hairColorSwatchBase64 || "").trim();
        const normalizedHairColorReferenceFilename = String(hairColorReferenceFilename || "").trim();
        const normalizedHairColorSwatchBase64 = String(hairColorSwatchBase64 || "").trim();
        const normalizedHairColorReferenceKind = String(
            hairColorReferenceKind || (hairColorSwatchBase64 ? "swatch" : "")
        ).trim().toLowerCase();
        const blurredHairColorReferenceImageBase64 = normalizedHairColorReferenceKind === "portrait" &&
            normalizedHairColorReferenceFilename ?
            getBlurredStyleReferenceDataUrl(normalizedHairColorReferenceFilename) : "";
        const preferredHairColorReferenceImageBase64 = blurredHairColorReferenceImageBase64 || normalizedHairColorReferenceImageBase64;
        const isUsingBlurredHairColorReferenceByDefault = Boolean(blurredHairColorReferenceImageBase64);

        if (!normalizedReferenceImageBase64) {
            return res.status(400).json({ error: "Please choose an image first." });
        }

        if (!normalizedModifierImageBase64) {
            return res.status(400).json({ error: "Please choose a generated hairstyle result before continuing." });
        }

        if (!lookName) {
            return res.status(400).json({ error: "Please choose a hairstyle before continuing." });
        }

        if (!normalizedExtraPrompt && !normalizedHairColorHex && !preferredHairColorReferenceImageBase64) {
            return res.status(400).json({ error: "Add an extra prompt or choose a hair color before generating a variation." });
        }

        const promptVariationMetadata = getPromptVariationMetadata({
            lookName,
            variationBaseName,
            variationSequence
        });

        const runVariationAttempt = async(hairColorReferenceImageDataUrl, referenceKind) => {
            const isHairColorOnlyPrompt = !normalizedExtraPrompt && Boolean(
                normalizedHairColorHex ||
                normalizedHairColorLabel ||
                hairColorReferenceImageDataUrl
            );
            const hasHairColorRequest = Boolean(
                normalizedHairColorHex ||
                normalizedHairColorLabel ||
                hairColorReferenceImageDataUrl
            );
            const effectiveExtraPrompt = normalizedExtraPrompt || buildHairColorOnlyPrompt({
                hairColorHex: normalizedHairColorHex,
                hairColorLabel: normalizedHairColorLabel,
                hasHairColorReference: Boolean(hairColorReferenceImageDataUrl)
            });
            const finalPrompt = buildPromptVariationPrompt({
                extraPrompt: effectiveExtraPrompt,
                hairColorHex: normalizedHairColorHex,
                hairColorLabel: normalizedHairColorLabel,
                hasHairColorReference: Boolean(hairColorReferenceImageDataUrl),
                isHairColorOnlyPrompt
            });
            const result = FAL_AI_USED ?
                await generatePromptVariationImageWithFal({
                    imageBase64: normalizedReferenceImageBase64,
                    prompt: finalPrompt,
                    savePrefix: `${normalizeStyleKey(promptVariationMetadata.baseName)}-variation-${promptVariationMetadata.sequence}`,
                    referenceImageDataUrls: [
                        normalizedModifierImageBase64,
                        hairColorReferenceImageDataUrl
                    ].filter(Boolean),
                    referenceFilename: "",
                    useFacialFit: false
                }) :
                await generateImageVariation({
                    imageBase64: normalizedReferenceImageBase64,
                    prompt: finalPrompt,
                    savePrefix: `${normalizeStyleKey(promptVariationMetadata.baseName)}-variation-${promptVariationMetadata.sequence}`,
                    referenceImageDataUrls: [
                        normalizedModifierImageBase64,
                        hairColorReferenceImageDataUrl
                    ].filter(Boolean),
                    referenceFilename: "",
                    useFacialFit: false,
                    useTwoPassRefinement: !hasHairColorRequest
                });

            return {
                result,
                finalPrompt,
                referenceKindUsed: referenceKind || ""
            };
        };

        let variationAttempt;

        try {
            variationAttempt = await runVariationAttempt(
                preferredHairColorReferenceImageBase64,
                normalizedHairColorReferenceKind
            );
        } catch (error) {
            if (
                !isUsingBlurredHairColorReferenceByDefault &&
                normalizedHairColorReferenceKind === "portrait" &&
                normalizedHairColorReferenceFilename &&
                shouldRetryWithBlurredStyleReference({
                    error,
                    filename: normalizedHairColorReferenceFilename
                })
            ) {
                console.warn(`Retrying hair-color variation with blurred portrait reference ${normalizedHairColorReferenceFilename}.`);
                writeAppLog({
                    level: "WARN",
                    category: "generation-retry",
                    message: `Retrying hair-color variation with blurred portrait reference ${normalizedHairColorReferenceFilename}.`,
                    data: {
                        route: "/api/generated-hairstyle-variation",
                        lookName,
                        lookDescription,
                        extraPrompt: normalizedExtraPrompt,
                        hairColorHex: normalizedHairColorHex,
                        hairColorLabel: normalizedHairColorLabel,
                        hairColorReferenceFilename: normalizedHairColorReferenceFilename,
                        error: serializeErrorForLog(error)
                    }
                });
                variationAttempt = await runVariationAttempt(
                    getBlurredStyleReferenceDataUrl(normalizedHairColorReferenceFilename),
                    "portrait"
                );
            } else {
                if (!shouldRetryHairColorWithSwatchFallback({
                        error,
                        referenceKind: normalizedHairColorReferenceKind,
                        swatchDataUrl: normalizedHairColorSwatchBase64
                    })) {
                    throw error;
                }

                console.warn("Retrying hair-color variation with swatch fallback.");
                writeAppLog({
                    level: "WARN",
                    category: "generation-retry",
                    message: "Retrying hair-color variation with swatch fallback.",
                    data: {
                        route: "/api/generated-hairstyle-variation",
                        lookName,
                        lookDescription,
                        extraPrompt: normalizedExtraPrompt,
                        hairColorHex: normalizedHairColorHex,
                        hairColorLabel: normalizedHairColorLabel,
                        hairColorReferenceKind: normalizedHairColorReferenceKind,
                        error: serializeErrorForLog(error)
                    }
                });
                variationAttempt = await runVariationAttempt(
                    normalizedHairColorSwatchBase64,
                    "swatch"
                );
            }
        }

        res.json({
            result: {
                id: createPromptVariationResultId(promptVariationMetadata),
                name: promptVariationMetadata.displayName,
                variationBaseName: promptVariationMetadata.baseName,
                variationSequence: promptVariationMetadata.sequence,
                sourcePrompt: lookDescription || "",
                extraPrompt: normalizedExtraPrompt,
                hairColorHex: normalizedHairColorHex,
                hairColorLabel: normalizedHairColorLabel,
                hairColorReferenceKind: variationAttempt.referenceKindUsed,
                imageUrl: variationAttempt.result.imageUrl,
                savedFile: variationAttempt.result.savedFile,
                testMode: variationAttempt.result.testMode
            },
            testMode: TEST_MODE
        });
    } catch (error) {
        return respondWithPublicError(res, error, "Prompt variation generation failed:", "We couldn't create that variation right now. Please try again.");
    }
});

app.post("/api/hair-mask", async(req, res) => {
    try {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.set("Pragma", "no-cache");
        const { imageBase64 } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Please choose an image first." });
        }

        const image = await runHairSegmentation({ imageBase64 });
        res.json({ image });
    } catch (error) {
        return respondWithPublicError(res, error, "Hair segmentation failed:", "We couldn't prepare the hair color tools right now. Please try again later.");
    }
});

app.use("/api", (_req, res) => {
    res.status(404).json({
        error: "That API route was not found.",
        reason: "api_route_not_found",
        details: "The requested API endpoint does not exist."
    });
});

app.use((error, _req, res, next) => {
    if (!error) {
        return next();
    }

    return respondWithPublicError(
        res,
        error,
        "Unhandled request error:",
        "We couldn't process that request. Please try again."
    );
});

app.use("/uploads", express.static(uploadsFolder));

app.get("/:salonSlug/takeimage", (_req, res) => {
    res.sendFile(path.join(__dirname, "takeimage.html"));
});

app.get("/:salonSlug", (req, res) => {
    const normalizedSalonSlug = sanitizeSalonSlug(req.params.salonSlug);

    if (!getSalonAccessRecord(normalizedSalonSlug)) {
        return res.status(404).send("Salon access is not configured for this location.");
    }

    if (getAuthenticatedSalonSession(req, normalizedSalonSlug)) {
        return res.sendFile(path.join(__dirname, "index.html"));
    }

    return res.sendFile(path.join(__dirname, "salon-login.html"));
});

app.use((_req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Logs available at ${appLogFile}, ${imageGeneratorLogFile}, and ${imageGeneratorErrorLogFile}`);
    writeAppLog({
        level: "INFO",
        category: "server",
        message: "Server started.",
        data: {
            port: PORT,
            model: MODEL_NAME,
            testMode: TEST_MODE,
            twoPass: TWO_PASS,
            facialFit: FACIAL_FIT_ENABLED,
            pythonImageToolsEnabled: PYTHON_IMAGE_TOOLS_ENABLED,
            appLogFile,
            imageGeneratorLogFile,
            imageGeneratorErrorLogFile,
            generationMetricsFile
        }
    });

    if (TEST_MODE) {
        const testModeMessage = "TEST_MODE is enabled. External image-generation requests are skipped and the original image is returned.";
        console.warn(testModeMessage);
        writeAppLog({
            level: "WARN",
            category: "server",
            message: testModeMessage,
            data: {
                testMode: true
            }
        });
    }
});
