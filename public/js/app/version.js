const SITE_VERSION = "0.70";
const CHANGELOG_LINE = 74;
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
  versionElement.appendChild(versionLink);
  container.appendChild(versionElement);
}

renderSiteVersion();
