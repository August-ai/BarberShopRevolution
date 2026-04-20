import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
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
const generatedFolder = path.join(__dirname, "generated");
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
const stylesMetadataFile = path.join(stylesFolder, "hairstyles.json");
const stylesDescriptionFile = path.join(stylesFolder, "hairstyles.txt");
const faceGeometryManifestFile = path.join(faceGeometryFolder, "manifest.json");
const hairSegmenterModelPath = path.join(modelsFolder, "hair_segmenter.tflite");
const hairSegmenterScriptPath = path.join(scriptsFolder, "segment_hair.py");
const facialFitScriptPath = path.join(scriptsFolder, "facial_fit.py");
const hairSegmenterModelUrl = "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite";
const pythonCommand = process.env.PYTHON_BIN || "python";
const execFileAsync = promisify(execFile);
const IMAGE_GENERATION_MAX_ATTEMPTS = Math.max(1, Number(process.env.IMAGE_GENERATION_MAX_ATTEMPTS || 3));

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
const TWO_PASS = parseBooleanEnv(
    process.env.TWO_PASS ?? process.env.TwoPass,
    false
);
const FACIAL_FIT = parseBooleanEnv(
    process.env.FACIAL_FIT ?? process.env.FacialFit,
    false
);

const ensureDirectory = (folderPath) => {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
};

ensureDirectory(generatedFolder);
ensureDirectory(logsFolder);
ensureDirectory(modelsFolder);
ensureDirectory(uploadsFolder);
ensureDirectory(faceGeometryFolder);
ensureDirectory(zoomedFolder);

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

const shouldDisableThinkingConfigForModel = (modelName) => /image-preview/i.test(String(modelName || ""));

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

    const metadata = loadStyleMetadata();
    const descriptions = loadStyleDescriptions();

    return fs.readdirSync(stylesFolder)
        .filter(isImageFile)
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

