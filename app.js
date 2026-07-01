(function(){
"use strict";

const CONFIG = { cardsPerPlayer: 9, turnSeconds: 20, chopBigSingleWithTriple: true, bigSingleRanks: ['10','J','Q','K'], chopSingleWithStraight: true, superStraightBeatsTwoAndWins: true, quadInHandAutoWins: true };
const RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
const RVAL = Object.fromEntries(RANKS.map((r,i)=>[r,i]));
const SUITS = ['♠','♣','♥','♦'];

function buildDeck(){ const d = []; for(const s of SUITS) for(const r of RANKS) d.push(r+s); return d; }
function shuffle(arr){ const a = arr.slice(); for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
function parseCard(c){ return { rank: c.slice(0,-1), suit: c.slice(-1), val: RVAL[c.slice(0,-1)] }; }
function suitColor(s){ return (s==='♥'||s==='♦') ? 'red' : 'black'; }

function isStraightCards(cards){
  const suit = cards[0].suit;
  if(!cards.every(c=>c.suit===suit)) return false;
  if(cards.some(c=>c.rank==='2')) return false;
  const vals = cards.map(c=>c.val).sort((a,b)=>a-b);
  for(let i=1;i<vals.length;i++) if(vals[i] !== vals[i-1]+1) return false;
  return true;
}

function classifyCombo(cardStrs){
  if(!cardStrs || !cardStrs.length) return null;
  const cards = cardStrs.map(parseCard); const n = cards.length;
  if(n === 1) return { type:'single', highVal: cards[0].val, len:1 };
  if(n === 2 && cards[0].rank === cards[1].rank && suitColor(cards[0].suit) === suitColor(cards[1].suit)) return { type:'pair', highVal: cards[0].val, len:2 };
  if(n === 3 && cards.every(c=>c.rank===cards[0].rank)) return { type:'triple', highVal: cards[0].val, len:3 };
  if(n === 4 && cards.every(c=>c.rank===cards[0].rank)) return { type:'quad', highVal: cards[0].val, len:4 };
  if(n >= 3 && isStraightCards(cards)) return { type: n>=4 ? 'superstraight' : 'straight', highVal: Math.max(...cards.map(c=>c.val)), len:n };
  return null;
}

function canBeat(play, last){
  if(!last) return { ok:true };
  if(play.type === last.type && play.len === last.len) return { ok: play.highVal > last.highVal };
  if(last.type === 'single'){
    const lastRank = RANKS[last.highVal];
    if(CONFIG.chopBigSingleWithTriple && play.type === 'triple' && CONFIG.bigSingleRanks.includes(lastRank)) return { ok:true, chop:true };
    if(play.type === 'superstraight' && lastRank === '2' && CONFIG.superStraightBeatsTwoAndWins) return { ok:true, chop:true, instantWin:true };
    if(CONFIG.chopSingleWithStraight && (play.type === 'straight' || play.type === 'superstraight') && lastRank !== '2') return { ok:true, chop:true };
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
  if(mode === 'suit') arr.sort((a,b)=>{ const A=parseCard(a), B=parseCard(b); return A.suit!==B.suit ? SUITS.indexOf(A.suit)-SUITS.indexOf(B.suit) : A.val-B.val; });
  else arr.sort((a,b)=> parseCard(a).val - parseCard(b).val || SUITS.indexOf(parseCard(a).suit)-SUITS.indexOf(parseCard(b).suit));
  return arr;
}

function candidateCombosContaining(hand, cardStr, lastCombo){
  const out = []; const seen = new Set();
  const push = (cards)=>{
    const key = cards.slice().sort().join(',');
    if(seen.has(key)) return;
    const combo = classifyCombo(cards);
    if(!combo || combo.type === 'quad') return;
    const res = canBeat(combo, lastCombo);
    if(res.ok) { seen.add(key); out.push({ cards, combo, chop: !!res.chop, instantWin: !!res.instantWin }); }
  };
  const target = parseCard(cardStr); push([cardStr]);
  const pairPartner = hand.find(c => c!==cardStr && parseCard(c).rank===target.rank && suitColor(parseCard(c).suit)===suitColor(target.suit));
  if(pairPartner) push([cardStr, pairPartner].sort());
  const sameRank = hand.filter(c => parseCard(c).rank === target.rank);
  if(sameRank.length >= 3) push(sameRank.slice(0,3));
  const sameSuit = hand.filter(c => parseCard(c).suit === target.suit && parseCard(c).rank !== '2');
  const vals = [...new Set(sameSuit.map(c=>parseCard(c).val))].sort((a,b)=>a-b);
  let runStart=null, runEnd=null;
  for(let i=0;i<vals.length;i++){ if(vals[i]===target.val){ runStart=runEnd=i; while(runStart>0 && vals[runStart-1]===vals[runStart]-1) runStart--; while(runEnd<vals.length-1 && vals[runEnd+1]===vals[runEnd]+1) runEnd++; break; } }
  if(runStart!==null){
    const runVals = vals.slice(runStart, runEnd+1);
    const cardOf = (v)=> sameSuit.find(c=>parseCard(c).val===v);
    const targetIdx = runVals.indexOf(target.val);
    for(const len of [3,4]){
      if(runVals.length < len) continue;
      for(let start=Math.max(0,targetIdx-len+1); start<=targetIdx && start+len<=runVals.length; start++) push(runVals.slice(start, start+len).map(cardOf));
    }
  }
  return out;
}

let db = null; let fbReady = false;
try{ firebase.initializeApp(window.FIREBASE_CONFIG); db = firebase.database(); fbReady = true; } catch(e){}

function roomRef(id){ return db.ref('rooms/'+id); }

const MY_UID = (()=>{ let id = localStorage.getItem('lao_card_uid'); if(!id){ id = 'u_'+Math.random().toString(36).slice(2,10); localStorage.setItem('lao_card_uid', id); } return id; })();

let STATE = { roomId: null, isHost: false, myName: '', players: {}, seatOrder: [], status: 'idle', table: null, myHand: [], selected: new Set(), history: [], winnerUid: null, offline: false };
let OFFLINE_ROOM = null;

const $ = (id)=>document.getElementById(id);
function showScreen(name){ ['landing','waiting','game'].forEach(s=>$('screen-'+s).classList.toggle('hidden', s!==name)); }
function toast(msg, ms=2600){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._h); toast._h = setTimeout(()=>t.classList.remove('show'), ms); }

function switchTab(tab) {
  ['create', 'join', 'offline'].forEach(t => {
    $('tab-'+t).classList.toggle('active', t === tab);
    $('panel-'+t).classList.toggle('hidden', t !== tab);
  });
}
$('tab-create').onclick = () => switchTab('create');
$('tab-join').onclick   = () => switchTab('join');
$('tab-offline').onclick = () => switchTab('offline');

let createSeatN = 4, joinSeatN = 4, offlineSeatN = 4;
document.querySelectorAll('.seat-choice button').forEach(b=>{
  b.onclick = ()=>{ b.parentElement.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); if(b.parentElement.id==='create-seat-choice') createSeatN = +b.dataset.n; else if(b.parentElement.id==='join-seat-choice') joinSeatN = +b.dataset.n; else offlineSeatN = +b.dataset.n; };
});
['create-code','join-code'].forEach(id=>$(id).addEventListener('input', e=>e.target.value = e.target.value.replace(/\D/g,'').slice(0,4)));
function landingError(msg){ const el = $('err-landing'); el.textContent = msg; el.classList.remove('hidden'); }
function clearLandingError(){ $('err-landing').classList.add('hidden'); }

$('btn-create-room').onclick = async ()=>{
  clearLandingError(); const name = $('input-name').value.trim(); const code = $('create-code').value.trim();
  if(!fbReady) return landingError('ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ Firebase');
  if(!name) return landingError('ກະລຸນາໃສ່ຊື່ຂອງທ່ານ'); if(code.length !== 4) return landingError('ລະຫັດຕ້ອງເປັນ 4 ຕົວເລກ');
  const roomId = `${createSeatN}_${code}`; const ref = roomRef(roomId);
  try{
    const snap = await ref.get();
    if(snap.exists() && ['waiting','playing'].includes((snap.val().meta||{}).status)) return landingError('ລະຫັດນີ້ຖືກໃຊ້ຢູ່ແລ້ວ');
    await ref.set({ meta: { maxPlayers: createSeatN, code, status:'waiting', hostUid: MY_UID, createdAt: Date.now() }, players: { [MY_UID]: { name, seat:0 } } });
    STATE.myName = name; enterRoom(roomId, true);
  }catch(e){ landingError('ເຊື່ອມຕໍ່ Firebase ບໍ່ໄດ້'); }
};

$('btn-join-room').onclick = async ()=>{
  clearLandingError(); const name = $('input-name').value.trim(); const code = $('join-code').value.trim();
  if(!fbReady) return landingError('ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ Firebase');
  if(!name) return landingError('ກະລຸນາໃສ່ຊື່ຂອງທ່ານ'); if(code.length !== 4) return landingError('ລະຫັດຕ້ອງເປັນ 4 ຕົວເລກ');
  const roomId = `${joinSeatN}_${code}`; const ref = roomRef(roomId);
  try{
    const snap = await ref.get(); if(!snap.exists()) return landingError('ບໍ່ພົບຫ້ອງນີ້');
    const val = snap.val(); if(val.meta.status !== 'waiting') return landingError('ຫ້ອງນີ້ເລີ່ມຫຼິ້ນໄປແລ້ວ');
    const players = val.players || {};
    if(players[MY_UID]){ STATE.myName = players[MY_UID].name; enterRoom(roomId, players[MY_UID].seat===0); return; }
    const seatsTaken = Object.values(players).map(p=>p.seat);
    if(seatsTaken.length >= val.meta.maxPlayers) return landingError('ຫ້ອງເຕັມແລ້ວ');
    const availableSeats = []; for(let s=0; s<val.meta.maxPlayers; s++) if(!seatsTaken.includes(s)) availableSeats.push(s);
    const seat = availableSeats[Math.floor(Math.random()*availableSeats.length)];
    await ref.child('players/'+MY_UID).set({ name, seat }); STATE.myName = name; enterRoom(roomId, seat===0);
  }catch(e){ landingError('ເຊື່ອມຕໍ່ Firebase ບໍ່ໄດ້'); }
};

$('btn-play-offline').onclick = ()=>{
  clearLandingError(); const name = $('input-name').value.trim();
  if(!name) return landingError('ກະລຸນາໃສ່ຊື່ຂອງທ່ານ');
  
  STATE.offline = true; STATE.roomId = 'OFFLINE'; STATE.isHost = true; STATE.myName = name;
  const players = { [MY_UID]: { name, seat: 0 } };
  for(let i=1; i<offlineSeatN; i++) players['bot_'+i] = { name: 'ບອດ ' + i, seat: i };
  
  OFFLINE_ROOM = { meta: { maxPlayers: offlineSeatN, code: 'OFF', status: 'playing', hostUid: MY_UID, createdAt: Date.now() }, players };
  const deck = shuffle(buildDeck()); const hands = {};
  const seatOrder = Object.keys(players).sort((a,b)=> players[a].seat - players[b].seat);
  seatOrder.forEach((uid, i) => hands[uid] = deck.slice(i*CONFIG.cardsPerPlayer, (i+1)*CONFIG.cardsPerPlayer));
  OFFLINE_ROOM.hands = hands;
  OFFLINE_ROOM.table = { lastCombo: null, currentUid: seatOrder[0], freeLead: true, deadline: Date.now() + 99999999, passSet: {}, deckRemaining: deck.length - offlineSeatN*CONFIG.cardsPerPlayer };
  
  showScreen('game'); onRoomUpdate(OFFLINE_ROOM); if(OFFLINE_ROOM.table.currentUid !== MY_UID) triggerBots();
};

function enterRoom(roomId, isHost){
  STATE.roomId = roomId; STATE.isHost = isHost; showScreen('waiting');
  if(STATE.roomListener) STATE.roomListener();
  const ref = roomRef(roomId); const cb = (snap)=> onRoomUpdate(snap.val());
  ref.on('value', cb); STATE.roomListener = ()=>ref.off('value', cb);
  ref.child('players/'+MY_UID).onDisconnect().remove();

  if(isHost){
    if(STATE.actionsListener) STATE.actionsListener();
    const actRef = ref.child('actions');
    const actCb = (snap)=> hostProcessAction(roomId, snap.key, snap.val());
    actRef.on('child_added', actCb); STATE.actionsListener = ()=>actRef.off('child_added', actCb);
    startHostWatchdog(roomId);
  }
}

function leaveRoom(){
  if(STATE.roomListener) STATE.roomListener();
  if(STATE.actionsListener) STATE.actionsListener();
  if(STATE.hostWatchdog) clearInterval(STATE.hostWatchdog);
  
  if(STATE.offline) {
    STATE.offline = false; OFFLINE_ROOM = null;
  } else if(STATE.roomId) {
    const rId = STATE.roomId; const ref = roomRef(rId);
    ref.child('players/'+MY_UID).remove().then(()=>{
      ref.child('players').get().then(snap => { if(!snap.exists() || Object.keys(snap.val()||{}).length === 0) ref.remove(); });
    }).catch(()=>{});
    ref.child('players/'+MY_UID).onDisconnect().cancel();
  }
  STATE.roomId = null; STATE.isHost=false; STATE.players={}; STATE.seatOrder=[];
  STATE.status='idle'; STATE.table=null; STATE.myHand=[]; STATE.selected=new Set();
  showScreen('landing');
}
$('btn-leave-waiting').onclick = leaveRoom;
$('btn-leave-game').onclick = ()=>{ if(confirm('ອອກຈາກເກມ?')) leaveRoom(); };
$('btn-back-lobby').onclick = leaveRoom;

function onRoomUpdate(val){
  if(!val){ toast('ຫ້ອງຖືກລຶບ ຫຼື ບໍ່ມີແລ້ວ'); leaveRoom(); return; }
  const meta = val.meta || {}; STATE.players = val.players || {};
  STATE.seatOrder = Object.entries(STATE.players).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
  STATE.status = meta.status; STATE.table = val.table || null; STATE.history = val.history ? Object.values(val.history) : [];
  STATE.winnerUid = val.winnerUid || null; STATE.myHand = (val.hands && val.hands[MY_UID]) ? val.hands[MY_UID] : [];
  STATE.isHost = meta.hostUid === MY_UID;

  if(meta.status === 'waiting'){ showScreen('waiting'); renderWaitingRoom(meta); } 
  else if(meta.status === 'playing' || meta.status === 'finished'){
    showScreen('game'); renderGame(meta);
    if(meta.status === 'finished') showWinnerModal(); else $('modal-winner').classList.add('hidden');
  }
}

function renderWaitingRoom(meta){
  $('waiting-code').textContent = meta.code;
  const list = $('seat-list'); list.innerHTML = '';
  for(let i=0;i<meta.maxPlayers;i++){
    const uid = STATE.seatOrder[i]; const p = uid ? STATE.players[uid] : null;
    const row = document.createElement('div'); row.className = 'seat-row' + (uid ? ' filled' : '');
    row.innerHTML = `<div class="dot"></div><div class="name">${p ? escapeHtml(p.name) : 'ລໍຖ້າຜູ້ຫຼິ້ນ...'}</div>${uid===MY_UID?'<span class="you-tag">ທ່ານ</span>':''}`;
    list.appendChild(row);
  }
  const full = STATE.seatOrder.length === meta.maxPlayers;
  $('waiting-hint').textContent = full ? 'ຫ້ອງເຕັມແລ້ວ! ' + (STATE.isHost ? 'ກົດເລີ່ມເກມໄດ້ເລີຍ' : 'ລໍຖ້າເຈົ້າຂອງຫ້ອງກົດເລີ່ມ') : `ລໍຖ້າອີກ ${meta.maxPlayers - STATE.seatOrder.length} ຄົນ...`;
  $('btn-start-game').classList.toggle('hidden', !(STATE.isHost && full));
}
$('btn-start-game').onclick = async ()=>{ if(STATE.isHost && STATE.roomId) await hostStartGame(STATE.roomId); };
function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

async function hostStartGame(roomId){
  const ref = roomRef(roomId); const snap = await ref.get(); const val = snap.val(); const meta = val.meta;
  const seatOrder = Object.entries(val.players).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
  const deck = shuffle(buildDeck()); const hands = {};
  for(let i=0;i<seatOrder.length;i++) hands[seatOrder[i]] = deck.slice(i*CONFIG.cardsPerPlayer, (i+1)*CONFIG.cardsPerPlayer);
  let autoWinnerUid = null; if(CONFIG.quadInHandAutoWins) for(const uid of seatOrder) if(findQuadInHand(hands[uid])) autoWinnerUid = uid;
  const startUid = (val.winnerUid && seatOrder.includes(val.winnerUid)) ? val.winnerUid : null;
  const update = { 'meta/status': autoWinnerUid ? 'finished' : 'playing', hands, history: null, winnerUid: autoWinnerUid || null,
    table: { lastCombo: null, currentUid: startUid, freeLead: true, deadline: Date.now() + CONFIG.turnSeconds*1000, passSet: {}, deckRemaining: deck.length - seatOrder.length*CONFIG.cardsPerPlayer }
  };
  await ref.update(update);
}

async function hostProcessAction(roomId, actionKey, action){
  if(!action) return; const ref = roomRef(roomId);
  try{ await ref.transaction((room)=>{ if(room && room.meta.status === 'playing') applyAction(room, action); return room; }); }
  finally{ ref.child('actions/'+actionKey).remove().catch(()=>{}); }
}

function nextUnpassedUid(seatOrder, fromUid, passSet){
  const ps = passSet || {}; let i = seatOrder.indexOf(fromUid);
  for(let step=0; step<seatOrder.length; step++){ i = (i+1) % seatOrder.length; if(!ps[seatOrder[i]]) return seatOrder[i]; }
  return fromUid;
}

function applyAction(room, action){
  const table = room.table; const uid = action.uid;
  const seatOrder = Object.entries(room.players).sort((a,b)=>a[1].seat-b[1].seat).map(([u])=>u);
  if(table.currentUid !== null && !seatOrder.includes(table.currentUid)) { table.currentUid = seatOrder[0]; table.passSet = {}; }
  if(table.currentUid !== uid && !(table.currentUid === null && table.freeLead)) return;

  if(action.kind === 'pass'){
    if(table.freeLead) return;
    table.passSet = table.passSet || {}; table.passSet[uid] = true;
    const ownerUid = table.lastCombo ? table.lastCombo.ownerUid : null;
    const ownerStillHere = ownerUid && seatOrder.includes(ownerUid);
    const nxt = nextUnpassedUid(seatOrder, uid, table.passSet);
    if(!ownerStillHere || nxt === ownerUid || nxt === uid){ table.lastCombo = null; table.freeLead = true; table.currentUid = ownerStillHere ? ownerUid : nxt; table.passSet = {}; } 
    else table.currentUid = nxt;
    table.deadline = Date.now() + CONFIG.turnSeconds*1000; return;
  }

  if(action.kind === 'play'){
    const hand = (room.hands && room.hands[uid]) || []; const cards = action.cards || [];
    if(!cards.every(c=>hand.includes(c))) return;
    const combo = classifyCombo(cards); if(!combo || combo.type==='quad') return;
    const result = canBeat(combo, table.freeLead ? null : table.lastCombo); if(!result.ok) return;

    room.hands[uid] = hand.filter(c=>!cards.includes(c));
    room.history = room.history || {}; room.history['h'+Date.now()+Math.random().toString(36).slice(2,6)] = { uid, cards, type: combo.type, ts: Date.now() };

    if(result.instantWin || room.hands[uid].length === 0){ room.meta.status = 'finished'; room.winnerUid = uid; return; }

    table.lastCombo = { type: combo.type, len: combo.len, highVal: combo.highVal, cards, ownerUid: uid }; table.freeLead = false;
    table.passSet = table.passSet || {}; delete table.passSet[uid];
    const nxt = nextUnpassedUid(seatOrder, uid, table.passSet);
    if(nxt === uid){ table.lastCombo = null; table.freeLead = true; table.currentUid = uid; table.passSet = {}; } 
    else table.currentUid = nxt;
    table.deadline = Date.now() + CONFIG.turnSeconds*1000;
  }
}

function startHostWatchdog(roomId){
  if(STATE.hostWatchdog) clearInterval(STATE.hostWatchdog);
  STATE.hostWatchdog = setInterval(async ()=>{
    const ref = roomRef(roomId); const snap = await ref.get(); const room = snap.val();
    if(!room || room.meta.status !== 'playing' || !room.table || Date.now() < room.table.deadline) return;
    const seatOrder = Object.entries(room.players).sort((a,b)=>a[1].seat-b[1].seat).map(([uid])=>uid);
    let uid = room.table.currentUid || seatOrder[0];
    const hand = (room.hands && room.hands[uid]) || []; if(!hand.length) return;
    const action = room.table.freeLead ? { uid, kind:'play', cards:[sortHand(hand, 'rank')[0]] } : { uid, kind:'pass' };
    await ref.transaction((r)=>{ if(r) applyAction(r, action); return r; });
  }, 1000);
}

function triggerBots() {
  if(!STATE.offline || !OFFLINE_ROOM || OFFLINE_ROOM.meta.status !== 'playing') return;
  const table = OFFLINE_ROOM.table; const curUid = table.currentUid;
  if(curUid === MY_UID) return;
  setTimeout(()=>{
    const hand = OFFLINE_ROOM.hands[curUid]; if(!hand || !hand.length) return;
    let played = false;
    if(table.freeLead) {
      applyAction(OFFLINE_ROOM, { uid: curUid, kind: 'play', cards: [sortHand(hand, 'rank')[0]] }); played = true;
    } else {
      const sorted = sortHand(hand, 'rank');
      for(const c of sorted) {
        const combo = classifyCombo([c]);
        if(combo && canBeat(combo, table.lastCombo).ok) { applyAction(OFFLINE_ROOM, { uid: curUid, kind: 'play', cards: [c] }); played = true; break; }
      }
      if(!played) applyAction(OFFLINE_ROOM, { uid: curUid, kind: 'pass' });
    }
    onRoomUpdate(OFFLINE_ROOM);
    if(OFFLINE_ROOM.meta.status === 'playing' && OFFLINE_ROOM.table.currentUid !== MY_UID) triggerBots();
  }, 1200);
}

function sendAction(kind, cards){
  if(STATE.offline) { applyAction(OFFLINE_ROOM, { uid: MY_UID, kind, cards }); onRoomUpdate(OFFLINE_ROOM); triggerBots(); return; }
  if(!STATE.roomId) return;
  roomRef(STATE.roomId).child('actions').push({ uid: MY_UID, kind, cards: cards||null, ts: Date.now() });
}

$('btn-play-again').onclick = async ()=>{
  if(STATE.offline) {
    $('modal-winner').classList.add('hidden');
    const deck = shuffle(buildDeck()); const hands = {}; const seatOrder = Object.keys(OFFLINE_ROOM.players).sort((a,b)=> OFFLINE_ROOM.players[a].seat - OFFLINE_ROOM.players[b].seat);
    seatOrder.forEach((uid, i) => hands[uid] = deck.slice(i*CONFIG.cardsPerPlayer, (i+1)*CONFIG.cardsPerPlayer));
    OFFLINE_ROOM.hands = hands; OFFLINE_ROOM.winnerUid = null; OFFLINE_ROOM.meta.status = 'playing';
    OFFLINE_ROOM.table = { lastCombo: null, currentUid: seatOrder[0], freeLead: true, deadline: Date.now() + 99999999, passSet: {}, deckRemaining: deck.length - offlineSeatN*CONFIG.cardsPerPlayer };
    onRoomUpdate(OFFLINE_ROOM); if(OFFLINE_ROOM.table.currentUid !== MY_UID) triggerBots(); return;
  }
  if(!STATE.isHost) { toast('ໃຫ້ເຈົ້າຂອງຫ້ອງເປັນຄົນກົດຫຼິ້ນໃໝ່'); return; }
  await hostStartGame(STATE.roomId);
};

const OPP_LAYOUTS = { 1: [{x:50,y:10}], 2: [{x:22,y:16},{x:78,y:16}], 3: [{x:12,y:38},{x:50,y:6},{x:88,y:38}], 4: [{x:8,y:52},{x:24,y:10},{x:76,y:10},{x:92,y:52}] };

function cardEl(cardStr, opts={}){
  const {suit, rank} = parseCard(cardStr); const div = document.createElement('div');
  div.className = 'pcard ' + suitColor(suit) + (opts.size ? ' '+opts.size : '');
  div.innerHTML = `<div class="corner">${rank}<br>${suit}</div><div class="pip">${suit}</div><div class="corner bottom">${rank}<br>${suit}</div>`; return div;
}

function lastPlayForUid(uid){ let best = null; for(const h of STATE.history) if(h.uid === uid && (!best || h.ts > best.ts)) best = h; return best; }

$('last-combo').parentElement.onclick = ()=> openHistoryDrawer(MY_UID);

function renderGame(meta){
  $('game-room-tag').textContent = 'ຫ້ອງ ' + meta.code;
  const table = STATE.table;
  const oval = $('table-oval'); oval.querySelectorAll('.seat').forEach(el=>el.remove());
  const opponents = STATE.seatOrder.filter(u=>u!==MY_UID); const layout = OPP_LAYOUTS[opponents.length] || OPP_LAYOUTS[4];
  
  opponents.forEach((uid, idx)=>{
    const pos = layout[idx] || {x:50,y:50}; const p = STATE.players[uid] || {name:'?'};
    const seatDiv = document.createElement('div'); seatDiv.className = 'seat' + (table && table.currentUid===uid ? ' turn' : ''); seatDiv.dataset.uid = uid;
    seatDiv.style.left = pos.x+'%'; seatDiv.style.top = pos.y+'%'; seatDiv.style.transform = 'translate(-50%,-50%)';
    const passed = table && table.passSet && table.passSet[uid];
    const count = STATE.offline ? (OFFLINE_ROOM.hands[uid]?OFFLINE_ROOM.hands[uid].length:0) : ((STATE.oppCounts && STATE.oppCounts[uid]!==undefined) ? STATE.oppCounts[uid] : '?');
    seatDiv.innerHTML = `<div class="avatar">${(p.name||'?').slice(0,1).toUpperCase()}</div><div class="name">${escapeHtml(p.name||'')}</div><div class="hand-count">🂠 × <span data-count>${count}</span></div>${passed ? '<div class="passed-tag" style="font-size:0.7rem; color:#ff6b6b;">ຜ່ານ</div>' : ''}`;
    
    const lastPlay = lastPlayForUid(uid); const pileWrap = document.createElement('div');
    pileWrap.className = 'seat-pile' + ((table && table.lastCombo && table.lastCombo.ownerUid === uid) ? ' active-pile' : '') + (lastPlay ? '' : ' empty');
    
    // ສະແດງໄພ້ສູງສຸດ 3 ໃບ (ຂອງຄູ່ແຂ່ງ)
    if(lastPlay) {
      lastPlay.cards.slice(-3).forEach(c=>pileWrap.appendChild(cardEl(c, {size:'small'})));
      if(lastPlay.cards.length > 3) { const b = document.createElement('div'); b.className = 'more-cards-badge'; b.textContent = '+' + (lastPlay.cards.length - 3); pileWrap.appendChild(b); }
    }
    pileWrap.title = 'ກົດເພື່ອເບິ່ງປະຫວັດການລົງໄພ້'; pileWrap.onclick = ()=> openHistoryDrawer(uid);
    seatDiv.appendChild(pileWrap); oval.appendChild(seatDiv);
  });
  
  if(!STATE.offline) refreshOpponentCounts();

  const myPileEl = $('last-combo'); myPileEl.innerHTML = ''; const myPileMeta = $('last-combo-meta');
  const myLastPlay = lastPlayForUid(MY_UID); const myPileIsActive = !!(table && table.lastCombo && table.lastCombo.ownerUid === MY_UID);
  myPileEl.parentElement.classList.toggle('active-pile', myPileIsActive);
  
  // ສະແດງໄພ້ສູງສຸດ 3 ໃບ (ຂອງທ່ານ)
  if(myLastPlay){
    myLastPlay.cards.slice(-3).forEach(c=>myPileEl.appendChild(cardEl(c, {size:'small'})));
    if(myLastPlay.cards.length > 3) { const b = document.createElement('div'); b.className = 'more-cards-badge'; b.textContent = '+' + (myLastPlay.cards.length - 3); myPileEl.appendChild(b); }
    myPileMeta.textContent = `ໄພ້ຂອງທ່ານ • ${comboLabel(myLastPlay.type)}`;
  } else { myPileMeta.textContent = (table && table.freeLead && table.currentUid===MY_UID) ? 'ຮອບໃໝ່ — ລົງໄພ່ຫຍັງກໍໄດ້' : 'ໄພ້ຂອງທ່ານ'; }
  
  $('deck-count').textContent = table ? `ໄພ້ໃນກອງ: ${table.deckRemaining ?? 0}` : '';
  const isMyTurn = table && ((table.currentUid===MY_UID) || (table.currentUid===null && table.freeLead));
  let statusMsg = '';
  if(STATE.status === 'finished') statusMsg = '';
  else if(isMyTurn) statusMsg = table.freeLead ? 'ຮອບຂອງທ່ານ — ລົງໄພ່ນຳກ່ອນ' : 'ຮອບຂອງທ່ານ — ລົງໄພ່ໃຫ້ໃຫຍ່ກວ່າ ຫຼື ກົດຜ່ານ';
  else if(table){ const cur = STATE.players[table.currentUid]; statusMsg = cur ? `ລໍຖ້າ ${cur.name}...` : 'ກຳລັງແກ້ໄຂຮອບ...'; }
  $('status-msg').textContent = statusMsg;
  $('btn-pass').disabled = !isMyTurn || (table && table.freeLead); $('btn-play').disabled = !isMyTurn;
  
  if(!STATE.offline) renderTimer();
  renderHand();
}

function comboLabel(type){ return { single:'ໃບດ່ຽວ', pair:'ໄພ່ຄູ່', triple:'ໄພ່ເປົາ', straight:'ໄພ່ລຽງ', superstraight:'ລຽງພິເສດ', quad:'ເປົາພິເສດ' }[type] || type; }

function refreshOpponentCounts(){
  if(!STATE.roomId) return;
  roomRef(STATE.roomId).child('hands').get().then(snap=>{
    STATE.oppCounts = {}; for(const uid in (snap.val()||{})) STATE.oppCounts[uid] = (snap.val()[uid]||[]).length;
    for(const uid in STATE.oppCounts){ const seatDiv = document.querySelector(`.seat[data-uid="${uid}"] [data-count]`); if(seatDiv) seatDiv.textContent = STATE.oppCounts[uid]; }
  }).catch(()=>{});
}

function renderTimer(){
  clearInterval(STATE._timerTick); const el = $('status-msg');
  if(!STATE.table || !STATE.table.deadline || STATE.status!=='playing') return;
  const tick = ()=>{
    const left = Math.max(0, Math.ceil((STATE.table.deadline - Date.now())/1000));
    el.textContent = el.textContent.replace(/\s*\(\d+s\)$/,'') + (left>0 ? ` (${left}s)` : '');
  };
  tick(); STATE._timerTick = setInterval(tick, 500);
}

$('btn-sort-rank').onclick = ()=>{ STATE.sortMode='rank'; $('btn-sort-rank').classList.add('active'); $('btn-sort-suit').classList.remove('active'); renderHand(); };
$('btn-sort-suit').onclick = ()=>{ STATE.sortMode='suit'; $('btn-sort-suit').classList.add('active'); $('btn-sort-rank').classList.remove('active'); renderHand(); };

function renderHand(){
  const row = $('hand-row'); row.innerHTML = ''; const hand = sortHand(STATE.myHand, STATE.sortMode);
  hand.forEach(c=>{
    const el = cardEl(c); if(STATE.selected.has(c)) el.classList.add('selected');
    el.onclick = ()=>{ if(STATE.selected.has(c)) STATE.selected.delete(c); else STATE.selected.add(c); renderHand(); };
    row.appendChild(el);
  });
}

$('btn-pass').onclick = ()=>{ sendAction('pass'); STATE.selected.clear(); renderHand(); };
$('btn-play').onclick = ()=>{
  const sel = Array.from(STATE.selected); if(sel.length === 0){ toast('ເລືອກໄພ່ກ່ອນ'); return; }
  const table = STATE.table; const lastCombo = table && !table.freeLead ? table.lastCombo : null;
  if(sel.length === 1){
    const candidates = candidateCombosContaining(STATE.myHand, sel[0], lastCombo);
    if(candidates.length > 1) return openSkillChoiceModal(candidates);
    if(candidates.length === 1) return submitPlay(candidates[0].cards);
    return toast('ໄພ່ໃບນີ້ລົງບໍ່ໄດ້ໃນຮອບນີ້');
  }
  const combo = classifyCombo(sel); if(!combo || combo.type==='quad') return toast('ໄພ່ທີ່ເລືອກລົງນຳກັນບໍ່ໄດ້');
  if(!canBeat(combo, lastCombo).ok) return toast('ໄພ່ນີ້ນ້ອຍ ຫຼື ບໍ່ຖືກແບບກັບໄພ່ເທິງໂຕະ');
  submitPlay(sel);
};

function submitPlay(cards){ sendAction('play', cards); STATE.selected.clear(); renderHand(); }

function openSkillChoiceModal(candidates){
  const box = $('skill-choice-options'); box.innerHTML = '';
  candidates.forEach(cand=>{
    const btn = document.createElement('button'); const preview = document.createElement('div'); preview.className = 'cards-preview';
    cand.cards.forEach(c=>preview.appendChild(cardEl(c,{size:'small'})));
    const label = document.createElement('span'); label.textContent = comboLabel(cand.combo.type) + (cand.chop ? ' (ທັບ!)' : '') + (cand.instantWin ? ' — ຊະນະທັນທີ' : '');
    btn.appendChild(preview); btn.appendChild(label);
    btn.onclick = ()=>{ $('modal-skill-choice').classList.add('hidden'); submitPlay(cand.cards); }; box.appendChild(btn);
  });
  $('modal-skill-choice').classList.remove('hidden');
}
$('btn-cancel-skill-choice').onclick = ()=> $('modal-skill-choice').classList.add('hidden');

function openHistoryDrawer(filterUid){
  const track = $('history-track'); track.innerHTML = '';
  let items = STATE.history.slice().sort((a,b)=>a.ts-b.ts); if(filterUid) items = items.filter(h=>h.uid===filterUid);
  const titleEl = document.querySelector('#history-drawer h3');
  if(titleEl) titleEl.textContent = filterUid ? `ປະຫວັດການລົງໄພ່ — ${filterUid===MY_UID ? 'ທ່ານ' : ((STATE.players[filterUid]||{}).name || '?')}` : 'ປະຫວັດການລົງໄພ່';
  if(!items.length) track.innerHTML = '<p style="opacity:.6; color:#fff;">ຍັງບໍ່ມີການລົງໄພ່</p>';
  items.forEach(h=>{
    const set = document.createElement('div'); set.className = 'history-set';
    const cardsDiv = document.createElement('div'); cardsDiv.className = 'cards'; h.cards.forEach(c=>cardsDiv.appendChild(cardEl(c,{size:'small'})));
    const who = document.createElement('div'); who.className = 'who'; who.style.color = 'var(--gold-soft)'; who.style.fontSize = '0.8rem'; who.textContent = (STATE.players[h.uid]||{}).name || '?';
    set.appendChild(cardsDiv); set.appendChild(who); track.appendChild(set);
  });
  $('history-drawer').classList.remove('hidden');
}
$('btn-history').onclick = ()=> openHistoryDrawer(null);
$('btn-close-history').onclick = ()=> $('history-drawer').classList.add('hidden');

function showWinnerModal(){
  const uid = STATE.winnerUid; const name = (STATE.players[uid]||{}).name || '?';
  $('winner-text').textContent = uid===MY_UID ? '🎉 ທ່ານຊະນະ!' : `${name} ຊະນະ!`;
  $('winner-sub').textContent = uid===MY_UID ? 'ຍິນດີນຳ ຫຼິ້ນອີກຮອບບໍ?' : 'ຮອບໜ້າລອງໃໝ່ອີກ!';
  $('btn-play-again').style.display = (STATE.isHost || STATE.offline) ? 'block' : 'none';
  $('modal-winner').classList.remove('hidden');
}

showScreen('landing');
})();
