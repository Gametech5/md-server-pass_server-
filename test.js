const cursor = document.getElementById("fake-cursor");
const woorden = Array.from(document.querySelectorAll(".woord"));
const placeholders = document.querySelectorAll(".placeholder");

cursor.style.left = "0px";
cursor.style.top = "0px";

// Slaapfunctie
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Cursor bewegen
function moveCursorTo(x, y) {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      const curX = parseFloat(cursor.style.left);
      const curY = parseFloat(cursor.style.top);
      const dx = x - curX;
      const dy = y - curY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
        clearInterval(interval);
        resolve();
      } else {
        const stepX = curX + dx * 0.2;
        const stepY = curY + dy * 0.2;
        cursor.style.left = `${stepX}px`;
        cursor.style.top = `${stepY}px`;
      }
    }, 16);
  });
}

// Cursor én woord samen bewegen
function moveCursorAndWordTogether(wordEl, toX, toY) {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      const curX = parseFloat(cursor.style.left);
      const curY = parseFloat(cursor.style.top);
      const dx = toX - curX;
      const dy = toY - curY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        cursor.style.left = `${toX}px`;
        cursor.style.top = `${toY}px`;
        wordEl.style.left = `${toX}px`;
        wordEl.style.top = `${toY}px`;
        clearInterval(interval);
        resolve();
      } else {
        const stepX = curX + dx * 0.2;
        const stepY = curY + dy * 0.2;
        cursor.style.left = `${stepX}px`;
        cursor.style.top = `${stepY}px`;
        wordEl.style.left = `${stepX}px`;
        wordEl.style.top = `${stepY}px`;
      }
    }, 16);
  });
}

// Start animatie
async function startOpbouw() {
  for (const wordEl of woorden) {
    const index = parseInt(wordEl.getAttribute("data-index"));
    const placeholder = document.querySelector(`.placeholder[data-index="${index}"]`);

    const wordRect = wordEl.getBoundingClientRect();
    const startX = wordRect.left;
    const startY = wordRect.top;

    const targetRect = placeholder.getBoundingClientRect();
    const targetX = targetRect.left;
    const targetY = targetRect.top;

    // Stap 1: Ga naar het woord
    await moveCursorTo(startX, startY);
    await sleep(150);

    // Stap 2: Sleep het woord naar zijn plek
    await moveCursorAndWordTogether(wordEl, targetX, targetY);
    await sleep(100);

    // Stap 3: Plaats het woord in de placeholder
    placeholder.textContent = wordEl.textContent;
    wordEl.style.display = "none";

    await sleep(300);
  }
}

startOpbouw();
