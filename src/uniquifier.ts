// Business-style uniquifier
// - Different phrasing, formal tone
// - 1-2 intentional typos per message
// - Rearranged punctuation
// - URLs untouched

// Business reformulations: original phrase → alternatives
const REFORMULATIONS: Array<[string, string[]]> = [
  // Greetings
  ['Dear Seller,', ['Hello,', 'Good day,', 'Greetings,', 'Dear Sir/Madam,', 'Hi,']],
  ['Dear Seller', ['Hello', 'Good day', 'Greetings', 'Dear Sir/Madam']],
  ['Hi,', ['Hello,', 'Good day,', 'Greetings,', 'Dear Sir/Madam,']],
  ['Hello,', ['Good day,', 'Greetings,', 'Dear Sir/Madam,', 'Hi,']],

  // Payment
  ['Your item has been paid for', ['Payment for your item has been completed', 'The item has been paid for', 'Payment has been processed for your item', 'Your item payment is complete']],
  ['has been paid for', ['payment has been completed', 'has been purchased', 'payment is complete', 'has been settled']],
  ['has been paid', ['payment is complete', 'has been purchased', 'is paid']],

  // Delivery
  ['choose the delivery method', ['select the delivery option', 'choose a shipping method', 'select delivery preferences', 'pick the delivery method']],
  ['delivery method', ['shipping method', 'delivery option', 'shipping option', 'delivery preference']],
  ['for the item', ['for this item', 'for the product', 'for this product', 'for the order']],
  ['for the delivery', ['for shipping', 'for dispatch', 'for sending']],

  // Order page
  ['please open the order page', ['kindly visit the order page', 'please go to the order page', 'please access the order page', 'kindly open your order page']],
  ['open the order page', ['visit the order page', 'go to the order page', 'access the order page', 'check the order page']],

  // Time limits
  ['This must be completed within 24 hours', ['Please complete this within 24 hours', 'This should be done within 24 hours', 'Kindly complete this within 24 hours', 'This needs to be completed within 24 hours']],
  ['within 24 hours of receiving this notification', ['within 24 hours of this message', 'within 24 hours', 'within one day of receiving this', 'within 24 hours upon receipt']],
  ['within 24 hours', ['within one day', 'within a day', 'in 24 hours', 'within 24hrs']],

  // Completion
  ['Once the process is successfully completed', ['After the process is completed', 'Once completed', 'After completion', 'Upon successful completion']],
  ['the order will appear in your profile', ['the order will show in your account', 'you will see the order in your profile', 'the order will be visible in your account', 'it will appear in your orders']],
  ['will appear in your profile', ['will show in your account', 'will be visible in your profile', 'will be listed in your account']],

  // Closing
  ['Best regards!', ['Kind regards,', 'Regards,', 'Best,', 'Thank you,', 'Sincerely,']],
  ['Best regards', ['Kind regards', 'Regards', 'Best', 'Thank you', 'Sincerely']],
  ['Thank you!', ['Thanks,', 'Thank you,', 'Much appreciated,', 'Many thanks,']],
  ['Thank you', ['Thanks', 'Much appreciated', 'Many thanks']],

  // Misc business
  ['I am interested in', ['I would like to purchase', 'I am looking to buy', 'I wish to acquire', 'I want to order']],
  ['I\'m interested in', ['I would like to purchase', 'I am looking to buy', 'I wish to acquire', 'I want to order']],
  ['Is this still available', ['Is this item still available', 'Is this product still for sale', 'Is this still in stock', 'Do you still have this']],
  ['Is it still available', ['Is this item still available', 'Is this still for sale', 'Do you still have this']],
  ['How much', ['What is the price', 'What is the cost', 'May I ask the price']],
  ['Can you ship', ['Is shipping available', 'Can this be shipped', 'Do you offer delivery']],
  ['I would like to buy', ['I want to purchase', 'I wish to buy', 'I would like to order']],
  ['Please let me know', ['Kindly inform me', 'Please advise', 'Please confirm']],
  ['Looking forward', ['I look forward', 'Anticipating', 'Expecting']],
];

