// ── Emoji picker ────────────────────────────────────────────────────────────
const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
  '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐',
  '🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒',
  '🤕','🤢','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','😟',
  '🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖',
  '😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡',
  '👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾',
  '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆',
  '🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
  '💘','💝','💟','☮️','✝️','☪️','🕉️','☯️','🆗','🆙','🆒','🆕','🆓','🔥','💯','✨',
  '⭐','🌟','💫','💥','❗','❓','💬','👁️‍🗨️','💭','💤','🎉','🎊','🎈','🎁','🏆','🥇',
];

const EMOJI_KW = {
  '😀':'grin happy','😃':'smile happy','😄':'laugh happy','😁':'grin beam','😆':'laughing squint','😅':'sweat smile nervous',
  '🤣':'rofl rolling laugh','😂':'joy laugh cry tears','🙂':'slight smile','🙃':'upside down','😉':'wink','😊':'blush happy shy',
  '😇':'angel halo innocent','🥰':'love hearts face','😍':'heart eyes love','🤩':'star struck wow amazing',
  '😘':'kiss blow','😗':'kiss','😚':'kiss blush','😙':'kiss smile','🥲':'smile tear sad happy',
  '😋':'yum delicious tasty food','😛':'tongue','😜':'tongue wink crazy','🤪':'zany crazy wild','😝':'tongue squint',
  '🤑':'money dollar rich','🤗':'hug hugging','🤭':'giggle oops cover','🤫':'shush quiet secret','🤔':'think thinking hmm','🤐':'zip mouth quiet shut',
  '🤨':'raised eyebrow sus suspicious','😐':'neutral','😑':'expressionless blank','😶':'no mouth silent','😏':'smirk','😒':'unamused meh bored',
  '🙄':'eye roll annoyed','😬':'grimace awkward','🤥':'lying pinocchio','😌':'relieved peaceful','😔':'sad pensive','😪':'sleepy tired',
  '🤤':'drool drooling','😴':'sleep zzz','😷':'mask sick','🤒':'thermometer sick fever','🤕':'bandage hurt injured',
  '🤢':'nauseous sick green','🤧':'sneeze sick','🥵':'hot overheated','🥶':'cold freezing','🥴':'woozy drunk dizzy',
  '😵':'dizzy shocked','🤯':'mind blown exploding head wow','🤠':'cowboy yeehaw','🥳':'party celebrate birthday',
  '🥸':'disguise glasses','😎':'cool sunglasses','🤓':'nerd glasses','🧐':'monocle curious','😕':'confused','😟':'worried',
  '🙁':'sad frown','☹️':'sad frown','😮':'open mouth surprised','😯':'hushed surprised','😲':'astonished shocked wow',
  '😳':'flushed embarrassed','🥺':'pleading puppy eyes please','😦':'frown open mouth','😧':'anguished','😨':'fearful scared',
  '😰':'anxious sweat nervous','😥':'sad relieved','😢':'cry crying sad','😭':'sob crying loud sad','😱':'scream scared horror',
  '😖':'confounded','😣':'persevere','😞':'disappointed sad','😓':'downcast sweat','😩':'weary tired','😫':'tired exhausted',
  '🥱':'yawn bored sleepy','😤':'angry huff steam','😡':'angry mad rage red','😠':'angry mad','🤬':'swear curse angry',
  '😈':'devil evil smiling','👿':'devil angry evil','💀':'skull dead death','☠️':'skull crossbones death poison','💩':'poop shit','🤡':'clown',
  '👹':'ogre monster','👺':'goblin tengu','👻':'ghost boo','👽':'alien ufo','👾':'space invader game','🤖':'robot bot',
  '😺':'cat smile','😸':'cat grin','😹':'cat joy laugh','😻':'cat heart eyes love','😼':'cat smirk','😽':'cat kiss',
  '🙀':'cat scared weary','😿':'cat cry sad','😾':'cat angry',
  '👋':'wave hello hi bye','🤚':'raised back hand stop','🖐️':'hand fingers','✋':'hand stop high five','🖖':'vulcan spock',
  '👌':'ok okay perfect','🤌':'pinch italian','🤏':'pinch small tiny','✌️':'peace victory','🤞':'crossed fingers luck hope',
  '🤟':'love you sign','🤘':'rock metal horns','🤙':'call shaka hang loose','👈':'point left','👉':'point right','👆':'point up',
  '🖕':'middle finger','👇':'point down','☝️':'point up','👍':'thumbs up yes good like','👎':'thumbs down no bad dislike',
  '✊':'fist raised','👊':'fist bump punch','🤛':'left fist bump','🤜':'right fist bump','👏':'clap applause bravo',
  '🙌':'raise hands celebrate hooray','👐':'open hands','🤲':'palms up','🤝':'handshake deal','🙏':'pray please thank you namaste',
  '❤️':'red heart love','🧡':'orange heart','💛':'yellow heart','💚':'green heart','💙':'blue heart','💜':'purple heart',
  '🖤':'black heart','🤍':'white heart','🤎':'brown heart','💔':'broken heart sad','❣️':'heart exclamation',
  '💕':'two hearts love','💞':'revolving hearts','💓':'heartbeat','💗':'growing heart','💖':'sparkling heart',
  '💘':'cupid arrow heart love','💝':'heart ribbon gift','💟':'heart decoration',
  '☮️':'peace','✝️':'cross christian','☪️':'crescent moon islam','🕉️':'om hindu','☯️':'yin yang balance',
  '🆗':'ok button','🆙':'up button','🆒':'cool button','🆕':'new button','🆓':'free button',
  '🔥':'fire hot lit flame','💯':'hundred perfect score','✨':'sparkle shine magic star',
  '⭐':'star yellow','🌟':'glowing star shine','💫':'dizzy star','💥':'boom explosion crash bang',
  '❗':'exclamation important','❓':'question','💬':'speech bubble chat talk comment','👁️‍🗨️':'eye speech witness',
  '💭':'thought bubble think','💤':'sleep zzz','🎉':'party tada congratulations celebrate','🎊':'confetti ball party',
  '🎈':'balloon party birthday','🎁':'gift present birthday','🏆':'trophy winner champion cup','🥇':'gold medal first winner',
};

