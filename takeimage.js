const openCameraButton = document.getElementById("openCameraButton");
const openUploadButton = document.getElementById("openUploadButton");
const capturePhotoInput = document.getElementById("capturePhotoInput");
const uploadPhotoInput = document.getElementById("uploadPhotoInput");
const captureStage = document.getElementById("captureStage");
const captureSuccessPanel = document.getElementById("captureSuccessPanel");
const sendAnotherCameraButton = document.getElementById("sendAnotherCameraButton");
const sendAnotherUploadButton = document.getElementById("sendAnotherUploadButton");
const previewStep = document.getElementById("previewStep");
const capturePreviewImage = document.getElementById("capturePreviewImage");
const closePreviewButton = document.getElementById("closePreviewButton");
const retakeCaptureButton = document.getElementById("retakeCaptureButton");
const captureStatusMessage = document.getElementById("captureStatusMessage");
const previewStatusMessage = document.getElementById("previewStatusMessage");
const continueToSalonButton = document.getElementById("continueToSalonButton");
const previewActionRow = document.getElementById("previewActionRow");

const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3013" : window.location.origin;
const CAPTURED_PHOTO_STORAGE_KEY = "capturedSalonPhoto";
const currentPathSegments = window.location.pathname.split("/").filter(Boolean);
const rawSalonSlug = decodeURIComponent(currentPathSegments[0] || "salon1");
const IMAGE_TRANSFER_MAX_DIMENSION = 1600;
const IMAGE_TRANSFER_QUALITY = 0.86;
const IMAGE_TRANSFER_MIME_TYPE = "image/jpeg";

let previewUrl = "";
let isUploading = false;
let selectedCaptureFile = null;
let hasPreviewImage = false;
let hasUploadSuccess = false;

const initializeTakeImagePage = () => {
  isUploading = false;
  sessionStorage.removeItem(CAPTURED_PHOTO_STORAGE_KEY);
  resetFlow();
};

const setStatus = (message) => {
  captureStatusMessage.textContent = message;
  previewStatusMessage.textContent = message;
};

const syncControlState = () => {
  openCameraButton.disabled = isUploading || hasPreviewImage;
  openUploadButton.disabled = isUploading || hasPreviewImage;
  closePreviewButton.disabled = isUploading || !hasPreviewImage;
  retakeCaptureButton.disabled = isUploading || !hasPreviewImage;
  continueToSalonButton.disabled = isUploading || !hasPreviewImage;
  sendAnotherCameraButton.disabled = isUploading;
  sendAnotherUploadButton.disabled = isUploading;
};

const syncViewState = () => {
  captureStage.hidden = hasUploadSuccess;
  captureStage.classList.toggle("is-hidden", hasUploadSuccess);
  captureStage.inert = hasUploadSuccess || hasPreviewImage;

  captureSuccessPanel.hidden = !hasUploadSuccess;
  captureSuccessPanel.classList.toggle("is-hidden", !hasUploadSuccess);
  captureSuccessPanel.inert = !hasUploadSuccess;

  previewStep.hidden = !hasPreviewImage;
  previewStep.classList.toggle("is-hidden", !hasPreviewImage);
  previewStep.inert = !hasPreviewImage;
  previewStep.setAttribute("aria-hidden", String(!hasPreviewImage));

  document.body.classList.toggle("capture-preview-open", hasPreviewImage);
  capturePreviewImage.hidden = !hasPreviewImage;
  previewActionRow.hidden = !hasPreviewImage;
  closePreviewButton.hidden = !hasPreviewImage;
  retakeCaptureButton.hidden = !hasPreviewImage;
  continueToSalonButton.hidden = !hasPreviewImage;
  syncControlState();
};

const setBusyState = (busy) => {
  isUploading = busy;
  syncControlState();
};

const setPreviewState = (hasImage) => {
  hasPreviewImage = hasImage;
  syncViewState();

  if (hasImage) {
    closePreviewButton.focus({ preventScroll: true });
  }
};

const setSuccessState = (hasSuccess) => {
  hasUploadSuccess = hasSuccess;
  syncViewState();
};

const openInputPicker = async (inputElement) => {
  if (!inputElement) {
    return;
  }

  if (typeof inputElement.showPicker === "function") {
    try {
      inputElement.showPicker();
      return;
    } catch (_error) {
      // Fall back to click when the picker API is unavailable.
    }
  }

  inputElement.click();
};

const openCameraPicker = async (event) => {
  event?.preventDefault();
  event?.stopPropagation();

  if (isUploading) {
    return;
  }

  await openInputPicker(capturePhotoInput);
};

