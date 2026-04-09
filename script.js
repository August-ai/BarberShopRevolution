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
const templateCount = document.getElementById("templateCount");
const generationPanel = document.getElementById("generationPanel");
const resultGrid = document.getElementById("resultGrid");
const statusMessage = document.getElementById("statusMessage");
const heroCard = document.querySelector(".hero-card");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const lightboxClose = document.getElementById("lightboxClose");
const generationLabel = document.getElementById("generationLabel");
const generationTitle = document.getElementById("generationTitle");

const hairstyleLibrary = Array.isArray(window.HAIRSTYLE_PROMPTS) ? window.HAIRSTYLE_PROMPTS : [];
const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3013" : "";

let previewUrl = "";
let isGenerating = false;
let templateStyles = [];
let selectedTemplateIds = new Set();

const setStatus = (message) => {
  statusMessage.textContent = message;
};

const openLightbox = (imageUrl, imageAlt) => {
  lightboxImage.src = imageUrl;
  lightboxImage.alt = imageAlt;
  lightbox.classList.remove("is-hidden");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
};

const closeLightbox = () => {
  lightbox.classList.add("is-hidden");
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImage.removeAttribute("src");
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
  templateNextButton.disabled = busy;
  templatePrompt.disabled = busy;
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

const resetPreviewUrl = () => {
  if (!previewUrl) {
    return;
  }

  URL.revokeObjectURL(previewUrl);
  previewUrl = "";
};

const showPreviewStep = () => {
  captureStep.classList.add("is-hidden");
  optionPanel.classList.add("is-hidden");
  templatePanel.classList.add("is-hidden");
  previewPanel.classList.remove("is-hidden");
  heroCard.classList.remove("is-template-mode");
};

const showOptionStep = () => {
  captureStep.classList.add("is-hidden");
  previewPanel.classList.add("is-hidden");
  templatePanel.classList.add("is-hidden");
  optionPanel.classList.remove("is-hidden");
  heroCard.classList.remove("is-template-mode");
};

const showTemplateStep = () => {
  captureStep.classList.add("is-hidden");
  previewPanel.classList.add("is-hidden");
  optionPanel.classList.add("is-hidden");
  templatePanel.classList.remove("is-hidden");
  heroCard.classList.add("is-template-mode");
};

const showGenerationPanel = () => {
  generationPanel.classList.remove("is-hidden");
  heroCard.classList.add("has-results");
};

const hideGenerationPanel = () => {
  generationPanel.classList.add("is-hidden");
  resultGrid.innerHTML = "";
  heroCard.classList.remove("has-results");
};

const resetToCaptureStep = () => {
  resetPreviewUrl();
  photoInput.value = "";
  photoPreview.removeAttribute("src");
  previewPanel.classList.add("is-hidden");
  optionPanel.classList.add("is-hidden");
  templatePanel.classList.add("is-hidden");
  hideGenerationPanel();
  selectedTemplateIds = new Set();
  templatePrompt.value = "";
  captureStep.classList.remove("is-hidden");
  heroCard.classList.remove("is-template-mode");
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
  const [selectedFile] = photoInput.files;

  if (!selectedFile) {
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

const fileToDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
};

const setGenerationHeading = (label, title) => {
  generationLabel.textContent = label;
  generationTitle.textContent = title;
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

  templateStyles = payload.styles || [];
  return templateStyles;
};

const toggleTemplateSelection = (templateId) => {
  if (selectedTemplateIds.has(templateId)) {
    selectedTemplateIds.delete(templateId);
  } else {
    selectedTemplateIds.add(templateId);
  }

  updateTemplateCount();
  renderTemplateGrid();
};

const renderTemplateGrid = () => {
  templateGrid.innerHTML = "";

  templateStyles.forEach((style) => {
    const card = document.createElement("article");
    const isSelected = selectedTemplateIds.has(style.id);
    card.className = `template-card${isSelected ? " is-selected" : ""}`;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", String(isSelected));
    card.innerHTML = `
      <span class="template-card-check">&#10003;</span>
      <div class="template-card-media">
        <img src="${style.imageUrl}" alt="${style.name} hairstyle template">
      </div>
      <div>
        <h3 class="template-card-name">${style.name}</h3>
      </div>
    `;

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
      <p class="result-note">Sending this look to Nano Banana.</p>
    </div>
  `;

  resultGrid.appendChild(card);
  return card;
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

  description.textContent = result.sourcePrompt;

  if (result.imageUrl) {
    media.innerHTML = `<img src="${result.imageUrl}" alt="${result.name} generated hairstyle result">`;
    media.classList.add("has-image");
    badge.textContent = "Ready";
    badge.classList.remove("warning");
    badge.classList.add("success");
    note.textContent = result.testMode
      ? "Test mode is on, so this is your original image shown as a placeholder."
      : "Nano Banana returned a generated variation.";
    media.onclick = () => openLightbox(result.imageUrl, `${result.name} expanded generated hairstyle result`);
    return;
  }

  media.classList.remove("has-image");
  media.onclick = null;
  badge.textContent = "Error";
  badge.classList.remove("success");
  badge.classList.add("warning");
  note.textContent = result.errorMessage || "The generation request did not return an image.";
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

const handleRandomHairstyles = async () => {
  const [selectedFile] = photoInput.files;

  if (!selectedFile) {
    setStatus("Please take a picture before generating hairstyles.");
    return;
  }

  if (hairstyleLibrary.length < 5) {
    setStatus("The hairstyle library is incomplete.");
    return;
  }

  const selectedHairstyles = pickRandomHairstyles(hairstyleLibrary, 5);
  const imageBase64 = await fileToDataUrl(selectedFile);

  resultGrid.innerHTML = "";
  const cards = selectedHairstyles.map(createResultCard);
  setGenerationHeading("Random Set", "Five hairstyle directions");
  showGenerationPanel();
  setBusyState(true);
  setStatus("Generating 5 hairstyle variations. In test mode, the original image will be shown.");

  try {
    const results = await requestRandomHairstyles({
      imageBase64,
      hairstyles: selectedHairstyles
    });

    renderGenerationResults(cards, results);
    setStatus("Your 5 Nano Banana hairstyle variations are ready.");
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
    setBusyState(false);
  }
};

const handleOpenTemplates = async () => {
  const [selectedFile] = photoInput.files;

  if (!selectedFile) {
    setStatus("Please take a picture before opening templates.");
    return;
  }

  hideGenerationPanel();
  showTemplateStep();
  setStatus("Loading hairstyle templates.");

  try {
    await ensureTemplateStyles();
    updateTemplateCount();
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
  const [selectedFile] = photoInput.files;

  if (!selectedFile) {
    setStatus("Please take a picture before continuing.");
    return;
  }

  const selectedTemplates = templateStyles.filter((style) => selectedTemplateIds.has(style.id));

  if (selectedTemplates.length === 0) {
    setStatus("Select at least one template before clicking next.");
    return;
  }

  const imageBase64 = await fileToDataUrl(selectedFile);
  const extraPrompt = templatePrompt.value.trim();

  resultGrid.innerHTML = "";
  const cards = selectedTemplates.map(createResultCard);
  setGenerationHeading("Template Set", "Chosen hairstyle templates");
  showGenerationPanel();
  setBusyState(true);
  setStatus("Generating your selected template looks. In test mode, the original image will be shown.");

  try {
    const results = await requestTemplateHairstyles({
      imageBase64,
      templates: selectedTemplates,
      extraPrompt
    });

    renderGenerationResults(cards, results);
    setStatus("Your selected template results are ready.");
  } catch (error) {
    const fallbackResults = selectedTemplates.map((template) => ({
      name: template.name,
      sourcePrompt: template.prompt,
      finalPrompt: `${template.prompt} ${extraPrompt}`.trim(),
      errorMessage: error.message
    }));

    renderGenerationResults(cards, fallbackResults);
    setStatus(error.message);
  } finally {
    setBusyState(false);
  }
};

captureButton.addEventListener("click", openPicker);

if (window.location.protocol === "file:") {
  setStatus("Open the app through http://localhost:3013 after running npm start. Opening index.html directly can block API requests.");
}

photoInput.addEventListener("change", () => {
  const [selectedFile] = photoInput.files;

  if (!selectedFile) {
    setStatus("");
    return;
  }

  resetPreviewUrl();
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

window.addEventListener("beforeunload", resetPreviewUrl);
