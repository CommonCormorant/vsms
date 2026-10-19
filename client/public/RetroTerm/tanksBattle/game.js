/* game.js
   Main game logic and UI wiring:
   - splash overlay mode selection
   - fairness reshuffle loop (logs Reshuffle N×)
   - selection / preview / confirm / cancel
   - pass/hold button
   - turn handling and win check
   - uses BoardUtil and Assem
*/

(function () {
  // grid config
  var COLS = 6, ROWS = 9, BOARD_SIZE = COLS * ROWS;

  // token emojis for now inside token divs (easy to swap to <img> later)
  var EMOJI = {
    RED_SCOUT: '⚪',
    BLACK_SCOUT: '⚫',
    RED_TANK: '🟥',
    BLACK_TANK: '⬛',
    BARRIER: '🧱',
    HIT: '💥'
  };

  // DOM
  var overlay = document.getElementById('overlay');
  var overlayPVP = document.getElementById('overlay-pvp');
  var overlayAI = document.getElementById('overlay-ai');
  var reshuffleNote = document.getElementById('reshuffle-note');

  var boardEl = document.getElementById('board');
  var turnNameEl = document.getElementById('turn-name');
  var redInfo = document.getElementById('red-info');
  var blackInfo = document.getElementById('black-info');
  var messageEl = document.getElementById('message');
  var logEl = document.getElementById('log');

  var passBtn = document.getElementById('pass-btn');
  var confirmBtn = document.getElementById('confirm-btn');
  var cancelBtn = document.getElementById('cancel-btn');
  var newGameBtn = document.getElementById('new-game');

  // state containers
  var rawBoard = [];
  var cells = []; // { idx, card, type, disabled, unitId }
  var units = []; // { id, type, team, idx, active }

  var state = {
    mode: null, // 'pvp' | 'ai'
    turn: 'red',
    selectedUnitId: null,
    previewIdx: null,
    previewAction: null, // 'move'|'fire'
    aiThinking: false,
    gameOver: false,
    reshuffleCount: 0
  };

  // helpers
  function log(msg) {
    if (!msg) return;
    var time = new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
    var node = document.createElement('div');
    node.textContent = msg;
    logEl.insertBefore(node, logEl.firstChild);
    while (logEl.childNodes.length > 200) logEl.removeChild(logEl.lastChild);
  }
  function setMessage(txt) { messageEl.textContent = txt || ''; }

  function indexToRC(idx) { return { row: Math.floor(idx / COLS), col: idx % COLS }; }
  function rcToIndex(r, c) { if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return -1; return r * COLS + c; }
  function getCell(idx) { return cells[idx]; }
  function getUnitById(id) { if (!id) return null; for (var i=0;i<units.length;i++) if (units[i].id===id) return units[i]; return null; }
  function getUnitAt(idx) { for (var i=0;i<units.length;i++) { if (units[i].idx===idx && units[i].active) return units[i]; } return null; }

  // build board and units from a raw deck array
  function buildFromDeck(deck) {
    cells = [];
    units = [];
    var redTankCount = 0, blackTankCount = 0;
    for (var i=0;i<BOARD_SIZE;i++) {
      var card = deck[i];
      var meta = BoardUtil.classifyCard(card);
      var cell = { idx: i, card: card, type: meta.type, disabled: false, unitId: null };
      if (meta.type === 'scout') {
        var id = (meta.team === 'red') ? 'red_scout' : 'black_scout';
        cell.unitId = id;
        units.push({ id: id, type: 'scout', team: meta.team, idx: i, active: true });
      } else if (meta.type === 'tank') {
        var id = (meta.team === 'red') ? ('red_tank_' + (++redTankCount)) : ('black_tank_' + (++blackTankCount));
        cell.unitId = id;
        units.push({ id: id, type: 'tank', team: meta.team, idx: i, active: true });
      } else if (meta.type === 'barrier') {
        cell.type = 'barrier';
      } else {
        cell.type = 'open';
      }
      cells.push(cell);
    }
  }

  // fairness checks for first-move immediate kills:
  // - any tank can artillery-hit an enemy unit within range with no barrier blocking
  // - any scout has a valid move that would land on an enemy unit (scout killing scout or scout sabotaging tank)
  function boardIsFair() {
    for (var i=0;i<units.length;i++) {
      var u = units[i];
      if (!u.active) continue;
      if (u.type === 'tank') {
        var targets = getValidArtilleryTargets(u, cells, units);
        for (var t=0;t<targets.length;t++) {
          var tgt = targets[t];
          var destUnit = getUnitAt(tgt.idx);
          if (destUnit && destUnit.team !== u.team) {
            return false; // immediate artillery kill possible
          }
        }
      } else if (u.type === 'scout') {
        var moves = getValidScoutMoves(u, cells, units);
        for (var m=0;m<moves.length;m++) {
          var mv = moves[m];
          var destUnit = getUnitAt(mv.idx);
          if (destUnit && destUnit.team !== u.team) {
            return false; // scout has immediate killing move
          }
        }
      }
    }
    return true;
  }

  // search utilities (same logic used for preview/AI)
  function isBarrier(idx) { if (idx < 0 || idx >= cells.length) return true; return cells[idx].type === 'barrier'; }

  // ---------- FIXED SCOUT MOVES LOGIC ----------
  // Scouts can move:
  //  - one square in a diagonal (abs(dr) === 1 && abs(dc) === 1)
  //  - one or two squares in a cardinal direction:
  //      * (abs(dr) === 1 && dc === 0) or (abs(dc) === 1 && dr === 0)
  //      * (abs(dr) === 2 && dc === 0) or (abs(dc) === 2 && dr === 0) only if intermediate square is free (no barrier, no unit)
  function getValidScoutMoves(unit, cellsArr, unitsArr) {
    if (!unit) return [];
    var rc = indexToRC(unit.idx);
    var row = rc.row, col = rc.col;
    var moves = [];

    // Cardinal one & two:
    var cardinals = [
      {r: -1, c: 0},
      {r: 1, c: 0},
      {r: 0, c: -1},
      {r: 0, c: 1}
    ];
    for (var i=0;i<cardinals.length;i++) {
      var d = cardinals[i];
      // one-step
      var nr1 = row + d.r, nc1 = col + d.c;
      var idx1 = rcToIndex(nr1, nc1);
      if (idx1 !== -1 && !isBarrier(idx1)) {
        var dest1 = getUnitAt(idx1);
        if (!dest1 || dest1.team !== unit.team) {
          moves.push({ idx: idx1, type: 'move' });
        }
      }
      // two-step (only if intermediate is empty and not barrier)
      var nr2 = row + d.r*2, nc2 = col + d.c*2;
      var idx2 = rcToIndex(nr2, nc2);
      if (idx2 !== -1 && !isBarrier(idx2)) {
        var midr = row + d.r, midc = col + d.c;
        var midIdx = rcToIndex(midr, midc);
        if (midIdx !== -1 && !isBarrier(midIdx) && !getUnitAt(midIdx)) {
          var dest2 = getUnitAt(idx2);
          if (!dest2 || dest2.team !== unit.team) {
            moves.push({ idx: idx2, type: 'move' });
          }
        }
      }
    }

    // Diagonal one only
    var diagonals = [
      {r:-1, c:-1}, {r:-1, c:1}, {r:1, c:-1}, {r:1, c:1}
    ];
    for (i=0;i<diagonals.length;i++) {
      var d2 = diagonals[i];
      var nr = row + d2.r, nc = col + d2.c;
      var idx = rcToIndex(nr, nc);
      if (idx === -1) continue;
      if (isBarrier(idx)) continue;
      var dest = getUnitAt(idx);
      if (!dest || dest.team !== unit.team) {
        moves.push({ idx: idx, type: 'move' });
      }
    }

    return moves;
  }

  function getValidTankMoves(unit, cellsArr, unitsArr) {
    if (!unit) return [];
    var rc = indexToRC(unit.idx);
    var row = rc.row, col = rc.col;
    var moves = [];
    var dirs = [{r:-1,c:0},{r:1,c:0},{r:0,c:-1},{r:0,c:1}];
    for (var i=0;i<dirs.length;i++){
      var d = dirs[i];
      var nr = row + d.r, nc = col + d.c;
      var idx = rcToIndex(nr,nc);
      if (idx === -1) continue;
      if (isBarrier(idx)) continue;
      var dest = getUnitAt(idx);
      if (!dest || dest.team !== unit.team) moves.push({ idx: idx, type:'move' });
    }
    return moves;
  }

  function getValidArtilleryTargets(unit, cellsArr, unitsArr) {
    if (!unit) return [];
    var rc = indexToRC(unit.idx);
    var row = rc.row, col = rc.col;
    var targets = [];
    var dirs = [{r:-1,c:0},{r:1,c:0},{r:0,c:-1},{r:0,c:1}];
    for (var i=0;i<dirs.length;i++){
      var d = dirs[i];
      for (var dist=1; dist<=4; dist++){
        var nr = row + d.r*dist, nc = col + d.c*dist;
        var idx = rcToIndex(nr,nc);
        if (idx === -1) break;
        if (isBarrier(idx)) break;
        targets.push({ idx: idx, type: 'fire' });
        if (getUnitAt(idx)) break;
      }
    }
    return targets;
  }

  // rendering
  function renderBoard() {
    boardEl.innerHTML = '';
    for (var i=0;i<cells.length;i++) {
      var c = cells[i];
      var el = document.createElement('div');
      el.className = 'cell';
      el.dataset.idx = i;
      if (c.type === 'barrier') {
        el.classList.add('barrier');
        var token = document.createElement('div');
        token.className = 'token barrier';
        token.textContent = EMOJI.BARRIER;
        el.appendChild(token);
      } else {
        var unit = getUnitAt(i);
        if (unit) {
          var token = document.createElement('div');
          token.className = 'token ' + (unit.type === 'scout' ? 'scout' : 'tank') + ' ' + unit.team;
          if (unit.type === 'scout') token.textContent = (unit.team === 'red') ? '🔴' : '⚫';
          else token.textContent = (unit.team === 'red') ? '🟥' : '⬛';
          el.appendChild(token);
          if (cells[i].disabled && unit.type === 'tank') {
            el.classList.add('disabled');
          }
        } else {
          // empty cell, leave blank
        }
      }

      // selection/preview visuals
      if (state.selectedUnitId) {
        var sel = getUnitById(state.selectedUnitId);
        if (sel && sel.idx === i) el.classList.add('selected');
      }
      if (state.previewIdx === i) el.classList.add('preview');

      boardEl.appendChild(el);
    }
    highlightValidTargets();
  }

  function renderStatus() {
    turnNameEl.textContent = (state.turn === 'red') ? 'Red' : (state.mode === 'ai' && state.turn === 'black' ? 'Assem' : 'Black');
    var redTanksLeft = units.filter(function(u){ return u.team==='red' && u.type==='tank' && u.active && !cells[u.idx].disabled; }).length;
    var redScoutAlive = units.some(function(u){ return u.team==='red' && u.type==='scout' && u.active; });
    var blackTanksLeft = units.filter(function(u){ return u.team==='black' && u.type==='tank' && u.active && !cells[u.idx].disabled; }).length;
    var blackScoutAlive = units.some(function(u){ return u.team==='black' && u.type==='scout' && u.active; });
    redInfo.innerHTML = 'Red: Tanks ' + redTanksLeft + '/2 &nbsp; Scout ' + (redScoutAlive ? '✓' : '✗');
    blackInfo.innerHTML = 'Black: Tanks ' + blackTanksLeft + '/2 &nbsp; Scout ' + (blackScoutAlive ? '✓' : '✗');
  }

  // highlighting of valid targets based on selection
  function highlightValidTargets() {
    var els = boardEl.querySelectorAll('.cell');
    for (var i=0;i<els.length;i++) { els[i].classList.remove('valid-move','valid-fire'); }

    var sel = getUnitById(state.selectedUnitId);
    if (!sel) return;
    if (sel.type === 'scout') {
      var moves = getValidScoutMoves(sel, cells, units);
      for (var m=0;m<moves.length;m++) {
        var el = boardEl.querySelector('.cell[data-idx="' + moves[m].idx + '"]');
        if (el) el.classList.add('valid-move');
      }
    } else if (sel.type === 'tank') {
      var mv = getValidTankMoves(sel, cells, units);
      for (var j=0;j<mv.length;j++) {
        var el2 = boardEl.querySelector('.cell[data-idx="' + mv[j].idx + '"]');
        if (el2) el2.classList.add('valid-move');
      }
      var fires = getValidArtilleryTargets(sel, cells, units);
      for (j=0;j<fires.length;j++) {
        var ef = boardEl.querySelector('.cell[data-idx="' + fires[j].idx + '"]');
        if (ef) ef.classList.add('valid-fire');
      }
    }
  }

  // board click handling
  boardEl.addEventListener('click', function (ev) {
    if (state.gameOver || state.aiThinking) return;
    var cellEl = ev.target.closest('.cell');
    if (!cellEl) return;
    var idx = parseInt(cellEl.dataset.idx, 10);

    // if previewed target clicked again -> show confirm
    if (state.previewIdx === idx) {
      confirmBtn.classList.remove('hidden');
      confirmBtn.classList.add('primary');
      cancelBtn.classList.remove('hidden');
      return;
    }

    // if clicked valid move -> set preview
    if (cellEl.classList.contains('valid-move')) {
      state.previewIdx = idx;
      state.previewAction = 'move';
      showPreview();
      return;
    }
    if (cellEl.classList.contains('valid-fire')) {
      state.previewIdx = idx;
      state.previewAction = 'fire';
      showPreview();
      return;
    }

    // else try select a unit
    var u = getUnitAt(idx);
    if (!u) {
      clearSelection();
      return;
    }
    if (u.team !== state.turn) {
      setMessage("That's not your unit.");
      return;
    }
    selectUnit(u.id);
  });

  // selection / preview UI helpers
  function selectUnit(id) {
    state.selectedUnitId = id;
    state.previewIdx = null;
    state.previewAction = null;
    confirmBtn.classList.add('hidden');
    cancelBtn.classList.remove('hidden');
    var u = getUnitById(id);
    setMessage((u.team==='red' ? 'Red' : (state.mode==='ai' && u.team==='black' ? 'Assem' : 'Black')) + ' selected: ' + u.type);
    renderBoard();
  }

  function showPreview() {
    var all = boardEl.querySelectorAll('.cell');
    for (var i=0;i<all.length;i++) all[i].classList.remove('preview');
    var tgt = boardEl.querySelector('.cell[data-idx="' + state.previewIdx + '"]');
    if (tgt) tgt.classList.add('preview');
    confirmBtn.classList.remove('hidden');
    confirmBtn.classList.add('primary');
    cancelBtn.classList.remove('hidden');

    var u = getUnitById(state.selectedUnitId);
    setMessage((u.team==='red' ? 'Red' : (state.mode==='ai' && u.team==='black' ? 'Assem' : 'Black')) + ' previewing ' + state.previewAction);
  }

  function clearSelection() {
    state.selectedUnitId = null;
    state.previewIdx = null;
    state.previewAction = null;
    confirmBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    setMessage('');
    renderBoard();
  }

  confirmBtn.addEventListener('click', function () {
    if (!state.selectedUnitId || state.previewIdx === null) return;
    var u = getUnitById(state.selectedUnitId);
    var target = state.previewIdx;
    var action = state.previewAction;
    if (!u) return;
    performAction(u, target, action);
    state.previewIdx = null;
    state.previewAction = null;
    state.selectedUnitId = null;
    confirmBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
  });

  cancelBtn.addEventListener('click', function () {
    clearSelection();
    confirmBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
  });

  passBtn.addEventListener('click', function () {
    if (state.gameOver || state.aiThinking) return;
    setMessage((state.turn === 'red' ? 'Red' : (state.mode === 'ai' && state.turn === 'black' ? 'Assem' : 'Black')) + ' holds position and passes the turn.');
    endTurn();
  });

  newGameBtn.addEventListener('click', function () {
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
  });

  overlayPVP.addEventListener('click', function () { overlayChoose('pvp'); });
  overlayAI.addEventListener('click', function () { overlayChoose('ai'); });

  function overlayChoose(mode) {
    state.mode = mode;
    overlay.style.display = 'none';
    overlay.classList.add('hidden');
    startNewDeal();
  }

  // perform move or fire
  function performAction(unit, targetIdx, actionType) {
    if (!unit || unit.team !== state.turn) return;
    var msg = '';
    var destUnit = getUnitAt(targetIdx);

    if (actionType === 'move') {
      if (unit.type === 'scout') {
        if (destUnit && destUnit.team !== unit.team) {
          if (destUnit.type === 'scout') {
            // FIX 1: Moving scout wins face-off by eliminating the *destination* scout.
            destUnit.active = false;
            cells[targetIdx].unitId = null;
            msg = (unit.team==='red' ? 'Red' : 'Black') + ' scout eliminated enemy scout!';
          } else if (destUnit.type === 'tank' && !cells[targetIdx].disabled) {
            // FIX 2: Scout moves into cell, so old cell is emptied, new cell is occupied by scout, but the *tank* in the new cell is disabled.
            cells[targetIdx].disabled = true; // Disable the enemy tank at the destination cell
            // No need to set destUnit.active = false or cells[targetIdx].unitId = null for the tank, 
            // as the scout will occupy the cell and the unit list remains unchanged, only 'disabled' is set.
            msg = (unit.team==='red' ? 'Red' : 'Black') + ' scout sabotaged enemy tank!';
          } else {
            msg = (unit.team==='red' ? 'Red' : 'Black') + ' scout moved.';
          }
        } else {
          msg = (unit.team==='red' ? 'Red' : 'Black') + ' scout moved.';
        }
      } else if (unit.type === 'tank') {
        if (destUnit && destUnit.type === 'scout' && destUnit.team !== unit.team) {
          destUnit.active = false;
          cells[targetIdx].unitId = null;
          msg = (unit.team==='red' ? 'Red' : 'Black') + ' tank ran over enemy scout!';
        } else {
          msg = (unit.team==='red' ? 'Red' : 'Black') + ' tank moved.';
        }
      }

      var oldIdx = unit.idx;
      var oldCell = getCell(oldIdx);
      if (oldCell) oldCell.unitId = null;
      unit.idx = targetIdx;
      getCell(targetIdx).unitId = unit.id;
    }

    else if (actionType === 'fire') {
      if (destUnit) {
        if (destUnit.type === 'scout') {
          destUnit.active = false;
          cells[targetIdx].unitId = null;
          msg = (unit.team==='red' ? 'Red' : 'Black') + ' artillery eliminated enemy scout!';
        } else if (destUnit.type === 'tank') {
          if (!cells[targetIdx].disabled) {
            cells[targetIdx].disabled = true;
            msg = (unit.team==='red' ? 'Red' : 'Black') + ' artillery disabled enemy tank!';
          } else {
            msg = (unit.team==='red' ? 'Red' : 'Black') + ' artillery hit previously disabled tank.';
          }
        }
      } else {
        msg = (unit.team==='red' ? 'Red' : 'Black') + ' artillery missed.';
      }
      animateHit(targetIdx);
    }

    log((state.turn === 'red' ? 'Red: ' : 'Black: ') + msg);
    setMessage(msg);
    renderBoard();
    renderStatus();

    if (checkWin()) return;

    endTurn();
  }

  function animateHit(idx) {
    var el = boardEl.querySelector('.cell[data-idx="' + idx + '"]');
    if (!el) return;
    var original = el.innerHTML;
    el.innerHTML = '<div class="token">' + EMOJI.HIT + '</div>';
    setTimeout(function () { renderBoard(); }, 420);
  }

  function endTurn() {
    state.turn = (state.turn === 'red') ? 'black' : 'red';
    renderStatus();

    if (state.gameOver) return;

    if (state.mode === 'ai' && state.turn === 'black') {
      state.aiThinking = true;
      setMessage('Assem is thinking...');
      setTimeout(function () {
        Assem.act({ cells: cells, units: units, state: state, performActionCallback: performAction }, function () {
          state.aiThinking = false;
          renderBoard();
          renderStatus();
          if (!state.gameOver) setMessage('');
        });
      }, 1000);
    } else {
      setMessage((state.turn === 'red' ? 'Red' : 'Black') + "'s turn.");
    }
  }

  function checkWin() {
    var redTanksLeft = units.filter(function(u){ return u.team==='red' && u.type==='tank' && u.active && !cells[u.idx].disabled; }).length;
    var redScoutAlive = units.some(function(u){ return u.team==='red' && u.type==='scout' && u.active; });
    var blackTanksLeft = units.filter(function(u){ return u.team==='black' && u.type==='tank' && u.active && !cells[u.idx].disabled; }).length;
    var blackScoutAlive = units.some(function(u){ return u.team==='black' && u.type==='scout' && u.active; });

    if (redTanksLeft === 0 && !redScoutAlive) {
      state.gameOver = true;
      setMessage('Black wins!');
      log('Black wins!');
      return true;
    }
    if (blackTanksLeft === 0 && !blackScoutAlive) {
      state.gameOver = true;
      setMessage('Red wins!');
      log('Red wins!');
      return true;
    }
    return false;
  }

  // -- setup flow: reshuffle for fairness with logging
  function startNewDeal() {
    state.reshuffleCount = 0;
    var tries = 0;
    var board;
    while (true) {
      tries++;
      board = BoardUtil.createShuffledBoard();
      buildFromDeck(board);
      if (boardIsFair()) break;
      state.reshuffleCount++;
      log('Reshuffle (' + state.reshuffleCount + '×)… Board redealt for fairness.');
      if (tries > 200) break;
    }
    rawBoard = board.slice(0);
    state.turn = 'red';
    state.selectedUnitId = null;
    state.previewIdx = null;
    state.previewAction = null;
    state.gameOver = false;
    state.aiThinking = false;
    renderBoard();
    renderStatus();
    setMessage('Red starts. Select a unit.');
    if (state.reshuffleCount > 0) {
      reshuffleNote.textContent = 'Reshuffled (' + state.reshuffleCount + '×)';
    } else {
      reshuffleNote.textContent = '';
    }
  }

  window.addEventListener('load', function () {
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
    reshuffleNote.textContent = '';
  });

  // expose for debugging
  window.ScoutTanks = {
    startDeal: startNewDeal,
    getState: function(){ return { cells: cells, units: units, state: state }; }
  };

})();