// Common typos to introduce (correct → typo)
const TYPO_MAP: Array<[string, string]> = [
  ['carousell', 'carrousel'],
  ['carousell', 'carossel'],
  ['carousell', 'carousel'],
  ['payment', 'payement'],
  ['payment', 'paymnt'],
  ['delivery', 'delivary'],
  ['delivery', 'delievery'],
  ['completed', 'complited'],
  ['completed', 'completeed'],
  ['notification', 'notifcation'],
  ['notification', 'notifiation'],
  ['successfully', 'successfuly'],
  ['successfully', 'sucessfully'],
  ['please', 'plase'],
  ['please', 'pleas'],
  ['available', 'avalable'],
  ['available', 'avaiable'],
  ['shipping', 'shiping'],
  ['purchase', 'purchace'],
  ['receive', 'recieve'],
  ['receive', 'receve'],
  ['business', 'bussiness'],
  ['order', 'odrer'],
  ['product', 'prduct'],
  ['account', 'acount'],
  ['profile', 'profiel'],
  ['method', 'metod'],
  ['process', 'proccess'],
  ['within', 'witin'],
  ['completed', 'done'],
  ['regards', 'regareds'],
  ['sincerely', 'sincerly'],
  ['kindly', 'kndly'],
];

// Punctuation variations
const PUNCTUATION_VARIATIONS: Array<[string, string]> = [
  ['. ', '.\n'],
  ['.\n', '. '],
  [', ', ',\n'],
  [': ', ':\n'],
  ['! ', '!\n'],
  ['.\n\n', '.\n'],
  ['. ', '.  '],
];

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

function applyReformulation(text: string): string {
  // Shuffle reformulations to pick different ones each time
  const shuffled = [...REFORMULATIONS].sort(() => Math.random() - 0.5);

  let result = text;
  let applied = 0;

  for (const [original, alternatives] of shuffled) {
    if (applied >= 3) break; // Max 3 reformulations per message

    const lower = result.toLowerCase();
    const idx = lower.indexOf(original.toLowerCase());

    if (idx !== -1) {
      const alt = alternatives[Math.floor(Math.random() * alternatives.length)];
      // Preserve original capitalization of first char
      const origChar = result[idx];
      let replacement = alt;
      if (origChar === origChar.toUpperCase()) {
        replacement = alt.charAt(0).toUpperCase() + alt.slice(1);
      }
      result = result.slice(0, idx) + replacement + result.slice(idx + original.length);
      applied++;
    }
  }

  return result;
}

function introduceTypo(text: string): string {
  const lower = text.toLowerCase();

  for (const [correct, typo] of TYPO_MAP) {
    const idx = lower.indexOf(correct);
    if (idx !== -1) {
      // Replace with typo (preserve case)
      const before = text.slice(0, idx);
      const after = text.slice(idx + correct.length);
      const typoCased = text[idx] === text[idx].toUpperCase()
        ? typo.charAt(0).toUpperCase() + typo.slice(1)
        : typo;
      return before + typoCased + after;
    }
  }

  return text;
}

function varyPunctuation(text: string): string {
  const [from, to] = PUNCTUATION_VARIATIONS[Math.floor(Math.random() * PUNCTUATION_VARIATIONS.length)];
  // Only apply once, to a random occurrence
  const idx = text.indexOf(from);
  if (idx !== -1) {
    return text.slice(0, idx) + to + text.slice(idx + from.length);
  }
  return text;
}

export function addVariation(text: string, messageIndex: number): string {
  const parts = splitPreservingUrls(text);

  return parts.map(part => {
    if (part.type === 'url') return part.value;

    let result = part.value;

    // 1. Apply reformulation (different phrasing)
    result = applyReformulation(result);

    // 2. Introduce 1 typo (every other message)
    if (messageIndex % 2 === 0) {
      result = introduceTypo(result);
    }

    // 3. Vary punctuation (every message)
    result = varyPunctuation(result);

    return result;
  }).join('');
}
