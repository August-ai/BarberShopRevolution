const salonLoginForm = document.getElementById("salonLoginForm");
const salonLoginHeading = document.getElementById("salonLoginHeading");
const salonUsernameInput = document.getElementById("salonUsernameInput");
const salonPasswordInput = document.getElementById("salonPasswordInput");
const salonLoginButton = document.getElementById("salonLoginButton");
const salonLoginStatus = document.getElementById("salonLoginStatus");

const API_BASE_URL = window.location.protocol === "file:" ? "http://localhost:3013" : window.location.origin;
const currentPathSegments = window.location.pathname.split("/").filter(Boolean);
const rawSalonSlug = decodeURIComponent(currentPathSegments[0] || "salon1");
const salonLabel = rawSalonSlug
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());

let isSubmitting = false;

const setStatus = (message) => {
  salonLoginStatus.textContent = message;
};

const setBusyState = (busy) => {
  isSubmitting = busy;
  salonUsernameInput.disabled = busy;
  salonPasswordInput.disabled = busy;
  salonLoginButton.disabled = busy;
};

salonLoginHeading.textContent = salonLabel;
salonUsernameInput.value = "Salon";
salonPasswordInput.value = "Salon";

salonLoginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  const username = salonUsernameInput.value.trim();
  const password = salonPasswordInput.value;

  if (!username || !password) {
    setStatus("Enter both the username and password.");
    return;
  }

  setBusyState(true);
  setStatus("Signing in...");

  try {
    const response = await fetch(`${API_BASE_URL}/api/salons/${encodeURIComponent(rawSalonSlug)}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password
      })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to sign in right now.");
    }

    window.location.assign(`/${encodeURIComponent(rawSalonSlug)}`);
  } catch (error) {
    setStatus(error.message);
    setBusyState(false);
  }
});
