const openCameraButton = document.getElementById("openCameraButton");
const openUploadButton = document.getElementById("openUploadButton");
const capturePhotoInput = document.getElementById("capturePhotoInput");
const uploadPhotoInput = document.getElementById("uploadPhotoInput");
const previewStep = document.getElementById("previewStep");
const captureStage = document.getElementById("captureStage");
const capturePreviewImage = document.getElementById("capturePreviewImage");
const retakeCaptureButton = document.getElementById("retakeCaptureButton");
const captureStatusMessage = document.getElementById("captureStatusMessage");
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

const setStatus = (message) => {
  captureStatusMessage.textContent = message;
};

const syncControlState = () => {
  openCameraButton.disabled = isUploading || hasPreviewImage;
  openUploadButton.disabled = isUploading || hasPreviewImage;
  retakeCaptureButton.disabled = isUploading || !hasPreviewImage;
  continueToSalonButton.disabled = isUploading || !hasPreviewImage;
};

const setBusyState = (busy) => {
  isUploading = busy;
  syncControlState();
};

const setPreviewState = (hasImage) => {
  hasPreviewImage = hasImage;
  captureStage.hidden = hasImage;
  captureStage.classList.toggle("is-hidden", hasImage);
  captureStage.inert = hasImage;
  previewStep.hidden = !hasImage;
  previewStep.classList.toggle("is-hidden", !hasImage);
  previewStep.inert = !hasImage;
  capturePreviewImage.hidden = !hasImage;
  previewActionRow.hidden = !hasImage;
  retakeCaptureButton.hidden = !hasImage;
  continueToSalonButton.hidden = !hasImage;
  syncControlState();
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

const resetFlow = () => {
  if (isUploading) {
    return;
  }

  selectedCaptureFile = null;
  resetPreviewUrl();
  capturePhotoInput.value = "";
  uploadPhotoInput.value = "";
  capturePreviewImage.removeAttribute("src");
  setPreviewState(false);
  setStatus("");
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
  resetPreviewUrl();
  previewUrl = URL.createObjectURL(file);
  capturePreviewImage.src = previewUrl;
  setPreviewState(true);
  openCameraButton.blur();
  openUploadButton.blur();
  setStatus("");
};

const redirectToSalonHomepage = () => {
  window.location.assign(`/${encodeURIComponent(rawSalonSlug)}`);
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

    const { photo } = payload;
    sessionStorage.setItem(CAPTURED_PHOTO_STORAGE_KEY, JSON.stringify(photo));
    redirectToSalonHomepage();
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusyState(false);
  }
};

setPreviewState(false);

openCameraButton.addEventListener("click", openCameraPicker);
openUploadButton.addEventListener("click", openUploadPicker);
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

const handleSelectedCaptureFile = (selectedFile) => {
  if (!selectedFile) {
    setStatus("");
    return;
  }

  showPreview(selectedFile);
};

capturePhotoInput.addEventListener("change", () => {
  const [selectedFile] = capturePhotoInput.files;
  handleSelectedCaptureFile(selectedFile);
});

uploadPhotoInput.addEventListener("change", () => {
  const [selectedFile] = uploadPhotoInput.files;
  handleSelectedCaptureFile(selectedFile);
});

window.addEventListener("beforeunload", resetPreviewUrl);
