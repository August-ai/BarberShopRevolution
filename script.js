const captureButton = document.getElementById("captureButton");
const photoInput = document.getElementById("photoInput");
const captureStep = document.getElementById("captureStep");
const previewPanel = document.getElementById("previewPanel");
const photoPreview = document.getElementById("photoPreview");
const retakeButton = document.getElementById("retakeButton");
const nextButton = document.getElementById("nextButton");
const optionPanel = document.getElementById("optionPanel");
const randomButton = document.getElementById("randomButton");
const templateButton = document.getElementById("templateButton");
const templatePanel = document.getElementById("templatePanel");
const templateGrid = document.getElementById("templateGrid");
const templatePrompt = document.getElementById("templatePrompt");
const templateBackButton = document.getElementById("templateBackButton");
const templateNextButton = document.getElementById("templateNextButton");
const templateNextDock = document.getElementById("templateNextDock");
const templateCount = document.getElementById("templateCount");
const templateFilterToggle = document.getElementById("templateFilterToggle");
const templateFilterContent = document.getElementById("templateFilterContent");
const templateFilterBar = document.getElementById("templateFilterBar");
const templateFilterSummary = document.getElementById("templateFilterSummary");
const templateFilterReset = document.getElementById("templateFilterReset");
const generationPanel = document.getElementById("generationPanel");
const generationProgressCard = document.getElementById("generationProgressCard");
const generationProgressImage = document.getElementById("generationProgressImage");
const generationProgressKicker = document.getElementById("generationProgressKicker");
const generationProgressTitle = document.getElementById("generationProgressTitle");
const generationProgressText = document.getElementById("generationProgressText");
const resultGrid = document.getElementById("resultGrid");
const statusMessage = document.getElementById("statusMessage");
const heroCard = document.querySelector(".hero-card");
const lightbox = document.getElementById("lightbox");
const lightboxImageShell = document.getElementById("lightboxImageShell");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxMarkupCanvas = document.getElementById("lightboxMarkupCanvas");
const lightboxDrawButton = document.getElementById("lightboxDrawButton");
const lightboxEraseButton = document.getElementById("lightboxEraseButton");
const lightboxClose = document.getElementById("lightboxClose");
const generationLabel = document.getElementById("generationLabel");
const generationTitle = document.getElementById("generationTitle");
const lightboxTitle = document.getElementById("lightboxTitle");
const lightboxDescription = document.getElementById("lightboxDescription");
const lightboxLoadingOverlay = document.getElementById("lightboxLoadingOverlay");
const lightboxLoadingTitle = document.getElementById("lightboxLoadingTitle");
const lightboxLoadingText = document.getElementById("lightboxLoadingText");
const generateViewsButton = document.getElementById("generateViewsButton");
const viewStatusMessage = document.getElementById("viewStatusMessage");
const variationPromptInput = document.getElementById("variationPromptInput");
const generateVariationButton = document.getElementById("generateVariationButton");
const variationStatusMessage = document.getElementById("variationStatusMessage");
const variationHairColorToggle = document.getElementById("variationHairColorToggle");
const variationHairColorPanel = document.getElementById("variationHairColorPanel");
const variationHairColorPalette = document.getElementById("variationHairColorPalette");
const variationHairColorMore = document.getElementById("variationHairColorMore");
const variationHairColorCustom = document.getElementById("variationHairColorCustom");
const variationHairColorInput = document.getElementById("variationHairColorInput");
const variationHairColorReset = document.getElementById("variationHairColorReset");
const variationHairColorNote = document.getElementById("variationHairColorNote");
const promptVariationSection = document.getElementById("promptVariationSection");
const promptVariationGrid = document.getElementById("promptVariationGrid");
const viewResultsSection = document.getElementById("viewResultsSection");
const viewResultsGrid = document.getElementById("viewResultsGrid");

const hairstyleLibrary = Array.isArray(window.HAIRSTYLE_PROMPTS) ? window.HAIRSTYLE_PROMPTS : [];
const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3013" : "";
const CAPTURED_PHOTO_STORAGE_KEY = "capturedSalonPhoto";
const currentPathSegments = window.location.pathname.split("/").filter(Boolean);
const currentSalonSlug = decodeURIComponent(currentPathSegments[0] || "");
const TEMPLATE_FILTER_DEFINITIONS = [
  { id: "length", label: "Length", allLabel: "All Lengths" },
  { id: "style", label: "Style", allLabel: "All Styles" },
  { id: "fringe", label: "Fringe", allLabel: "All Fringe Types" },
  { id: "color", label: "Color", allLabel: "All Colors" }
];

const createEmptyTemplateFilters = () => Object.fromEntries(
  TEMPLATE_FILTER_DEFINITIONS.map((definition) => [definition.id, ""])
);
const DEFAULT_VARIATION_HAIR_COLOR = "#9b5b4b";
const LIGHTBOX_MARKUP_COLOR = "#d62f2f";
const LIGHTBOX_MARKUP_DRAW_SIZE = 4;
const LIGHTBOX_MARKUP_ERASE_SIZE = 18;
const COMMON_HAIR_COLORS = [
  {
    hex: "#171311",
    label: "Black",
    imageUrl: "/styles/sleek-center-part-lob.jpg"
  },
  {
    hex: "#5a3a2d",
    label: "Brunette",
    imageUrl: "/styles/extra-long-layered-blowout-with-face-framing-volume.jpg"
  },
  {
    hex: "#8b603d",
    label: "Highlighted Brunette",
    imageUrl: "/styles/medium-brown-long-bob-with-highlighted-face-framing-layers.jpg"
  },
  {
    hex: "#e0c27a",
    label: "Blonde",
    imageUrl: "/styles/side-part-textured-french-bob.jpg"
  },
  {
    hex: "#f0d89d",
    label: "Highlighted Blonde",
    imageUrl: "/styles/textured-lob-with-bold-money-piece-highlights.webp"
  },
  {
    hex: "#bc4a34",
    label: "Red",
    imageUrl: "/styles/Redhair_shoulderHair.png"
  }
];

let previewUrl = "";
let isGenerating = false;
let templateStyles = [];
let templateMetadataCatalogPromise = null;
let selectedTemplateIds = new Set();
let selectedImage = null;
let activeLightboxResult = null;
let activeTemplateFilters = createEmptyTemplateFilters();
let areTemplateFiltersVisible = false;
let activeLightboxMarkupTool = null;
let activeLightboxMarkupStroke = null;
let isVariationHairColorPanelVisible = false;
let isVariationHairColorCustomVisible = false;
let selectedVariationHairColor = "";
const lightboxMarkupStore = new Map();
const loadedHairColorPreviewUrls = new Set();

const resolveHairColorPreviewUrl = (color) => (
  color.imageUrl.startsWith("http") ? color.imageUrl : `${API_BASE_URL}${color.imageUrl}`
);

const preloadCommonHairColorImages = () => {
  COMMON_HAIR_COLORS.forEach((color) => {
    const resolvedImageUrl = resolveHairColorPreviewUrl(color);

    if (loadedHairColorPreviewUrls.has(resolvedImageUrl)) {
      return;
    }

    const previewImage = new Image();
    const markLoaded = () => {
      loadedHairColorPreviewUrls.add(resolvedImageUrl);
    };

    previewImage.decoding = "async";
    previewImage.src = resolvedImageUrl;

    if (previewImage.complete) {
      markLoaded();
      return;
    }

    previewImage.addEventListener("load", markLoaded, { once: true });
  });
};

const syncTemplateNextButtonVisibility = () => {
  const shouldShow = !templatePanel.classList.contains("is-hidden");
  const hasSelectedTemplates = selectedTemplateIds.size > 0;
  const shouldDisable = isGenerating || !hasSelectedTemplates;

  templateNextDock.classList.toggle("is-hidden", !shouldShow);
  templateNextDock.setAttribute("aria-hidden", shouldShow ? "false" : "true");
  templateNextButton.classList.toggle("is-muted", shouldDisable);
  templateNextButton.disabled = shouldDisable;
};

const scrollToGenerationPanel = () => {
  const scrollToTarget = (behavior) => {
    const target = !generationProgressCard.classList.contains("is-hidden")
      ? generationProgressCard
      : resultGrid.querySelector(".result-card") || generationPanel;

    const targetTop = Math.max(0, window.scrollY + target.getBoundingClientRect().top - 8);

    target.scrollIntoView({
      behavior,
      block: "start"
    });

    window.scrollTo({
      top: targetTop,
      behavior
    });
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToTarget("smooth");
      window.setTimeout(() => {
        scrollToTarget("smooth");
      }, 260);
      window.setTimeout(() => {
        scrollToTarget("smooth");
      }, 620);
    });
  });
};

