/* ============================================================================
   ໄພ່ລາວ — Lao Card Table
   Serverless realtime multiplayer using Firebase Realtime Database.
   One client (the room creator / seat 0) acts as "host": it is the only
   client that mutates authoritative game state. Everyone else sends
   intents to rooms/{id}/actions and the host applies them.
   ============================================================================ */

(function(){
"use strict";

/* ---------------------------------------------------------------------- */
/* 0. CONFIG — tweak these to change house-rule interpretations           */
/* ---------------------------------------------------------------------- */
const CONFIG = {
  cardsPerPlayer: 9,
  turnSeconds: 20,
  // a single 10/J/Q/K on the table can be "chopped" by a triple
  chopBigSingleWithTriple: true,
  bigSingleRanks: ['10','J','Q','K'],
  // a straight (3+, same suit) can chop any single card
  chopSingleWithStraight: true,
  // a 4+ same-suit straight ("Super Straight") can only be played on a
  // single "2" and wins the game instantly for whoever plays it
  superStraightBeatsTwoAndWins: true,
  // a four-of-a-kind found in a starting hand ("Super Quad") wins instantly
  quadInHandAutoWins: true,
};

const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RVAL = Object.fromEntries(RANKS.map((r,i)=>[r,i]));
const SUITS = ['♠','♣','♥','♦'];

/* ---------------------------------------------------------------------- */
/* 1. Card + combo helpers                                                */
/* ---------------------------------------------------------------------- */
function buildDeck(){
  const d = [];
  for(const s of SUITS) for(const r of RANKS) d.push(r+s);
  return d;
}
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function parseCard(c){
  const suit = c.slice(-1);
  const rank = c.slice(0,-1);
  return { rank, suit, val: RVAL[rank] };
}
function suitColor(s){ return (s==='♥'||s==='♦') ? 'red' : 'black'; }

function isStraightCards(cards){
  const suit = cards[0].suit;
  if(!cards.every(c=>c.suit===suit)) return false;
  if(cards.some(c=>c.rank==='2')) return false;
  const vals = cards.map(c=>c.val).sort((a,b)=>a-b);
  for(let i=1;i<vals.length;i++) if(vals[i] !== vals[i-1]+1) return false;
  return true;
}

// Returns a combo descriptor or null if the given card strings don't form
// any legal combination.
function classifyCombo(cardStrs){
  if(!cardStrs || !cardStrs.length) return null;
  const cards = cardStrs.map(parseCard);
  const n = cards.length;

  if(n === 1) return { type:'single', highVal: cards[0].val, len:1 };

  if(n === 2){
    if(cards[0].rank === cards[1].rank && suitColor(cards[0].suit) === suitColor(cards[1].suit)){
      return { type:'pair', highVal: cards[0].val, len:2 };
    }
    return null;
  }

  if(n === 3 && cards.every(c=>c.rank===cards[0].rank)){
    return { type:'triple', highVal: cards[0].val, len:3 };
  }
  if(n === 4 && cards.every(c=>c.rank===cards[0].rank)){
    return { type:'quad', highVal: cards[0].val, len:4 };
  }

  if(n >= 3 && isStraightCards(cards)){
    const highVal = Math.max(...cards.map(c=>c.val));
    return { type: n>=4 ? 'superstraight' : 'straight', highVal, len:n };
  }
  return null;
}

// Can `play` legally beat `last`? (last === null means "free lead", anything goes)
function canBeat(play, last){
  if(!last) return { ok:true };
  if(play.type === last.type && play.len === last.len){
    return { ok: play.highVal > last.highVal };
  }
  if(last.type === 'single'){
    const lastRank = RANKS[last.highVal];
    if(CONFIG.chopBigSingleWithTriple && play.type === 'triple' && CONFIG.bigSingleRanks.includes(lastRank)){
      return { ok:true, chop:true };
    }
    if(play.type === 'superstraight' && lastRank === '2' && CONFIG.superStraightBeatsTwoAndWins){
      return { ok:true, chop:true, instantWin:true };
    }
    if(CONFIG.chopSingleWithStraight && (play.type === 'straight' || play.type === 'superstraight') && lastRank !== '2'){
      return { ok:true, chop:true };
    }
  }
  return { ok:false };
}

function findQuadInHand(hand){
  const byRank = {};
  for(const c of hand){ const r = parseCard(c).rank; (byRank[r] = byRank[r]||[]).push(c); }
  for(const r in byRank) if(byRank[r].length === 4) return byRank[r];
  return null;
}

function sortHand(hand, mode){
  const arr = hand.slice();
  if(mode === 'suit'){
    arr.sort((a,b)=>{
      const A=parseCard(a), B=parseCard(b);
      if(A.suit!==B.suit) return SUITS.indexOf(A.suit)-SUITS.indexOf(B.suit);
      return A.val-B.val;
    });
  } else {
    arr.sort((a,b)=> parseCard(a).val - parseCard(b).val || SUITS.indexOf(parseCard(a).suit)-SUITS.indexOf(parseCard(b).suit));
  }
  return arr;
}

/* Suggest candidate combos in `hand` that contain `cardStr` and are legal
   right now (used for the "smart popup" when a single tap is ambiguous). */
function candidateCombosContaining(hand, cardStr, lastCombo){
  const out = [];
  const seen = new Set();
  const push = (cards)=>{
    const key = cards.slice().sort().join(',');
    if(seen.has(key)) return;
    const combo = classifyCombo(cards);
    if(!combo) return;
    if(combo.type === 'quad') return; // quad isn't a normal playable move
    const res = canBeat(combo, lastCombo);
    if(!res.ok) return;
    seen.add(key);
    out.push({ cards, combo, chop: !!res.chop, instantWin: !!res.instantWin });
  };

  const target = parseCard(cardStr);
  push([cardStr]); // plain single

  // pair partner: same rank, same color
  const pairPartner = hand.find(c => c!==cardStr && parseCard(c).rank===target.rank && suitColor(parseCard(c).suit)===suitColor(target.suit));
  if(pairPartner) push([cardStr, pairPartner].sort());

  // triple: any 3 cards sharing the rank
  const sameRank = hand.filter(c => parseCard(c).rank === target.rank);
  if(sameRank.length >= 3) push(sameRank.slice(0,3));

  // straights: runs of consecutive same-suit cards (excluding '2') containing target
  const sameSuit = hand.filter(c => parseCard(c).suit === target.suit && parseCard(c).rank !== '2');
  const vals = [...new Set(sameSuit.map(c=>parseCard(c).val))].sort((a,b)=>a-b);
  // find the run containing target.val
  let runStart=null, runEnd=null;
  for(let i=0;i<vals.length;i++){
    if(vals[i]===target.val){
      runStart=i; runEnd=i;
      while(runStart>0 && vals[runStart-1]===vals[runStart]-1) runStart--;
      while(runEnd<vals.length-1 && vals[runEnd+1]===vals[runEnd]+1) runEnd++;
      break;
    }
  }
  if(runStart!==null){
    const runVals = vals.slice(runStart, runEnd+1);
    const cardOf = (v)=> sameSuit.find(c=>parseCard(c).val===v);
    const targetIdx = runVals.indexOf(target.val);
    for(const len of [3,4]){
      if(runVals.length < len) continue;
      for(let start=Math.max(0,targetIdx-len+1); start<=targetIdx && start+len<=runVals.length; start++){
        const windowVals = runVals.slice(start, start+len);
        push(windowVals.map(cardOf));
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* 2. Firebase setup                                                      */
/* ---------------------------------------------------------------------- */
let db = null;
let fbReady = false;
try{
  firebase.initializeApp(window.FIREBASE_CONFIG);
  db = firebase.database();
  fbReady = true;
}catch(e){
  console.error('Firebase init failed', e);
}

function roomRef(id){ return db.ref('rooms/'+id); }

/* ---------------------------------------------------------------------- */
/* 3. Local identity + state                                              */
/* ---------------------------------------------------------------------- */
const MY_UID = (function(){
  let id = localStorage.getItem('lao_card_uid');
  if(!id){
    id = 'u_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36);
    localStorage.setItem('lao_card_uid', id);
  }
  return id;
})();

let STATE = {
  roomId: null,
  isHost: false,
  myName: '',
  players: {},      // uid -> {name, seat}
  seatOrder: [],     // uid[] ordered by seat
  status: 'idle',
  table: null,
  myHand: [],
  selected: new Set(),
  sortMode: 'rank',
  history: [],
  winnerUid: null,
  timerInterval: null,
  hostWatchdog: null,
  roomListener: null,
  actionsListener: null,
};

/* ---------------------------------------------------------------------- */
/* 4. DOM shortcuts                                                       */
/* ---------------------------------------------------------------------- */
const $ = (id)=>document.getElementById(id);
function showScreen(name){
  ['landing','waiting','game'].forEach(s=>{
    $('screen-'+s).classList.toggle('hidden', s!==name);
  });
}
function toast(msg, ms=2600){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(()=>t.classList.remove('show'), ms);
}

if(!fbReady){
  toast('ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ Firebase — ແກ້ໄຟລ໌ config.js ກ່ອນ (ເບິ່ງ README.md)', 8000);
}

/* ---------------------------------------------------------------------- */
/* 5. Landing screen — create / join                                      */
/* ---------------------------------------------------------------------- */
let landingTab = 'create';
$('tab-create').onclick = ()=>{ landingTab='create'; $('tab-create').classList.add('active'); $('tab-join').classList.remove('active'); $('panel-create').classList.remove('hidden'); $('panel-join').classList.add('hidden'); };
$('tab-join').onclick   = ()=>{ landingTab='join'; $('tab-join').classList.add('active'); $('tab-create').classList.remove('active'); $('panel-join').classList.remove('hidden'); $('panel-create').classList.add('hidden'); };

let createSeatN = 4, joinSeatN = 4;
document.querySelectorAll('#create-seat-choice button').forEach(b=>{
  b.onclick = ()=>{ document.querySelectorAll('#create-seat-choice button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); createSeatN = +b.dataset.n; };
});
document.querySelectorAll('#join-seat-choice button').forEach(b=>{
  b.onclick = ()=>{ document.querySelectorAll('#join-seat-choice button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); joinSeatN = +b.dataset.n; };
});
['create-code','join-code'].forEach(id=>{
  $(id).addEventListener('input', (e)=>{ e.target.value = e.target.value.replace(/\D/g,'').slice(0,4); });
});

function landingError(msg){
  const el = $('err-landing');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearLandingError(){ $('err-landing').classList.add('hidden'); }

$('btn-create-room').onclick = async ()=>{
  clearLandingError();
  const name = $('input-name').value.trim();
  const code = $('create-code').value.trim();
  if(!fbReady) return landingError('ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ Firebase (ເບິ່ງ README.md)');
  if(!name) return landingError('ກະລຸນາໃສ່ຊື່ຂອງທ່ານ');
  if(code.length !== 4) return landingError('ລະຫັດຫ້ອງຕ້ອງເປັນ 4 ຕົວເລກ');

  const roomId = `${createSeatN}_${code}`;
  const ref = roomRef(roomId);
  try{
    const snap = await ref.get();
    if(snap.exists()){
      const existingStatus = (snap.val().meta || {}).status;
      if(existingStatus === 'waiting' || existingStatus === 'playing'){
        return landingError('ລະຫັດ ແລະ ໂໝດນີ້ຖືກໃຊ້ຢູ່ແລ້ວ, ລອງລະຫັດອື່ນ');
      }
    }
    await ref.set({
      meta: { maxPlayers: createSeatN, code, status:'waiting', hostUid: MY_UID, createdAt: Date.now() },
      players: { [MY_UID]: { name, seat:0 } },
    });
    STATE.myName = name;
    enterRoom(roomId, true);
  }catch(e){
    console.error(e);
    landingError('ເຊື່ອມຕໍ່ Firebase ບໍ່ໄດ້: ' + e.message);
  }
};

$('btn-join-room').onclick = async ()=>{
  clearLandingError();
  const name = $('input-name').value.trim();
  const code = $('join-code').value.trim();
  if(!fbReady) return landingError('ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ Firebase (ເບິ່ງ README.md)');
  if(!name) return landingError('ກະລຸນາໃສ່ຊື່ຂອງທ່ານ');
  if(code.length !== 4) return landingError('ລະຫັດຫ້ອງຕ້ອງເປັນ 4 ຕົວເລກ');

  const roomId = `${joinSeatN}_${code}`;
  const ref = roomRef(roomId);
  try{
    const snap = await ref.get();
    if(!snap.exists()) return landingError('ບໍ່ພົບຫ້ອງນີ້ — ກວດສອບໂໝດ ແລະ ລະຫັດອີກຄັ້ງ');
    const val = snap.val();
    if(val.meta.status !== 'waiting') return landingError('ຫ້ອງນີ້ເລີ່ມຫຼິ້ນໄປແລ້ວ ຫຼື ຈົບແລ້ວ');
    const players = val.players || {};
    if(players[MY_UID]){ STATE.myName = players[MY_UID].name; enterRoom(roomId, players[MY_UID].seat===0); return; }
    const seatsTaken = Object.values(players).map(p=>p.seat);
    if(seatsTaken.length >= val.meta.maxPlayers) return landingError('ຫ້ອງເຕັມແລ້ວ');
    let seat = 0;
    while(seatsTaken.includes(seat)) seat++;
    await ref.child('players/'+MY_UID).set({ name, seat });
    STATE.myName = name;
    enterRoom(roomId, seat===0);
  }catch(e){
    console.error(e);
    landingError('ເຊື່ອມຕໍ່ Firebase ບໍ່ໄດ້: ' + e.message);
  }
};

/* ---------------------------------------------------------------------- */
/* 6. Enter room -> subscribe to state                                    */
/* ---------------------------------------------------------------------- */
function enterRoom(roomId, isHost){
  STATE.roomId = roomId;
  STATE.isHost = isHost;
  showScreen('waiting');

  if(STATE.roomListener) STATE.roomListener();
  const ref = roomRef(roomId);
  const cb = (snap)=> onRoomUpdate(snap.val());
  const cbErr = (err)=>{
    console.error('room listener error', err);
    toast('ອ່ານຂໍ້ມູນຫ້ອງບໍ່ໄດ້: ' + err.message + ' — ກວດ Firebase Database Rules', 6000);
  };
  ref.on('value', cb, cbErr);
  STATE.roomListener = ()=>ref.off('value', cb);

  if(isHost){
    if(STATE.actionsListener) STATE.actionsListener();
    const actRef = ref.child('actions');
    const actCb = (snap)=>{
      const key = snap.key, val = snap.val();
      hostProcessAction(roomId, key, val);
    };
    const actErr = (err)=>{
      console.error('actions listener error', err);
      toast('ໂຮສຮັບຄຳສັ່ງບໍ່ໄດ້ (actions): ' + err.message + ' — ກວດ Firebase Database Rules', 6000);
    };
    actRef.on('child_added', actCb, actErr);
    STATE.actionsListener = ()=>actRef.off('child_added', actCb);
    startHostWatchdog(roomId);
  }
}

function leaveRoom(){
  if(STATE.roomListener) STATE.roomListener();
  if(STATE.actionsListener) STATE.actionsListener();
  if(STATE.hostWatchdog) clearInterval(STATE.hostWatchdog);
  if(STATE.roomId){
    roomRef(STATE.roomId).child('players/'+MY_UID).remove().catch(()=>{});
  }
  STATE.roomId = null; STATE.isHost=false; STATE.players={}; STATE.seatOrder=[];
  STATE.status='idle'; STATE.table=null; STATE.myHand=[]; STATE.selected=new Set();
  showScreen('landing');
}
$('btn-leave-waiting').onclick = leaveRoom;
$('btn-leave-game').onclick = ()=>{ if(confirm('ອອກຈາກເກມ?')) leaveRoom(); };
$('btn-back-lobby').onclick = leaveRoom;

/* ---------------------------------------------------------------------- */
/* 7. Room snapshot -> render waiting room or game                        */
/* ---------------------------------------------------------------------- */
function onRoomUpdate(val){
  if(!val){ toast('ຫ້ອງຖືກລຶບ ຫຼື ບໍ່ມີແລ້ວ'); leaveRoom(); return; }
  const meta = val.meta || {};
  STATE.players = val.players || {};
  STATE.seatOrder = Object.entries(STATE.players).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
  STATE.status = meta.status;
  STATE.table = val.table || null;
  STATE.history = val.history ? Object.values(val.history) : [];
  STATE.winnerUid = val.winnerUid || null;
  STATE.myHand = (val.hands && val.hands[MY_UID]) ? val.hands[MY_UID] : [];
  STATE.isHost = meta.hostUid === MY_UID;

  if(meta.status === 'waiting'){
    showScreen('waiting');
    renderWaitingRoom(meta);
  } else if(meta.status === 'playing' || meta.status === 'finished'){
    showScreen('game');
    renderGame(meta);
    if(meta.status === 'finished') showWinnerModal();
    else $('modal-winner').classList.add('hidden');
  }
}

function renderWaitingRoom(meta){
  $('waiting-code').textContent = meta.code;
  const list = $('seat-list');
  list.innerHTML = '';
  for(let i=0;i<meta.maxPlayers;i++){
    const uid = STATE.seatOrder[i];
    const row = document.createElement('div');
    row.className = 'seat-row' + (uid ? ' filled' : '');
    const p = uid ? STATE.players[uid] : null;
    row.innerHTML = `<div class="dot"></div><div class="name">${p ? escapeHtml(p.name) : 'ລໍຖ້າຜູ້ຫຼິ້ນ...'}</div>${uid===MY_UID?'<span class="you-tag">ທ່ານ</span>':''}`;
    list.appendChild(row);
  }
  const full = STATE.seatOrder.length === meta.maxPlayers;
  $('waiting-hint').textContent = full ? 'ຫ້ອງເຕັມແລ້ວ! ' + (STATE.isHost ? 'ກົດເລີ່ມເກມໄດ້ເລີຍ' : 'ລໍຖ້າເຈົ້າຂອງຫ້ອງກົດເລີ່ມ') : `ລໍຖ້າອີກ ${meta.maxPlayers - STATE.seatOrder.length} ຄົນ...`;
  $('btn-start-game').classList.toggle('hidden', !(STATE.isHost && full));
}

$('btn-start-game').onclick = async ()=>{
  if(!STATE.isHost || !STATE.roomId) return;
  await hostStartGame(STATE.roomId);
};

function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

/* ---------------------------------------------------------------------- */
/* 8. HOST — game engine                                                  */
/* ---------------------------------------------------------------------- */
async function hostStartGame(roomId){
  const ref = roomRef(roomId);
  const snap = await ref.get();
  const val = snap.val();
  const meta = val.meta;
  const seatOrder = Object.entries(val.players).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
  const n = seatOrder.length;

  const deck = shuffle(buildDeck());
  const hands = {};
  for(let i=0;i<n;i++) hands[seatOrder[i]] = deck.slice(i*CONFIG.cardsPerPlayer, (i+1)*CONFIG.cardsPerPlayer);
  const deckRemaining = deck.length - n*CONFIG.cardsPerPlayer;

  // check for an instant-win "super quad" dealt straight into someone's hand
  let autoWinnerUid = null;
  if(CONFIG.quadInHandAutoWins){
    for(const uid of seatOrder){ if(findQuadInHand(hands[uid])){ autoWinnerUid = uid; break; } }
  }

  const table = {
    lastCombo: null,
    currentUid: null,
    freeLead: true,
    deadline: Date.now() + CONFIG.turnSeconds*1000,
    passSet: {},
    deckRemaining,
  };

  const update = {
    'meta/status': autoWinnerUid ? 'finished' : 'playing',
    hands,
    table,
    history: null,
    winnerUid: autoWinnerUid || null,
  };
  try{
    await ref.update(update);
  }catch(e){
    console.error('hostStartGame failed', e);
    toast('ເລີ່ມເກມບໍ່ໄດ້: ' + e.message + ' — ກວດ Firebase Database Rules', 6000);
  }
}

async function hostProcessAction(roomId, actionKey, action){
  if(!action) return;
  const ref = roomRef(roomId);
  try{
    await ref.transaction((room)=>{
      if(!room) return room;
      if(room.meta.status !== 'playing') return room;
      applyAction(room, action);
      return room;
    });
  }catch(e){
    console.error('processAction error', e);
    toast('ຫຼິ້ນໄພ່ບໍ່ສຳເລັດ (host): ' + e.message + ' — ກວດ Firebase Database Rules', 6000);
  }
  finally{
    ref.child('actions/'+actionKey).remove().catch(()=>{});
  }
}

function nextSeatUid(seatOrder, uid){
  const i = seatOrder.indexOf(uid);
  return seatOrder[(i+1) % seatOrder.length];
}

// If table.currentUid points at someone who is no longer in room.players
// (they left / closed the tab), the game gets stuck forever: nobody's
// isMyTurn check ever matches. Snap the turn to the first remaining seat.
function healCurrentUid(room){
  const table = room.table;
  if(!table) return;
  const seatOrder = Object.entries(room.players||{}).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
  if(table.currentUid !== null && !seatOrder.includes(table.currentUid)){
    table.currentUid = seatOrder[0] || null;
    table.passSet = {};
    table.deadline = Date.now() + CONFIG.turnSeconds*1000;
  }
}

// Mutates `room` in place applying a validated play/pass action. Used both
// inside the Firebase transaction and by the host's timeout watchdog.
function applyAction(room, action){
  healCurrentUid(room);
  const seatOrder = Object.entries(room.players).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
  const table = room.table;
  const uid = action.uid;

  const isMyTurn = (table.currentUid === uid) || (table.currentUid === null && table.freeLead);
  if(!isMyTurn) return;

  if(action.kind === 'pass'){
    if(table.freeLead) return; // can't pass when you must lead
    table.passSet = table.passSet || {};
    table.passSet[uid] = true;
    const ownerUid = table.lastCombo ? table.lastCombo.ownerUid : null;
    const ownerStillHere = ownerUid && seatOrder.includes(ownerUid);
    const nxt = nextSeatUid(seatOrder, uid);
    if(!ownerStillHere || nxt === ownerUid){
      table.lastCombo = null;
      table.freeLead = true;
      table.currentUid = ownerStillHere ? ownerUid : nxt;
      table.passSet = {};
    } else {
      table.currentUid = nxt;
    }
    table.deadline = Date.now() + CONFIG.turnSeconds*1000;
    return;
  }

  if(action.kind === 'play'){
    const hand = (room.hands && room.hands[uid]) || [];
    const cards = action.cards || [];
    if(!cards.every(c=>hand.includes(c))) return; // cheating / stale hand guard
    const combo = classifyCombo(cards);
    if(!combo || combo.type==='quad') return;
    const result = canBeat(combo, table.freeLead ? null : table.lastCombo);
    if(!result.ok) return;

    // remove cards from hand
    const newHand = hand.filter(c=>!cards.includes(c));
    room.hands[uid] = newHand;

    // history (cap at last 60 entries)
    room.history = room.history || {};
    const histKey = 'h'+Date.now()+Math.random().toString(36).slice(2,6);
    room.history[histKey] = { uid, cards, type: combo.type, ts: Date.now() };

    if(result.instantWin){
      room.meta.status = 'finished';
      room.winnerUid = uid;
      return;
    }
    if(newHand.length === 0){
      room.meta.status = 'finished';
      room.winnerUid = uid;
      return;
    }

    table.lastCombo = { type: combo.type, len: combo.len, highVal: combo.highVal, cards, ownerUid: uid };
    table.freeLead = false;
    table.passSet = {};
    table.currentUid = nextSeatUid(seatOrder, uid);
    table.deadline = Date.now() + CONFIG.turnSeconds*1000;
  }
}

// Host-only watchdog: force-pass / force-play the smallest card when a
// player's 20s timer runs out. Runs only in the host's browser tab.
function startHostWatchdog(roomId){
  if(STATE.hostWatchdog) clearInterval(STATE.hostWatchdog);
  STATE.hostWatchdog = setInterval(async ()=>{
    const ref = roomRef(roomId);
    const snap = await ref.get();
    const room = snap.val();
    if(!room || room.meta.status !== 'playing') return;

    // Fix a stuck turn (currentUid pointing at someone who left) right away,
    // don't wait for the 20s deadline.
    const seatOrderNow = Object.entries(room.players||{}).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
    if(room.table && room.table.currentUid !== null && !seatOrderNow.includes(room.table.currentUid)){
      await ref.transaction((r)=>{ if(!r) return r; healCurrentUid(r); return r; });
      return;
    }

    const table = room.table;
    if(!table || !table.deadline || Date.now() < table.deadline) return;

    const seatOrder = Object.entries(room.players).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
    let uid = table.currentUid;
    if(uid === null) uid = seatOrder[0];
    const hand = (room.hands && room.hands[uid]) || [];
    if(!hand.length) return;

    let action;
    if(table.freeLead){
      const sorted = sortHand(hand, 'rank');
      action = { uid, kind:'play', cards:[sorted[0]] };
    } else {
      action = { uid, kind:'pass' };
    }
    await ref.transaction((r)=>{ if(!r) return r; applyAction(r, action); return r; });
  }, 1000);
}

/* Client -> intent helpers (writes to actions/ ; host consumes them). If
   the local client IS the host, we still go through the same path so
   there is exactly one code path for game logic. */
function sendAction(kind, cards){
  if(!STATE.roomId) return;
  roomRef(STATE.roomId).child('actions').push({ uid: MY_UID, kind, cards: cards||null, ts: Date.now() })
    .catch(err=>{
      console.error('sendAction failed', err);
      toast('ສົ່ງຄຳສັ່ງບໍ່ໄດ້: ' + err.message + ' — ກວດ Firebase Database Rules (README ຂໍ້ 2)', 6000);
    });
}

$('btn-play-again').onclick = async ()=>{
  if(!STATE.isHost) { toast('ໃຫ້ເຈົ້າຂອງຫ້ອງເປັນຄົນກົດຫຼິ້ນໃໝ່'); return; }
  await hostStartGame(STATE.roomId);
};

/* ---------------------------------------------------------------------- */
/* 9. GAME RENDER                                                         */
/* ---------------------------------------------------------------------- */
const OPP_LAYOUTS = {
  1: [{x:50,y:10}],
  2: [{x:22,y:16},{x:78,y:16}],
  3: [{x:12,y:38},{x:50,y:6},{x:88,y:38}],
  4: [{x:8,y:52},{x:24,y:10},{x:76,y:10},{x:92,y:52}],
};

function cardEl(cardStr, opts={}){
  const {suit, rank} = parseCard(cardStr);
  const color = suitColor(suit);
  const div = document.createElement('div');
  div.className = 'pcard ' + color + (opts.size ? ' '+opts.size : '');
  div.innerHTML = `<div class="corner">${rank}<br>${suit}</div><div class="pip">${suit}</div><div class="corner bottom">${rank}<br>${suit}</div>`;
  return div;
}

function renderGame(meta){
  $('game-room-tag').textContent = 'ຫ້ອງ ' + meta.code;
  const table = STATE.table;
  const mySeat = STATE.players[MY_UID] ? STATE.players[MY_UID].seat : 0;
  const n = meta.maxPlayers;

  // ---- opponent seats ----
  const oval = $('table-oval');
  oval.querySelectorAll('.seat').forEach(el=>el.remove());
  const opponents = STATE.seatOrder.filter(u=>u!==MY_UID);
  const layout = OPP_LAYOUTS[opponents.length] || OPP_LAYOUTS[4];
  opponents.forEach((uid, idx)=>{
    const pos = layout[idx] || {x:50,y:50};
    const p = STATE.players[uid] || {name:'?'};
    const seatDiv = document.createElement('div');
    seatDiv.className = 'seat' + (table && table.currentUid===uid ? ' turn' : '');
    seatDiv.dataset.uid = uid;
    seatDiv.style.left = pos.x+'%';
    seatDiv.style.top = pos.y+'%';
    seatDiv.style.transform = 'translate(-50%,-50%)';
    const passed = table && table.passSet && table.passSet[uid];
    const count = (STATE.oppCounts && STATE.oppCounts[uid]!==undefined) ? STATE.oppCounts[uid] : '?';
    seatDiv.innerHTML = `
      <div class="avatar">${(p.name||'?').slice(0,1).toUpperCase()}</div>
      <div class="name">${escapeHtml(p.name||'')}</div>
      <div class="hand-count">🂠 × <span data-count>${count}</span></div>
      ${passed ? '<div class="passed-tag">ຜ່ານ</div>' : ''}
    `;
    oval.appendChild(seatDiv);
  });

  // opponent hand counts come from a lightweight mirror path we don't have
  // directly (hands are per-uid) — fetch counts on demand:
  refreshOpponentCounts();

  // ---- center pile ----
  const lastComboEl = $('last-combo');
  lastComboEl.innerHTML = '';
  const metaEl = $('last-combo-meta');
  if(table && table.lastCombo){
    table.lastCombo.cards.forEach(c=>lastComboEl.appendChild(cardEl(c, {size:'small'})));
    const ownerName = (STATE.players[table.lastCombo.ownerUid]||{}).name || '';
    metaEl.textContent = `${comboLabel(table.lastCombo.type)} • ${ownerName}`;
  } else {
    metaEl.textContent = table && table.freeLead ? 'ຮອບໃໝ່ — ລົງໄພ່ຫຍັງກໍໄດ້' : '';
  }
  $('deck-count').textContent = table ? `ໄພ່ໃນກອງ: ${table.deckRemaining ?? 0}` : '';

  // ---- status + turn highlight ----
  const isMyTurn = table && ((table.currentUid===MY_UID) || (table.currentUid===null && table.freeLead));
  let statusMsg = '';
  if(STATE.status === 'finished'){ statusMsg = ''; }
  else if(isMyTurn){
    statusMsg = table.freeLead ? 'ຮອບຂອງທ່ານ — ລົງໄພ່ນຳກ່ອນ' : 'ຮອບຂອງທ່ານ — ລົງໄພ່ໃຫ້ໃຫຍ່ກວ່າ ຫຼື ກົດຜ່ານ';
  } else if(table){
    const cur = STATE.players[table.currentUid];
    statusMsg = cur ? `ລໍຖ້າ ${cur.name}...` : 'ກຳລັງແກ້ໄຂຮອບ...';
  }
  $('status-msg').textContent = statusMsg;
  $('btn-pass').disabled = !isMyTurn || (table && table.freeLead);
  $('btn-play').disabled = !isMyTurn;

  renderTimer();
  renderHand();
}

function comboLabel(type){
  return { single:'ໃບດ່ຽວ', pair:'ໄພ່ຄູ່', triple:'ໄພ່ເປົາ', straight:'ໄພ່ລຽງ', superstraight:'ລຽງພິເສດ', quad:'ເປົາພິເສດ' }[type] || type;
}

// Since /hands is keyed by uid and security-rules-light, any client can
// technically read all hands; we only ever DISPLAY our own hand in detail,
// but we do read opponents' hand *lengths* to show remaining-card counts.
function refreshOpponentCounts(){
  if(!STATE.roomId) return;
  roomRef(STATE.roomId).child('hands').get().then(snap=>{
    const val = snap.val() || {};
    STATE.oppCounts = {};
    for(const uid in val) STATE.oppCounts[uid] = (val[uid]||[]).length;
    for(const uid in STATE.oppCounts){
      const seatDiv = document.querySelector(`.seat[data-uid="${uid}"] [data-count]`);
      if(seatDiv) seatDiv.textContent = STATE.oppCounts[uid];
    }
  }).catch(()=>{});
}

function renderTimer(){
  clearInterval(STATE._timerTick);
  const el = $('status-msg');
  if(!STATE.table || !STATE.table.deadline || STATE.status!=='playing') return;
  const tick = ()=>{
    const left = Math.max(0, Math.ceil((STATE.table.deadline - Date.now())/1000));
    const base = el.textContent.replace(/\s*\(\d+s\)$/,'');
    el.textContent = base + (left>0 ? ` (${left}s)` : '');
  };
  tick();
  STATE._timerTick = setInterval(tick, 500);
}

/* ---------------------------------------------------------------------- */
/* 10. HAND rendering + selection                                         */
/* ---------------------------------------------------------------------- */
$('btn-sort-rank').onclick = ()=>{ STATE.sortMode='rank'; $('btn-sort-rank').classList.add('active'); $('btn-sort-suit').classList.remove('active'); renderHand(); };
$('btn-sort-suit').onclick = ()=>{ STATE.sortMode='suit'; $('btn-sort-suit').classList.add('active'); $('btn-sort-rank').classList.remove('active'); renderHand(); };

function renderHand(){
  const row = $('hand-row');
  row.innerHTML = '';
  const hand = sortHand(STATE.myHand, STATE.sortMode);
  hand.forEach(c=>{
    const el = cardEl(c);
    if(STATE.selected.has(c)) el.classList.add('selected');
    el.onclick = ()=>{
      if(STATE.selected.has(c)) STATE.selected.delete(c); else STATE.selected.add(c);
      renderHand();
    };
    row.appendChild(el);
  });
}

$('btn-pass').onclick = ()=>{ sendAction('pass'); STATE.selected.clear(); renderHand(); };

$('btn-play').onclick = ()=>{
  const sel = Array.from(STATE.selected);
  if(sel.length === 0){ toast('ເລືອກໄພ່ກ່ອນ'); return; }

  const table = STATE.table;
  const lastCombo = table && !table.freeLead ? table.lastCombo : null;

  if(sel.length === 1){
    const candidates = candidateCombosContaining(STATE.myHand, sel[0], lastCombo);
    if(candidates.length > 1){
      openSkillChoiceModal(candidates);
      return;
    }
    if(candidates.length === 1){
      submitPlay(candidates[0].cards);
      return;
    }
    toast('ໄພ່ໃບນີ້ລົງບໍ່ໄດ້ໃນຮອບນີ້');
    return;
  }

  const combo = classifyCombo(sel);
  if(!combo || combo.type==='quad'){ toast('ໄພ່ທີ່ເລືອກລົງນຳກັນບໍ່ໄດ້'); return; }
  const res = canBeat(combo, lastCombo);
  if(!res.ok){ toast('ໄພ່ນີ້ນ້ອຍ ຫຼື ບໍ່ຖືກແບບກັບໄພ່ເທິງໂຕະ'); return; }
  submitPlay(sel);
};

function submitPlay(cards){
  sendAction('play', cards);
  STATE.selected.clear();
  renderHand();
}

function openSkillChoiceModal(candidates){
  const box = $('skill-choice-options');
  box.innerHTML = '';
  candidates.forEach(cand=>{
    const btn = document.createElement('button');
    const preview = document.createElement('div');
    preview.className = 'cards-preview';
    cand.cards.forEach(c=>preview.appendChild(cardEl(c,{size:'small'})));
    const label = document.createElement('span');
    label.textContent = comboLabel(cand.combo.type) + (cand.chop ? ' (ທັບ!)' : '') + (cand.instantWin ? ' — ຊະນະທັນທີ' : '');
    btn.appendChild(preview);
    btn.appendChild(label);
    btn.onclick = ()=>{ closeSkillChoiceModal(); submitPlay(cand.cards); };
    box.appendChild(btn);
  });
  $('modal-skill-choice').classList.remove('hidden');
}
function closeSkillChoiceModal(){ $('modal-skill-choice').classList.add('hidden'); }
$('btn-cancel-skill-choice').onclick = closeSkillChoiceModal;

/* ---------------------------------------------------------------------- */
/* 11. History drawer                                                     */
/* ---------------------------------------------------------------------- */
$('btn-history').onclick = ()=>{
  const track = $('history-track');
  track.innerHTML = '';
  const items = STATE.history.slice().sort((a,b)=>a.ts-b.ts);
  if(!items.length) track.innerHTML = '<p style="opacity:.6;">ຍັງບໍ່ມີການລົງໄພ່</p>';
  items.forEach(h=>{
    const set = document.createElement('div');
    set.className = 'history-set';
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'cards';
    h.cards.forEach(c=>cardsDiv.appendChild(cardEl(c,{size:'small'})));
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = (STATE.players[h.uid]||{}).name || '?';
    set.appendChild(cardsDiv);
    set.appendChild(who);
    track.appendChild(set);
  });
  $('history-drawer').classList.remove('hidden');
};
$('btn-close-history').onclick = ()=> $('history-drawer').classList.add('hidden');

/* ---------------------------------------------------------------------- */
/* 12. Winner modal                                                       */
/* ---------------------------------------------------------------------- */
function showWinnerModal(){
  const uid = STATE.winnerUid;
  const name = (STATE.players[uid]||{}).name || '?';
  $('winner-text').textContent = uid===MY_UID ? '🎉 ທ່ານຊະນະ!' : `${name} ຊະນະ!`;
  $('winner-sub').textContent = uid===MY_UID ? 'ຍິນດີນຳ ຫຼິ້ນອີກຮອບບໍ?' : 'ຮອບໜ້າລອງໃໝ່ອີກ!';
  $('btn-play-again').style.display = STATE.isHost ? 'block' : 'none';
  $('modal-winner').classList.remove('hidden');
}

/* ---------------------------------------------------------------------- */
/* init                                                                    */
/* ---------------------------------------------------------------------- */
showScreen('landing');

})();
