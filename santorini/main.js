/* =================== */
/* =====  CONST  ===== */
/* =================== */

// Here are common constants between nogod and god modes.
// Check also constants_*.js

const directions_char = ['↖', '↑', '↗', '←', 'Ø', '→', '↙', '↓', '↘'];
const levels_array = ['‌', '▂', '▅', '█', 'X'];
const worker_string = '웃';
const no_worker_string = '‌';

/* =================== */
/* =====  ONNX   ===== */
/* =================== */

var onnxSession;

// Function called by python code
async function predict(canonicalBoard, valids) {
  const cb_js = Float32Array.from(canonicalBoard.toJs({create_proxies: false}));
  const vs_js = Uint8Array.from(valids.toJs({create_proxies: false}));
  const tensor_board = new ort.Tensor('float32', cb_js, [1, 25, 3]);
  const tensor_valid = new ort.Tensor('bool'   , vs_js, [1, onnxOutputSize]);
  // console.log('canonicalboard:', tensor_board);
  // console.log('valid:', tensor_valid);
  const results = await globalThis.onnxSession.run({ board: tensor_board, valid_actions: tensor_valid });
  // console.log('results:', results);
  return {pi: Array.from(results.pi.data), v: Array.from(results.v.data)}
}

/* =================== */
/* =====  UTILS  ===== */
/* =================== */

function encodeDirection(oldX, oldY, newX, newY) {
  let diffX = newX - oldX;
  let diffY = newY - oldY;
  if (Math.abs(diffX) > 1 || Math.abs(diffY) > 1) {
    return -1;
  }
  return ((diffY+1)*3 + (diffX+1));
}

function moveToString(move, subject='One') {
  let [worker, power, move_direction, build_direction] = Santorini.decodeMove(move);
  var description = subject + ' moved worker ' + worker + ' ' + directions_char[move_direction]
  description += ' then build ' + directions_char[build_direction];
  description += (power > 0) ? (' using power of god' + power) : '';
  description += ' (move ' + move + ')';
  return description;
}

/* =================== */
/* =====  LOGIC  ===== */
/* =================== */

class Santorini {
  constructor() {
    this.py = null;
    this.board = Array.from(Array(5), _ => Array.from(Array(5), _ => Array(3).fill(0)));
    this.nextPlayer = 0;
    this.validMoves = Array(2*NB_GODS*9*9); this.validMoves.fill(false);
    this.gameEnded = [0, 0];
    this.history = [];          // List all previous states from new to old, not including current one
    this.lastMove = -1;
    this.powers = [0, 0];       // Which power each player has
    this.powers_data = [0, 0];  // Which data stored in power position
    this.gameMode = 'P0';
  }

