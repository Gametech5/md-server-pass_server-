const cursor = document.getElementById("fake-cursor");
const woorden = Array.from(document.querySelectorAll(".woord"));
const placeholders = document.querySelectorAll(".placeholder");

cursor.style.left = "0px";
cursor.style.top = "0px";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function moveTo(x, y, callback) {
  return new Promise(resolve => {
    const interval = setInterval(() => {
      let curX = parseFloat(cursor.style.left);
      let curY = parseFloat(cursor.style.top);
      let dx = x - curX;
      let dy = y - curY;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 2) {
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
        if (callback) callback(x, y);
        clearInterval(interval);
        resolve();
      } else {
        curX += dx * 0.15;
        curY += dy * 0.15;
        cursor.style.left = `${curX}px`;
        cursor.style.top = `${curY}px`;
        if (callback) callback(curX, curY);
      }
    }, 16);
  });
}

async function start() {
  for (const woord of woorden) {
    const index = parseInt(woord.dataset.index);
    const placeholder = document.querySelector(`.placeholder[data-index="${index}"]`);

    const wordRect = woord.getBoundingClientRect();
    const targetRect = placeholder.getBoundingClientRect();

    const wordX = wordRect.left;
    const wordY = wordRect.top;
    const targetX = targetRect.left;
    const targetY = targetRect.top;

    // Ga naar woord
    await moveTo(wordX, wordY);

    // Sleep woord
    await moveTo(targetX, targetY, (x, y) => {
      woord.style.left = `${x}px`;
      woord.style.top = `${y}px`;
    });

    // Zet woord neer
    placeholder.textContent = woord.textContent;
    woord.style.display = "none";

    await sleep(200);
  }

  // Als klaar: cursor naar rechtsonder en laat verdwijnen
  await moveTo(window.innerWidth + 100, window.innerHeight + 100);
}

start();