const scrollToResultBatch = (targetElement) => {
  if (!targetElement) {
    return;
  }

  const scrollToTarget = (behavior) => {
    const targetTop = Math.max(0, window.scrollY + targetElement.getBoundingClientRect().top - 18);

    targetElement.scrollIntoView({
      behavior,
      block: "start"
    });

    window.scrollTo({
      top: targetTop,
      behavior
    });
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToTarget("smooth");
      window.setTimeout(() => {
        scrollToTarget("smooth");
      }, 240);
    });
  });
};

const setVariationHairColorCustomVisibility = (visible) => {
  isVariationHairColorCustomVisible = visible;
  variationHairColorCustom.classList.toggle("is-hidden", !visible);
  variationHairColorMore.setAttribute("aria-expanded", String(visible));
  variationHairColorMore.textContent = visible ? "Less" : "More";

  if (activeLightboxResult) {
    activeLightboxResult.isVariationHairColorCustomPanelOpen = visible;
  }
};

const isCommonHairColor = (hexColor) => {
  const normalizedHex = String(hexColor || "").trim().toUpperCase();
  return COMMON_HAIR_COLORS.some((color) => color.hex.toUpperCase() === normalizedHex);
};

const getCommonHairColorOption = (hexColor) => {
  const normalizedHex = String(hexColor || "").trim().toUpperCase();
  return COMMON_HAIR_COLORS.find((color) => color.hex.toUpperCase() === normalizedHex) || null;
};

const getVariationHairColorLabel = (hexColor) => {
  const match = getCommonHairColorOption(hexColor);
  return match ? match.label : "Custom";
};

const getVariationHairColorRequestLabel = (hexColor) => {
  const normalizedHex = String(hexColor || "").trim().toUpperCase();

  if (!normalizedHex) {
    return "";
  }

  const match = getCommonHairColorOption(normalizedHex);
  return match ? match.label : `Custom color ${normalizedHex}`;
};

const setSelectedVariationHairColor = (hexColor) => {
  selectedVariationHairColor = String(hexColor || "").trim();

  if (activeLightboxResult) {
    activeLightboxResult.lastVariationHairColorHex = selectedVariationHairColor;
    activeLightboxResult.isVariationHairColorCustomPanelOpen = isVariationHairColorCustomVisible;
  }
};

const renderVariationHairColorPalette = () => {
  variationHairColorPalette.innerHTML = "";

  COMMON_HAIR_COLORS.forEach((color) => {
    const swatchButton = document.createElement("button");
    const swatchMedia = document.createElement("span");
    const previewImage = document.createElement("img");
    const swatchCopy = document.createElement("span");
    const swatchLabel = document.createElement("span");
    const swatchValue = document.createElement("span");
    swatchButton.type = "button";
    swatchButton.className = `lightbox-hair-color-swatch${selectedVariationHairColor.toUpperCase() === color.hex.toUpperCase() ? " is-selected" : ""}`;
    swatchButton.setAttribute("aria-label", color.label);
    swatchButton.setAttribute("title", color.label);
    swatchButton.setAttribute("aria-pressed", String(selectedVariationHairColor.toUpperCase() === color.hex.toUpperCase()));
    const resolvedImageUrl = resolveHairColorPreviewUrl(color);
    const markPreviewReady = () => {
      swatchMedia.classList.add("is-loaded");
      loadedHairColorPreviewUrls.add(resolvedImageUrl);
    };

    swatchMedia.className = "lightbox-hair-color-swatch-media";
    previewImage.src = resolvedImageUrl;
    previewImage.alt = `${color.label} hair color example`;
    previewImage.loading = "eager";
    previewImage.decoding = "async";
    previewImage.fetchPriority = "high";
    previewImage.addEventListener("load", markPreviewReady, { once: true });
    previewImage.addEventListener("error", () => {
      swatchMedia.classList.add("is-loaded");
    }, { once: true });

    if (loadedHairColorPreviewUrls.has(resolvedImageUrl) || previewImage.complete) {
      markPreviewReady();
    }

    swatchMedia.appendChild(previewImage);

    swatchCopy.className = "lightbox-hair-color-swatch-copy";
    swatchLabel.className = "lightbox-hair-color-swatch-label";
    swatchValue.className = "lightbox-hair-color-swatch-value";
    swatchLabel.textContent = color.label;
    swatchValue.textContent = color.hex.toUpperCase();
    swatchCopy.appendChild(swatchLabel);
    swatchCopy.appendChild(swatchValue);
    swatchButton.appendChild(swatchMedia);
    swatchButton.appendChild(swatchCopy);

    swatchButton.addEventListener("click", () => {
      setSelectedVariationHairColor(color.hex);
      variationHairColorInput.value = color.hex;
      setVariationHairColorCustomVisibility(false);
      syncVariationHairColorUi();
    });
    variationHairColorPalette.appendChild(swatchButton);
  });
};

const resetTemplateNextUsage = () => {
  syncTemplateNextButtonVisibility();
};

const setStatus = (message) => {
  statusMessage.textContent = message;
};

const getSelectedImagePreviewUrl = () => {
  if (photoPreview.getAttribute("src")) {
    return photoPreview.src;
  }

  const imageUrl = selectedImage?.photo?.imageUrl;

  if (!imageUrl) {
    return "";
  }

  return imageUrl.startsWith("http") ? imageUrl : `${API_BASE_URL}${imageUrl}`;
};

const setVariationHairColorPanelVisibility = (visible) => {
  isVariationHairColorPanelVisible = visible;
  variationHairColorPanel.classList.toggle("is-hidden", !visible);
  variationHairColorToggle.setAttribute("aria-expanded", String(visible));

  if (visible) {
    preloadCommonHairColorImages();
  }

  syncVariationHairColorPreviewState();
};

const syncVariationHairColorUi = () => {
  variationHairColorInput.value = selectedVariationHairColor || variationHairColorInput.value || DEFAULT_VARIATION_HAIR_COLOR;
  variationHairColorReset.disabled = !selectedVariationHairColor;
  renderVariationHairColorPalette();
  variationHairColorNote.textContent = selectedVariationHairColor
    ? isCommonHairColor(selectedVariationHairColor)
      ? `${getVariationHairColorLabel(selectedVariationHairColor)} selected. Its label and reference photo will be used for the variation request.`
      : `${getVariationHairColorRequestLabel(selectedVariationHairColor)} selected. A color swatch will be used for the variation request.`
    : "Optional: pick a common hair color reference, or use More for any custom shade.";
  syncVariationHairColorPreviewState();
};

const clearVariationHairColorSelection = () => {
  setSelectedVariationHairColor("");
  variationHairColorInput.value = DEFAULT_VARIATION_HAIR_COLOR;
  setVariationHairColorCustomVisibility(false);

  if (activeLightboxResult) {
    activeLightboxResult.lastVariationHairColorHex = "";
    activeLightboxResult.isVariationHairColorCustomPanelOpen = false;
  }

  syncVariationHairColorUi();
};

const createHairColorSwatchDataUrl = (hexColor) => {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Unable to create the hair color swatch.");
  }

  context.fillStyle = hexColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
};

const getActiveVariationHairColor = () => selectedVariationHairColor || "";

const getHairColorReferencePayload = async (hexColor) => {
  const normalizedHex = String(hexColor || "").trim();

  if (!normalizedHex) {
    return {
      hairColorLabel: "",
      hairColorReferenceImageBase64: "",
      hairColorReferenceKind: ""
    };
  }

  const commonHairColor = getCommonHairColorOption(normalizedHex);

  if (commonHairColor?.imageUrl) {
    try {
      return {
        hairColorLabel: commonHairColor.label,
        hairColorReferenceImageBase64: await getImageDataUrlFromUrl(resolveHairColorPreviewUrl(commonHairColor)),
        hairColorReferenceKind: "portrait"
      };
    } catch (_error) {
      // Fall back to a generated swatch if the reference portrait can't be loaded.
    }
  }

  return {
    hairColorLabel: getVariationHairColorRequestLabel(normalizedHex),
    hairColorReferenceImageBase64: createHairColorSwatchDataUrl(normalizedHex),
    hairColorReferenceKind: "swatch"
  };
};