  init_game() {
    this.history = [];
    this.lastMove = -1;
    if (pyodide == null) {
      // Random board
      this.board = Array.from(Array(5), _ => Array.from(Array(5), _ => Array(3).fill(0)));
      this.validMoves.fill(true);
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          let worker = Math.random() * 15 - 7;
          let level = Math.random() * 9;
          this.board[y][x][0] = Math.floor((worker>0) ? worker-Math.min(5,worker) : worker-Math.max(-5,worker));
          this.board[y][x][1] = Math.floor(level - Math.min(6, level));
          /*console.log(this.board[y][x][0], this.board[y][x][1]);*/
        }
      }
      // Random powers
      let power = Math.floor(Math.random()*NB_GODS);
      console.log('Random power 1 = ', power);
      this.board[Math.floor(power/5)][power%5][2] = 64;
      power = Math.floor(Math.random()*NB_GODS) + NB_GODS;
      console.log('Random power 2 = ', power-NB_GODS);
      this.board[Math.floor(power/5)][power%5][2] = 64;      
    } else {
      if (this.py == null) {
        console.log('Now importing python module');
        this.py = pyodide.pyimport("proxy");
      }
      console.log('Run a game');
      let data_tuple = this.py.init_stuff(25).toJs({create_proxies: false});
      [this.nextPlayer, this.gameEnded, this.board, this.validMoves] = data_tuple;
    }

    // Find powers of each player
    for (let p = 0; p < 2; p++) {
      for (let i = p*NB_GODS; i < (p+1)*NB_GODS; i++) {
        let y = Math.floor(i/5), x = i%5;
        if (this.board[y][x][2] > 0) {
          this.powers[p] = i - p*NB_GODS;
          console.log('Player', p, 'has power', this.powers[p]);
        }
      }
    }
    this._readPowersData();
  }

  manual_move(action) {
    console.log('manual move:', action);
    if (this.validMoves[action]) {
      this._applyMove(action);
    } else {
      console.log('Not a valid action', this.validMoves);
    }    
  }


  async ai_guess_and_play() {
    if (game.gameEnded.some(x => !!x)) {
      console.log('Not guessing, game is finished');
      return;
    }
    // console.log('guessing');
    var best_action = await this.py.guessBestAction();
    this._applyMove(best_action);
  }

  _applyMove(action) {
    this.history.unshift([this.nextPlayer, this.board]);
    let data_tuple = this.py.getNextState(action).toJs({create_proxies: false});
    [this.nextPlayer, this.gameEnded, this.board, this.validMoves] = data_tuple;
    this._readPowersData();
    this.lastMove = action;
  }

  changeDifficulty(numMCTSSims) {
    this.py.changeDifficulty(Number(numMCTSSims));
  }

  _readPowersData() {
    for (let p = 0; p < 2; p++) {
      let index = this.powers[p] + p * NB_GODS;
      let y = Math.floor(index/5), x = index%5;
      this.powers_data[p] = this.board[y][x][2];
      console.log('Power data for player', p, 'is', this.powers_data[p]);
    }
  }

  previous() {
    if (this.history.length == 0) {
      return;
    }

    let player = (this.gameMode == 'P0') ? 0 : 1;
    // find earliest move where 'player' is next player (last move if null)
    let index = 0;
    if (player != null) {
      index = this.history.findIndex(x => x[0]==player);
      if (index < 0) {
        return;
      }
      // continue to find first item of sequence
      for (; (index < this.history.length) && (this.history[index][0] == player); index++) {
      }
      index--;
    }
    console.log('index=', index, '/', this.history.length);

    // Actually revert
    console.log('board to revert:', this.history[index][1]);
    let data_tuple = this.py.setData(this.history[index][0], this.history[index][1]).toJs({create_proxies: false});
    [this.nextPlayer, this.gameEnded, this.board, this.validMoves] = data_tuple;
    this._readPowersData();
    this.history.splice(0, index+1); // remove reverted move from history and further moves
    this.lastMove = -1;
  }

  editCell(clicked_y, clicked_x, editMode) {
    if (editMode == 1) {
      this.board[clicked_y][clicked_x][1] = (this.board[clicked_y][clicked_x][1]+1) % 5;
    } else if (editMode == 2) {
      if (this.board[clicked_y][clicked_x][0] > 0) {
         this.board[clicked_y][clicked_x][0] = -1;
      } else if (this.board[clicked_y][clicked_x][0] < 0) {
        this.board[clicked_y][clicked_x][0] = 0;
      } else {
        this.board[clicked_y][clicked_x][0] = 1;
      }
    } else if (editMode == 0) {
      // Reassign worker id
      let countP0 = 0, countP1 = 0;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          if (this.board[y][x][0] > 0) {
            countP0++;
            this.board[y][x][0] = countP0;
          } else if (this.board[y][x][0] < 0) {
            countP1++;
            this.board[y][x][0] = -countP1;
          }
        }
      }
      if (countP0 != 2 || countP1 != 2) {
        console.log('Invalid board', countP0, countP1);
      }
      // Update all other data
      let data_tuple = this.py.setData(this.nextPlayer, this.board).toJs({create_proxies: false});
      [this.nextPlayer, this.gameEnded, this.board, this.validMoves] = data_tuple;
      this._readPowersData();
    } else {
      console.log('Dont know what to do in editMode', editMode);
    }
  }

  editGod(player) {
    this.powers[player] = (this.powers[player] + 1) % NB_GODS;
    this.powers_data[player] = 64;
    let power = this.powers[player] + player * NB_GODS;
    this.board[Math.floor(power/5)][power%5][2] = 64;
  }

  static decodeMove(move) {
    let worker = Math.floor(move / (NB_GODS*9*9));
    let action_ = move % (NB_GODS*9*9);
    let power = Math.floor(action_ / (9*9));
    action_ = action_ % (9*9);
    let move_direction = Math.floor(action_ / 9);
    let build_direction = action_ % 9;
    return [worker, power, move_direction, build_direction];
  }
}

