const SITE_VERSION = "0.34";

function renderSiteVersion() {
  const container = document.querySelector(".page-shell") || document.body;
  const versionElement = document.createElement("footer");

  versionElement.className = "site-version";
  versionElement.textContent = `Версія ${SITE_VERSION}`;
  container.appendChild(versionElement);
}

renderSiteVersion();