const syncVariationHairColorPreviewState = () => {
  lightboxImageShell.classList.remove("is-hair-color-preview");
};

const getActiveLightboxMarkupKey = () => {
  if (!activeLightboxResult) {
    return "";
  }

  return [
    activeLightboxResult.id || "result",
    activeLightboxResult.imageUrl || "image",
    activeLightboxResult.name || "markup"
  ].join("::");
};

const getActiveLightboxMarkupStrokes = () => {
  const key = getActiveLightboxMarkupKey();

  if (!key) {
    return [];
  }

  if (!lightboxMarkupStore.has(key)) {
    lightboxMarkupStore.set(key, []);
  }

  return lightboxMarkupStore.get(key) || [];
};

const syncLightboxMarkupToolState = () => {
  const isInteractive = Boolean(activeLightboxMarkupTool) && !lightboxImageShell.classList.contains("is-loading");

  lightboxDrawButton.classList.toggle("is-active", activeLightboxMarkupTool === "draw");
  lightboxEraseButton.classList.toggle("is-active", activeLightboxMarkupTool === "erase");
  lightboxDrawButton.setAttribute("aria-pressed", String(activeLightboxMarkupTool === "draw"));
  lightboxEraseButton.setAttribute("aria-pressed", String(activeLightboxMarkupTool === "erase"));
  lightboxMarkupCanvas.classList.toggle("is-interactive", isInteractive);
  lightboxMarkupCanvas.classList.toggle("is-drawing", isInteractive && activeLightboxMarkupTool === "draw");
  lightboxMarkupCanvas.classList.toggle("is-erasing", isInteractive && activeLightboxMarkupTool === "erase");
};

const setActiveLightboxMarkupTool = (tool) => {
  activeLightboxMarkupTool = activeLightboxMarkupTool === tool ? null : tool;
  activeLightboxMarkupStroke = null;
  syncLightboxMarkupToolState();
};

const clearLightboxMarkupCanvasSurface = () => {
  const context = lightboxMarkupCanvas.getContext("2d");

  if (!context) {
    return;
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, lightboxMarkupCanvas.width, lightboxMarkupCanvas.height);
};

const renderLightboxMarkupStroke = (context, stroke, width, height) => {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) {
    return;
  }

  const points = stroke.points.map((point) => ({
    x: point.x * width,
    y: point.y * height
  }));

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.size || LIGHTBOX_MARKUP_DRAW_SIZE;

  if (stroke.mode === "erase") {
    context.globalCompositeOperation = "destination-out";
    context.strokeStyle = "rgba(0, 0, 0, 1)";
    context.fillStyle = "rgba(0, 0, 0, 1)";
  } else {
    context.globalCompositeOperation = "source-over";
    context.strokeStyle = LIGHTBOX_MARKUP_COLOR;
    context.fillStyle = LIGHTBOX_MARKUP_COLOR;
  }

  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);

  points.slice(1).forEach((point) => {
    context.lineTo(point.x, point.y);
  });

  context.stroke();
  context.restore();
};

const redrawLightboxMarkupCanvas = () => {
  const width = Math.round(lightboxImage.clientWidth || 0);
  const height = Math.round(lightboxImage.clientHeight || 0);

  if (!width || !height) {
    clearLightboxMarkupCanvasSurface();
    return;
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  lightboxMarkupCanvas.width = Math.round(width * dpr);
  lightboxMarkupCanvas.height = Math.round(height * dpr);
  lightboxMarkupCanvas.style.width = `${width}px`;
  lightboxMarkupCanvas.style.height = `${height}px`;

  const context = lightboxMarkupCanvas.getContext("2d");

  if (!context) {
    return;
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  getActiveLightboxMarkupStrokes().forEach((stroke) => {
    renderLightboxMarkupStroke(context, stroke, width, height);
  });
};

const scheduleLightboxMarkupCanvasRedraw = () => {
  requestAnimationFrame(() => {
    if (!lightbox.classList.contains("is-hidden")) {
      redrawLightboxMarkupCanvas();
    }
  });
};

const getLightboxMarkupPoint = (event) => {
  const bounds = lightboxMarkupCanvas.getBoundingClientRect();

  if (!bounds.width || !bounds.height) {
    return null;
  }

  return {
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
  };
};

const handleLightboxMarkupPointerDown = (event) => {
  if (!activeLightboxMarkupTool || lightboxImageShell.classList.contains("is-loading")) {
    return;
  }

  const point = getLightboxMarkupPoint(event);

  if (!point) {
    return;
  }

  event.preventDefault();
  lightboxMarkupCanvas.setPointerCapture(event.pointerId);

  const stroke = {
    mode: activeLightboxMarkupTool,
    size: activeLightboxMarkupTool === "erase" ? LIGHTBOX_MARKUP_ERASE_SIZE : LIGHTBOX_MARKUP_DRAW_SIZE,
    points: [point]
  };

  getActiveLightboxMarkupStrokes().push(stroke);
  activeLightboxMarkupStroke = {
    pointerId: event.pointerId,
    stroke
  };

  redrawLightboxMarkupCanvas();
};

const handleLightboxMarkupPointerMove = (event) => {
  if (!activeLightboxMarkupStroke || activeLightboxMarkupStroke.pointerId !== event.pointerId) {
    return;
  }

  const point = getLightboxMarkupPoint(event);

  if (!point) {
    return;
  }

  event.preventDefault();

  const points = activeLightboxMarkupStroke.stroke.points;
  const lastPoint = points[points.length - 1];

  if (lastPoint && Math.abs(lastPoint.x - point.x) < 0.0015 && Math.abs(lastPoint.y - point.y) < 0.0015) {
    return;
  }

  points.push(point);
  redrawLightboxMarkupCanvas();
};

const finishLightboxMarkupStroke = (event) => {
  if (!activeLightboxMarkupStroke || activeLightboxMarkupStroke.pointerId !== event.pointerId) {
    return;
  }

  if (lightboxMarkupCanvas.hasPointerCapture(event.pointerId)) {
    lightboxMarkupCanvas.releasePointerCapture(event.pointerId);
  }

  activeLightboxMarkupStroke = null;
};

const setGenerationProgressState = ({
  active,
  imageUrl = "",
  kicker = "Generating",
  title = "Generating your new hairstyle",
  text = "Your source image is being used to build the next results."
}) => {
  generationProgressCard.classList.toggle("is-hidden", !active);
  generationPanel.setAttribute("aria-busy", String(active));

  if (!active) {
    generationProgressImage.removeAttribute("src");
    return;
  }

  generationProgressKicker.textContent = kicker;
  generationProgressTitle.textContent = title;
  generationProgressText.textContent = text;

  if (imageUrl) {
    generationProgressImage.src = imageUrl;
  } else {
    generationProgressImage.removeAttribute("src");
  }
};

const setLightboxLoadingState = ({
  active,
  title = "Generating",
  text = "This selected image is being used as the source for the next request."
}) => {
  lightboxImageShell.classList.toggle("is-loading", active);
  lightboxLoadingOverlay.classList.toggle("is-hidden", !active);
  syncLightboxMarkupToolState();

  if (!active) {
    return;
  }

  lightboxLoadingTitle.textContent = title;
  lightboxLoadingText.textContent = text;
};

const openLightbox = (imageUrl, imageAlt) => {
  lightboxImage.src = imageUrl;
  lightboxImage.alt = imageAlt;
  lightbox.classList.remove("is-hidden");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  scheduleLightboxMarkupCanvasRedraw();
};

const closeLightbox = () => {
  activeLightboxResult = null;
  activeLightboxMarkupStroke = null;
  selectedVariationHairColor = "";
  isVariationHairColorCustomVisible = false;
  lightbox.classList.add("is-hidden");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImage.removeAttribute("src");
  lightboxTitle.textContent = "Generated hairstyle";
  lightboxDescription.textContent = "";
  viewStatusMessage.textContent = "";
  variationStatusMessage.textContent = "";
  variationPromptInput.value = "";
  variationHairColorInput.value = DEFAULT_VARIATION_HAIR_COLOR;
  promptVariationGrid.innerHTML = "";
  viewResultsGrid.innerHTML = "";
  promptVariationSection.classList.add("is-hidden");
  viewResultsSection.classList.add("is-hidden");
  setActiveLightboxMarkupTool(null);
  setLightboxLoadingState({ active: false });
  setVariationHairColorCustomVisibility(false);
  clearLightboxMarkupCanvasSurface();
  syncVariationHairColorPreviewState();
  document.body.style.overflow = "";
};

const setBusyState = (busy) => {
  isGenerating = busy;
  randomButton.disabled = busy;
  templateButton.disabled = busy;
  nextButton.disabled = busy;
  retakeButton.disabled = busy;
  captureButton.disabled = busy;
  templateBackButton.disabled = busy;
  templatePrompt.disabled = busy;
  generateViewsButton.disabled = busy;
  variationPromptInput.disabled = busy;
  generateVariationButton.disabled = busy;
  syncTemplateNextButtonVisibility();
};

const openPicker = async () => {
  if (typeof photoInput.showPicker === "function") {
    try {
      photoInput.showPicker();
      return;
    } catch (error) {
      // Fall back to click for browsers that block the picker API.
    }
  }

  photoInput.click();
};

const hasSelectedImage = () => Boolean(selectedImage);

const resetPreviewUrl = () => {
  if (!previewUrl) {
    return;
  }

  URL.revokeObjectURL(previewUrl);
  previewUrl = "";
};

const clearSelectedImage = () => {
  selectedImage = null;
  resetTemplateNextUsage();
};

const setSelectedFileImage = (file) => {
  selectedImage = {
    type: "file",
    file,
    name: file.name
  };
  resetTemplateNextUsage();
};

const setSelectedServerImage = (photo) => {
  selectedImage = {
    type: "server",
    photo,
    name: photo.originalName || `${photo.salonName || "Salon"} capture`
  };
  resetTemplateNextUsage();
};

const showPreviewStep = () => {
  captureStep.classList.add("is-hidden");
  optionPanel.classList.add("is-hidden");
  templatePanel.classList.add("is-hidden");
  previewPanel.classList.remove("is-hidden");
  heroCard.classList.remove("is-template-mode");
  syncTemplateNextButtonVisibility();
};

const showOptionStep = () => {
  captureStep.classList.add("is-hidden");
  previewPanel.classList.add("is-hidden");
  templatePanel.classList.add("is-hidden");
  optionPanel.classList.remove("is-hidden");
  heroCard.classList.remove("is-template-mode");
  syncTemplateNextButtonVisibility();
};

const showTemplateStep = () => {
  captureStep.classList.add("is-hidden");
  previewPanel.classList.add("is-hidden");
  optionPanel.classList.add("is-hidden");
  templatePanel.classList.remove("is-hidden");
  heroCard.classList.add("is-template-mode");
  syncTemplateNextButtonVisibility();
};

const showGenerationPanel = () => {
  generationPanel.classList.remove("is-hidden");
  heroCard.classList.add("has-results");
  syncTemplateNextButtonVisibility();
};

const hideGenerationPanel = () => {
  generationPanel.classList.add("is-hidden");
  resultGrid.innerHTML = "";
  heroCard.classList.remove("has-results");
  setGenerationProgressState({ active: false });
  syncTemplateNextButtonVisibility();
};

const resetToCaptureStep = () => {
  resetPreviewUrl();
  clearSelectedImage();
  photoInput.value = "";
  photoPreview.removeAttribute("src");
  previewPanel.classList.add("is-hidden");
  optionPanel.classList.add("is-hidden");
  templatePanel.classList.add("is-hidden");
  hideGenerationPanel();
  selectedTemplateIds = new Set();
  activeTemplateFilters = createEmptyTemplateFilters();
  setTemplateFilterVisibility(false);
  templatePrompt.value = "";
  captureStep.classList.remove("is-hidden");
  heroCard.classList.remove("is-template-mode");
  syncTemplateNextButtonVisibility();
  updateTemplateCount();
  setStatus("");
};

const handleRetake = () => {
  if (isGenerating) {
    return;
  }

  resetToCaptureStep();
  openPicker();
};

const handleNext = () => {
  if (!hasSelectedImage()) {
    setStatus("Please take a picture before continuing.");
    return;
  }

  showOptionStep();
  setStatus("Choose how you want to generate your new hairstyle.");
};

const handleTemplateSelection = () => {
  hideGenerationPanel();
  showTemplateStep();
  setStatus("Choose one or more templates and add an optional extra prompt.");
};

const pickRandomHairstyles = (items, count) => {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled.slice(0, count);
};

const blobToDataUrl = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(blob);
  });
};

