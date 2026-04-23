import crypto from "crypto";

const [,, salonSlug = "", username = "", password = ""] = process.argv;

if (!salonSlug || !username || !password) {
  console.error("Usage: node scripts/generate-salon-access.mjs <salon-slug> <username> <password>");
  process.exit(1);
}

const normalizedSalonSlug = String(salonSlug)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-")
  .replace(/^-+|-+$/g, "") || "default-salon";

const salt = crypto.randomBytes(16).toString("hex");
const keyLength = 64;
const hash = crypto.scryptSync(password, salt, keyLength).toString("hex");

console.log(JSON.stringify({
  [normalizedSalonSlug]: {
    displayName: normalizedSalonSlug
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase()),
    username,
    password: {
      algorithm: "scrypt",
      keyLength,
      salt,
      hash
    }
  }
}, null, 2));
