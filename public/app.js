// public/app.js
const socket = io();
const createBtn = document.getElementById('createRoomBtn');
const linkDisplay = document.getElementById('linkDisplay');

// ✅ Secure random generator (WebCrypto-based fallback)
function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  window.crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

// 🧩 Create Room button
createBtn.addEventListener('click', () => {
  createBtn.disabled = true;
  createBtn.innerText = 'Creating Room...';
  socket.emit('createRoom');
});

// 🧠 Room created event (from server)
socket.on('roomCreated', ({ roomId, expireAt }) => {
  try {
    // generate AES key
    const secretKey = CryptoJS.lib.WordArray.random(16).toString();

    // build link with expiry data
    const link = `${window.location.origin}/join.html?room=${roomId}&key=${secretKey}&expireAt=${expireAt}`;

    linkDisplay.innerHTML = `
      <p>Share this link with your friend:</p>
      <input type="text" value="${link}" readonly onclick="this.select()" />
      <p style="font-size:0.8rem;color:#555;margin-top:8px;">Room valid until ${new Date(expireAt).toLocaleTimeString()}.</p>
    `;

    // countdown for auto-redirect
    let countdown = 40;
    linkDisplay.innerHTML += `
      <p id="countdown" style="color:#0a3d91;font-weight:600;margin-top:6px;">
        Auto-joining in ${countdown}s...
      </p>
    `;

    const countdownTimer = setInterval(() => {
      countdown--;
      const el = document.getElementById('countdown');
      if (el) el.textContent = `Auto-joining in ${countdown}s...`;

      if (countdown <= 0) {
        clearInterval(countdownTimer);

        // redirect to name-entry (join.html)
        window.location.href = `/join.html?room=${roomId}&key=${secretKey}&expireAt=${expireAt}`;
      }
    }, 1000);

  } catch (err) {
    console.error("Error generating AES key:", err);
    linkDisplay.innerHTML = `<p style="color:red;">Error creating secure room.</p>`;
  }
});