const getSelectedImageDataUrl = async () => {
  if (!selectedImage) {
    throw new Error("Please take a picture before continuing.");
  }

  if (selectedImage.type === "file") {
    return blobToDataUrl(selectedImage.file);
  }

  const imageUrl = selectedImage.photo?.imageUrl;

  if (!imageUrl) {
    throw new Error("The captured salon image is missing.");
  }

  const response = await fetch(imageUrl.startsWith("http") ? imageUrl : `${API_BASE_URL}${imageUrl}`);

  if (!response.ok) {
    throw new Error("Unable to load the saved salon photo.");
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
};

const getTemplateMetadataCatalog = async () => {
  if (!templateMetadataCatalogPromise) {
    templateMetadataCatalogPromise = fetch(`${API_BASE_URL}/styles/hairstyles.json`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load template metadata.");
        }

        return response.json();
      })
      .catch((error) => {
        templateMetadataCatalogPromise = null;
        throw error;
      });
  }

  return templateMetadataCatalogPromise;
};

const buildTemplateMetadataIndex = (items) => {
  const index = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item?.filename) {
      return;
    }

    const keys = [item.filename, item.id]
      .concat(Array.isArray(item.aliases) ? item.aliases : [])
      .filter(Boolean);

    keys.forEach((key) => index.set(String(key).toLowerCase(), item));
  });

  return index;
};

const mergeTemplateStylesWithMetadata = (styles, metadataItems) => {
  const metadataIndex = buildTemplateMetadataIndex(metadataItems);

  return (Array.isArray(styles) ? styles : []).map((style) => {
    const metadata = metadataIndex.get(String(style.filename || "").toLowerCase())
      || metadataIndex.get(String(style.id || "").toLowerCase());

    if (!metadata) {
      return {
        ...style,
        attributes: style.attributes || {}
      };
    }

    const mergedPrompt = metadata.description || style.prompt || style.description || "";

    return {
      ...style,
      id: metadata.id || style.id,
      name: metadata.name || style.name,
      prompt: mergedPrompt,
      description: mergedPrompt,
      attributes: metadata.attributes || style.attributes || {}
    };
  });
};

const getImageDataUrlFromUrl = async (imageUrl) => {
  if (!imageUrl) {
    throw new Error("Missing generated image.");
  }

  if (imageUrl.startsWith("data:")) {
    return imageUrl;
  }

  const resolvedUrl = imageUrl.startsWith("http") ? imageUrl : `${API_BASE_URL}${imageUrl}`;
  const response = await fetch(resolvedUrl, { cache: "no-store" });

  if (!response.ok) {
    throw new Error("Unable to load the selected generated image.");
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
};

const setGenerationHeading = (label, title) => {
  generationLabel.textContent = label;
  generationTitle.textContent = title;
};

const setTemplateFilterVisibility = (visible) => {
  areTemplateFiltersVisible = visible;
  templateFilterContent.classList.toggle("is-hidden", !visible);
  templateFilterToggle.setAttribute("aria-expanded", String(visible));
};

const formatTemplateFilterValue = (value) => {
  return String(value || "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const getTemplateAttribute = (style, key) => {
  return String(style?.attributes?.[key] || "").trim();
};

const getTemplateCardMeta = (style) => {
  return ["length", "style", "color"]
    .map((key) => getTemplateAttribute(style, key))
    .filter(Boolean)
    .map(formatTemplateFilterValue)
    .join(" • ");
};

const getAvailableTemplateFilterOptions = () => {
  const options = {};

  TEMPLATE_FILTER_DEFINITIONS.forEach((definition) => {
    options[definition.id] = [...new Set(
      templateStyles
        .map((style) => getTemplateAttribute(style, definition.id))
        .filter(Boolean)
    )].sort((left, right) => formatTemplateFilterValue(left).localeCompare(formatTemplateFilterValue(right)));
  });

  return options;
};

const matchesTemplateFilters = (style) => {
  return TEMPLATE_FILTER_DEFINITIONS.every((definition) => {
    const selectedValue = activeTemplateFilters[definition.id];

    if (!selectedValue) {
      return true;
    }

    return getTemplateAttribute(style, definition.id) === selectedValue;
  });
};

const getFilteredTemplateStyles = () => {
  return templateStyles.filter(matchesTemplateFilters);
};

const renderTemplateFilters = () => {
  const availableOptions = getAvailableTemplateFilterOptions();
  templateFilterBar.innerHTML = "";

  TEMPLATE_FILTER_DEFINITIONS.forEach((definition) => {
    const field = document.createElement("label");
    field.className = "template-filter-field";
    field.setAttribute("for", `template-filter-${definition.id}`);

    const label = document.createElement("span");
    label.className = "template-filter-label";
    label.textContent = definition.label;

    const select = document.createElement("select");
    select.className = "template-filter-select";
    select.id = `template-filter-${definition.id}`;

    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = definition.allLabel;
    select.appendChild(allOption);

    (availableOptions[definition.id] || []).forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatTemplateFilterValue(value);
      select.appendChild(option);
    });

    select.value = activeTemplateFilters[definition.id] || "";
    select.addEventListener("change", () => {
      activeTemplateFilters[definition.id] = select.value;
      renderTemplateGrid();
    });

    field.appendChild(label);
    field.appendChild(select);
    templateFilterBar.appendChild(field);
  });

  templateFilterReset.disabled = TEMPLATE_FILTER_DEFINITIONS.every((definition) => !activeTemplateFilters[definition.id]);
};

