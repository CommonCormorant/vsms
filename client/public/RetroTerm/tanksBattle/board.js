/* board.js
   Deck builder and classification utilities.
   Exposes:
     BoardUtil.createShuffledBoard() -> array[54] of card objects
     BoardUtil.classifyCard(card) -> { type: 'scout'|'tank'|'barrier'|'open', team?: 'red'|'black' }
*/

(function () {
  window.BoardUtil = {};

  var SUITS = ['♣','♦','♥','♠'];
  var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];

  function createDeck() {
    var deck = [];
    var id = 0;
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) {
        deck.push({
          id: id,
          suit: SUITS[s],
          rank: RANKS[r],
          isRed: (SUITS[s] === '♦' || SUITS[s] === '♥')
        });
        id++;
      }
    }
    // Add two jokers (red and black). Place them outside the 52 so shuffle works fine.
    deck.unshift({ id: -1, suit: null, rank: 'JOKER_RED', isRed: true });
    deck.push({ id: -2, suit: null, rank: 'JOKER_BLACK', isRed: false });
    return deck;
  }

  function shuffle(deck) {
    var arr = deck.slice(0);
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function classifyCard(card) {
    if (!card) return { type: 'empty' };
    if (card.rank === 'JOKER_RED') return { type: 'scout', team: 'red' };
    if (card.rank === 'JOKER_BLACK') return { type: 'scout', team: 'black' };
    if (card.rank === 'A') return { type: 'tank', team: card.isRed ? 'red' : 'black' };
    if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return { type: 'barrier' };
    return { type: 'open' };
  }

  // produce 54 shuffled cards trimmed to board size
  window.BoardUtil.createShuffledBoard = function () {
    var deck = createDeck();
    var shuffled = shuffle(deck);
    // ensure length >= 54
    if (shuffled.length < 54) {
      while (shuffled.length < 54) shuffled.push({ id: 9999, suit: null, rank: '?' });
    }
    return shuffled.slice(0, 54);
  };

  window.BoardUtil.classifyCard = classifyCard;
})();