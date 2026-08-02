// Text uniquifier — slightly varies English text while preserving meaning and URLs
// Changes only 5-6 words per message

const SYNONYMS: Record<string, string[]> = {
  'hi': ['hey', 'hello', 'hi there'],
  'hello': ['hi', 'hey', 'hello there'],
  'hey': ['hi', 'hello', 'hey there'],
  'interested': ['keen', 'curious', 'interested still'],
  'buy': ['purchase', 'get', 'grab'],
  'want': ['would like', 'want to', 'wish to get'],
  'need': ['require', 'looking for', 'in need of'],
  'looking': ['searching', 'looking around', 'browsing'],
  'available': ['still available', 'up for grabs', 'still up'],
  'still': ['currently', 'right now', 'at the moment'],
  'please': ['pls', 'plz', 'kindly'],
  'thanks': ['thank you', 'thanks a lot', 'ty'],
  'thank': ['thanks to', 'appreciate', 'thankful for'],
  'good': ['great', 'nice', 'fine'],
  'great': ['awesome', 'wonderful', 'great one'],
  'price': ['cost', 'rate', 'pricing'],
  'cheap': ['affordable', 'budget-friendly', 'low-cost'],
  'fast': ['quick', 'speedy', 'prompt'],
  'send': ['ship', 'dispatch', 'mail'],
  'deliver': ['ship', 'send over', 'drop off'],
  'meet': ['meet up', 'link up', 'catch up'],
  'check': ['look at', 'review', 'take a look at'],
  'item': ['product', 'listing', 'piece'],
  'sell': ['list', 'offer', 'put up'],
  'buying': ['purchasing', 'getting', 'picking up'],
  'selling': ['offering', 'listing', 'putting up'],
  'condition': ['state', 'quality', 'shape'],
  'original': ['authentic', 'genuine', 'OG'],
  'new': ['brand new', 'fresh', 'unused'],
  'used': ['pre-owned', 'second-hand', 'gently used'],
  'free': ['no charge', 'complimentary', 'at no cost'],
  'today': ['right now', 'this day', 'currently'],
  'tomorrow': ['next day', 'the day after', 'tmr'],
  'sure': ['definitely', 'of course', 'absolutely'],
  'yes': ['yeah', 'yep', 'sure thing'],
  'no': ['nah', 'nope', 'not really'],
  'maybe': ['perhaps', 'possibly', 'might be'],
  'because': ['since', 'as', 'cos'],
  'about': ['around', 'roughly', 'approximately'],
  'with': ['along with', 'together with', 'w/'],
  'without': ['w/o', 'minus', 'lacking'],
  'before': ['prior to', 'ahead of', 'b4'],
  'after': ['following', 'post', 'afterwards'],
  'very': ['really', 'quite', 'pretty'],
  'really': ['truly', 'genuinely', 'actually'],
  'also': ['too', 'as well', 'additionally'],
  'but': ['however', 'though', 'yet'],
  'and': ['plus', 'as well as', '&'],
  'or': ['or else', 'alternatively', 'otherwise'],
  'if': ['in case', 'should', 'provided that'],
  'when': ['once', 'as soon as', 'whenever'],
  'where': ['at which', 'in which', 'wherever'],
  'how': ['in what way', 'the way'],
  'what': ['which', 'whatever'],
  'that': ['which', 'this'],
  'this': ['this one', 'the current'],
  'here': ['right here', 'over here'],
  'there': ['over there', 'right there'],
  'now': ['right now', 'at this moment', 'rn'],
  'later': ['afterwards', 'in a bit', 'later on'],
  'soon': ['shortly', 'in a moment', 'before long'],
  'big': ['large', 'huge', 'sizable'],
  'small': ['tiny', 'little', 'compact'],
  'old': ['vintage', 'classic', 'aged'],
  'nice': ['lovely', 'pleasant', 'fine'],
  'cool': ['awesome', 'neat', 'sweet'],
  'perfect': ['ideal', 'flawless', 'spot-on'],
  'happy': ['glad', 'pleased', 'delighted'],
  'sorry': ['apologies', 'my bad', 'sry'],
  'help': ['assist', 'help out', 'lend a hand'],
  'try': ['attempt', 'give it a shot', 'try out'],
  'use': ['utilize', 'make use of', 'employ'],
  'make': ['create', 'produce', 'craft'],
  'take': ['grab', 'pick up', 'get'],
  'give': ['offer', 'provide', 'hand over'],
  'come': ['stop by', 'drop by', 'swing by'],
  'go': ['head over', 'move', 'proceed'],
  'get': ['obtain', 'receive', 'acquire'],
  'know': ['be aware of', 'understand', 'realize'],
  'think': ['believe', 'reckon', 'figure'],
  'see': ['check out', 'look at', 'view'],
  'find': ['locate', 'come across', 'discover'],
  'work': ['function', 'operate', 'run'],
  'keep': ['hold on to', 'retain', 'maintain'],
  'let': ['allow', 'permit', 'have'],
  'put': ['place', 'set', 'position'],
  'set': ['configure', 'arrange', 'adjust'],
  'talk': ['chat', 'speak', 'converse'],
  'tell': ['inform', 'let know', 'share with'],
  'ask': ['inquire', 'question', 'request'],
  'call': ['ring', 'phone', 'contact'],
  'pay': ['cover', 'settle', 'compensate'],
  'wait': ['hold on', 'hang on', 'bear with me'],
  'move': ['shift', 'relocate', 'transfer'],
  'play': ['enjoy', 'have fun with', 'engage in'],
  'read': ['go through', 'review', 'look over'],
  'open': ['unlock', 'unseal', 'crack open'],
  'close': ['shut', 'seal', 'lock'],
  'start': ['begin', 'kick off', 'commence'],
  'finish': ['complete', 'wrap up', 'finalize'],
  'stop': ['halt', 'pause', 'cease'],
  'change': ['modify', 'alter', 'adjust'],
  'break': ['crack', 'damage', 'bust'],
  'fix': ['repair', 'mend', 'resolve'],
  'save': ['preserve', 'keep', 'store'],
  'lose': ['misplace', 'drop', 'forfeit'],
  'win': ['succeed', 'triumph', 'prevail'],
  'fail': ['miss', 'fall short', 'not succeed'],
  'feel': ['sense', 'experience', 'perceive'],
  'look': ['appear', 'seem', 'come across'],
  'seem': ['appear', 'look like', 'come across as'],
  'show': ['display', 'reveal', 'present'],
  'turn': ['switch', 'flip', 'convert'],
  'pick': ['choose', 'select', 'go for'],
  'hold': ['grip', 'grasp', 'clutch'],
  'carry': ['bring', 'transport', 'tote'],
  'pull': ['tug', 'drag', 'yank'],
  'push': ['shove', 'press', 'nudge'],
  'cut': ['slice', 'trim', 'chop'],
  'join': ['sign up', 'enter', 'participate in'],
  'leave': ['exit', 'depart', 'head out'],
  'stay': ['remain', 'stick around', 'hang around'],
  'sit': ['settle', 'perch', 'rest'],
  'stand': ['rise', 'get up', 'be on feet'],
  'walk': ['stroll', 'step', 'head'],
  'buy it': ['take it', 'get it', 'grab it'],
  'how much': ['what is the price', 'how much is it', 'what is the cost'],
  'let me know': ['tell me', 'inform me', 'drop me a message'],
  'asap': ['as soon as possible', 'urgently', 'right away'],
  'by the way': ['btw', 'incidentally', 'also'],
  'in fact': ['actually', 'as a matter of fact', 'indeed'],
  'for sure': ['definitely', 'certainly', 'absolutely'],
  'no worries': ['all good', 'no problem', 'it is fine'],
  'sounds good': ['works for me', 'that is great', 'perfect'],
  'got it': ['understood', 'noted', 'roger that'],
  'see you': ['catch you later', 'talk soon', 'bye for now'],
  'take care': ['stay safe', 'be well', 'all the best'],
};

