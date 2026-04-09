import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3013);
const MODEL_NAME = process.env.NANO_BANANA_MODEL || "gemini-3.1-flash-image-preview";
const generatedFolder = path.join(__dirname, "generated");
const uploadsFolder = path.join(__dirname, "uploads");
const stylesFolder = path.join(__dirname, "styles");
const stylesDescriptionFile = path.join(stylesFolder, "hairstyles.txt");
const TEST_MODE = process.env.NANO_BANANA_TEST_MODE !== "false";

const ensureDirectory = (folderPath) => {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
};

ensureDirectory(generatedFolder);
ensureDirectory(uploadsFolder);

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

    const descriptions = loadStyleDescriptions();

    return fs.readdirSync(stylesFolder)
        .filter(isImageFile)
        .sort((left, right) => left.localeCompare(right))
        .map((filename) => {
            const baseKey = normalizeStyleKey(filename);
            const prompt = descriptions.get(filename.toLowerCase())
                || descriptions.get(baseKey)
                || `Use the reference image to recreate the hairstyle shown in ${formatStyleName(filename)}.`;

            return {
                id: baseKey,
                filename,
                name: formatStyleName(filename),
                prompt,
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

const extractInlineImage = (response) => {
    const parts = response?.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
        if (part?.inlineData?.data) {
            return {
                mimeType: part.inlineData.mimeType || "image/png",
                data: part.inlineData.data
            };
        }
    }

    return null;
};

const writeGeneratedImage = (base64Data, mimeType, prefix) => {
    const extension = mimeType === "image/jpeg" ? "jpg" : "png";
    const filename = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const outputPath = path.join(generatedFolder, filename);

    fs.writeFileSync(outputPath, Buffer.from(base64Data, "base64"));
    return filename;
};

const generateImageVariation = async({ imageBase64, prompt, savePrefix, referenceImageDataUrl = "" }) => {
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

    if (referenceImageDataUrl) {
        contents.push({
            inlineData: {
                mimeType: getMimeTypeFromDataUrl(referenceImageDataUrl),
                data: getBase64Payload(referenceImageDataUrl)
            }
        });
    }

    const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents
    });

    const imagePart = extractInlineImage(response);

    if (!imagePart) {
        throw new Error("Nano Banana did not return an image.");
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