const openUploadPicker = async (event) => {
  event?.preventDefault();
  event?.stopPropagation();

  if (isUploading) {
    return;
  }

  await openInputPicker(uploadPhotoInput);
};

const resetPreviewUrl = () => {
  if (!previewUrl) {
    return;
  }

  URL.revokeObjectURL(previewUrl);
  previewUrl = "";
};

const clearSelectedCapture = () => {
  selectedCaptureFile = null;
  capturePhotoInput.value = "";
  uploadPhotoInput.value = "";
  capturePreviewImage.removeAttribute("src");
  resetPreviewUrl();
};

const resetFlow = () => {
  if (isUploading) {
    return;
  }

  clearSelectedCapture();
  setPreviewState(false);
  setSuccessState(false);
  setStatus("");
};

const dismissPreview = () => {
  if (isUploading || !hasPreviewImage) {
    return;
  }

  closePreviewButton.blur();
  resetFlow();
};

const blobToDataUrl = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(blob);
  });
};

const loadImageFromObjectUrl = (objectUrl) => {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to process the selected image."));
    image.src = objectUrl;
  });
};

const optimizeImageBlobForTransfer = async (blob) => {
  if (!(blob instanceof Blob) || !String(blob.type || "").startsWith("image/")) {
    return blobToDataUrl(blob);
  }

  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadImageFromObjectUrl(objectUrl);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

    if (!sourceWidth || !sourceHeight) {
      return blobToDataUrl(blob);
    }

    const scale = Math.min(1, IMAGE_TRANSFER_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return blobToDataUrl(blob);
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return canvas.toDataURL(IMAGE_TRANSFER_MIME_TYPE, IMAGE_TRANSFER_QUALITY);
  } catch (_error) {
    return blobToDataUrl(blob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const showPreview = (file) => {
  selectedCaptureFile = file;
  setSuccessState(false);
  resetPreviewUrl();
  previewUrl = URL.createObjectURL(file);
  capturePreviewImage.src = previewUrl;
  setPreviewState(true);
  openCameraButton.blur();
  openUploadButton.blur();
  setStatus("");
};

const showUploadSuccess = (photo) => {
  if (photo) {
    sessionStorage.setItem(CAPTURED_PHOTO_STORAGE_KEY, JSON.stringify(photo));
  }

  clearSelectedCapture();
  setPreviewState(false);
  setSuccessState(true);
  setStatus("");
};

const handleUpload = async () => {
  const selectedFile = selectedCaptureFile;

  if (!selectedFile) {
    setStatus("Choose an image first.");
    return;
  }

  setBusyState(true);
  setStatus("");

  try {
    const imageBase64 = await optimizeImageBlobForTransfer(selectedFile);
    const response = await fetch(`${API_BASE_URL}/api/salons/${encodeURIComponent(rawSalonSlug)}/photos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        imageBase64,
        originalName: selectedFile.name
      })
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to save the photo.");
    }

    showUploadSuccess(payload.photo);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusyState(false);
  }
};

const handleSelectedCaptureFile = (selectedFile) => {
  if (!selectedFile) {
    setStatus("");
    return;
  }

  showPreview(selectedFile);
};

openCameraButton.addEventListener("click", openCameraPicker);
openUploadButton.addEventListener("click", openUploadPicker);
sendAnotherCameraButton.addEventListener("click", async (event) => {
  setSuccessState(false);
  await openCameraPicker(event);
});
sendAnotherUploadButton.addEventListener("click", async (event) => {
  setSuccessState(false);
  await openUploadPicker(event);
});
closePreviewButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  dismissPreview();
});
previewStep.addEventListener("click", (event) => {
  if (event.target !== previewStep) {
    return;
  }

  dismissPreview();
});
retakeCaptureButton.addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (isUploading) {
    return;
  }

  retakeCaptureButton.blur();
  resetFlow();
  await openCameraPicker();
});
continueToSalonButton.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  continueToSalonButton.blur();
  handleUpload();
});

capturePhotoInput.addEventListener("change", () => {
  const [selectedFile] = capturePhotoInput.files;
  handleSelectedCaptureFile(selectedFile);
});

uploadPhotoInput.addEventListener("change", () => {
  const [selectedFile] = uploadPhotoInput.files;
  handleSelectedCaptureFile(selectedFile);
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  dismissPreview();
});

window.addEventListener("pageshow", () => {
  initializeTakeImagePage();
});

window.addEventListener("beforeunload", resetPreviewUrl);

initializeTakeImagePage();