const updateTemplateFilterSummary = (visibleCount, totalCount) => {
  const activeFilters = TEMPLATE_FILTER_DEFINITIONS
    .filter((definition) => activeTemplateFilters[definition.id])
    .map((definition) => `${definition.label}: ${formatTemplateFilterValue(activeTemplateFilters[definition.id])}`);

  if (visibleCount === 0) {
    templateFilterSummary.textContent = activeFilters.length > 0
      ? `No templates match. ${activeFilters.join(" • ")}`
      : "No templates match the current filters.";
    return;
  }

  if (visibleCount === totalCount) {
    templateFilterSummary.textContent = activeFilters.length > 0
      ? `Showing all ${totalCount} templates. ${activeFilters.join(" • ")}`
      : `Showing all ${totalCount} templates.`;
    return;
  }

  templateFilterSummary.textContent = activeFilters.length > 0
    ? `Showing ${visibleCount} of ${totalCount} templates. ${activeFilters.join(" • ")}`
    : `Showing ${visibleCount} of ${totalCount} templates.`;
};

const getResultDescription = (result) => {
  return result.sourcePrompt || result.finalPrompt || "Selected generated hairstyle result.";
};

const createFollowUpCard = ({ title, imageUrl, alt, note, promptText, errorMessage, pending = false, onSelect = null }) => {
  const card = document.createElement("article");
  const isSelectable = typeof onSelect === "function" && Boolean(imageUrl) && !pending && !errorMessage;
  card.className = `lightbox-followup-card${errorMessage ? " is-error" : ""}${isSelectable ? " is-selectable" : ""}`;

  const media = document.createElement("div");
  media.className = `lightbox-followup-media${imageUrl ? "" : " is-empty"}${isSelectable ? " is-selectable" : ""}`;

  if (imageUrl) {
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = alt;
    image.loading = "lazy";
    image.decoding = "async";
    media.appendChild(image);
  } else {
    const placeholder = document.createElement("p");
    placeholder.className = "lightbox-followup-note";
    placeholder.textContent = pending ? "Generating preview..." : "Preview unavailable.";
    media.appendChild(placeholder);
  }

  const heading = document.createElement("h4");
  heading.className = "lightbox-followup-title";
  heading.textContent = title;

  const noteBlock = document.createElement("p");
  noteBlock.className = "lightbox-followup-note";
  noteBlock.textContent = errorMessage || note;

  card.appendChild(media);
  card.appendChild(heading);
  card.appendChild(noteBlock);

  if (promptText) {
    const promptBlock = document.createElement("p");
    promptBlock.className = "lightbox-followup-prompt";
    promptBlock.textContent = promptText;
    card.appendChild(promptBlock);
  }

  if (isSelectable) {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Use ${title} as the selected image`);
    card.addEventListener("click", () => onSelect());
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect();
      }
    });
  }

  return card;
};

const createWorkspaceResultFromRelatedResult = (result, fallbackName = "Generated hairstyle", fallbackDescription = "") => ({
  ...result,
  name: result?.name || fallbackName,
  sourcePrompt: result?.sourcePrompt || fallbackDescription,
  finalPrompt: result?.finalPrompt || "",
  followUpViews: Array.isArray(result?.followUpViews) ? result.followUpViews : [],
  promptVariationResult: result?.promptVariationResult || null,
  lastVariationPrompt: result?.lastVariationPrompt || "",
  lastVariationHairColorHex: result?.lastVariationHairColorHex || "",
  isVariationHairColorPanelOpen: Boolean(result?.isVariationHairColorPanelOpen),
  isVariationHairColorCustomPanelOpen: Boolean(result?.isVariationHairColorCustomPanelOpen)
});

const renderPromptVariationSection = (result) => {
  promptVariationGrid.innerHTML = "";

  if (!result?.promptVariationResult) {
    promptVariationSection.classList.add("is-hidden");
    return;
  }

  promptVariationSection.classList.remove("is-hidden");
  promptVariationGrid.appendChild(createFollowUpCard({
    title: "Selected Result",
    imageUrl: result.imageUrl,
    alt: `${result.name} selected generated hairstyle result`,
    note: "Your selected generated hairstyle.",
    onSelect: () => openResultWorkspace(createWorkspaceResultFromRelatedResult(result, result.name, getResultDescription(result)))
  }));

  const promptVariationResult = result.promptVariationResult;
  const variationDetails = [
    promptVariationResult.extraPrompt ? `Extra prompt: ${promptVariationResult.extraPrompt}` : "",
    promptVariationResult.hairColorLabel
      ? `Hair color: ${promptVariationResult.hairColorLabel}`
      : promptVariationResult.hairColorHex
        ? `Hair color: ${promptVariationResult.hairColorHex.toUpperCase()}`
        : "",
    promptVariationResult.hairColorReferenceKind === "portrait"
      ? "Reference: color photo"
      : promptVariationResult.hairColorReferenceKind === "swatch"
        ? "Reference: color swatch"
        : ""
  ].filter(Boolean).join(" • ");

  promptVariationGrid.appendChild(createFollowUpCard({
    title: promptVariationResult.name || "Prompt Variation",
    imageUrl: promptVariationResult.imageUrl,
    alt: `${promptVariationResult.name || "Prompt variation"} generated hairstyle result`,
    note: promptVariationResult.pending
      ? promptVariationResult.hairColorHex && !promptVariationResult.extraPrompt
        ? "Generating a new image from your selected hair color."
        : "Generating a new image from your extra prompt."
      : promptVariationResult.hairColorHex && !promptVariationResult.extraPrompt
        ? "Created from your selected hair color."
        : "Created from your extra prompt.",
    promptText: variationDetails,
    errorMessage: promptVariationResult.errorMessage || "",
    pending: Boolean(promptVariationResult.pending),
    onSelect: () => openResultWorkspace(createWorkspaceResultFromRelatedResult(
      promptVariationResult,
      promptVariationResult.name || "Prompt Variation",
      getResultDescription(promptVariationResult) || getResultDescription(result)
    ))
  }));
};

const renderViewResultsSection = (result) => {
  viewResultsGrid.innerHTML = "";

  if (!Array.isArray(result?.followUpViews) || result.followUpViews.length === 0) {
    viewResultsSection.classList.add("is-hidden");
    return;
  }

  viewResultsSection.classList.remove("is-hidden");

  result.followUpViews.forEach((viewResult) => {
    viewResultsGrid.appendChild(createFollowUpCard({
      title: viewResult.name,
      imageUrl: viewResult.imageUrl,
      alt: `${viewResult.name} generated hairstyle view`,
      note: viewResult.pending
        ? "Generating this back-angle view."
        : "Created from the selected hairstyle result.",
      errorMessage: viewResult.errorMessage || "",
      pending: Boolean(viewResult.pending),
      onSelect: () => openResultWorkspace(createWorkspaceResultFromRelatedResult(
        viewResult,
        viewResult.name || "Generated hairstyle view",
        getResultDescription(viewResult) || getResultDescription(result)
      ))
    }));
  });
};

const syncLightboxPanels = () => {
  if (!activeLightboxResult) {
    return;
  }

  renderPromptVariationSection(activeLightboxResult);
  renderViewResultsSection(activeLightboxResult);
  scheduleLightboxMarkupCanvasRedraw();
};

const openResultWorkspace = (result) => {
  if (!result?.imageUrl) {
    return;
  }

  activeLightboxResult = result;
  activeLightboxMarkupStroke = null;
  setActiveLightboxMarkupTool(null);
  setLightboxLoadingState({ active: false });
  clearLightboxMarkupCanvasSurface();
  lightboxTitle.textContent = result.name || "Generated hairstyle";
  lightboxDescription.textContent = getResultDescription(result);
  variationPromptInput.value = result.lastVariationPrompt || "";
  selectedVariationHairColor = result.lastVariationHairColorHex || "";
  variationHairColorInput.value = result.lastVariationHairColorHex || DEFAULT_VARIATION_HAIR_COLOR;
  setVariationHairColorCustomVisibility(Boolean(
    result.isVariationHairColorCustomPanelOpen
    || (result.lastVariationHairColorHex && !isCommonHairColor(result.lastVariationHairColorHex))
  ));
  setVariationHairColorPanelVisibility(Boolean(result.isVariationHairColorPanelOpen));
  syncVariationHairColorUi();
  viewStatusMessage.textContent = "";
  variationStatusMessage.textContent = "";
  syncLightboxPanels();
  openLightbox(result.imageUrl, `${result.name} expanded generated hairstyle result`);
};

const updateTemplateCount = () => {
  const count = selectedTemplateIds.size;
  templateCount.querySelector(".template-count-text").textContent = `${count} selected`;
};

const ensureTemplateStyles = async () => {
  if (templateStyles.length > 0) {
    return templateStyles;
  }

  const response = await fetch(`${API_BASE_URL}/api/styles`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to load hairstyle templates.");
  }

  const apiStyles = Array.isArray(payload.styles) ? payload.styles : [];

  try {
    const metadataCatalog = await getTemplateMetadataCatalog();
    templateStyles = mergeTemplateStylesWithMetadata(apiStyles, metadataCatalog);
  } catch (_error) {
    templateStyles = apiStyles.map((style) => ({
      ...style,
      attributes: style.attributes || {}
    }));
  }

  return templateStyles;
};

const toggleTemplateSelection = (templateId) => {
  if (selectedTemplateIds.has(templateId)) {
    selectedTemplateIds.delete(templateId);
  } else {
    selectedTemplateIds.add(templateId);
  }

  updateTemplateCount();
  syncTemplateNextButtonVisibility();
  renderTemplateGrid();
};

const syncTemplateCardSize = (card, imageElement) => {
  const { naturalWidth, naturalHeight } = imageElement;

  if (!naturalWidth || !naturalHeight) {
    card.classList.remove("is-roomy");
    return;
  }

  const aspectRatio = naturalWidth / naturalHeight;
  card.classList.toggle("is-roomy", aspectRatio >= 0.95);
};

const renderTemplateGrid = () => {
  templateGrid.innerHTML = "";
  const filteredStyles = getFilteredTemplateStyles();

  updateTemplateFilterSummary(filteredStyles.length, templateStyles.length);
  templateFilterReset.disabled = TEMPLATE_FILTER_DEFINITIONS.every((definition) => !activeTemplateFilters[definition.id]);

  if (filteredStyles.length === 0) {
    templateGrid.innerHTML = `
      <article class="template-empty-state">
        <h3 class="template-empty-title">No templates match these filters</h3>
        <p class="template-empty-copy">Clear one or more filters to see more hairstyle templates.</p>
      </article>
    `;
    return;
  }

  filteredStyles.forEach((style) => {
    const card = document.createElement("article");
    const isSelected = selectedTemplateIds.has(style.id);
    const metaSummary = getTemplateCardMeta(style);
    card.className = `template-card${isSelected ? " is-selected" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(isSelected));
    card.innerHTML = `
      <span class="template-card-check">&#10003;</span>
      <div class="template-card-media">
        <img src="${style.imageUrl}" alt="${style.name} hairstyle template" loading="lazy" decoding="async">
      </div>
      <div>
        <h3 class="template-card-name">${style.name}</h3>
        ${metaSummary ? `<p class="template-card-meta">${metaSummary}</p>` : ""}
      </div>
    `;

    const templateImage = card.querySelector(".template-card-media img");

    if (templateImage) {
      templateImage.addEventListener("load", () => syncTemplateCardSize(card, templateImage));

      if (templateImage.complete) {
        syncTemplateCardSize(card, templateImage);
      }
    }

    card.addEventListener("click", () => toggleTemplateSelection(style.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleTemplateSelection(style.id);
      }
    });

    templateGrid.appendChild(card);
  });
};