let emojiPickerOpen = false;

function initEmojiPicker() {
  const btn = document.getElementById('emoji-btn');
  const picker = document.getElementById('emoji-picker');
  const grid = document.getElementById('emoji-grid');
  const search = document.getElementById('emoji-search');
  const input = document.getElementById('msg-input');

  function renderGrid(list) {
    grid.innerHTML = '';
    if (!list.length) {
      const noRes = document.createElement('div');
      noRes.id = 'emoji-no-result';
      noRes.textContent = 'No emoji found';
      grid.parentElement.appendChild(noRes);
      return;
    }
    const existing = document.getElementById('emoji-no-result');
    if (existing) existing.remove();
    list.forEach(em => {
      const b = document.createElement('button');
      b.className = 'h-emoji-btn';
      b.textContent = em;
      b.type = 'button';
      b.onclick = () => {
        input.focus();
        document.execCommand('insertText', false, em);
        closePicker();
      };
      grid.appendChild(b);
    });
  }

  function filterEmojis(query) {
    if (!query) return EMOJIS;
    const q = query.toLowerCase();
    return EMOJIS.filter(em => {
      const kw = EMOJI_KW[em];
      return kw && kw.includes(q);
    });
  }

  function openPicker() {
    picker.classList.add('open');
    search.value = '';
    renderGrid(EMOJIS);
    emojiPickerOpen = true;
    setTimeout(() => search.focus(), 50);
  }

  function closePicker() {
    picker.classList.remove('open');
    emojiPickerOpen = false;
    const existing = document.getElementById('emoji-no-result');
    if (existing) existing.remove();
  }

  search.addEventListener('input', () => {
    renderGrid(filterEmojis(search.value.trim()));
  });

  search.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = grid.querySelector('.h-emoji-btn');
      if (first) first.click();
    }
  });

  btn.addEventListener('click', e => {
    e.stopPropagation();
    emojiPickerOpen ? closePicker() : openPicker();
  });

  document.addEventListener('click', e => {
    if (emojiPickerOpen && !picker.contains(e.target) && e.target !== btn) {
      closePicker();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && emojiPickerOpen) closePicker();
  });
}


// ── HTML → Markdown ─────────────────────────────────────────────────────────
function htmlToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/​/g, '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName.toLowerCase();
  const inner = () => Array.from(node.childNodes).map(htmlToMarkdown).join('');

  switch (tag) {
    case 'strong': case 'b': {
      const c = inner();
      return c ? `**${c}**` : '';
    }
    case 'em': case 'i': {
      const c = inner();
      return c ? `*${c}*` : '';
    }
    case 's': case 'del': case 'strike': {
      const c = inner();
      return c ? `~~${c}~~` : '';
    }
    case 'code':
      return node.closest('pre') ? inner() : `\`${inner()}\``;
    case 'pre': {
      const c = inner().replace(/\n$/, '');
      const prev = node.previousElementSibling;
      const next = node.nextElementSibling;
      const prevIsPre = prev?.tagName?.toLowerCase() === 'pre';
      const nextIsPre = next?.tagName?.toLowerCase() === 'pre';
      if (prevIsPre && nextIsPre) return c + '\n';
      if (prevIsPre) return c + '\n```\n\n';
      if (nextIsPre) return '\n```\n' + c + '\n';
      return '\n```\n' + c + '\n```\n\n';
    }
    case 'a': {
      const href = node.getAttribute('href') || '';
      const text = inner();
      if (!text || text === href) return href;
      return `[${text}](${href})`;
    }
    case 'blockquote': {
      const lines = inner().replace(/\n$/, '').split('\n');
      return lines.map(l => `> ${l}`).join('\n') + '\n\n';
    }
    case 'ol': case 'ul': {
      const c = inner();
      return c.endsWith('\n') ? c + '\n' : c + '\n\n';
    }
    case 'li': {
      const parent = node.parentElement?.tagName?.toLowerCase();
      const idx = Array.from(node.parentElement?.children || []).indexOf(node) + 1;
      const prefix = parent === 'ol' ? `${idx}. ` : '- ';
      return prefix + inner().replace(/\n$/, '').replace(/\n/g, '\n  ') + '\n';
    }
    case 'br':
      return '\n';
    case 'div': case 'p': {
      const c = inner();
      if (!c) return '\n';
      return c + (c.endsWith('\n') ? '' : '\n');
    }
    default: return inner();
  }
}