class MoveSelector {
  constructor() {
    this.resetAndStart();
    this.stage = 0; // how many taps done, finished when 3, -1 means new game
  }

  resetAndStart() {
    this.reset();
    this._select_relevant_cells();
  }

  reset() {
    this.cells = Array.from(Array(5), _ => Array(5).fill(false)); // 2D array containg true if cell should be selectable  
    this.stage = 0;
    this.workerID = 0, this.workerX = 0, this.workerY = 0;
    this.moveDirection = 0, this.workerNewX = 0, this.workerNewY = 0;
    this.buildDirection = 0, this.buildX = 0, this.buildY = 0;
    this.currentMoveWoPower = 0; // Accumulate data about move being selected
    this.power = -1; // -1 = undefined, 0 = no power used, x = power delta to add on 'currentMoveWoPower'
    this.editMode = 0; // 0 = no edit mode, 1 = editing levels, 2 = editing workers
  }

  // return move when finished, else null
  click(clicked_y, clicked_x) {
    this.stage++; 
    if (this.stage == 1) {
      // Selecting worker
      this.workerX = clicked_x;
      this.workerY = clicked_y;
      this.workerID = Math.abs(game.board[this.workerY][this.workerX][0]) - 1;
      this.currentMoveWoPower = NB_GODS*9*9 * this.workerID;
    } else if (this.stage == 2) {
      // Selecting worker new position
      this.workerNewX = clicked_x;
      this.workerNewY = clicked_y;
      this.moveDirection = encodeDirection(this.workerX, this.workerY, this.workerNewX, this.workerNewY);
      this.currentMoveWoPower += 9*this.moveDirection;
    } else if (this.stage == 3) {
      // Selecting building position
      this.buildX = clicked_x;
      this.buildY = clicked_y;
      this.buildDirection = encodeDirection(this.workerNewX, this.workerNewY, this.buildX, this.buildY);
      this.currentMoveWoPower += this.buildDirection;
    } else if (this.stage == 4) {
      console.log('We are on stage 4');
      this.reset();
    } else {
      console.log('We are on stage', this.stage);
      // Starting new game
      this.reset();
    }

    this._select_relevant_cells();
  }

  togglePower(usePower) {
    this.power = (usePower ? game.powers[game.nextPlayer]*9*9 : 0);
  }

  isSelectable(y, x) {
    return this.cells[y][x];
  }

  getPartialDescription() {
    var description = '';
    if (this.stage >= 1) {
      description += 'You move from ('+this.workerY+','+this.workerX+')';
    }
    if (this.stage >= 2) {
      description += ' in direction ' + directions_char[this.moveDirection];
    }
    if (this.stage >= 3) {
      description += ' and build ' + directions_char[this.buildDirection] + ' (move ' + this.currentMoveWoPower + ')';
    }
    return description;
  }

