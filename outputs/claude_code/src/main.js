// Game state
let gameState = {
  board: Array(9).fill(null),
  currentPlayer: 'X',
  gameOver: false,
  difficulty: null,
  winner: null
};

const WINNING_COMBINATIONS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

// DOM elements
const modeScreen = document.getElementById('modeScreen');
const gameScreen = document.getElementById('gameScreen');
const resultModal = document.getElementById('resultModal');
const difficultyButtons = document.querySelectorAll('.difficulty-btn');
const startBtn = document.getElementById('startBtn');
const boardElement = document.getElementById('board');
const cells = document.querySelectorAll('.cell');
const newGameBtn = document.getElementById('newGameBtn');
const modalNewGameBtn = document.getElementById('modalNewGameBtn');
const turnDisplay = document.getElementById('turnDisplay');
const difficultyDisplay = document.getElementById('difficultyDisplay');
const resultTitle = document.getElementById('resultTitle');
const resultMessage = document.getElementById('resultMessage');

// Initialize
function init() {
  loadDifficulty();
  attachEventListeners();
  registerServiceWorker();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/src/sw.js').catch(() => {});
  }
}

function attachEventListeners() {
  difficultyButtons.forEach(btn => {
    btn.addEventListener('click', () => selectDifficulty(btn));
  });

  startBtn.addEventListener('click', startGame);
  newGameBtn.addEventListener('click', resetGame);
  modalNewGameBtn.addEventListener('click', resetGame);
  cells.forEach(cell => {
    cell.addEventListener('click', (e) => handleCellClick(e.target));
  });
}

function loadDifficulty() {
  const saved = localStorage.getItem('tictactoe-difficulty');
  if (saved) {
    gameState.difficulty = parseInt(saved);
    const btn = document.querySelector(`[data-level="${gameState.difficulty}"]`);
    selectDifficulty(btn);
  }
}

function selectDifficulty(btn) {
  difficultyButtons.forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  gameState.difficulty = parseInt(btn.dataset.level);
  localStorage.setItem('tictactoe-difficulty', gameState.difficulty);
  startBtn.disabled = false;
}

function startGame() {
  resetGameState();
  modeScreen.classList.remove('active');
  gameScreen.classList.add('active');
  updateDifficultyDisplay();
  updateTurnDisplay();
  renderBoard();
}

function resetGame() {
  resultModal.classList.add('hidden');
  startGame();
}

function resetGameState() {
  gameState.board = Array(9).fill(null);
  gameState.currentPlayer = 'X';
  gameState.gameOver = false;
  gameState.winner = null;
}

function handleCellClick(cell) {
  const index = parseInt(cell.dataset.index);
  if (gameState.board[index] || gameState.gameOver) return;

  makeMove(index, 'X');
  if (!gameState.gameOver) {
    setTimeout(makeAIMove, 500);
  }
}

function makeMove(index, player) {
  gameState.board[index] = player;
  
  const winner = checkWinner(gameState.board);
  const isBoardFull = gameState.board.every(cell => cell !== null);

  if (winner) {
    gameState.winner = winner;
    gameState.gameOver = true;
    showResult(winner === 'X' ? 'You won! 🎉' : 'AI won! 🤖');
  } else if (isBoardFull) {
    gameState.gameOver = true;
    showResult("It's a draw! 🤝");
  } else {
    gameState.currentPlayer = gameState.currentPlayer === 'X' ? 'O' : 'X';
    updateTurnDisplay();
  }

  renderBoard();
}

function makeAIMove() {
  if (gameState.gameOver) return;

  let index;
  switch (gameState.difficulty) {
    case 1:
      index = getRandomMove();
      break;
    case 2:
      index = getMediumMove();
      break;
    case 3:
      index = getHardMove();
      break;
  }

  if (index !== -1) {
    makeMove(index, 'O');
  }
}

function getRandomMove() {
  const available = gameState.board.map((cell, i) => cell === null ? i : -1).filter(i => i !== -1);
  return available[Math.floor(Math.random() * available.length)];
}

function getMediumMove() {
  // Try to win
  for (let i = 0; i < 9; i++) {
    if (gameState.board[i] === null) {
      gameState.board[i] = 'O';
      if (checkWinner(gameState.board) === 'O') {
        gameState.board[i] = null;
        return i;
      }
      gameState.board[i] = null;
    }
  }

  // Try to block player win
  for (let i = 0; i < 9; i++) {
    if (gameState.board[i] === null) {
      gameState.board[i] = 'X';
      if (checkWinner(gameState.board) === 'X') {
        gameState.board[i] = null;
        return i;
      }
      gameState.board[i] = null;
    }
  }

  // Take center if available
  if (gameState.board[4] === null) return 4;

  // Take corners
  const corners = [0, 2, 6, 8];
  const availableCorners = corners.filter(i => gameState.board[i] === null);
  if (availableCorners.length > 0) {
    return availableCorners[Math.floor(Math.random() * availableCorners.length)];
  }

  // Take any available
  return getRandomMove();
}

function getHardMove() {
  let bestScore = -Infinity;
  let bestMove = -1;

  for (let i = 0; i < 9; i++) {
    if (gameState.board[i] === null) {
      gameState.board[i] = 'O';
      const score = minimax(gameState.board, 0, false);
      gameState.board[i] = null;

      if (score > bestScore) {
        bestScore = score;
        bestMove = i;
      }
    }
  }

  return bestMove;
}

function minimax(board, depth, isMaximizing) {
  const winner = checkWinner(board);
  
  if (winner === 'O') return 10 - depth;
  if (winner === 'X') return depth - 10;
  if (board.every(cell => cell !== null)) return 0;

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        board[i] = 'O';
        const score = minimax(board, depth + 1, false);
        board[i] = null;
        bestScore = Math.max(score, bestScore);
      }
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for (let i = 0; i < 9; i++) {
      if (board[i] === null) {
        board[i] = 'X';
        const score = minimax(board, depth + 1, true);
        board[i] = null;
        bestScore = Math.min(score, bestScore);
      }
    }
    return bestScore;
  }
}

function checkWinner(board) {
  for (const combo of WINNING_COMBINATIONS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function renderBoard() {
  cells.forEach((cell, index) => {
    cell.textContent = gameState.board[index] || '';
    cell.classList.remove('x', 'o');
    if (gameState.board[index]) {
      cell.classList.add(gameState.board[index].toLowerCase());
    }
    cell.disabled = gameState.gameOver || gameState.board[index] !== null;
  });
}

function updateTurnDisplay() {
  if (!gameState.gameOver) {
    turnDisplay.textContent = gameState.currentPlayer === 'X' ? 'Your turn' : 'AI thinking...';
  }
}

function updateDifficultyDisplay() {
  const levels = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
  difficultyDisplay.textContent = levels[gameState.difficulty];
}

function showResult(message) {
  resultMessage.textContent = message;
  resultTitle.textContent = message.includes('won') || message.includes('draw') ? 'Game Over' : 'Game Over';
  resultModal.classList.remove('hidden');
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
