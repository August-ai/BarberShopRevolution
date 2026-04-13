const openCameraButton = document.getElementById("openCameraButton");
const openUploadButton = document.getElementById("openUploadButton");
const capturePhotoInput = document.getElementById("capturePhotoInput");
const uploadPhotoInput = document.getElementById("uploadPhotoInput");
const previewStep = document.getElementById("previewStep");
const successStep = document.getElementById("successStep");
const captureStage = document.getElementById("captureStage");
const capturePreviewImage = document.getElementById("capturePreviewImage");
const savedPreviewImage = document.getElementById("savedPreviewImage");
const retakeCaptureButton = document.getElementById("retakeCaptureButton");
const uploadCaptureButton = document.getElementById("uploadCaptureButton");
const captureAnotherButton = document.getElementById("captureAnotherButton");
const captureStatusMessage = document.getElementById("captureStatusMessage");
const salonNameHeading = document.getElementById("salonNameHeading");
const savedSalonName = document.getElementById("savedSalonName");
const savedPhotoId = document.getElementById("savedPhotoId");
const savedTimestamp = document.getElementById("savedTimestamp");
const viewSavedPhotoLink = document.getElementById("viewSavedPhotoLink");
const continueToSalonButton = document.getElementById("continueToSalonButton");

const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3013" : window.location.origin;
const CAPTURED_PHOTO_STORAGE_KEY = "capturedSalonPhoto";
const currentPathSegments = window.location.pathname.split("/").filter(Boolean);
const rawSalonSlug = decodeURIComponent(currentPathSegments[0] || "salon1");
const salonLabel = rawSalonSlug
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());
const IMAGE_TRANSFER_MAX_DIMENSION = 1600;
const IMAGE_TRANSFER_QUALITY = 0.86;
const IMAGE_TRANSFER_MIME_TYPE = "image/jpeg";

let previewUrl = "";
let isUploading = false;
let lastCaptureSource = "camera";

const setStatus = (message) => {
  captureStatusMessage.textContent = message;
};

const setBusyState = (busy) => {
  isUploading = busy;
  openCameraButton.disabled = busy;
  openUploadButton.disabled = busy;
  retakeCaptureButton.disabled = busy;
  uploadCaptureButton.disabled = busy;
  captureAnotherButton.disabled = busy;
  continueToSalonButton.disabled = busy;
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

const openCameraPicker = async () => {
  lastCaptureSource = "camera";
  await openInputPicker(capturePhotoInput);
};

const openUploadPicker = async () => {
  lastCaptureSource = "upload";
  await openInputPicker(uploadPhotoInput);
};

const reopenLastCapturePicker = async () => {
  if (lastCaptureSource === "upload") {
    await openUploadPicker();
    return;
  }

  await openCameraPicker();
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

  resetPreviewUrl();
  capturePhotoInput.value = "";
  uploadPhotoInput.value = "";
  capturePreviewImage.removeAttribute("src");
  savedPreviewImage.removeAttribute("src");
  previewStep.classList.add("is-hidden");
  successStep.classList.add("is-hidden");
  captureStage.classList.remove("is-hidden");
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
  resetPreviewUrl();
  previewUrl = URL.createObjectURL(file);
  capturePreviewImage.src = previewUrl;
  captureStage.classList.add("is-hidden");
  successStep.classList.add("is-hidden");
  previewStep.classList.remove("is-hidden");
  setStatus(`Ready to save ${file.name} for ${salonLabel}.`);
};

const redirectToSalonHomepage = () => {
  window.location.assign(`/${encodeURIComponent(rawSalonSlug)}`);
};

const handleUpload = async () => {
  const [selectedFile] = capturePhotoInput.files;

  if (!selectedFile) {
    setStatus("Take a picture before saving.");
    return;
  }

  setBusyState(true);
  setStatus("Uploading photo...");

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
    const imageUrl = new URL(photo.imageUrl, window.location.origin).href;

    savedPreviewImage.src = imageUrl;
    savedSalonName.textContent = photo.salonName;
    savedPhotoId.textContent = photo.id;
    savedTimestamp.textContent = new Date(photo.storedAt).toLocaleString();
    viewSavedPhotoLink.href = imageUrl;
    captureStage.classList.add("is-hidden");
    previewStep.classList.add("is-hidden");
    successStep.classList.remove("is-hidden");
    sessionStorage.setItem(CAPTURED_PHOTO_STORAGE_KEY, JSON.stringify(photo));
    setStatus(`Photo saved for ${photo.salonName}. Continue when you're ready.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusyState(false);
  }
};

salonNameHeading.textContent = salonLabel;
savedSalonName.textContent = salonLabel;

openCameraButton.addEventListener("click", openCameraPicker);
openUploadButton.addEventListener("click", openUploadPicker);
retakeCaptureButton.addEventListener("click", () => {
  if (isUploading) {
    return;
  }

  resetFlow();
  reopenLastCapturePicker();
});
uploadCaptureButton.addEventListener("click", handleUpload);
continueToSalonButton.addEventListener("click", redirectToSalonHomepage);
captureAnotherButton.addEventListener("click", () => {
  resetFlow();
  reopenLastCapturePicker();
});

const handleSelectedCaptureFile = (selectedFile, source = "camera") => {
  if (!selectedFile) {
    setStatus("");
    return;
  }

  lastCaptureSource = source;
  showPreview(selectedFile);
};

capturePhotoInput.addEventListener("change", () => {
  const [selectedFile] = capturePhotoInput.files;
  handleSelectedCaptureFile(selectedFile, "camera");
});

uploadPhotoInput.addEventListener("change", () => {
  const [selectedFile] = uploadPhotoInput.files;
  handleSelectedCaptureFile(selectedFile, "upload");
});

window.addEventListener("beforeunload", resetPreviewUrl);
