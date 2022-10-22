from MCTS import MCTS
from SantoriniGame import SantoriniGame as Game

g, board, mcts, player = None, None, None, 0

class dotdict(dict):
    def __getattr__(self, name):
        return self[name]

def init_stuff():
	global g, board, mcts, player

	mcts_args = dotdict({
		'numMCTSSims'     : 100,
		'cpuct'           : 1.0,
		'prob_fullMCTS'   : 1.,
		'forced_playouts' : False,
		'no_mem_optim'    : False,
	})

	if g is None:
		g = Game()
	board = g.getInitBoard()
	mcts = MCTS(g, None, mcts_args)
	player = 0
	valids = g.getValidMoves(board, player)
	end = [0,0]

	return player, end, board.tolist(), valids

def getNextState(action):
	global g, board, mcts, player
	board, player = g.getNextState(board, player, action)
	end = g.getGameEnded(board, player)
	valids = g.getValidMoves(board, player)

	return player, end, board.tolist(), valids

def getBoard():
	global g, board, mcts, player
	return board.tolist()

# 0: max (400), 1: medium (100), 2: easy (25), 3: easier (6), 4: come on (1)
def changeDifficulty(level):
	global g, board, mcts, player
	level = min(4, max(0, level))
	mcts.args.numMCTSSims = [400, 100, 25, 6, 4, 1][level]

async def guessBestAction():
	global g, board, mcts, player
	probs, _, _ = await mcts.getActionProb(g.getCanonicalForm(board, player), 1)
	# print('Results', probs)
	best_action = max(range(len(probs)), key=lambda x: probs[x])
	print(f'best_action {best_action} with strength {int(probs[best_action]*100)}%')
	return best_action
