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
const modelsFolder = path.join(__dirname, "models");
const scriptsFolder = path.join(__dirname, "scripts");
const uploadsFolder = path.join(__dirname, "uploads");
const stylesFolder = path.join(__dirname, "styles");
const stylesMetadataFile = path.join(stylesFolder, "hairstyles.json");
const stylesDescriptionFile = path.join(stylesFolder, "hairstyles.txt");
const hairSegmenterModelPath = path.join(modelsFolder, "hair_segmenter.tflite");
const hairSegmenterScriptPath = path.join(scriptsFolder, "segment_hair.py");
const hairSegmenterModelUrl = "https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite";
const pythonCommand = process.env.PYTHON_BIN || "python";
const execFileAsync = promisify(execFile);

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

const ensureDirectory = (folderPath) => {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
};

ensureDirectory(generatedFolder);
ensureDirectory(modelsFolder);
ensureDirectory(uploadsFolder);

let hairSegmenterModelPromise = null;

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(__dirname));

const getGoogleClient = () => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("Missing GEMINI_API_KEY environment variable.");
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
                    item.aliases.map((alias) => String(alias || "").trim()).filter(Boolean) :
                    []
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

const getStyleReferenceDataUrl = (filename) => {
    const filePath = path.join(stylesFolder, filename);

    if (!fs.existsSync(filePath)) {
        throw new Error(`Template image not found: ${filename}`);
    }

    const mimeType = getMimeTypeFromFilename(filename);
    const base64Data = fs.readFileSync(filePath).toString("base64");
    return `data:${mimeType};base64,${base64Data}`;
};

const buildHairstyleEditPrompt = ({ hairstyleName, hairstylePrompt }) => {
    return [
        "Use the uploaded portrait as the source image.",
        "Keep the exact same person.",
        "Preserve facial features, skin tone, expression, camera angle, pose, clothing, and background.",
        "Only change the hairstyle.",
        "Make the result photorealistic, flattering, and salon quality.",
        `Target hairstyle name: ${hairstyleName}.`,
        `Target hairstyle description: ${hairstylePrompt}`
    ].join(" ");
};

const buildTemplateEditPrompt = ({ templateName, templatePrompt, extraPrompt }) => {
    return [
        "Use the uploaded portrait as the source image.",
        "Keep the exact same person.",
        "Preserve facial features, skin tone, expression, camera angle, pose, clothing, and background.",
        "Change only the hairstyle.",
        "Use the reference template image as the hairstyle guide.",
        "Match the reference hairstyle shape, length, texture, and color as closely as possible.",
        "Keep the result photorealistic, flattering, and salon quality.",
        `Template hairstyle name: ${templateName}.`,
        `Template hairstyle description: ${templatePrompt}`,
        extraPrompt ? `Additional prompt: ${extraPrompt}` : ""
    ].filter(Boolean).join(" ");
};

const buildRearViewPrompt = ({ lookName, lookDescription, angleLabel }) => {
    return [
        "Use the provided hairstyle image as the source image.",
        "Keep the exact same person and the exact same hairstyle from the source image.",
        "Preserve the haircut shape, length, layering, texture, density, and hair color.",
        "Do not redesign the hairstyle or change the person's identity.",
        "Create a photorealistic salon-quality result.",
        `Rotate the viewpoint to show a ${angleLabel} of the hairstyle.`,
        "Make the back shape, layers, perimeter, and nape area clearly visible.",
        "Keep the styling polished and believable, as if photographed naturally from that new angle.",
        `Current hairstyle name: ${lookName}.`,
        lookDescription ? `Current hairstyle description: ${lookDescription}` : ""
    ].filter(Boolean).join(" ");
};

