const board = document.getElementById('board');
const cells = document.querySelectorAll('.cell');
const statusDisplay = document.getElementById('status');
const difficultySelect = document.getElementById('difficulty');
const newGameBtn = document.getElementById('newGameBtn');
const resultModal = document.getElementById('resultModal');
const resultTitle = document.getElementById('resultTitle');
const resultMessage = document.getElementById('resultMessage');
const modalNewGameBtn = document.getElementById('modalNewGameBtn');

let gameState = ['', '', '', '', '', '', '', '', ''];
let currentPlayer = 'X';
let gameOver = false;
let difficulty = localStorage.getItem('difficulty') || '2';

const WINNING_COMBOS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

function initGame() {
  gameState = ['', '', '', '', '', '', '', '', ''];
  currentPlayer = 'X';
  gameOver = false;
  difficulty = difficultySelect.value;
  localStorage.setItem('difficulty', difficulty);
  renderBoard();
  updateStatus();
  resultModal.classList.remove('show');
}

function renderBoard() {
  cells.forEach((cell, index) => {
    cell.textContent = gameState[index];
    cell.className = 'cell';
    if (gameState[index] === 'X') cell.classList.add('x');
    if (gameState[index] === 'O') cell.classList.add('o');
  });
}

function updateStatus() {
  if (gameOver) return;
  statusDisplay.textContent = currentPlayer === 'X' ? 'Your turn' : 'AI thinking...';
}

function checkWinner(state) {
  for (let combo of WINNING_COMBOS) {
    const [a, b, c] = combo;
    if (state[a] && state[a] === state[b] && state[b] === state[c]) {
      return state[a];
    }
  }
  return null;
}

function isBoardFull(state) {
  return state.every(cell => cell !== '');
}

function getAvailableMoves(state) {
  return state
    .map((cell, index) => (cell === '' ? index : null))
    .filter(val => val !== null);
}

function minimax(state, depth, isMaximizing) {
  const winner = checkWinner(state);

  if (winner === 'O') return 10 - depth;
  if (winner === 'X') return depth - 10;
  if (isBoardFull(state)) return 0;

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (let i of getAvailableMoves(state)) {
      state[i] = 'O';
      const score = minimax(state, depth + 1, false);
      state[i] = '';
      bestScore = Math.max(score, bestScore);
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for (let i of getAvailableMoves(state)) {
      state[i] = 'X';
      const score = minimax(state, depth + 1, true);
      state[i] = '';
      bestScore = Math.min(score, bestScore);
    }
    return bestScore;
  }
}

function getAIMove(state, level) {
  const available = getAvailableMoves(state);

  if (level === '1') {
    return available[Math.floor(Math.random() * available.length)];
  }

  if (level === '2') {
    for (let combo of WINNING_COMBOS) {
      const [a, b, c] = combo;
      const [countO, countX] = [
        [a, b, c].filter(i => state[i] === 'O').length,
        [a, b, c].filter(i => state[i] === 'X').length
      ];

      if (countO === 2 && state[[a, b, c].find(i => state[i] === '')] === '') {
        return [a, b, c].find(i => state[i] === '');
      }

      if (countX === 2 && state[[a, b, c].find(i => state[i] === '')] === '') {
        return [a, b, c].find(i => state[i] === '');
      }
    }

    if (state[4] === '') return 4;

    const corners = [0, 2, 6, 8].filter(i => state[i] === '');
    if (corners.length > 0) {
      return corners[Math.floor(Math.random() * corners.length)];
    }

    return available[Math.floor(Math.random() * available.length)];
  }

  if (level === '3') {
    let bestScore = -Infinity;
    let bestMove = available[0];

    for (let move of available) {
      state[move] = 'O';
      const score = minimax(state, 0, false);
      state[move] = '';

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }
}

function makeAIMove() {
  if (gameOver || currentPlayer !== 'O') return;

  statusDisplay.textContent = 'AI thinking...';

  setTimeout(() => {
    const move = getAIMove(gameState, difficulty);
    gameState[move] = 'O';
    currentPlayer = 'X';

    const winner = checkWinner(gameState);
    if (winner) {
      endGame(winner === 'X' ? 'You Win!' : 'AI Wins!');
    } else if (isBoardFull(gameState)) {
      endGame("It's a Draw!");
    } else {
      renderBoard();
      updateStatus();
    }
  }, 500);
}

function endGame(message) {
  gameOver = true;
  resultTitle.textContent = message.split('!')[0];
  resultMessage.textContent = message === 'You Win!'
    ? 'Congratulations! You defeated the AI.'
    : message === 'AI Wins!'
    ? 'The AI won this round. Try again!'
    : 'Both players played perfectly!';
  resultModal.classList.add('show');
  renderBoard();
}

function handleCellClick(e) {
  if (!e.target.classList.contains('cell') || gameOver || currentPlayer !== 'X') return;

  const index = parseInt(e.target.getAttribute('data-index'));

  if (gameState[index] !== '') return;

  gameState[index] = 'X';
  currentPlayer = 'O';

  const winner = checkWinner(gameState);
  if (winner) {
    endGame(winner === 'X' ? 'You Win!' : 'AI Wins!');
  } else if (isBoardFull(gameState)) {
    endGame("It's a Draw!");
  } else {
    renderBoard();
    makeAIMove();
  }
}

difficultySelect.value = difficulty;
difficultySelect.addEventListener('change', () => {
  difficulty = difficultySelect.value;
  localStorage.setItem('difficulty', difficulty);
});

board.addEventListener('click', handleCellClick);
newGameBtn.addEventListener('click', initGame);
modalNewGameBtn.addEventListener('click', initGame);

initGame();