const buildHairstyleEditPrompt = ({ hairstyleName, hairstylePrompt }) => {
    return [
        "Use the uploaded portrait as the source image.",
        "Keep the exact same person.",
        "Preserve facial features, skin tone, expression, camera angle, pose, clothing, and background.",
        "Only change the hairstyle.",
        "The new hairstyle cannot have hair longer than in the current image provided.",
        naturalLightingInstruction,
        "Make it realistic and fitting well important!",
        "Make the result photorealistic, flattering, and salon quality.",
        `Target hairstyle name: ${hairstyleName}.`,
        `Target hairstyle description: ${hairstylePrompt}`
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

const buildTemplateEditPrompt = ({ extraPrompt }) => buildPrecisionHairSwapPrompt({
    specificHairDescription: extraPrompt
});

const buildRearViewPrompt = ({ lookName, lookDescription, angleLabel }) => {
    return [
        "Use the provided hairstyle image as the source image.",
        "Keep the exact same person and the exact same hairstyle from the source image.",
        "Preserve the haircut shape, length, layering, texture, density, and hair color.",
        "Keep the background unchanged.",
        "Do not redesign the hairstyle or change the person's identity.",
        naturalLightingInstruction,
        "Make it realistic and fitting well important!",
        "Create a photorealistic salon-quality result.",
        `Rotate the viewpoint to show a ${angleLabel} of the hairstyle.`,
        "Make the back shape, layers, perimeter, and nape area clearly visible.",
        "Keep the styling polished and believable, as if photographed naturally from that new angle.",
        `Current hairstyle name: ${lookName}.`,
        lookDescription ? `Current hairstyle description: ${lookDescription}` : ""
    ].filter(Boolean).join(" ");
};

const buildPromptVariationPrompt = ({
    lookName,
    lookDescription,
    extraPrompt,
    hairColorHex,
    hairColorLabel,
    hasHairColorReference,
    hairColorReferenceKind = "",
    isHairColorOnlyPrompt = false
}) => {
    if (isHairColorOnlyPrompt) {
        return extraPrompt;
    }

    if (hasHairColorReference && hairColorReferenceKind === "portrait") {
        return [
            buildPrecisionHairSwapPrompt({
                specificHairDescription: extraPrompt
            }),
            hairColorLabel ? `Requested hair color name: ${hairColorLabel}.` : "",
            hairColorHex ? `Requested hair color value: ${hairColorHex}.` : ""
        ].filter(Boolean).join(" ");
    }

    return [
        "Edit image 1 only.", !hasHairColorReference ?
        "Keep the same person and background in image 1. Only refine the hair realistically so it fits well." :
        "",
        hasHairColorReference && hairColorReferenceKind !== "portrait" ?
        "Match only the hair color in image 1 to image 2 and keep everything else in image 1 the same." :
        "",
        naturalLightingInstruction,
        hairColorLabel ? `Requested hair color name: ${hairColorLabel}.` : "",
        hairColorHex ? `Requested hair color value: ${hairColorHex}.` : "",
        extraPrompt ? `Additional prompt: ${extraPrompt}` : ""
    ].filter(Boolean).join(" ");
};

const buildHairColorOnlyPrompt = ({
    hairColorHex,
    hairColorLabel,
    hasHairColorReference,
    hairColorReferenceKind = ""
}) => {
    if (hasHairColorReference) {
        return [
            "Edit image 1 only. Match only the hair color in image 2 to image 1 and keep everything else in image 1 the same.",
            "Same person and same hairstyle as the original image 1, only the hair color is changed.",
            naturalLightingInstruction
        ].join(" ");
    }

    return [
        "Change the subject's hair color to the requested color.",
        "Keep everything else in image 1 the same, including the person, hairstyle shape, and background.",
        naturalLightingInstruction,
        "Make it realistic and fitting well important!",
        hairColorLabel ? `Requested hair color name: ${hairColorLabel}.` : "",
        hairColorHex ? `Requested hair color value: ${hairColorHex}.` : ""
    ].filter(Boolean).join(" ");
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

    if (hasSafetyBlockSignal(combinedMessage)) {
        return {
            statusCode: 422,
            message: "The image service blocked this request. Try a different photo, reference image, or prompt.",
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
            facialFitScriptPath,
            sourcePath,
            referencePath,
            outputPath
        ];

        if (cachedReferenceGeometry?.geometryPath) {
            facialFitArgs.push("--reference-geometry", cachedReferenceGeometry.geometryPath);
        }

        const { stdout, stderr } = await execFileAsync(
            pythonCommand,
            facialFitArgs, {
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

        const { stdout, stderr } = await execFileAsync(
            pythonCommand, [
                hairSegmenterScriptPath,
                inputPath,
                outputPath,
                "--model",
                hairSegmenterModelPath
            ], {
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

const generateImageVariation = async({
    imageBase64,
    prompt,
    savePrefix,
    referenceImageDataUrl = "",
    referenceImageDataUrls = [],
    referenceFilename = "",
    useFacialFit = false,
    thinkingLevel = "",
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

    if (FACIAL_FIT && useFacialFit && normalizedReferenceImages[0]) {
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
    let effectiveThinkingLevel = shouldDisableThinkingConfigForModel(MODEL_NAME) ? "" : thinkingLevel;

    if (thinkingLevel && !effectiveThinkingLevel) {
        writeImageGeneratorLog({
            level: "INFO",
            category: "thinking-config",
            message: "Skipping explicit thinking configuration because the current image model does not support it.",
            data: {
                requestLabel: savePrefix || "",
                model: MODEL_NAME,
                requestedThinkingLevel: thinkingLevel
            }
        });
    }

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

app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        model: MODEL_NAME,
        hasApiKey: Boolean(process.env.GEMINI_API_KEY),
        testMode: TEST_MODE,
        facialFit: FACIAL_FIT
    });
});

app.get("/api/styles", (_req, res) => {
    res.json({
        styles: listTemplateStyles(),
        testMode: TEST_MODE
    });
});

app.get("/api/salons/:salonSlug/photos/latest", (req, res) => {
    const photo = getLatestSalonPhoto(req.params.salonSlug);

    if (!photo) {
        return res.status(404).json({ error: "No photo has been uploaded for this salon yet." });
    }

    res.json({ photo });
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
        const { imageBase64, hairstyles } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Please choose a photo first." });
        }

        if (!Array.isArray(hairstyles) || hairstyles.length !== 5) {
            return res.status(400).json({ error: "Please choose five hairstyle directions and try again." });
        }

        const results = [];

        for (const hairstyle of hairstyles) {
            const finalPrompt = buildHairstyleEditPrompt({
                hairstyleName: hairstyle.name,
                hairstylePrompt: hairstyle.prompt
            });

            try {
                const result = await generateImageVariation({
                    imageBase64,
                    prompt: finalPrompt,
                    savePrefix: hairstyle.id || "hairstyle",
                    useTwoPassRefinement: true
                });

                results.push({
                    id: hairstyle.id,
                    name: hairstyle.name,
                    sourcePrompt: hairstyle.prompt,
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode
                });
            } catch (error) {
                const errorResponse = getPublicErrorResponse(error, "We couldn't create this look right now.");
                logGenerationFailure({
                    route: "/api/random-hairstyles",
                    stage: "hairstyle-option",
                    error,
                    context: {
                        hairstyleId: hairstyle.id || "",
                        hairstyleName: hairstyle.name || "",
                        sourcePrompt: hairstyle.prompt || "",
                        finalPrompt
                    }
                });
                results.push({
                    id: hairstyle.id,
                    name: hairstyle.name,
                    sourcePrompt: hairstyle.prompt,
                    errorMessage: errorResponse.message,
                    errorReason: errorResponse.reason || "",
                    errorDetails: errorResponse.details || ""
                });
            }
        }

        res.json({ results, testMode: TEST_MODE });
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

        const results = [];

        for (const template of templates) {
            const resolvedTemplate = getTemplateStyleByFilename(template.filename) || template;
            const finalPrompt = buildTemplateEditPrompt({
                templateName: resolvedTemplate.name,
                templatePrompt: resolvedTemplate.prompt,
                extraPrompt
            });
            const attemptedReferenceVariants = ["original"];

            try {
                const runTemplateAttempt = async(referenceImageDataUrl) => generateImageVariation({
                    imageBase64,
                    prompt: finalPrompt,
                    savePrefix: resolvedTemplate.id || normalizeStyleKey(resolvedTemplate.filename),
                    referenceImageDataUrl,
                    referenceFilename: resolvedTemplate.filename,
                    useFacialFit: true,
                    useTwoPassRefinement: true
                });

                let result;
                let referenceImageVariant = "original";

                try {
                    result = await runTemplateAttempt(getStyleReferenceDataUrl(resolvedTemplate.filename));
                } catch (error) {
                    if (!shouldRetryWithBlurredStyleReference({
                            error,
                            filename: resolvedTemplate.filename
                        })) {
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

                results.push({
                    id: resolvedTemplate.id,
                    name: resolvedTemplate.name,
                    sourcePrompt: resolvedTemplate.prompt,
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode,
                    referenceImageUrl: resolvedTemplate.imageUrl,
                    referenceImageVariant
                });
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
                results.push({
                    id: resolvedTemplate.id || template.id || normalizeStyleKey(template.filename),
                    name: resolvedTemplate.name || template.name || formatStyleName(template.filename),
                    sourcePrompt: resolvedTemplate.prompt || template.prompt || "",
                    errorMessage: errorResponse.message,
                    errorReason: errorResponse.reason || "",
                    errorDetails: errorResponse.details || ""
                });
            }
        }

        res.json({ results, testMode: TEST_MODE });
    } catch (error) {
        return respondWithPublicError(res, error, "Template generation failed:", "We couldn't create those selected looks right now. Please try again.");
    }
});

app.post("/api/generated-hairstyle-views", async(req, res) => {
    try {
        const { imageBase64, lookName, lookDescription } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Please choose an image first." });
        }

        if (!lookName) {
            return res.status(400).json({ error: "Please choose a hairstyle before continuing." });
        }

        const requestedViews = [{
                id: "left-back-view",
                name: "Left Back View",
                angleLabel: "left-back three-quarter view"
            },
            {
                id: "right-back-view",
                name: "Right Back View",
                angleLabel: "right-back three-quarter view"
            }
        ];

        const results = [];

        for (const view of requestedViews) {
            const finalPrompt = buildRearViewPrompt({
                lookName,
                lookDescription,
                angleLabel: view.angleLabel
            });

            try {
                const result = await generateImageVariation({
                    imageBase64,
                    prompt: finalPrompt,
                    savePrefix: `${normalizeStyleKey(lookName)}-${view.id}`,
                    useTwoPassRefinement: false
                });

                results.push({
                    id: view.id,
                    name: view.name,
                    sourcePrompt: lookDescription || "",
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode
                });
            } catch (error) {
                const errorResponse = getPublicErrorResponse(error, "We couldn't create this view right now.");
                logGenerationFailure({
                    route: "/api/generated-hairstyle-views",
                    stage: "rear-view",
                    error,
                    context: {
                        viewId: view.id,
                        viewName: view.name,
                        angleLabel: view.angleLabel,
                        lookName,
                        lookDescription,
                        finalPrompt
                    }
                });
                results.push({
                    id: view.id,
                    name: view.name,
                    sourcePrompt: lookDescription || "",
                    errorMessage: errorResponse.message,
                    errorReason: errorResponse.reason || "",
                    errorDetails: errorResponse.details || ""
                });
            }
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
            lookName,
            lookDescription,
            extraPrompt,
            hairColorHex,
            hairColorLabel,
            hairColorReferenceImageBase64,
            hairColorReferenceFilename,
            hairColorReferenceKind,
            hairColorSwatchBase64
        } = req.body || {};
        const normalizedExtraPrompt = String(extraPrompt || "").trim();
        const normalizedHairColorHex = String(hairColorHex || "").trim();
        const normalizedHairColorLabel = String(hairColorLabel || "").trim();
        const normalizedHairColorReferenceImageBase64 = String(hairColorReferenceImageBase64 || hairColorSwatchBase64 || "").trim();
        const normalizedHairColorReferenceFilename = String(hairColorReferenceFilename || "").trim();
        const normalizedHairColorSwatchBase64 = String(hairColorSwatchBase64 || "").trim();
        const normalizedHairColorReferenceKind = String(
            hairColorReferenceKind || (hairColorSwatchBase64 ? "swatch" : "")
        ).trim().toLowerCase();

        if (!imageBase64) {
            return res.status(400).json({ error: "Please choose an image first." });
        }

        if (!lookName) {
            return res.status(400).json({ error: "Please choose a hairstyle before continuing." });
        }

        if (!normalizedExtraPrompt && !normalizedHairColorHex && !normalizedHairColorReferenceImageBase64) {
            return res.status(400).json({ error: "Add an extra prompt or choose a hair color before generating a variation." });
        }

        const runVariationAttempt = async(referenceImageDataUrl, referenceKind) => {
            const isHairColorOnlyPrompt = !normalizedExtraPrompt && Boolean(
                normalizedHairColorHex ||
                normalizedHairColorLabel ||
                referenceImageDataUrl
            );
            const hasHairColorRequest = Boolean(
                normalizedHairColorHex ||
                normalizedHairColorLabel ||
                referenceImageDataUrl
            );
            const effectiveExtraPrompt = normalizedExtraPrompt || buildHairColorOnlyPrompt({
                hairColorHex: normalizedHairColorHex,
                hairColorLabel: normalizedHairColorLabel,
                hasHairColorReference: Boolean(referenceImageDataUrl),
                hairColorReferenceKind: referenceKind
            });
            const finalPrompt = buildPromptVariationPrompt({
                lookName,
                lookDescription,
                extraPrompt: effectiveExtraPrompt,
                hairColorHex: normalizedHairColorHex,
                hairColorLabel: normalizedHairColorLabel,
                hasHairColorReference: Boolean(referenceImageDataUrl),
                hairColorReferenceKind: referenceKind,
                isHairColorOnlyPrompt
            });
            const result = await generateImageVariation({
                imageBase64,
                prompt: finalPrompt,
                savePrefix: `${normalizeStyleKey(lookName)}-variation`,
                referenceImageDataUrls: referenceImageDataUrl ? [referenceImageDataUrl] : [],
                referenceFilename: referenceKind === "portrait" ? normalizedHairColorReferenceFilename : "",
                useFacialFit: referenceKind === "portrait",
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
                normalizedHairColorReferenceImageBase64,
                normalizedHairColorReferenceKind
            );
        } catch (error) {
            if (
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
                id: `${normalizeStyleKey(lookName)}-variation`,
                name: `${lookName} Prompt Variation`,
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
            facialFit: FACIAL_FIT,
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