const createResultCard = (hairstyle) => {
  const card = document.createElement("article");
  card.className = "result-card";
  card.innerHTML = `
    <div class="result-card-media"></div>
    <div class="result-card-body">
      <div class="result-card-title-row">
        <h3 class="result-card-title">${hairstyle.name}</h3>
        <span class="result-badge">Queued</span>
      </div>
      <p class="result-description">${hairstyle.prompt}</p>
      <p class="result-note">Preparing this look now.</p>
    </div>
  `;

  resultGrid.appendChild(card);
  return card;
};

const createResultBatchDivider = ({ label, title }) => {
  const divider = document.createElement("div");
  divider.className = "result-batch-divider";
  divider.innerHTML = `
    <p class="result-batch-label">${label}</p>
    <h3 class="result-batch-title">${title}</h3>
  `;
  resultGrid.appendChild(divider);
  return divider;
};

const addPromptBlock = (card, promptText) => {
  if (card.querySelector(".result-prompt")) {
    return;
  }

  const promptBlock = document.createElement("p");
  promptBlock.className = "result-prompt";
  promptBlock.textContent = promptText;
  card.querySelector(".result-card-body").appendChild(promptBlock);
};

const updateResultCard = (card, result) => {
  const media = card.querySelector(".result-card-media");
  const badge = card.querySelector(".result-badge");
  const note = card.querySelector(".result-note");
  const description = card.querySelector(".result-description");

  card.resultData = result;
  description.textContent = getResultDescription(result);

  if (result.imageUrl) {
    media.innerHTML = `<img src="${result.imageUrl}" alt="${result.name} generated hairstyle result">`;
    media.classList.add("has-image");
    badge.textContent = "Ready";
    badge.classList.remove("warning");
    badge.classList.add("success");
    note.textContent = "Your image is ready. Click it to explore more angles or make refinements.";
    media.onclick = () => openResultWorkspace(card.resultData || result);
    return;
  }

  media.classList.remove("has-image");
  media.onclick = null;
  badge.textContent = "Error";
  badge.classList.remove("success");
  badge.classList.add("warning");
  note.textContent = result.errorMessage || "We couldn't prepare this look right now.";
  addPromptBlock(card, result.finalPrompt);
};

const renderGenerationResults = (cards, results) => {
  results.forEach((result, index) => {
    updateResultCard(cards[index], result);
  });
};

const requestRandomHairstyles = async ({ imageBase64, hairstyles }) => {
  const response = await fetch(`${API_BASE_URL}/api/random-hairstyles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      imageBase64,
      hairstyles
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Random hairstyle generation failed.");
  }

  return payload.results || [];
};

const requestTemplateHairstyles = async ({ imageBase64, templates, extraPrompt }) => {
  const response = await fetch(`${API_BASE_URL}/api/template-hairstyles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      imageBase64,
      templates,
      extraPrompt
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Template hairstyle generation failed.");
  }

  return payload.results || [];
};

const requestGeneratedHairstyleViews = async ({ imageBase64, lookName, lookDescription }) => {
  const response = await fetch(`${API_BASE_URL}/api/generated-hairstyle-views`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      imageBase64,
      lookName,
      lookDescription
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to generate more views.");
  }

  return payload.results || [];
};