// ── Drafts per room ─────────────────────────────────────────────────────────
function saveDraft(roomId) {
  if (!roomId) return;
  const input = document.getElementById('msg-input');
  const html = input.innerHTML.trim();
  if (html && html !== '<br>') {
    localStorage.setItem('stoa-draft-' + roomId, html);
  } else {
    localStorage.removeItem('stoa-draft-' + roomId);
  }
}

function restoreDraft(roomId) {
  const input = document.getElementById('msg-input');
  const draft = localStorage.getItem('stoa-draft-' + roomId);
  input.innerHTML = draft || '';
}

function clearDraft(roomId) {
  if (roomId) localStorage.removeItem('stoa-draft-' + roomId);
}

// ── Composer processing state ───────────────────────────────────────────────
function setComposerProcessing(messageId) {
  processingMessages.add(messageId);
  document.querySelector('.h-composer-box')?.classList.add('ai-processing');
  document.getElementById('stop-btn')?.classList.add('visible');
  document.getElementById('msg-input')?.blur();
}

function clearComposerProcessing(messageId) {
  if (messageId) processingMessages.delete(messageId);
  else processingMessages.clear();
  if (processingMessages.size === 0) {
    document.querySelector('.h-composer-box')?.classList.remove('ai-processing');
    document.getElementById('stop-btn')?.classList.remove('visible');
    document.getElementById('msg-input')?.focus();
  }
}

function stopGeneration() {
  if (processingMessages.size === 0 || !ws || ws.readyState !== WebSocket.OPEN) return;
  for (const mid of processingMessages) {
    ws.send(JSON.stringify({ type: 'stop_generation', room_id: currentRoomId, message_id: mid }));
  }
  clearComposerProcessing();
}

// ── Reply ───────────────────────────────────────────────────────────────────
let pendingReplyTo = null;

function startReply(msgId, actorName, avatarColor, content, attachments) {
  pendingReplyTo = msgId;
  document.getElementById('reply-bar-name').textContent = actorName;
  document.getElementById('reply-bar-name').style.color = avatarColor || 'var(--h-ink)';
  let preview = (content || '').substring(0, 150);
  if (attachments && attachments.length) {
    const urls = attachments.map(a => a.url).join('\n');
    preview = preview ? preview + '\n' + urls : urls;
  }
  document.getElementById('reply-bar-text').textContent = preview;
  document.getElementById('reply-bar').classList.add('visible');
  document.getElementById('msg-input').focus();
}

function clearReply() {
  pendingReplyTo = null;
  document.getElementById('reply-bar').classList.remove('visible');
}

document.getElementById('reply-bar-close').onclick = clearReply;

// ── Send ────────────────────────────────────────────────────────────────────
function sendMessage() {
  const input = document.getElementById('msg-input');
  const content = htmlToMarkdown(input).replace(/​/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if ((!content && !pendingAttachments.length) || !ws || ws.readyState !== WebSocket.OPEN) return;
  input.innerHTML = '';
  const attachments = pendingAttachments.length ? [...pendingAttachments] : undefined;
  const replyTo = pendingReplyTo;
  clearAttachments();
  clearReply();
  ws.send(JSON.stringify({ type: 'send_message', room_id: currentRoomId, content, attachments, reply_to: replyTo }));
  clearDraft(currentRoomId);
}


// ── Create room modal ───────────────────────────────────────────────────────
async function loadWorkdirsForActor(actorId) {
  const section = document.getElementById('new-room-workdir-section');
  const sel = document.getElementById('new-room-workdir');
  const newWdRow = document.getElementById('new-room-new-workdir-row');
  if (!actorId) { section.style.display = 'none'; return; }

  let workdirs;
  try { workdirs = await fjson(`/api/actors/${actorId}/workdirs`); } catch { workdirs = []; }
  sel.innerHTML = '';
  section.style.display = 'block';
  newWdRow.style.display = 'none';
  workdirs.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = (w.label || w.path) + (w.is_default ? ' (default)' : '');
    if (w.is_default) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.disabled = false;
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ new folder…';
  sel.appendChild(newOpt);
  if (workdirs.length === 0) {
    newOpt.selected = true;
    newWdRow.style.display = 'flex';
  }

  // Remove old listener by cloning
  const newSel = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSel, sel);
  newSel.addEventListener('change', () => {
    newWdRow.style.display = newSel.value === '__new__' ? 'flex' : 'none';
  });
}