const buildPromptVariationPrompt = ({ lookName, lookDescription, extraPrompt, hairColorHex, hasHairColorReference }) => {
    return [
        "Use the provided hairstyle image as the source image.",
        "Keep the exact same person.",
        "Keep the hairstyle closely related to the selected look unless the additional prompt requests a clear refinement.",
        "Preserve salon-quality realism and a flattering, believable result.",
        "Keep the framing suitable for comparing the new image beside the original selected result.",
        hasHairColorReference ? "Use the additional color swatch image only as the target hair color reference. Match the hair color to that swatch while preserving the haircut shape, length, and styling unless the prompt asks otherwise." : "",
        `Current hairstyle name: ${lookName}.`,
        lookDescription ? `Current hairstyle description: ${lookDescription}` : "",
        hairColorHex ? `Requested hair color swatch: ${hairColorHex}.` : "",
        extraPrompt ? `Additional prompt: ${extraPrompt}` : ""
    ].filter(Boolean).join(" ");
};

const buildHairColorOnlyPrompt = ({ hairColorHex, hasHairColorReference }) => {
    return [
        hasHairColorReference
            ? "Change the subject's hair color to match the provided color swatch."
            : "Change the subject's hair color to the requested color.",
        "Keep the exact same person, haircut shape, hairstyle length, and styling.",
        hairColorHex ? `Requested hair color: ${hairColorHex}.` : ""
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
    const mimeType = getMimeTypeFromDataUrl(dataUrl);
    const base64Payload = getBase64Payload(dataUrl);

    if (!mimeType.startsWith("image/")) {
        throw new Error("Only image inputs can be segmented.");
    }

    if (!base64Payload) {
        throw new Error("Missing image payload for segmentation.");
    }

    fs.writeFileSync(filePath, Buffer.from(base64Payload, "base64"));
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
            pythonCommand,
            [
                hairSegmenterScriptPath,
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
        }

        const parsed = JSON.parse(stdout.trim());

        if (parsed.error) {
            throw new Error(parsed.error);
        }

        if (!parsed.image) {
            throw new Error("Hair segmentation did not return an image.");
        }

        return parsed.image;
    } catch (error) {
        const stderr = error.stderr ? String(error.stderr).trim() : "";

        if (stderr) {
            console.error("Hair segmentation stderr:", stderr);
        }

        throw new Error(error.message || "Hair segmentation failed.");
    } finally {
        fs.rmSync(jobDirectory, { recursive: true, force: true });
    }
};

const generateImageVariation = async({ imageBase64, prompt, savePrefix, referenceImageDataUrl = "", referenceImageDataUrls = [] }) => {
    if (TEST_MODE) {
        return {
            imageUrl: imageBase64,
            savedFile: null,
            testMode: true
        };
    }

    const mimeType = getMimeTypeFromDataUrl(imageBase64);
    const ai = getGoogleClient();
    const contents = [
        { text: prompt },
        {
            inlineData: {
                mimeType,
                data: getBase64Payload(imageBase64)
            }
        }
    ];
    const normalizedReferenceImages = [...referenceImageDataUrls];

    if (referenceImageDataUrl) {
        normalizedReferenceImages.unshift(referenceImageDataUrl);
    }

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
            responseModalities: ["TEXT", "IMAGE"]
        }
    });

    const imagePart = extractInlineImage(response);

    if (!imagePart) {
        const failureSummary = summarizeGenerateContentFailure(response);
        console.warn("Nano Banana returned no image.", failureSummary);
        throw new Error(`Nano Banana did not return an image. ${failureSummary}`.trim());
    }

    const savedFile = writeGeneratedImage(imagePart.data, imagePart.mimeType, savePrefix);

    return {
        imageUrl: `data:${imagePart.mimeType};base64,${imagePart.data}`,
        savedFile,
        testMode: false
    };
};