const requestGeneratedHairstyleVariation = async ({
  imageBase64,
  lookName,
  lookDescription,
  extraPrompt,
  hairColorHex = "",
  hairColorLabel = "",
  hairColorReferenceImageBase64 = "",
  hairColorReferenceKind = "",
  hairColorSwatchBase64 = ""
}) => {
  const response = await fetch(`${API_BASE_URL}/api/generated-hairstyle-variation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      imageBase64,
      lookName,
      lookDescription,
      extraPrompt,
      hairColorHex,
      hairColorLabel,
      hairColorReferenceImageBase64,
      hairColorReferenceKind,
      hairColorSwatchBase64
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Unable to generate a prompt variation.");
  }

  return payload.result || null;
};

const handleGenerateViews = async () => {
  if (!activeLightboxResult?.imageUrl) {
    viewStatusMessage.textContent = "Select a generated hairstyle result first.";
    return;
  }

  const resultReference = activeLightboxResult;
  resultReference.followUpViews = [
    { id: "left-back-view", name: "Left Back View", pending: true },
    { id: "right-back-view", name: "Right Back View", pending: true }
  ];
  viewStatusMessage.textContent = "Generating left-back and right-back views.";
  syncLightboxPanels();
  setLightboxLoadingState({
    active: true,
    title: "Generating More Views",
    text: "The selected result is being used to create additional back-angle views."
  });
  setBusyState(true);

  try {
    const imageBase64 = await getImageDataUrlFromUrl(resultReference.imageUrl);
    const results = await requestGeneratedHairstyleViews({
      imageBase64,
      lookName: resultReference.name,
      lookDescription: getResultDescription(resultReference)
    });

    resultReference.followUpViews = results;
    if (activeLightboxResult === resultReference) {
      viewStatusMessage.textContent = "Your extra back-angle views are ready.";
      syncLightboxPanels();
    }
  } catch (error) {
    resultReference.followUpViews = [
      { id: "left-back-view", name: "Left Back View", errorMessage: error.message },
      { id: "right-back-view", name: "Right Back View", errorMessage: error.message }
    ];

    if (activeLightboxResult === resultReference) {
      viewStatusMessage.textContent = error.message;
      syncLightboxPanels();
    }
  } finally {
    if (activeLightboxResult === resultReference) {
      setLightboxLoadingState({ active: false });
    }

    setBusyState(false);
  }
};

const handleGeneratePromptVariation = async () => {
  if (!activeLightboxResult?.imageUrl) {
    variationStatusMessage.textContent = "Select a generated hairstyle result first.";
    return;
  }

  const extraPrompt = variationPromptInput.value.trim();
  const hairColorHex = getActiveVariationHairColor();
  const initialHairColorLabel = getVariationHairColorRequestLabel(hairColorHex);
  const initialHairColorReferenceKind = hairColorHex
    ? isCommonHairColor(hairColorHex) ? "portrait" : "swatch"
    : "";

  if (!extraPrompt && !hairColorHex) {
    variationStatusMessage.textContent = "Add an extra prompt or choose a hair color first.";
    return;
  }

  const resultReference = activeLightboxResult;
  resultReference.lastVariationPrompt = extraPrompt;
  resultReference.lastVariationHairColorHex = hairColorHex;
  resultReference.isVariationHairColorPanelOpen = isVariationHairColorPanelVisible;
  resultReference.isVariationHairColorCustomPanelOpen = isVariationHairColorCustomVisible;
  resultReference.promptVariationResult = {
    name: `${resultReference.name} Prompt Variation`,
    extraPrompt,
    hairColorHex,
    hairColorLabel: initialHairColorLabel,
    hairColorReferenceKind: initialHairColorReferenceKind,
    pending: true
  };
  variationStatusMessage.textContent = hairColorHex && !extraPrompt
    ? isCommonHairColor(hairColorHex)
      ? "Creating a new hair-color variation using the selected color label and reference photo."
      : "Creating a new hair-color variation using your custom color swatch."
    : hairColorHex
      ? isCommonHairColor(hairColorHex)
        ? "Creating a new variation using your selected color label and reference photo."
        : "Creating a new variation using your custom color swatch."
      : "Creating a new prompt-based variation.";
  syncLightboxPanels();
  setLightboxLoadingState({
    active: true,
    title: "Generating Prompt Variation",
    text: hairColorHex && !extraPrompt
      ? isCommonHairColor(hairColorHex)
        ? "The selected result, color label, and reference photo are being used to create the new variation."
        : "The selected result and your custom color swatch are being used to create the new variation."
      : hairColorHex
        ? isCommonHairColor(hairColorHex)
          ? "The selected result, color label, and reference photo are being used to create the new variation."
          : "The selected result and your custom color swatch are being used to create the new variation."
        : "The selected result is being used to create your new variation."
  });
  setBusyState(true);

  try {
    const imageBase64 = await getImageDataUrlFromUrl(resultReference.imageUrl);
    const hairColorSwatchBase64 = hairColorHex ? createHairColorSwatchDataUrl(hairColorHex) : "";
    const {
      hairColorLabel,
      hairColorReferenceImageBase64,
      hairColorReferenceKind
    } = hairColorHex
      ? await getHairColorReferencePayload(hairColorHex)
      : {
        hairColorLabel: "",
        hairColorReferenceImageBase64: "",
        hairColorReferenceKind: ""
      };

    resultReference.promptVariationResult.hairColorLabel = hairColorLabel;
    resultReference.promptVariationResult.hairColorReferenceKind = hairColorReferenceKind;

    if (activeLightboxResult === resultReference && hairColorHex) {
      variationStatusMessage.textContent = hairColorReferenceKind === "portrait"
        ? "Using the selected color label and reference photo."
        : "Using your custom color swatch.";
      syncLightboxPanels();
    }

    const result = await requestGeneratedHairstyleVariation({
      imageBase64,
      lookName: resultReference.name,
      lookDescription: getResultDescription(resultReference),
      extraPrompt,
      hairColorHex,
      hairColorLabel,
      hairColorReferenceImageBase64,
      hairColorReferenceKind,
      hairColorSwatchBase64
    });

    resultReference.promptVariationResult = result;
    if (activeLightboxResult === resultReference) {
      variationStatusMessage.textContent = hairColorHex && !extraPrompt
        ? "Your hair-color variation is ready."
        : "Your prompt variation is ready.";
      syncLightboxPanels();
    }
  } catch (error) {
    resultReference.promptVariationResult = {
      name: `${resultReference.name} Prompt Variation`,
      extraPrompt,
      hairColorHex,
      hairColorLabel: initialHairColorLabel,
      hairColorReferenceKind: initialHairColorReferenceKind,
      errorMessage: error.message
    };

    if (activeLightboxResult === resultReference) {
      variationStatusMessage.textContent = error.message;
      syncLightboxPanels();
    }
  } finally {
    if (activeLightboxResult === resultReference) {
      setLightboxLoadingState({ active: false });
    }

    setBusyState(false);
  }
};

const handleRandomHairstyles = async () => {
  if (!hasSelectedImage()) {
    setStatus("Please take a picture before generating hairstyles.");
    return;
  }

  if (hairstyleLibrary.length < 5) {
    setStatus("The hairstyle library is incomplete.");
    return;
  }

  const selectedHairstyles = pickRandomHairstyles(hairstyleLibrary, 5);
  const sourcePreviewUrl = getSelectedImagePreviewUrl();

  resultGrid.innerHTML = "";
  const cards = selectedHairstyles.map(createResultCard);
  setGenerationHeading("Random Set", "Five hairstyle directions");
  showGenerationPanel();
  setGenerationProgressState({
    active: true,
    imageUrl: sourcePreviewUrl,
    kicker: "Source Image",
    title: "Generating five hairstyle directions",
    text: "Your uploaded photo is being used to create a full set of new hairstyle previews."
  });
  scrollToGenerationPanel();
  setBusyState(true);
  setStatus("Creating five hairstyle variations.");

  try {
    const imageBase64 = await getSelectedImageDataUrl();
    const results = await requestRandomHairstyles({
      imageBase64,
      hairstyles: selectedHairstyles
    });

    renderGenerationResults(cards, results);
    setStatus("Your hairstyle variations are ready.");
  } catch (error) {
    const fallbackResults = selectedHairstyles.map((hairstyle) => ({
      name: hairstyle.name,
      sourcePrompt: hairstyle.prompt,
      finalPrompt: hairstyle.prompt,
      errorMessage: error.message
    }));

    renderGenerationResults(cards, fallbackResults);
    setStatus(error.message);
  } finally {
    setGenerationProgressState({ active: false });
    setBusyState(false);
  }
};

const handleOpenTemplates = async () => {
  if (!hasSelectedImage()) {
    setStatus("Please take a picture before opening templates.");
    return;
  }

  hideGenerationPanel();
  showTemplateStep();
  setStatus("Loading hairstyle templates.");

  try {
    await ensureTemplateStyles();
    updateTemplateCount();
    renderTemplateFilters();
    renderTemplateGrid();
    setStatus("Choose one or more templates and add an optional extra prompt.");
  } catch (error) {
    setStatus(error.message);
  }
};

const handleTemplateBack = () => {
  if (isGenerating) {
    return;
  }

  showOptionStep();
  setStatus("Choose how you want to generate your new hairstyle.");
};

const handleTemplateNext = async () => {
  if (!hasSelectedImage()) {
    setStatus("Please take a picture before continuing.");
    return;
  }

  const selectedTemplates = templateStyles.filter((style) => selectedTemplateIds.has(style.id));

  if (selectedTemplates.length === 0) {
    setStatus("Select at least one template before clicking next.");
    return;
  }

  selectedTemplateIds = new Set();
  updateTemplateCount();
  syncTemplateNextButtonVisibility();
  renderTemplateGrid();

  const extraPrompt = templatePrompt.value.trim();
  const sourcePreviewUrl = getSelectedImagePreviewUrl();
  const hasExistingResults = Boolean(resultGrid.querySelector(".result-card"));
  const batchAnchor = hasExistingResults
    ? createResultBatchDivider({
      label: "Added Looks",
      title: `${selectedTemplates.length} more selected template look${selectedTemplates.length === 1 ? "" : "s"}`
    })
    : null;

  const cards = selectedTemplates.map(createResultCard);
  setGenerationHeading("Template Set", "Chosen hairstyle templates");
  showGenerationPanel();
  setGenerationProgressState({
    active: true,
    imageUrl: sourcePreviewUrl,
    kicker: "Selected Photo",
    title: "Generating your chosen template looks",
    text: "The original photo is being used to create the selected hairstyle looks."
  });
  if (hasExistingResults) {
    scrollToResultBatch(batchAnchor || cards[0]);
  } else {
    scrollToGenerationPanel();
  }
  setBusyState(true);
  setStatus("Creating your selected hairstyle looks.");

  try {
    const imageBase64 = await getSelectedImageDataUrl();
    const results = await requestTemplateHairstyles({
      imageBase64,
      templates: selectedTemplates,
      extraPrompt
    });

    renderGenerationResults(cards, results);
    scrollToResultBatch(batchAnchor || cards[0]);
    setStatus(hasExistingResults
      ? "Your new template results were added below the previous set."
      : "Your selected template results are ready.");
  } catch (error) {
    const fallbackResults = selectedTemplates.map((template) => ({
      name: template.name,
      sourcePrompt: template.prompt,
      finalPrompt: `${template.prompt} ${extraPrompt}`.trim(),
      errorMessage: error.message
    }));

    renderGenerationResults(cards, fallbackResults);
    scrollToResultBatch(batchAnchor || cards[0]);
    setStatus(error.message);
  } finally {
    setGenerationProgressState({ active: false });
    setBusyState(false);
  }
};

captureButton.addEventListener("click", openPicker);

const restoreCapturedSalonPhoto = () => {
  const storedPhoto = sessionStorage.getItem(CAPTURED_PHOTO_STORAGE_KEY);

  if (!storedPhoto) {
    return;
  }

  try {
    const photo = JSON.parse(storedPhoto);
    const storedSalonSlug = String(photo?.salonSlug || "").toLowerCase();
    const pathnameSalonSlug = String(currentSalonSlug || "").toLowerCase();

    if (pathnameSalonSlug && storedSalonSlug && pathnameSalonSlug !== storedSalonSlug) {
      return;
    }

    if (!photo?.imageUrl) {
      sessionStorage.removeItem(CAPTURED_PHOTO_STORAGE_KEY);
      return;
    }

    sessionStorage.removeItem(CAPTURED_PHOTO_STORAGE_KEY);
    setSelectedServerImage(photo);
    photoPreview.src = photo.imageUrl.startsWith("http") ? photo.imageUrl : `${API_BASE_URL}${photo.imageUrl}`;
    hideGenerationPanel();
    showOptionStep();
    setStatus(`Photo loaded for ${photo.salonName || "your salon"}. Choose from templates or generate randomly.`);
  } catch (_error) {
    sessionStorage.removeItem(CAPTURED_PHOTO_STORAGE_KEY);
  }
};

photoInput.addEventListener("change", () => {
  const [selectedFile] = photoInput.files;

  if (!selectedFile) {
    clearSelectedImage();
    setStatus("");
    return;
  }

  resetPreviewUrl();
  setSelectedFileImage(selectedFile);
  previewUrl = URL.createObjectURL(selectedFile);
  photoPreview.src = previewUrl;
  hideGenerationPanel();
  showPreviewStep();
  setStatus(`Selected: ${selectedFile.name}`);
});

retakeButton.addEventListener("click", handleRetake);
nextButton.addEventListener("click", handleNext);
randomButton.addEventListener("click", handleRandomHairstyles);
templateButton.addEventListener("click", handleOpenTemplates);
templateBackButton.addEventListener("click", handleTemplateBack);
templateNextButton.addEventListener("click", handleTemplateNext);
templateFilterToggle.addEventListener("click", () => {
  setTemplateFilterVisibility(!areTemplateFiltersVisible);
});
templateFilterReset.addEventListener("click", () => {
  activeTemplateFilters = createEmptyTemplateFilters();
  renderTemplateFilters();
  renderTemplateGrid();
});
generateViewsButton.addEventListener("click", handleGenerateViews);
generateVariationButton.addEventListener("click", handleGeneratePromptVariation);
lightboxDrawButton.addEventListener("click", () => {
  setActiveLightboxMarkupTool("draw");
});
lightboxEraseButton.addEventListener("click", () => {
  setActiveLightboxMarkupTool("erase");
});
variationHairColorToggle.addEventListener("click", () => {
  const nextVisibility = !isVariationHairColorPanelVisible;
  setVariationHairColorPanelVisibility(nextVisibility);

  if (activeLightboxResult) {
    activeLightboxResult.lastVariationHairColorHex = selectedVariationHairColor;
    activeLightboxResult.isVariationHairColorPanelOpen = nextVisibility;
    activeLightboxResult.isVariationHairColorCustomPanelOpen = isVariationHairColorCustomVisible;
  }

  syncVariationHairColorUi();
});
variationHairColorMore.addEventListener("click", () => {
  const nextVisibility = !isVariationHairColorCustomVisible;
  setVariationHairColorCustomVisibility(nextVisibility);

  if (activeLightboxResult) {
    activeLightboxResult.isVariationHairColorCustomPanelOpen = nextVisibility;
  }

  if (nextVisibility && !selectedVariationHairColor) {
    variationHairColorInput.value = DEFAULT_VARIATION_HAIR_COLOR;
  }
});
variationHairColorInput.addEventListener("input", () => {
  setSelectedVariationHairColor(variationHairColorInput.value);
  setVariationHairColorCustomVisibility(true);
  syncVariationHairColorUi();
});
templatePrompt.addEventListener("input", () => {
  syncTemplateNextButtonVisibility();
});
variationHairColorReset.addEventListener("click", () => {
  clearVariationHairColorSelection();
});
lightboxMarkupCanvas.addEventListener("pointerdown", handleLightboxMarkupPointerDown);
lightboxMarkupCanvas.addEventListener("pointermove", handleLightboxMarkupPointerMove);
lightboxMarkupCanvas.addEventListener("pointerup", finishLightboxMarkupStroke);
lightboxMarkupCanvas.addEventListener("pointercancel", finishLightboxMarkupStroke);
lightboxMarkupCanvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});
lightboxImage.addEventListener("load", () => {
  scheduleLightboxMarkupCanvasRedraw();
});
lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !lightbox.classList.contains("is-hidden")) {
    closeLightbox();
  }
});

restoreCapturedSalonPhoto();
syncTemplateNextButtonVisibility();
syncLightboxMarkupToolState();
variationHairColorInput.value = DEFAULT_VARIATION_HAIR_COLOR;
setVariationHairColorCustomVisibility(false);
setVariationHairColorPanelVisibility(false);
syncVariationHairColorUi();
preloadCommonHairColorImages();
window.addEventListener("resize", () => {
  scheduleLightboxMarkupCanvasRedraw();
});
window.addEventListener("beforeunload", resetPreviewUrl);
