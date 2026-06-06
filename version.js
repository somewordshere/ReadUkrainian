const SITE_VERSION = "0.62";

function renderSiteVersion() {
  const container = document.querySelector(".page-shell") || document.body;
  const versionElement = document.createElement("footer");
  const versionLink = document.createElement("a");

  versionElement.className = "site-version";
  versionLink.className = "site-version-link";
  versionLink.href = "https://github.com/somewordshere/ReadUkrainian/blob/main/change.log";
  versionLink.target = "_blank";
  versionLink.rel = "noopener noreferrer";
  versionLink.textContent = `Версія ${SITE_VERSION}`;
  versionLink.setAttribute("aria-label", "Відкрити список змін");
  versionElement.appendChild(versionLink);
  container.appendChild(versionElement);
}

renderSiteVersion();