async function openNewRoomModal() {
  try {
    const freshActors = await fjson('/api/actors');
    allActors = freshActors;
    actorByName = {};
    allActors.forEach(a => actorByName[a.name] = a);
  } catch { showToast('Failed to load agents', { error: true }); }
  if (!allActors.some(a => a.type === 'ai')) { openSettings(); return; }
  const modal = document.getElementById('new-room-modal');
  const nameInput = document.getElementById('new-room-name');
  const actorsEl = document.getElementById('new-room-actors');

  actorsEl.innerHTML = '';
  const aiActors = allActors.filter(a => a.type === 'ai');
  aiActors.forEach((actor, i) => {
    const label = document.createElement('label');
    label.className = 'h-actor-check';

    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'new-room-actor';
    rb.value = actor.id;
    if (i === 0) rb.checked = true;
    label.appendChild(rb);
    label.appendChild(makeAvatar(actor.name, actor.avatar_color, actor.avatar_url, 22));

    const name = document.createElement('span');
    name.className = 'h-actor-check-name';
    name.textContent = actor.name.toLowerCase();
    label.appendChild(name);

    actorsEl.appendChild(label);
  });

  nameInput.value = '';
  modal.style.display = 'flex';
  nameInput.focus();

  // Load workdirs for selected actor
  const firstAI = aiActors[0];
  if (firstAI) await loadWorkdirsForActor(firstAI.id);
  // Change listener on actor radio buttons
  document.querySelectorAll('#new-room-actors input[type=radio]').forEach(rb => {
    rb.addEventListener('change', () => loadWorkdirsForActor(rb.value));
  });
}

async function submitNewRoom() {
  const title = document.getElementById('new-room-name').value.trim();
  if (!title) return;

  const selected = document.querySelector('#new-room-actors input[type=radio]:checked');
  const participant_ids = selected ? [parseInt(selected.value)] : [];

  const wdSel = document.getElementById('new-room-workdir');
  const newWdInput = document.getElementById('new-room-new-workdir-input');
  let workdir_id = null;

  if (wdSel && wdSel.value === '__new__' && newWdInput?.value.trim()) {
    // Create new workdir on agent
    const selectedActor = document.querySelector('#new-room-actors input[type=radio]:checked');
    if (selectedActor) {
      try {
        const res = await fetch(`/api/actors/${selectedActor.value}/workdirs`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newWdInput.value.trim() })
        });
        if (!res.ok) throw new Error('workdir creation failed');
        const wd = await res.json();
        workdir_id = wd.id;
      } catch { alert('Failed to create working directory'); return; }
    }
  } else if (wdSel && wdSel.value && wdSel.value !== '__new__') {
    workdir_id = parseInt(wdSel.value);
  }

  if (!workdir_id) { alert('Please select a working directory'); return; }
  document.getElementById('new-room-modal').style.display = 'none';

  try {
    const room = await fjson('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, participant_ids, workdir_id }),
    });
    const rooms = await fjson('/api/rooms');
    renderRoomList(rooms);
    openRoom(room);
  } catch { showToast('Failed to create room', { error: true }); }
}

// ── Scroll ──────────────────────────────────────────────────────────────────
function scrollToBottom(force) {
  const el = document.getElementById('messages');
  if (!el) return;
  if (force || el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
    el.scrollTop = el.scrollHeight;
  }
}

// ── Load older messages on scroll to top ───────────────────────────────────
async function loadOlderMessages() {
  if (loadingOlder || noMoreOlder || !oldestMessageId || !currentRoomId) return;
  loadingOlder = true;

  const container = document.getElementById('messages');
  const inner     = document.getElementById('messages-inner');

  const spinner = document.createElement('div');
  spinner.style.cssText = 'text-align:center;padding:12px;color:var(--h-ink-mute);font-size:13px;font-family:var(--h-sans)';
  spinner.textContent = 'loading…';
  inner.prepend(spinner);

  try {
    const msgs = await fjson(`/api/rooms/${currentRoomId}/messages?before=${oldestMessageId}&limit=50`);

    spinner.remove();

    if (!msgs.length) { noMoreOlder = true; loadingOlder = false; return; }

    // Build rows into a fragment using appendMessage's container param
    const frag = document.createDocumentFragment();
    msgs.forEach(m => {
      if (!document.getElementById('msg-' + m.id)) appendMessage(m, frag);
    });

    // Snapshot scroll anchor, then prepend, then restore
    const prevHeight = inner.scrollHeight;
    const prevTop    = container.scrollTop;
    inner.prepend(frag);
    container.scrollTop = prevTop + (inner.scrollHeight - prevHeight);

    oldestMessageId = msgs[0].id;
    if (msgs.length < 50) noMoreOlder = true;
  } catch {
    spinner.remove();
    showToast('Failed to load older messages', { error: true });
  }
  loadingOlder = false;
}