  // return move, or -1 if move is undefined
  getMove() {
    if (this.stage >= 3) {
      if (this.power >= 0) {
        return this.currentMoveWoPower + this.power;
      }
      if (game.powers[game.nextPlayer] == 0) {
        this.power = 0;
        return this.currentMoveWoPower;
      }
      // If power undefined, check how many options possible
      let doableWithOutPower = game.validMoves[this.currentMoveWoPower                                   ];
      let doableWithPower    = game.validMoves[this.currentMoveWoPower + game.powers[game.nextPlayer]*9*9];
      if        ( doableWithOutPower &&  doableWithPower) {
        console.log('2 moves possible, need user to decide whether s.he wants power or not');
      } else if (!doableWithOutPower && !doableWithPower) {
        console.log('No move possible, that should not happen');
      } else if (!doableWithOutPower &&  doableWithPower) {
        this.power = game.powers[game.nextPlayer]*9*9;
        return this.currentMoveWoPower + game.powers[game.nextPlayer]*9*9;
      } else if ( doableWithOutPower && !doableWithPower) {
        this.power = 0;
        return this.currentMoveWoPower;
      }
    }
    return -1;
  }

  edit() {
    this._select_none();
    this.editMode = (this.editMode+1) % 3;
    if (this.editMode == 0) {
      game.editCell(-1, -1, 0);
      this._select_relevant_cells();
    }
  }

  _select_relevant_cells() {
    if (this.stage >= 3) {
      this._select_none();
    } else if (this.stage < 1) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          if ((game.nextPlayer == 0 && game.board[y][x][0] > 0) ||
              (game.nextPlayer == 1 && game.board[y][x][0] < 0)) {
            this.cells[y][x] = this._anySubmovePossible(y, x);
          } else {
            this.cells[y][x] = false;
          }
        }
      }
    } else {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          this.cells[y][x] = this._anySubmovePossible(y, x);
        }
      }
    }
  }

  _select_none() {
    this.cells = Array.from(Array(5), _ => Array(5).fill(false));
  }

  // Whole function ignore value of this.power on purpose, consider both options
  _anySubmovePossible(coordY, coordX) {
    let any_move_possible = true;
    let power = game.powers[game.nextPlayer]*9*9;
    if (this.stage == 0) {
      let worker_id = Math.abs(game.board[coordY][coordX][0]) - 1;
      let moves_begin = (worker_id*NB_GODS    )*9*9;
      let moves_end   = (worker_id*NB_GODS + 1)*9*9;
      any_move_possible = game.validMoves.slice(moves_begin, moves_end).some(x => x);
      if (!any_move_possible && power>0) {
        // Check if any move with power
        moves_begin += power;
        moves_end   += power;
        any_move_possible = game.validMoves.slice(moves_begin, moves_end).some(x => x);
      }
    } else if (this.stage == 1) {
      // coord = worker move direction
      let move_direction = encodeDirection(this.workerX, this.workerY, coordX, coordY);
      if (move_direction < 0) {
        return false; // Not valid move
      }
      let moves_begin = this.currentMoveWoPower +  move_direction   *9;
      let moves_end   = this.currentMoveWoPower + (move_direction+1)*9;
      any_move_possible = game.validMoves.slice(moves_begin, moves_end).some(x => x);
      if (!any_move_possible && power>0) {
        // Check if any move with power
        moves_begin += power;
        moves_end   += power;
        any_move_possible = game.validMoves.slice(moves_begin, moves_end).some(x => x);
      }
    } else if (this.stage == 2) {
      // coord = build direction
      let build_direction = encodeDirection(this.workerNewX, this.workerNewY, coordX, coordY);
      if (build_direction < 0) {
        return false; // Not valid move
      }
      any_move_possible = game.validMoves[this.currentMoveWoPower + build_direction];
      if (!any_move_possible && power>0) {
        // Check if any move with power
        any_move_possible = game.validMoves[this.currentMoveWoPower + build_direction + power];
      }
    } else {
      console.log('Weird, I dont support this.stage=', this.stage, coordX, coordY);
    }

    return any_move_possible;
  }
}

/* =================== */
/* ===== DISPLAY ===== */
/* =================== */

