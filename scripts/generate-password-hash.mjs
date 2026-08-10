import crypto from "node:crypto";
import readline from "node:readline";

const PBKDF2_ITERATIONS = 600_000;

async function readPipedPassword() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function readHiddenPassword() {
  if (typeof process.stdin.setRawMode !== "function") {
    throw new Error("A hidden terminal prompt is unavailable; provide the password via stdin.");
  }

  return new Promise((resolve, reject) => {
    let password = "";
    const previousRawMode = Boolean(process.stdin.isRaw);

    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(previousRawMode);
      process.stdin.pause();
      process.stderr.write("\n");
    };

    const onKeypress = (text, key = {}) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) {
        cleanup();
        reject(new Error("Password entry cancelled."));
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(password);
        return;
      }

      if (key.name === "backspace") {
        password = Array.from(password).slice(0, -1).join("");
        return;
      }

      if (!key.ctrl && !key.meta && typeof text === "string") {
        password += text;
      }
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);
    process.stderr.write("Admin password: ");
  });
}

if (process.argv.length > 2) {
  console.error("For safety, do not pass a password as a command-line argument.");
  process.exit(1);
}

let password;

try {
  password = process.stdin.isTTY
    ? await readHiddenPassword()
    : await readPipedPassword();
} catch (caughtError) {
  console.error(caughtError instanceof Error ? caughtError.message : "Password input failed.");
  process.exit(1);
}

if (!password) {
  console.error("A non-empty password is required.");
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const derived = crypto.pbkdf2Sync(
  password,
  salt,
  PBKDF2_ITERATIONS,
  32,
  "sha256"
);

const toBase64Url = (buffer) =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

console.log(
  `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`
);
