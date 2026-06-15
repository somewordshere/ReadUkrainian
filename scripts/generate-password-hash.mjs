import crypto from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/generate-password-hash.mjs <password>");
  process.exit(1);
}

const iterations = 100000;
const salt = crypto.randomBytes(16);
const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256");

const toBase64Url = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

console.log(
  `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(derived)}`
);