function initScrollLoader() {
  const container = document.getElementById('messages');
  container.addEventListener('scroll', () => {
    if (container.scrollTop < 120) loadOlderMessages();
  });
}

// ── Search ──────────────────────────────────────────────────────────────────
{
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const searchClear = document.getElementById('search-clear');
  const roomList = document.getElementById('room-list');
  const roomsRow = document.querySelector('.h-rooms-row');
  let searchTimer = null;

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim();
    searchClear.style.display = q ? 'block' : 'none';
    clearTimeout(searchTimer);
    if (!q) { hideSearchResults(); return; }
    searchTimer = setTimeout(() => doSearch(q), 250);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') { searchInput.value = ''; searchClear.style.display = 'none'; hideSearchResults(); searchInput.blur(); }
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.style.display = 'none';
    hideSearchResults();
    searchInput.focus();
  });

  async function doSearch(q) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=30`);
      if (!res.ok) { showToast('Search failed', { error: true }); return; }
      const rows = await res.json();
      showSearchResults(rows);
    } catch { showToast('Search failed', { error: true }); }
  }

  function showSearchResults(rows) {
    roomList.style.display = 'none';
    roomsRow.style.display = 'none';
    searchResults.style.display = 'block';
    if (!rows.length) {
      searchResults.innerHTML = '<div class="h-search-empty">No results found</div>';
      return;
    }
    searchResults.innerHTML = '';
    for (const r of rows) {
      const item = document.createElement('div');
      item.className = 'h-search-result';
      const ts = r.created_at.endsWith('Z') ? r.created_at : r.created_at.replace(' ', 'T') + 'Z';
      const time = new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
                   new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const archivedBadge = r.archived_at ? '<span class="h-archived-badge">archived</span>' : '';
      item.innerHTML =
        `<div class="h-search-room">${escHtml(r.room_title)}${archivedBadge}</div>` +
        `<div class="h-search-meta">` +
          `<span class="h-search-actor" style="color:${r.avatar_color || 'var(--h-ink)'}">${escHtml(r.actor_name)}</span>` +
          `<span class="h-search-time">${time}</span>` +
        `</div>` +
        `<div class="h-search-snippet">${escHtml(r.snippet).replace(/&lt;mark&gt;/g,'<mark>').replace(/&lt;\/mark&gt;/g,'</mark>')}</div>`;
      item.onclick = () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        hideSearchResults();
        navigateToMessage(r.room_id, r.id, r.room_title);
      };
      searchResults.appendChild(item);
    }
  }

  function hideSearchResults() {
    searchResults.style.display = 'none';
    roomList.style.display = '';
    roomsRow.style.display = '';
  }

  function navigateToMessage(roomId, msgId, roomTitle) {
    if (currentRoomId !== roomId) {
      openRoom({ id: roomId, title: roomTitle || 'Room' });
      setTimeout(() => scrollToMessage(msgId), 800);
    } else {
      scrollToMessage(msgId);
    }
  }
}

// ── In-room search ─────────────────────────────────────────────────────────
let roomSearchResults = [];
let roomSearchIdx = -1;

function toggleRoomSearch() {
  const bar = document.getElementById('room-search-bar');
  const input = document.getElementById('room-search-input');
  const btn = document.querySelector('#chat-header .h-header-action-btn[title="Search in room"]');
  if (bar.classList.contains('visible')) {
    closeRoomSearch();
  } else {
    bar.classList.add('visible');
    if (btn) btn.classList.add('active');
    input.value = '';
    input.focus();
  }
}

function closeRoomSearch() {
  const bar = document.getElementById('room-search-bar');
  bar.classList.remove('visible');
  const results = document.getElementById('room-search-results');
  results.classList.remove('visible');
  results.innerHTML = '';
  const btn = document.querySelector('#chat-header .h-header-action-btn[title="Search in room"]');
  if (btn) btn.classList.remove('active');
  document.getElementById('room-search-count').textContent = '';
}

async function doRoomSearch(query) {
  const resultsEl = document.getElementById('room-search-results');
  const countEl = document.getElementById('room-search-count');
  resultsEl.innerHTML = '';
  if (!query.trim() || !currentRoomId) {
    resultsEl.classList.remove('visible');
    countEl.textContent = '';
    return;
  }
  let rows;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&room_id=${currentRoomId}&limit=50`);
    if (!res.ok) throw new Error();
    rows = await res.json();
  } catch { countEl.textContent = 'search failed'; return; }
  countEl.textContent = rows.length ? `${rows.length} found` : 'no results';
  if (!rows.length) { resultsEl.classList.remove('visible'); return; }
  resultsEl.classList.add('visible');
  for (const r of rows) {
    const item = document.createElement('div');
    item.className = 'h-room-search-result-item';
    const meta = document.createElement('div');
    meta.className = 'h-room-search-result-meta';
    const actor = document.createElement('span');
    actor.className = 'h-room-search-result-actor';
    actor.textContent = r.actor_name;
    if (r.avatar_color) actor.style.color = r.avatar_color;
    const time = document.createElement('span');
    time.className = 'h-room-search-result-time';
    time.textContent = relativeTime(r.created_at);
    meta.appendChild(actor);
    meta.appendChild(time);
    const snippet = document.createElement('div');
    snippet.className = 'h-room-search-result-snippet';
    snippet.innerHTML = DOMPurify.sanitize(r.snippet);
    item.appendChild(meta);
    item.appendChild(snippet);
    item.onclick = () => {
      resultsEl.classList.remove('visible');
      scrollToMessage(r.id);
    };
    resultsEl.appendChild(item);
  }
}