function refreshBoard() {
  let editMode = move_sel.editMode;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      let cell = document.getElementById('cell_' + y + '_' + x);
      let level  = game.board[y][x][1];
      let worker = game.board[y][x][0];
      let selectable = move_sel.isSelectable(y, x);

      // set cell content and color
      if (worker > 0) {
        cell_content = '<span class="ui green text">' + worker_string + '<br>' + levels_array[level] + '</span>';
      } else if (worker < 0) {
        cell_content = '<span class="ui red text">'   + worker_string + '<br>' + levels_array[level] + '</span>';
      } else {
        cell_content = '<span class="ui text">'    + no_worker_string + '<br>' + levels_array[level] + '</span>';
      }

      // set cell background and ability to be clicked
      if (editMode > 0) {
        cell.classList.add('selectable');
        cell.classList.remove('toselect');
        cell.innerHTML = '<a onclick="cellClick('+y+','+x+');event.preventDefault();">' + cell_content + '</a>';
      } else if (selectable) {
        cell.classList.add('selectable', 'toselect');
        cell.innerHTML = '<a onclick="cellClick('+y+','+x+');event.preventDefault();">' + cell_content + '</a>';
      } else {
        cell.classList.remove('selectable', 'toselect');
        cell.innerHTML = cell_content;
      }
    }
  }
}

function refreshButtons(loading=false) {
  if (loading) {
    // Loading
    allBtn.style = "display: none";
    loadingBtn.style = "";
    allBtn.classList.remove('green', 'red');
  } else if (move_sel.editMode > 0) {
    editMsg.classList.remove('hidden');
    allBtn.style = "display: none";
    allBtn.classList.remove('green', 'red');

    editBtn.classList.remove('secondary', 'primary', 'red');
    if (move_sel.editMode == 1) {
      editBtn.classList.add('secondary');
    } else if (move_sel.editMode == 2) {
      editBtn.classList.add('primary', 'red');
    }
  } else {
    allBtn.style = "";
    loadingBtn.style = "display: none";
    if (game.gameEnded.some(x => !!x)) {
      // Game is finished, looking for the winner
      console.log('End of game');
      allBtn.classList.add((game.gameEnded[0]>0) ? 'green' : 'red');
    } else {
      // Ongoing game
      allBtn.classList.remove('green', 'red');
      if (game.history.length < 1 && move_sel.stage <= 0) {
        undoBtn.classList.add('disabled');
      } else {
        undoBtn.classList.remove('disabled');
      }
    }

    if (NB_GODS == 1) {
      usePowerBtn.classList.remove('basic', 'teal'); usePowerBtn.classList.add('disabled');
      noPowerBtn.classList.remove('basic', 'blue'); noPowerBtn.classList.add('disabled');
    } else {
      usePowerBtn.classList.remove('basic', 'disabled');
      noPowerBtn.classList.remove('basic', 'disabled');
      if (move_sel.stage <= 2) {
        usePowerBtn.classList.add('disabled', 'basic');
        noPowerBtn.classList.add('disabled', 'basic');
      } else if (move_sel.power < 0) {
        usePowerBtn.classList.add('basic');
        noPowerBtn.classList.add('basic');
      } else if (move_sel.power == 0) {
        usePowerBtn.classList.add('basic');
      } else {
        noPowerBtn.classList.add('basic');
      }
    }

    editMsg.classList.add('hidden');
    editBtn.classList.remove('secondary', 'primary', 'red');
  }
}

function refreshPlayersText() {
  let power = game.powers[0];
  p0title.innerHTML = gods_name[power];
  p0details.innerHTML = gods_descr[power];

  power = game.powers[1];
  p1title.innerHTML = gods_name[power];
  p1details.innerHTML = gods_descr[power];

  if (move_sel.editMode > 0) {
    p0title.setAttribute('onclick', 'godClick(0)');
    p0details.setAttribute('onclick', 'godClick(0)');
    p1title.setAttribute('onclick', 'godClick(1)');
    p1details.setAttribute('onclick', 'godClick(1)');
  } else {
    p0title.removeAttribute('onclick');
    p0details.removeAttribute('onclick');
    p1title.removeAttribute('onclick');
    p1details.removeAttribute('onclick');
  }
}

