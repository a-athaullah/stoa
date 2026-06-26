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
let savedRange = null;

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
        if (savedRange) {
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(savedRange);
        }
        document.execCommand('insertText', false, em);
        savedRange = null;
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
    const sel = window.getSelection();
    if (sel.rangeCount > 0 && input.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    } else {
      savedRange = null;
    }
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