const saveSalonPhoto = ({ salonSlug, imageBase64, originalName }) => {
    const normalizedSalonSlug = sanitizeSalonSlug(salonSlug);
    const mimeType = getMimeTypeFromDataUrl(imageBase64);
    const base64Payload = getBase64Payload(imageBase64);

    if (!mimeType.startsWith("image/")) {
        throw new Error("Only image uploads are supported.");
    }

    if (!base64Payload) {
        throw new Error("Missing image payload.");
    }

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
        testMode: TEST_MODE
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
            return res.status(400).json({ error: "Missing source image." });
        }

        const photo = saveSalonPhoto({
            salonSlug: req.params.salonSlug,
            imageBase64,
            originalName
        });

        res.status(201).json({ photo });
    } catch (error) {
        console.error("Salon photo upload failed:", error);
        res.status(500).json({ error: error.message || "Photo upload failed." });
    }
});

app.post("/api/random-hairstyles", async(req, res) => {
    try {
        const { imageBase64, hairstyles } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Missing source image." });
        }

        if (!Array.isArray(hairstyles) || hairstyles.length !== 5) {
            return res.status(400).json({ error: "Expected exactly 5 hairstyle prompts." });
        }

        const results = [];

        for (const hairstyle of hairstyles) {
            try {
                const finalPrompt = buildHairstyleEditPrompt({
                    hairstyleName: hairstyle.name,
                    hairstylePrompt: hairstyle.prompt
                });
                const result = await generateImageVariation({
                    imageBase64,
                    prompt: finalPrompt,
                    savePrefix: hairstyle.id || "hairstyle"
                });

                results.push({
                    id: hairstyle.id,
                    name: hairstyle.name,
                    sourcePrompt: hairstyle.prompt,
                    finalPrompt,
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode
                });
            } catch (error) {
                results.push({
                    id: hairstyle.id,
                    name: hairstyle.name,
                    sourcePrompt: hairstyle.prompt,
                    finalPrompt: buildHairstyleEditPrompt({
                        hairstyleName: hairstyle.name,
                        hairstylePrompt: hairstyle.prompt
                    }),
                    errorMessage: error.message
                });
            }
        }

        res.json({ results, testMode: TEST_MODE });
    } catch (error) {
        console.error("Nano Banana generation failed:", error);
        res.status(500).json({ error: error.message || "Image generation failed." });
    }
});

app.post("/api/template-hairstyles", async(req, res) => {
    try {
        const { imageBase64, templates, extraPrompt } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Missing source image." });
        }

        if (!Array.isArray(templates) || templates.length === 0) {
            return res.status(400).json({ error: "Select at least one template." });
        }

        const results = [];

        for (const template of templates) {
            try {
                const resolvedTemplate = getTemplateStyleByFilename(template.filename) || template;
                const finalPrompt = buildTemplateEditPrompt({
                    templateName: resolvedTemplate.name,
                    templatePrompt: resolvedTemplate.prompt,
                    extraPrompt
                });
                const referenceImageDataUrl = getStyleReferenceDataUrl(resolvedTemplate.filename);
                const result = await generateImageVariation({
                    imageBase64,
                    prompt: finalPrompt,
                    savePrefix: resolvedTemplate.id || normalizeStyleKey(resolvedTemplate.filename),
                    referenceImageDataUrl
                });

                results.push({
                    id: resolvedTemplate.id,
                    name: resolvedTemplate.name,
                    sourcePrompt: resolvedTemplate.prompt,
                    finalPrompt,
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode,
                    referenceImageUrl: resolvedTemplate.imageUrl
                });
            } catch (error) {
                results.push({
                    id: template.id || normalizeStyleKey(template.filename),
                    name: template.name || formatStyleName(template.filename),
                    sourcePrompt: template.prompt || "",
                    finalPrompt: buildTemplateEditPrompt({
                        templateName: template.name || formatStyleName(template.filename),
                        templatePrompt: template.prompt || "",
                        extraPrompt
                    }),
                    errorMessage: error.message
                });
            }
        }

        res.json({ results, testMode: TEST_MODE });
    } catch (error) {
        console.error("Template generation failed:", error);
        res.status(500).json({ error: error.message || "Template generation failed." });
    }
});

