/* assem.js
   Assem AI:
   - chooses moves by simple heuristic (prioritize removing enemy scout, disabling tanks)
   - occasionally chooses to hold (pass) if no worthwhile move
   - speaks (writes to log) so commentary remains visible for a moment
*/

(function () {
  window.Assem = {};

  function indexToRC(idx) { return { row: Math.floor(idx / 6), col: idx % 6 }; }
  function rcToIndex(r,c) { if (r<0||r>=9||c<0||c>=6) return -1; return r*6 + c; }

  function getUnitAtIdx(units, idx) {
    for (var i=0;i<units.length;i++) { if (units[i].idx === idx && units[i].active) return units[i]; }
    return null;
  }

  function isBarrierByIdx(cells, idx) { if (idx < 0 || idx >= cells.length) return true; return cells[idx].type === 'barrier'; }

  // Scout moves (mirror the rules in game.js)
  function getScoutMoves(unit, cells, unitsList) {
    var rc = indexToRC(unit.idx);
    var row = rc.row, col = rc.col;
    var out = [];

    // cardinals one & two
    var cardinals = [
      {r:-1,c:0},{r:1,c:0},{r:0,c:-1},{r:0,c:1}
    ];
    for (var i=0;i<cardinals.length;i++){
      var d = cardinals[i];
      var nr1 = row + d.r, nc1 = col + d.c;
      var idx1 = rcToIndex(nr1, nc1);
      if (idx1 !== -1 && !isBarrierByIdx(cells, idx1)) {
        var dest1 = getUnitAtIdx(unitsList, idx1);
        if (!dest1 || dest1.team !== unit.team) out.push({ idx: idx1, type:'move' });
      }
      var nr2 = row + d.r*2, nc2 = col + d.c*2;
      var idx2 = rcToIndex(nr2, nc2);
      if (idx2 !== -1 && !isBarrierByIdx(cells, idx2)) {
        var midr = row + d.r, midc = col + d.c;
        var midIdx = rcToIndex(midr, midc);
        if (midIdx !== -1 && !isBarrierByIdx(cells, midIdx) && !getUnitAtIdx(unitsList, midIdx)) {
          var dest2 = getUnitAtIdx(unitsList, idx2);
          if (!dest2 || dest2.team !== unit.team) out.push({ idx: idx2, type:'move' });
        }
      }
    }

    // diagonal one only
    var diagonals = [{r:-1,c:-1},{r:-1,c:1},{r:1,c:-1},{r:1,c:1}];
    for (i=0;i<diagonals.length;i++){
      var d2 = diagonals[i];
      var nr = row + d2.r, nc = col + d2.c;
      var idx = rcToIndex(nr, nc);
      if (idx === -1) continue;
      if (isBarrierByIdx(cells, idx)) continue;
      var dest = getUnitAtIdx(unitsList, idx);
      if (!dest || dest.team !== unit.team) out.push({ idx: idx, type:'move' });
    }

    return out;
  }

  function getTankMoves(unit, cells, unitsList) {
    var rc = indexToRC(unit.idx);
    var row = rc.row, col = rc.col;
    var dirs = [{r:-1,c:0},{r:1,c:0},{r:0,c:-1},{r:0,c:1}];
    var moves = [], fires = [];
    for (var i=0;i<dirs.length;i++){
      var d = dirs[i];
      var nr = row + d.r, nc = col + d.c;
      var idx = rcToIndex(nr,nc);
      if (idx !== -1 && !isBarrierByIdx(cells, idx)) {
        var dest = getUnitAtIdx(unitsList, idx);
        if (!dest || dest.team !== unit.team) moves.push({ idx: idx, type: 'move' });
      }
      for (var dist=1; dist<=4; dist++){
        var tr = row + d.r*dist, tc = col + d.c*dist;
        var tIdx = rcToIndex(tr,tc);
        if (tIdx === -1) break;
        if (isBarrierByIdx(cells, tIdx)) break;
        fires.push({ idx: tIdx, type: 'fire' });
        if (getUnitAtIdx(unitsList, tIdx)) break;
      }
    }
    return { moves: moves, fires: fires };
  }

  function scoreCandidate(from, to, unitsList, cells) {
    var dest = getUnitAtIdx(unitsList, to.idx);
    var score = 0;
    if (to.type === 'move') {
      if (dest && dest.team === 'red') {
        if (dest.type === 'scout') score += 400;
        else if (dest.type === 'tank') score += 300;
      } else {
        score += 5;
      }
    } else if (to.type === 'fire') {
      if (dest && dest.team === 'red') {
        if (dest.type === 'scout') score += 450;
        else if (dest.type === 'tank') score += 280;
      } else {
        score -= 2;
      }
    }
    score += Math.random() * 8;
    return score;
  }

  function chooseBest(cells, unitsList) {
    var candidates = [];
    for (var i=0;i<unitsList.length;i++){
      var u = unitsList[i];
      if (!u.active || u.team !== 'black') continue;
      if (u.type === 'scout') {
        var moves = getScoutMoves(u, cells, unitsList);
        for (var m=0;m<moves.length;m++){
          var score = scoreCandidate(u, moves[m], unitsList, cells);
          candidates.push({ from: u, to: moves[m], score: score });
        }
      } else if (u.type === 'tank') {
        var mm = getTankMoves(u, cells, unitsList);
        for (var a=0;a<mm.moves.length;a++){
          var sc = scoreCandidate(u, mm.moves[a], unitsList, cells);
          candidates.push({ from: u, to: mm.moves[a], score: sc });
        }
        for (a=0;a<mm.fires.length;a++){
          var sc2 = scoreCandidate(u, mm.fires[a], unitsList, cells);
          candidates.push({ from: u, to: mm.fires[a], score: sc2 });
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort(function(a,b){ return b.score - a.score; });
    var topScore = candidates[0].score;
    var top = candidates.filter(function(c){ return c.score === topScore; });
    return top[Math.floor(Math.random() * top.length)];
  }

  var quips = {
    scoutMove: ["We've got a little Peek.", "Peek's out for a walk."],
    tankMove: ["How's 'bout a Poke.", "Time for a Poke."],
    scoutHit: ["Hahaha! Peek-a-boo!", "Peek took a bite!"],
    idle: ["Assem holds position.", "Assem waits..."]
  };

  function speak(kind) {
    var arr = quips[kind] || ['Assem moves.'];
    var s = arr[Math.floor(Math.random() * arr.length)];
    var msgEl = document.getElementById('message');
    if (msgEl) msgEl.textContent = 'Assem: ' + s;
    var logEl = document.getElementById('log');
    var node = document.createElement('div');
    node.textContent = 'Assem: ' + s;
    logEl.insertBefore(node, logEl.firstChild);
  }

  // main entry
  window.Assem.act = function (gameView, done) {
    var cells = gameView.cells;
    var units = gameView.units;
    var state = gameView.state;
    var perform = gameView.performActionCallback;

    var best = chooseBest(cells, units);

    if (!best || best.score < 20) {
      speak('idle');
      setTimeout(function () {
        if (typeof done === 'function') done();
      }, 700);
      return;
    }

    if (best.from.type === 'scout') speak('scoutMove'); else speak('tankMove');

    setTimeout(function () {
      perform(best.from, best.to.idx, best.to.type);
      setTimeout(function () {
        if (typeof done === 'function') done();
      }, 250);
    }, 800);
  };

})();