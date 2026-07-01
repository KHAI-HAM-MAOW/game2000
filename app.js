/* ---------------------------------------------------------------------- */
/* 5. ແທັບ Offline ທີ່ເພີ່ມໃໝ່                                                */
/* ---------------------------------------------------------------------- */
let offlineSeatN = 4;
$('tab-offline').onclick = ()=>{ 
  landingTab='offline'; 
  $('tab-offline').classList.add('active'); 
  $('tab-create').classList.remove('active'); 
  $('tab-join').classList.remove('active'); 
  $('panel-offline').classList.remove('hidden'); 
  $('panel-create').classList.add('hidden'); 
  $('panel-join').classList.add('hidden'); 
};
document.querySelectorAll('#offline-seat-choice button').forEach(b=>{
  b.onclick = ()=>{ document.querySelectorAll('#offline-seat-choice button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); offlineSeatN = +b.dataset.n; };
});

$('btn-play-offline').onclick = ()=>{
  clearLandingError();
  const name = $('input-name').value.trim();
  if(!name) return landingError('ກະລຸນາໃສ່ຊື່ຂອງທ່ານ');
  
  // ລະບົບຈຳລອງ Offline Mode ພື້ນຖານ
  STATE.myName = name;
  STATE.roomId = 'offline_mode';
  STATE.isHost = true;
  STATE.status = 'playing';
  // ... (ເພີ່ມ Logic ບອດຢູ່ບ່ອນນີ້ສຳລັບການຫຼິ້ນແບບບໍ່ໃຊ້ເນັດ)
  toast('ເລີ່ມໂໝດ Offline ແລ້ວ (ລະບົບບອດກຳລັງພັດທະນາ)', 3000);
  showScreen('game');
};


/* ---------------------------------------------------------------------- */
/* ການຣີເຊັດຫ້ອງເມື່ອກົດອອກ (ອອກແລ້ວຫ້ອງວ່າງ ຈະຖືກລຶບທັນທີ)                        */
/* ---------------------------------------------------------------------- */
function leaveRoom(){
  if(STATE.roomListener) STATE.roomListener();
  if(STATE.actionsListener) STATE.actionsListener();
  if(STATE.hostWatchdog) clearInterval(STATE.hostWatchdog);
  if(STATE.roomId && STATE.roomId !== 'offline_mode'){
    const ref = roomRef(STATE.roomId);
    ref.child('players/'+MY_UID).remove().then(() => {
      // ຖ້າບໍ່ມີໃຜເຫຼືອໃນຫ້ອງ ໃຫ້ລຶບຫ້ອງນັ້ນຖິ້ມເພື່ອໃຫ້ລີເຊັດໃໝ່ໄດ້
      ref.child('players').once('value').then(snap => {
         if (!snap.exists() || Object.keys(snap.val()).length === 0) {
            ref.remove();
         }
      });
    }).catch(()=>{});
  }
  STATE.roomId = null; STATE.isHost=false; STATE.players={}; STATE.seatOrder=[];
  STATE.status='idle'; STATE.table=null; STATE.myHand=[]; STATE.selected=new Set();
  showScreen('landing');
}


/* ---------------------------------------------------------------------- */
/* ຈຳກັດການສະແດງໄພ້ທີ່ລົງໜ້າໂຕະສູງສຸດ 3 ໃບ ແລະ ສາມາດກົດເບິ່ງປະຫວັດໄດ້              */
/* ---------------------------------------------------------------------- */
// ໃນຟັງຊັນ renderGame(meta) ແກ້ໄຂຈຸດການສ້າງ pileWrap
    const isActivePile = !!(table && table.lastCombo && table.lastCombo.ownerUid === uid);
    const lastPlay = lastPlayForUid(uid);
    const pileWrap = document.createElement('div');
    pileWrap.className = 'seat-pile' + (isActivePile ? ' active-pile' : '') + (lastPlay ? '' : ' empty');
    pileWrap.style.position = 'relative'; // ເພື່ອໃສ່ tag ຈຳນວນ
    
    if(lastPlay) {
      // ຕັດເອົາສະເພາະ 3 ໃບລ່າສຸດ
      const displayCards = lastPlay.cards.slice(-3);
      displayCards.forEach(c=>pileWrap.appendChild(cardEl(c, {size:'small'})));
      
      // ສະແດງຕົວເລກຖ້າໄພ້ຫຼາຍກວ່າ 3 ໃບ
      if(lastPlay.cards.length > 3) {
         const moreTag = document.createElement('div');
         moreTag.className = 'more-cards-tag';
         moreTag.textContent = '+' + (lastPlay.cards.length - 3);
         pileWrap.appendChild(moreTag);
      }
    }
    
    // ສາມາດກົດໃສ່ໄພ້ເພື່ອເບິ່ງປະຫວັດໄພ້ທີ່ລົງໄປແລ້ວ
    pileWrap.title = 'ກົດເພື່ອເບິ່ງປະຫວັດການລົງໄພ້';
    pileWrap.onclick = ()=> openHistoryDrawer(uid);
    seatDiv.appendChild(pileWrap);
