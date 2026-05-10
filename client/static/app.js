const SERVER = 'http://localhost:8000';
const TOKEN_URL = `${SERVER}/token`;
const DISPATCH_URL = `${SERVER}/dispatch`;

let room = null;
let muted = false;

// --- DOM refs ---
const joinScreen = document.getElementById('join-screen');
const callScreen = document.getElementById('call-screen');
const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const joinError = document.getElementById('join-error');
const roomLabel = document.getElementById('room-label');
const participants = document.getElementById('participants');
const micBtn = document.getElementById('mic-btn');
const dispatchBtn = document.getElementById('dispatch-btn');
const leaveBtn = document.getElementById('leave-btn');

// --- Join ---
joinBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) {
    showError('이름을 입력해주세요.');
    return;
  }

  if (typeof LivekitClient === 'undefined') {
    showError('LiveKit SDK 로딩 실패. 인터넷 연결을 확인하세요.');
    return;
  }

  joinBtn.disabled = true;
  joinBtn.textContent = '연결 중...';
  hideError();

  try {
    const res = await fetch(`${TOKEN_URL}?name=${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error(`토큰 서버 오류: ${res.status}`);
    const { token, url, room: roomName } = await res.json();
    await joinRoom(url, token, roomName);
  } catch (err) {
    showError(err.message);
    joinBtn.disabled = false;
    joinBtn.textContent = '입장하기';
  }
});

async function joinRoom(url, token, roomName) {
  const { Room, RoomEvent } = LivekitClient;

  room = new Room();
  bindRoomEvents(RoomEvent);

  await room.connect(url, token);

  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (err) {
    console.error('마이크 활성화 실패:', err);
  }

  roomLabel.textContent = `Room: ${roomName}`;
  joinScreen.classList.add('hidden');
  callScreen.classList.remove('hidden');
  renderParticipants();
  updateDispatchBtn();
}

// --- Room events ---
function bindRoomEvents(RoomEvent) {
  room.on(RoomEvent.ParticipantConnected, () => {
    renderParticipants();
    updateDispatchBtn();
  });
  room.on(RoomEvent.ParticipantDisconnected, () => {
    renderParticipants();
    updateDispatchBtn();
  });
  room.on(RoomEvent.ActiveSpeakersChanged, renderParticipants);
  room.on(RoomEvent.Disconnected, reset);

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === LivekitClient.Track.Kind.Audio) {
      const audioEl = track.attach();
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
    }
  });

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach((el) => el.remove());
  });
}

// --- Participants ---
function hasAgent() {
  if (!room) return false;
  const AGENT_KIND = LivekitClient.ParticipantKind?.AGENT ?? 4;
  return [...room.remoteParticipants.values()].some((p) => p.kind === AGENT_KIND);
}

function renderParticipants() {
  if (!room) return;
  const activeSpeakers = new Set(room.activeSpeakers.map((p) => p.identity));
  const all = [room.localParticipant, ...room.remoteParticipants.values()];

  participants.innerHTML = all
    .map((p) => {
      const speaking = activeSpeakers.has(p.identity);
      const isLocal = p === room.localParticipant;
      const AGENT_KIND = LivekitClient.ParticipantKind?.AGENT ?? 4;
      const isAgent = p.kind === AGENT_KIND;
      const label = isAgent ? '🤖 Agent' : p.name || p.identity;
      return `<div class="participant ${speaking ? 'speaking' : ''}">
      <span class="dot"></span>
      <span>${label}${isLocal ? ' (나)' : ''}</span>
    </div>`;
    })
    .join('');
}

// --- Dispatch button ---
function updateDispatchBtn() {
  if (hasAgent()) {
    dispatchBtn.textContent = '✅ 에이전트 있음';
    dispatchBtn.disabled = true;
    dispatchBtn.className = 'agent-present';
  } else {
    dispatchBtn.textContent = '🤖 에이전트 생성';
    dispatchBtn.disabled = false;
    dispatchBtn.className = '';
  }
}

dispatchBtn.addEventListener('click', async () => {
  dispatchBtn.disabled = true;
  dispatchBtn.textContent = '요청 중...';

  try {
    const res = await fetch(DISPATCH_URL, { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    dispatchBtn.textContent = '⏳ 에이전트 입장 대기 중...';
  } catch (err) {
    console.error('Dispatch 실패:', err);
    dispatchBtn.textContent = '❌ 실패 — 다시 시도';
    dispatchBtn.disabled = false;
  }
});

// --- Mic toggle ---
micBtn.addEventListener('click', async () => {
  if (!room) return;
  muted = !muted;
  await room.localParticipant.setMicrophoneEnabled(!muted);
  micBtn.textContent = muted ? '🔇 마이크 OFF' : '🎙 마이크 ON';
  micBtn.className = muted ? 'mic-off' : 'mic-on';
});

// --- Leave ---
leaveBtn.addEventListener('click', () => room?.disconnect());

function reset() {
  room = null;
  muted = false;
  participants.innerHTML = '';
  micBtn.textContent = '🎙 마이크 ON';
  micBtn.className = 'mic-on';
  dispatchBtn.textContent = '🤖 에이전트 생성';
  dispatchBtn.disabled = false;
  dispatchBtn.className = '';
  callScreen.classList.add('hidden');
  joinScreen.classList.remove('hidden');
  joinBtn.disabled = false;
  joinBtn.textContent = '입장하기';
}

function showError(msg) {
  joinError.textContent = msg;
  joinError.classList.remove('hidden');
}

function hideError() {
  joinError.classList.add('hidden');
}