function refreshMoveText(text) {
  moveSgmt.innerHTML = text;
}


/* =================== */
/* ===== ACTIONS ===== */
/* =================== */

async function ai_play_one_move() {
  refreshButtons(loading=true);
  let aiPlayer = game.nextPlayer;
  while ((game.nextPlayer == aiPlayer) && game.gameEnded.every(x => !x)) {
    await game.ai_guess_and_play();
    refreshBoard();
  }
  refreshButtons(loading=false);
}

async function ai_play_if_needed() {
  if (game.gameMode == 'AI') {
    while (game.gameEnded.every(x => !x)) {
      await ai_play_one_move();
    }
  } else
  {
    if ((game.nextPlayer == 0 && game.gameMode == 'P1') ||
        (game.nextPlayer == 1 && game.gameMode == 'P0')) {
      await ai_play_one_move();
    }
    move_sel.resetAndStart();

    refreshBoard();
    refreshButtons();
    refreshMoveText(moveToString(game.lastMove, 'AI'));
  }
}

async function changeGameMode(mode) {
  game.gameMode = mode;
  await ai_play_if_needed();
}

function cellClick(clicked_y = null, clicked_x = null) {
  if (move_sel.editMode > 0) {
    game.editCell(clicked_y, clicked_x, move_sel.editMode);
    refreshBoard();
  } else {
    move_sel.click(clicked_y == null ? -1 : clicked_y, clicked_x == null ? -1 : clicked_x);
    let move = move_sel.getMove();

    refreshBoard();
    refreshButtons();
    refreshMoveText(move_sel.getPartialDescription());

    if (move >= 0) {
      game.manual_move(move);
      move_sel.reset();
      refreshBoard();
      refreshButtons();

      ai_play_if_needed();
    }
  }
}

function godClick(player) {
  game.editGod(player);
  refreshPlayersText();
}

function reset() {
  game.init_game();
  move_sel.resetAndStart();

  refreshBoard();
  refreshPlayersText();
  refreshButtons();
  refreshMoveText('');
}

function cancel_and_undo() {
  if (move_sel.stage == 0) {
    game.previous();
  }
  move_sel.resetAndStart();

  refreshBoard();
  refreshButtons();
  refreshMoveText('');
}

function togglePower(state) {
  move_sel.togglePower(state);
  refreshButtons();
  refreshBoard();

  let move = move_sel.getMove();
  if (move >= 0) {
    game.manual_move(move);
    move_sel.reset();
    refreshBoard();
    refreshButtons();

    ai_play_if_needed();
  }
}

function edit() {
  move_sel.edit();
  refreshBoard();
  refreshButtons();
  refreshPlayersText();
}

/* =================== */
/* ===== PYODIDE ===== */
/* =================== */

// init Pyodide and stuff
async function init_code() {
  pyodide = await loadPyodide({ fullStdLib : false });
  await pyodide.loadPackage("numpy");

  globalThis.onnxSession = await ort.InferenceSession.create(modelFileName);

  await pyodide.runPythonAsync(`
    from pyodide.http import pyfetch
    for filename in ['Game.py', 'proxy.py', 'MCTS.py', 'SantoriniDisplay.py', 'SantoriniGame.py', 'SantoriniLogicNumba.py']:
      response = await pyfetch('santorini/'+filename)
      with open(filename, "wb") as f:
        f.write(await response.bytes())

    response = await pyfetch('`+pyConstantsFileName+`')
    with open('SantoriniConstants.py', "wb") as f:
      f.write(await response.bytes())
  `)
  console.log('Loaded python code, pyodide ready');
}

async function main(usePyodide=true) {
  refreshButtons(loading=true);

  if (usePyodide) {
    await init_code();
  }
  game.init_game();
  move_sel.resetAndStart();

  refreshBoard();
  refreshPlayersText();
  refreshButtons();
  refreshMoveText('');
}

var game = new Santorini();
var move_sel = new MoveSelector();
var pyodide = null;