app.post("/api/generated-hairstyle-views", async(req, res) => {
    try {
        const { imageBase64, lookName, lookDescription } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Missing selected generated image." });
        }

        if (!lookName) {
            return res.status(400).json({ error: "Missing hairstyle name." });
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
                    savePrefix: `${normalizeStyleKey(lookName)}-${view.id}`
                });

                results.push({
                    id: view.id,
                    name: view.name,
                    sourcePrompt: lookDescription || "",
                    finalPrompt,
                    imageUrl: result.imageUrl,
                    savedFile: result.savedFile,
                    testMode: result.testMode
                });
            } catch (error) {
                results.push({
                    id: view.id,
                    name: view.name,
                    sourcePrompt: lookDescription || "",
                    finalPrompt,
                    errorMessage: error.message
                });
            }
        }

        res.json({ results, testMode: TEST_MODE });
    } catch (error) {
        console.error("Rear-view generation failed:", error);
        res.status(500).json({ error: error.message || "Rear-view generation failed." });
    }
});

app.post("/api/generated-hairstyle-variation", async(req, res) => {
    try {
        const { imageBase64, lookName, lookDescription, extraPrompt, hairColorHex, hairColorSwatchBase64 } = req.body || {};
        const normalizedExtraPrompt = String(extraPrompt || "").trim();
        const normalizedHairColorHex = String(hairColorHex || "").trim();
        const normalizedHairColorSwatchBase64 = String(hairColorSwatchBase64 || "").trim();

        if (!imageBase64) {
            return res.status(400).json({ error: "Missing selected generated image." });
        }

        if (!lookName) {
            return res.status(400).json({ error: "Missing hairstyle name." });
        }

        if (!normalizedExtraPrompt && !normalizedHairColorHex && !normalizedHairColorSwatchBase64) {
            return res.status(400).json({ error: "Add an extra prompt or choose a hair color before generating a variation." });
        }

        const effectiveExtraPrompt = normalizedExtraPrompt || buildHairColorOnlyPrompt({
            hairColorHex: normalizedHairColorHex,
            hasHairColorReference: Boolean(normalizedHairColorSwatchBase64)
        });
        const finalPrompt = buildPromptVariationPrompt({
            lookName,
            lookDescription,
            extraPrompt: effectiveExtraPrompt,
            hairColorHex: normalizedHairColorHex,
            hasHairColorReference: Boolean(normalizedHairColorSwatchBase64)
        });
        const result = await generateImageVariation({
            imageBase64,
            prompt: finalPrompt,
            savePrefix: `${normalizeStyleKey(lookName)}-variation`,
            referenceImageDataUrls: normalizedHairColorSwatchBase64 ? [normalizedHairColorSwatchBase64] : []
        });

        res.json({
            result: {
                id: `${normalizeStyleKey(lookName)}-variation`,
                name: `${lookName} Prompt Variation`,
                sourcePrompt: lookDescription || "",
                finalPrompt,
                extraPrompt: normalizedExtraPrompt,
                hairColorHex: normalizedHairColorHex,
                imageUrl: result.imageUrl,
                savedFile: result.savedFile,
                testMode: result.testMode
            },
            testMode: TEST_MODE
        });
    } catch (error) {
        console.error("Prompt variation generation failed:", error);
        res.status(500).json({ error: error.message || "Prompt variation generation failed." });
    }
});

app.post("/api/hair-mask", async(req, res) => {
    try {
        res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
        res.set("Pragma", "no-cache");
        const { imageBase64 } = req.body || {};

        if (!imageBase64) {
            return res.status(400).json({ error: "Missing image for hair segmentation." });
        }

        const image = await runHairSegmentation({ imageBase64 });
        res.json({ image });
    } catch (error) {
        console.error("Hair segmentation failed:", error);
        res.status(500).json({ error: error.message || "Hair segmentation failed." });
    }
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
});