async function scrollToMessage(msgId) {
  let el = document.getElementById('msg-' + msgId);
  if (!el && currentRoomId && oldestMessageId && msgId < oldestMessageId) {
    for (let i = 0; i < 20 && !el && !noMoreOlder; i++) {
      loadingOlder = false;
      await loadOlderMessages();
      el = document.getElementById('msg-' + msgId);
    }
  }
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.transition = 'background 0.3s';
    el.style.background = 'color-mix(in srgb, #d39749 15%, transparent)';
    setTimeout(() => { el.style.background = ''; }, 2000);
  }
}

(function() {
  const input = document.getElementById('room-search-input');
  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => doRoomSearch(input.value), 300);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeRoomSearch();
  });
  document.getElementById('room-search-close').onclick = closeRoomSearch;
})();

// ── Utility ─────────────────────────────────────────────────────────────────
function relativeTime(ts) {
  // SQLite returns UTC without timezone — force UTC parse to avoid 7h offset in WIB
  const utc = typeof ts === 'string' && !ts.endsWith('Z') ? ts.trim().replace(' ', 'T') + 'Z' : ts;
  const diff = (Date.now() - new Date(utc)) / 1000;
  if (diff < 60)   return 'now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  if (diff < 86400)return Math.floor(diff / 3600) + 'h';
  return Math.floor(diff / 86400) + 'd';
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function formatModelName(model) {
  if (!model) return null;
  return model
    .replace(/^claude-/, '')
    .replace(/-(\d)/, ' $1')
    .replace(/-preview$/, '');
}

function handleModelUpdate(msg) {
  if (msg.room_id && msg.room_id !== currentRoomId) return;
  const badge = document.querySelector('.h-model-badge');
  const label = formatModelName(msg.model);
  if (badge && label) badge.textContent = label;
  else if (badge && !label) badge.remove();
  else if (!badge && label) {
    const tagline = document.querySelector('.h-room-tagline');
    if (tagline) {
      const b = document.createElement('span');
      b.className = 'h-model-badge';
      b.textContent = label;
      tagline.appendChild(b);
    }
  }
}

// ── Skill autocomplete ─────────────────────────────────────────────────────
const SKILL_COLORS = ['#5b8fd4','#d39749','#8a7660','#6b9e6b','#c25d5d','#9b6bc2','#4a9e9e'];

function showSkillPopup(query) {
  const popup = document.getElementById('skill-popup');
  const matches = allSkills.filter(s => s.name.startsWith(query)).slice(0, 7);
  if (!matches.length) { hideSkillPopup(); return; }

  popup.innerHTML = '';
  skillPopupIdx = 0;
  matches.forEach((skill, i) => {
    const color = SKILL_COLORS[i % SKILL_COLORS.length];
    const item = document.createElement('div');
    item.className = 'h-skill-item';
    item.dataset.idx = i;
    const agentTag = skill.actor_name
      ? `<span class="h-skill-agent">${escHtml(skill.actor_name)}</span>` : '';
    item.innerHTML =
      `<span class="h-skill-name" style="--skill-color:${color}">/${escHtml(skill.name)}</span>` +
      `<span class="h-skill-desc">${escHtml(skill.description || '')}</span>` +
      agentTag;
    item.onmousedown = e => {
      e.preventDefault();
      applySkill(skill.name);
    };
    if (i === 0) item.classList.add('active');
    popup.appendChild(item);
  });
  popup.style.display = 'block';
}

function hideSkillPopup() {
  document.getElementById('skill-popup').style.display = 'none';
  skillPopupIdx = -1;
}

function skillColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return SKILL_COLORS[Math.abs(h) % SKILL_COLORS.length];
}