const SKIP_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'he', 'him', 'his',
  'she', 'her', 'hers', 'it', 'its', 'we', 'us', 'our', 'ours', 'they',
  'them', 'their', 'theirs', 'the', 'a', 'an', 'is', 'am', 'are', 'was',
  'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall', 'must',
  'not', 'so', 'very', 'just', 'than', 'too', 'each', 'every', 'all', 'both',
  'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'into', 'through', 'during', 'above', 'below', 'up', 'down', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'any', 'much',
]);

function splitPreservingUrls(text: string): Array<{ type: 'text' | 'url'; value: string }> {
  const parts: Array<{ type: 'text' | 'url'; value: string }> = [];
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  let lastIndex = 0;
  let match;

  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'url', value: match[0] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return parts;
}

function getSynonym(word: string): string | null {
  const lower = word.toLowerCase();
  if (SKIP_WORDS.has(lower)) return null;
  if (!SYNONYMS[lower]) return null;

  const alternatives = SYNONYMS[lower];
  const replacement = alternatives[Math.floor(Math.random() * alternatives.length)];

  if (word[0] === word[0].toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function varyText(text: string, replaceCount: number): string {
  const words = text.split(/(\s+)/);

  const replaceable: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (/^\s+$/.test(word) || /^[^\w]+$/.test(word)) continue;
    if (getSynonym(word) !== null) {
      replaceable.push(i);
    }
  }

  if (replaceable.length === 0) return text;

  const count = Math.min(replaceCount, replaceable.length);
  const shuffled = [...replaceable].sort(() => Math.random() - 0.5);
  const toReplace = new Set(shuffled.slice(0, count));

  return words.map((word, i) => {
    if (!toReplace.has(i)) return word;
    return getSynonym(word) || word;
  }).join('');
}

export function addVariation(text: string, messageIndex: number): string {
  const parts = splitPreservingUrls(text);
  const replaceCount = (messageIndex % 2 === 0) ? 5 : 6;

  return parts.map(part => {
    if (part.type === 'url') return part.value;
    return varyText(part.value, replaceCount);
  }).join('');
}
