// /js/loadingOverlay.js
export function showBloomLoader({ message = "Preparing Bloom", sub = "Getting things ready just for you…" } = {}) {
  // prevent duplicates
  if (document.getElementById("bloomLoaderOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "bloomLoaderOverlay";
  overlay.className = "bloom-loading-overlay";

  overlay.innerHTML = `
    <div class="bloom-fall" aria-hidden="true" id="bloomFall"></div>

    <div class="bloom-loading-card" role="status" aria-live="polite">
      <div class="bloom-loading-icon" aria-hidden="true">🌸</div>
      <h2 class="bloom-loading-title">${message}</h2>
      <p class="bloom-loading-sub">${sub}</p>

      <div class="bloom-loading-bar">
        <div id="loaderBar" class="bloom-loading-bar-fill"></div>
      </div>
      <div class="bloom-loading-tiny" id="loaderText">Loading… 0%</div>
    </div>
  `;

  document.body.appendChild(overlay);
  startFallingFlowers(document.getElementById("bloomFall"));
}

export function runBloomLoader({ targetUrl, minMs = 900 } = {}) {
  return new Promise((resolve) => {
    let progress = 0;
    const bar = document.getElementById("loaderBar");
    const text = document.getElementById("loaderText");
    const startTime = Date.now();

    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 10) + 6; // 6–15
      if (progress >= 100) progress = 100;

      if (bar) bar.style.width = progress + "%";
      if (text) text.textContent = `Loading… ${progress}%`;

      if (progress === 100) {
        clearInterval(interval);

        const elapsed = Date.now() - startTime;
        const wait = Math.max(0, minMs - elapsed);

        setTimeout(() => {
          if (targetUrl) window.location.href = targetUrl;
          resolve();
        }, wait);
      }
    }, 220);
  });
}

function startFallingFlowers(container) {
  if (!container) return;
  container.innerHTML = "";

  const flowers = ["🌸","🌺","💮","🌷","🌼","🌹"];
  const max = 120;

  for (let i = 0; i < max; i++) {
    const el = document.createElement("span");
    el.className = "bloom-petal";
    el.textContent = flowers[i % flowers.length];

    const left = Math.random() * 100;        // vw
    const delay = Math.random() * 2.5;       // s
    const dur = 2.2 + Math.random() * 2;       // s
    const size = 14 + Math.random() * 18;    // px
    const drift = (Math.random() * 120) - 60; // px
    const spin = (Math.random() * 720) - 360;

    el.style.left = `${left}vw`;
    el.style.animationDelay = `${delay}s`;
    el.style.animationDuration = `${dur}s`;
    el.style.fontSize = `${size}px`;
    el.style.setProperty("--drift", `${drift}px`);
    el.style.setProperty("--spin", `${spin}deg`);

    container.appendChild(el);
  }
}