function applySkill(name) {
  const input = document.getElementById('msg-input');
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideSkillPopup(); return; }
  const node = sel.anchorNode;
  const color = skillColor(name);

  if (node.nodeType === 3 && input.contains(node)) {
    const text = node.textContent;
    const cursor = sel.anchorOffset;
    const before = text.slice(0, cursor);
    const match = before.match(/(^|\s)\/([a-z0-9-]*)$/);
    if (match) {
      const start = match.index + match[1].length;
      const beforeText = text.slice(0, start);
      const afterText = text.slice(cursor);
      const parent = node.parentElement;
      const frag = document.createDocumentFragment();
      if (beforeText) frag.appendChild(document.createTextNode(beforeText));
      const span = document.createElement('span');
      span.className = 'h-skill-tag';
      span.style.color = color;
      span.contentEditable = 'false';
      span.textContent = '/' + name;
      frag.appendChild(span);
      const after = document.createTextNode(' ' + afterText);
      frag.appendChild(after);
      parent.replaceChild(frag, node);
      const range = document.createRange();
      range.setStart(after, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      hideSkillPopup();
      return;
    }
  }
  input.focus();
  const span = document.createElement('span');
  span.className = 'h-skill-tag';
  span.style.color = color;
  span.contentEditable = 'false';
  span.textContent = '/' + name;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(span);
  const after = document.createTextNode(' ');
  span.parentNode.insertBefore(after, span.nextSibling);
  range.setStart(after, 1);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  hideSkillPopup();
}

function skillPopupNavigate(dir) {
  const popup = document.getElementById('skill-popup');
  if (popup.style.display === 'none') return false;
  const items = popup.querySelectorAll('.h-skill-item');
  if (!items.length) return false;
  items[skillPopupIdx]?.classList.remove('active');
  skillPopupIdx = (skillPopupIdx + dir + items.length) % items.length;
  items[skillPopupIdx].classList.add('active');
  return true;
}

function onComposerInput() {
  const input = document.getElementById('msg-input');
  saveDraft(currentRoomId);
  const sel = window.getSelection();
  if (sel.rangeCount && input.contains(sel.anchorNode)) {
    const node = sel.anchorNode;
    const text = node.nodeType === 3 ? node.textContent.slice(0, sel.anchorOffset) : '';
    const skillMatch = text.match(/(^|\s)\/([a-z0-9-]*)$/);
    const mentionMatch = text.match(/(^|\s)@([^\s]*)$/);
    if (skillMatch) {
      showSkillPopup(skillMatch[2]);
      hideMentionPopup();
    } else if (mentionMatch) {
      showMentionPopup(mentionMatch[2]);
      hideSkillPopup();
    } else {
      hideSkillPopup();
      hideMentionPopup();
    }
  } else {
    hideSkillPopup();
    hideMentionPopup();
  }
  handleInlineMarkdown();
}

function handleInlineMarkdown() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== 3) return;
  const input = document.getElementById('msg-input');
  if (!input.contains(node)) return;
  const parent = node.parentElement;
  if (parent.nodeName === 'CODE' || parent.nodeName === 'PRE') return;

  const text = node.textContent;
  const cursor = sel.anchorOffset;
  const before = text.slice(0, cursor);

  const patterns = [
    { re: /`([^`]+)`$/, tag: 'code' },
    { re: /\*([^\*]+)\*$/, tag: 'strong' },
    { re: /(?:^|[^a-zA-Z0-9])_([^_]+)_$/, tag: 'em', lookbehind: true },
    { re: /~([^~]+)~$/, tag: 's' },
  ];

  for (const { re, tag, lookbehind } of patterns) {
    const match = before.match(re);
    if (!match) continue;
    const innerText = match[1];
    const fullMatch = lookbehind ? match[0].slice(match[0].length - match[1].length - 2) : match[0];
    const start = cursor - fullMatch.length;
    const beforeText = text.slice(0, start);
    const afterText = text.slice(cursor);
    const frag = document.createDocumentFragment();
    if (beforeText) frag.appendChild(document.createTextNode(beforeText));
    const el = document.createElement(tag);
    el.textContent = innerText;
    frag.appendChild(el);
    const afterNode = document.createTextNode(afterText || '​');
    frag.appendChild(afterNode);
    parent.replaceChild(frag, node);
    const range = document.createRange();
    range.setStart(afterNode, afterText ? 0 : 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
}

// ── Mention highlighting in bubbles ───────────────────────────────────────
function highlightMentions(html) {
  const names = (roomParticipantsCache[currentRoomId] || []).map(p => p.name);
  if (!names.length) return html;
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(${escaped.join('|')})(?=\\s|[.,!?;:]|$)`, 'g');
  return html.replace(re, (match, name) => '<span class="h-mention-inline">@' + wsEscHtml(name) + '</span>');
}

// ── Mention autocomplete ──────────────────────────────────────────────────
function showMentionPopup(query) {
  const popup = document.getElementById('mention-popup');
  const parts = roomParticipantsCache[currentRoomId] || [];
  const q = query.toLowerCase();
  const matches = parts.filter(p => p.actor_id !== humanActor?.id && p.name.toLowerCase().startsWith(q)).slice(0, 7);
  if (!matches.length) { hideMentionPopup(); return; }

  popup.innerHTML = '';
  mentionPopupIdx = 0;
  matches.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'h-mention-item';
    item.dataset.idx = i;
    item.appendChild(makeAvatar(p.name, p.avatar_color, p.avatar_url, 22));
    const name = document.createElement('span');
    name.className = 'h-mention-name';
    name.textContent = p.name;
    item.appendChild(name);
    item.onmousedown = e => {
      e.preventDefault();
      applyMention(p.name);
    };
    if (i === 0) item.classList.add('active');
    popup.appendChild(item);
  });
  popup.style.display = 'block';
}

