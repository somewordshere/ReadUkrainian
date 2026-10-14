const SITE_VERSION = "1.11";
const CHANGELOG_LINE = 117;
const CHANGELOG_URL = `https://github.com/somewordshere/ReadUkrainian/blob/main/docs/change.log#L${CHANGELOG_LINE}`;

function renderSiteVersion() {
  const container = document.querySelector(".page-shell") || document.body;
  const versionElement = document.createElement("footer");
  const versionLink = document.createElement("a");

  versionElement.className = "site-version";
  versionLink.className = "site-version-link";
  versionLink.href = CHANGELOG_URL;
  versionLink.target = "_blank";
  versionLink.rel = "noopener noreferrer";
  versionLink.textContent = `Версія ${SITE_VERSION}`;
  versionLink.setAttribute("aria-label", "Відкрити список змін");

  // Learners' pages link to About, privacy and the feedback form; the admin does not.
  if (document.body.classList.contains("public-page") && !document.body.classList.contains("about-page")) {
    const aboutLink = document.createElement("a");
    aboutLink.className = "site-version-link";
    aboutLink.href = "./about.html";
    aboutLink.textContent = "Про сайт і відгук";
    const separator = document.createElement("span");
    separator.className = "site-version-separator";
    separator.setAttribute("aria-hidden", "true");
    separator.textContent = "·";
    versionElement.append(aboutLink, separator);
  }
  versionElement.appendChild(versionLink);
  container.appendChild(versionElement);
}

renderSiteVersion();
