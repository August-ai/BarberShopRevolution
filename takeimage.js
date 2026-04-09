const openCameraButton = document.getElementById("openCameraButton");
const capturePhotoInput = document.getElementById("capturePhotoInput");
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

const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3013" : window.location.origin;
const currentPathSegments = window.location.pathname.split("/").filter(Boolean);
const rawSalonSlug = decodeURIComponent(currentPathSegments[0] || "salon1");
const salonLabel = rawSalonSlug
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());

let previewUrl = "";
let isUploading = false;

const setStatus = (message) => {
  captureStatusMessage.textContent = message;
};

const setBusyState = (busy) => {
  isUploading = busy;
  openCameraButton.disabled = busy;
  retakeCaptureButton.disabled = busy;
  uploadCaptureButton.disabled = busy;
  captureAnotherButton.disabled = busy;
};

const openPicker = async () => {
  if (typeof capturePhotoInput.showPicker === "function") {
    try {
      capturePhotoInput.showPicker();
      return;
    } catch (_error) {
      // Fall back to click when the picker API is unavailable.
    }
  }

  capturePhotoInput.click();
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
  capturePreviewImage.removeAttribute("src");
  savedPreviewImage.removeAttribute("src");
  previewStep.classList.add("is-hidden");
  successStep.classList.add("is-hidden");
  captureStage.classList.remove("is-hidden");
  setStatus("");
};

const fileToDataUrl = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the selected image."));
    reader.readAsDataURL(file);
  });
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

const handleUpload = async () => {
  const [selectedFile] = capturePhotoInput.files;

  if (!selectedFile) {
    setStatus("Take a picture before saving.");
    return;
  }

  setBusyState(true);
  setStatus("Uploading photo...");

  try {
    const imageBase64 = await fileToDataUrl(selectedFile);
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
    previewStep.classList.add("is-hidden");
    successStep.classList.remove("is-hidden");
    setStatus(`Photo saved successfully for ${photo.salonName}.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusyState(false);
  }
};

salonNameHeading.textContent = salonLabel;
savedSalonName.textContent = salonLabel;

openCameraButton.addEventListener("click", openPicker);
retakeCaptureButton.addEventListener("click", () => {
  if (isUploading) {
    return;
  }

  resetFlow();
  openPicker();
});
uploadCaptureButton.addEventListener("click", handleUpload);
captureAnotherButton.addEventListener("click", () => {
  resetFlow();
  openPicker();
});

capturePhotoInput.addEventListener("change", () => {
  const [selectedFile] = capturePhotoInput.files;

  if (!selectedFile) {
    setStatus("");
    return;
  }

  showPreview(selectedFile);
});

window.addEventListener("beforeunload", resetPreviewUrl);