function hideMentionPopup() {
  document.getElementById('mention-popup').style.display = 'none';
  mentionPopupIdx = -1;
}

function applyMention(name) {
  const input = document.getElementById('msg-input');
  const sel = window.getSelection();
  if (!sel.rangeCount) { hideMentionPopup(); return; }
  const node = sel.anchorNode;

  if (node.nodeType === 3 && input.contains(node)) {
    const text = node.textContent;
    const cursor = sel.anchorOffset;
    const before = text.slice(0, cursor);
    const match = before.match(/(^|\s)@([^\s]*)$/);
    if (match) {
      const start = match.index + match[1].length;
      const beforeText = text.slice(0, start);
      const afterText = text.slice(cursor);
      const parent = node.parentElement;
      const frag = document.createDocumentFragment();
      if (beforeText) frag.appendChild(document.createTextNode(beforeText));
      const span = document.createElement('span');
      span.className = 'h-mention-tag';
      span.contentEditable = 'false';
      span.textContent = '@' + name;
      frag.appendChild(span);
      const after = document.createTextNode(' ' + afterText);
      frag.appendChild(after);
      parent.replaceChild(frag, node);
      const range = document.createRange();
      range.setStart(after, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      hideMentionPopup();
      return;
    }
  }
  hideMentionPopup();
}

// ── Model selector ────────────────────────────────────────────────────────
const ANTHROPIC_MODELS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet 4.5' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
];

let platformModels = [];

async function fetchPlatformModels() {
  try {
    const groups = await fjson('/api/ai/models');
    platformModels = [];
    for (const g of groups) {
      if (g.platform_id === 'anthropic') continue;
      for (const m of g.models) {
        platformModels.push({ value: m.value, label: m.label, vision: m.vision || false, platform: g.platform_name, platform_id: g.platform_id, base_url: g.base_url || '' });
      }
    }
  } catch {}
}

function getAvailableModels() {
  const models = [];
  for (const m of ANTHROPIC_MODELS) {
    models.push({ ...m, platform: 'anthropic' });
  }
  for (const m of platformModels) {
    models.push(m);
  }
  return models;
}

function populateModelDropdown(sel, currentModel) {
  const models = getAvailableModels();
  sel.innerHTML = '';
  let lastPlatform = '';
  for (const m of models) {
    if (m.platform !== lastPlatform && models.length > ANTHROPIC_MODELS.length) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = m.platform === 'anthropic' ? 'Anthropic' : m.platform;
      const platformModelsForGroup = models.filter(x => x.platform === m.platform).sort((a, b) => a.label.localeCompare(b.label));
      for (const pm of platformModelsForGroup) {
        const opt = document.createElement('option');
        opt.value = pm.value;
        opt.textContent = pm.vision ? '👁 ' + pm.label : pm.label;
        if (pm.base_url) opt.dataset.baseUrl = pm.base_url;
        if (pm.platform_id) opt.dataset.platformId = pm.platform_id;
        optgroup.appendChild(opt);
      }
      sel.appendChild(optgroup);
      lastPlatform = m.platform;
    } else if (models.length <= ANTHROPIC_MODELS.length) {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      sel.appendChild(opt);
    }
  }
  sel.value = currentModel || 'claude-sonnet-4-6';
}

function updateModelSelector(room, parts) {
  const wrap = document.getElementById('model-selector-wrap');
  const sel = document.getElementById('model-select');
  if (!wrap || !sel) return;
  const hasAIAgent = (parts || []).some(p => p.type === 'ai');
  wrap.style.display = hasAIAgent ? 'flex' : 'none';
  if (hasAIAgent) {
    populateModelDropdown(sel, room.model);
  }
}

document.getElementById('model-select')?.addEventListener('change', function() {
  if (!currentRoomId || !ws) return;
  const opt = this.selectedOptions[0];
  const msg = { type: 'set_room_model', model: this.value };
  if (opt?.dataset.platformId) {
    msg.model_config = { platform_id: opt.dataset.platformId, base_url: opt.dataset.baseUrl || '' };
  } else {
    msg.model_config = null;
  }
  ws.send(JSON.stringify(msg));
});

function mentionPopupNavigate(dir) {
  const popup = document.getElementById('mention-popup');
  if (popup.style.display === 'none') return false;
  const items = popup.querySelectorAll('.h-mention-item');
  if (!items.length) return false;
  items[mentionPopupIdx]?.classList.remove('active');
  mentionPopupIdx = (mentionPopupIdx + dir + items.length) % items.length;
  items[mentionPopupIdx].classList.add('active');
  return true;
}

