const PLAYER = 'x';
const AI = 'o';

let gameState = {
  board: Array(9).fill(null),
  currentPlayer: PLAYER,
  gameOver: false,
  difficulty: 2
};

const cells = document.querySelectorAll('.cell');
const statusDisplay = document.getElementById('status');
const difficultySelect = document.getElementById('difficulty');
const newGameBtn = document.getElementById('newGame');
const resultModal = document.getElementById('resultModal');
const resultTitle = document.getElementById('resultTitle');
const resultMessage = document.getElementById('resultMessage');
const resultNewGameBtn = document.getElementById('resultNewGame');

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

function initGame() {
  gameState.board = Array(9).fill(null);
  gameState.currentPlayer = PLAYER;
  gameState.gameOver = false;
  gameState.difficulty = parseInt(difficultySelect.value);

  localStorage.setItem('tictactoe_difficulty', gameState.difficulty);

  renderBoard();
  updateStatus();
  resultModal.classList.add('hidden');
}

function renderBoard() {
  cells.forEach((cell, index) => {
    cell.textContent = gameState.board[index] || '';
    cell.dataset.player = gameState.board[index] || '';
    cell.disabled = gameState.board[index] !== null || gameState.gameOver;
  });
}

function updateStatus() {
  if (gameState.gameOver) return;

  if (gameState.currentPlayer === PLAYER) {
    statusDisplay.textContent = 'Your turn (X)';
  } else {
    statusDisplay.textContent = 'AI thinking... (O)';
  }
}

function checkWinner(board) {
  for (const combo of WINNING_COMBINATIONS) {
    const [a, b, c] = combo;
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a];
    }
  }
  return null;
}

function isBoardFull(board) {
  return board.every(cell => cell !== null);
}

function getAvailableMoves(board) {
  return board
    .map((cell, index) => cell === null ? index : null)
    .filter(index => index !== null);
}

function minimax(board, depth, isMaximizing) {
  const winner = checkWinner(board);

  if (winner === AI) return 10 - depth;
  if (winner === PLAYER) return depth - 10;
  if (isBoardFull(board)) return 0;

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (const move of getAvailableMoves(board)) {
      board[move] = AI;
      const score = minimax(board, depth + 1, false);
      board[move] = null;
      bestScore = Math.max(score, bestScore);
    }
    return bestScore;
  } else {
    let bestScore = Infinity;
    for (const move of getAvailableMoves(board)) {
      board[move] = PLAYER;
      const score = minimax(board, depth + 1, true);
      board[move] = null;
      bestScore = Math.min(score, bestScore);
    }
    return bestScore;
  }
}

function getAIMove() {
  const available = getAvailableMoves(gameState.board);

  if (gameState.difficulty === 1) {
    return available[Math.floor(Math.random() * available.length)];
  }

  if (gameState.difficulty === 2) {
    const board = gameState.board;

    for (const combo of WINNING_COMBINATIONS) {
      const [a, b, c] = combo;
      const values = [board[a], board[b], board[c]];
      const aiCount = values.filter(v => v === AI).length;
      const playerCount = values.filter(v => v === PLAYER).length;

      if (aiCount === 2 && playerCount === 0) {
        const emptyIndex = [a, b, c].find(i => board[i] === null);
        if (emptyIndex !== undefined) return emptyIndex;
      }
    }

    for (const combo of WINNING_COMBINATIONS) {
      const [a, b, c] = combo;
      const values = [board[a], board[b], board[c]];
      const aiCount = values.filter(v => v === AI).length;
      const playerCount = values.filter(v => v === PLAYER).length;

      if (playerCount === 2 && aiCount === 0) {
        const emptyIndex = [a, b, c].find(i => board[i] === null);
        if (emptyIndex !== undefined) return emptyIndex;
      }
    }

    if (board[4] === null) return 4;

    const corners = [0, 2, 6, 8].filter(i => board[i] === null);
    if (corners.length > 0) {
      return corners[Math.floor(Math.random() * corners.length)];
    }

    return available[Math.floor(Math.random() * available.length)];
  }

  if (gameState.difficulty === 3) {
    let bestScore = -Infinity;
    let bestMove = available[0];

    for (const move of available) {
      gameState.board[move] = AI;
      const score = minimax(gameState.board, 0, false);
      gameState.board[move] = null;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }
}

function endGame(winner) {
  gameState.gameOver = true;

  if (winner === PLAYER) {
    resultTitle.textContent = '🎉 You Win!';
    resultMessage.textContent = 'Congratulations! You beat the AI.';
  } else if (winner === AI) {
    resultTitle.textContent = '🤖 AI Wins';
    resultMessage.textContent = 'The AI defeated you. Try again!';
  } else {
    resultTitle.textContent = "It's a Draw";
    resultMessage.textContent = 'Well played! Neither player won.';
  }

  statusDisplay.textContent =
    winner === PLAYER ? 'You won!' :
    winner === AI ? 'AI won!' :
    "It's a draw!";

  resultModal.classList.remove('hidden');
  cells.forEach(cell => cell.disabled = true);
}

function handlePlayerMove(index) {
  if (gameState.board[index] !== null || gameState.gameOver || gameState.currentPlayer !== PLAYER) {
    return;
  }

  gameState.board[index] = PLAYER;
  renderBoard();

  const winner = checkWinner(gameState.board);
  if (winner === PLAYER) {
    endGame(PLAYER);
    return;
  }

  if (isBoardFull(gameState.board)) {
    endGame(null);
    return;
  }

  gameState.currentPlayer = AI;
  updateStatus();

  setTimeout(() => {
    const aiMove = getAIMove();
    gameState.board[aiMove] = AI;
    renderBoard();

    const aiWinner = checkWinner(gameState.board);
    if (aiWinner === AI) {
      endGame(AI);
      return;
    }

    if (isBoardFull(gameState.board)) {
      endGame(null);
      return;
    }

    gameState.currentPlayer = PLAYER;
    updateStatus();
  }, 500);
}

cells.forEach(cell => {
  cell.addEventListener('click', (e) => {
    const index = parseInt(e.target.dataset.index);
    handlePlayerMove(index);
  });
});

newGameBtn.addEventListener('click', initGame);
resultNewGameBtn.addEventListener('click', initGame);

difficultySelect.addEventListener('change', (e) => {
  gameState.difficulty = parseInt(e.target.value);
  localStorage.setItem('tictactoe_difficulty', gameState.difficulty);
});

const savedDifficulty = localStorage.getItem('tictactoe_difficulty');
if (savedDifficulty) {
  difficultySelect.value = savedDifficulty;
  gameState.difficulty = parseInt(savedDifficulty);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
  });
}

initGame();
