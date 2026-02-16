// pages/loading.js
// Bloom loading screen with falling flowers + progress bar

export function Loading() {
  return `
    <section class="bloom-loading">
      <div class="bloom-fall" aria-hidden="true" id="bloomFall"></div>

      <div class="bloom-loading-card">
        <div class="bloom-loading-icon" aria-hidden="true">🌸</div>

        <h2 class="bloom-loading-title">Preparing Bloom</h2>
        <p class="bloom-loading-sub">Getting things ready just for you…</p>

        <div class="bloom-loading-bar">
          <div id="loaderBar" class="bloom-loading-bar-fill"></div>
        </div>

        <div class="bloom-loading-tiny" id="loaderText">Loading… 0%</div>
      </div>
    </section>
  `;
}

/**
 * Shows the loader, animates progress, then routes to targetHash
 * Example: mountLoading({ targetHash: "#/dashboard" })
 */
export function mountLoading({ targetHash = "#/dashboard", minMs = 900 } = {}) {
  // Spawn petals
  const fall = document.getElementById("bloomFall");
  if (fall) startFallingFlowers(fall);

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

      // Ensure it stays visible at least minMs (feels smoother)
      const elapsed = Date.now() - startTime;
      const wait = Math.max(0, minMs - elapsed);

      setTimeout(() => {
        window.location.hash = targetHash;
      }, wait);
    }
  }, 220);
}

function startFallingFlowers(container) {
  // Prevent duplicates if re-mounted
  container.innerHTML = "";

  const flowerChoices = ["🌸", "🌺", "💮"];
  const max = 18;

  for (let i = 0; i < max; i++) {
    const el = document.createElement("span");
    el.className = "bloom-petal";
    el.textContent = flowerChoices[i % flowerChoices.length];

    const left = Math.random() * 100;        // vw %
    const delay = Math.random() * 2.5;       // seconds
    const dur = 4 + Math.random() * 4;       // seconds
    const size = 14 + Math.random() * 18;    // px
    const drift = (Math.random() * 40) - 20; // px
    const spin = (Math.random() * 240) - 120;

    el.style.left = `${left}vw`;
    el.style.animationDelay = `${delay}s`;
    el.style.animationDuration = `${dur}s`;
    el.style.fontSize = `${size}px`;
    el.style.setProperty("--drift", `${drift}px`);
    el.style.setProperty("--spin", `${spin}deg`);

    container.appendChild(el);
  }
}
