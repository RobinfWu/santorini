# AI on your browser

All AI are running on client side, need 10\~20s to load it first time.

### Links

**Santorini**
- <https://robinfwu.github.io/santorini/santorini.html>
- <https://cestpasphoto.github.io/santorini_with_gods.html>

## Online Santorini AI

This AI is based on AlphaZero training. I have reused an existing training engine and significantly modified it, I fully implemented everything else from game logic, ML network design, training tuning, port to browser and JS/HTML interface.

### Strength

Compared to best AI I found:
* \>95% winrate against [Ai Ai](http://mrraow.com/index.php/aiai-home/aiai/) - 20 wins in 20 games
  * Even running a degraded version of mine leads to >90% winrate - 10 wins in 10 games
* 98+% win rate against [BoardSpace AI](https://www.boardspace.net/english/index.shtml), using BestBot

Details: these games use no god power, other AI always starting first, both with random initial positions. Mine was running at 800 rollouts per move (50 for degraded version), Ai Ai was set with a timelimit of 15+15sec/move (about 900k iterations on my computer). 

The training has been fully done on CPU, check [my repo](https://github.com/cestpasphoto/alpha-zero-general) and [this ReadMe](https://github.com/cestpasphoto/alpha-zero-general/blob/master/santorini/README.md).

The UI also propose "undervolted" settings: instead of exploring 800 future positions, it explores 200 or 50 or 10 of them to reduce strength. If AI was trained with these lower numbers, it could have been stronger but that wasn't the purpose.

### Speed

About 5 to 10sec per turn when using AI native level. See other details in (#common-technical-details).
You can find higher performance application on this [repo](https://github.com/cestpasphoto/alpha-zero-general), requiring you to install python and many other modules.

## Common technical details

My goal from the start was to run AI on client side. They all use the following technology:
* Python code running in browser running with [pyodide](https://pyodide.org/en/stable/). Still in beta phase, a bit long to load but very stable and compatible with several external modules such as numpy! It is based on WebAssembly so performance is quite good.
* AlphaZero need a ML inference library: [onnx](https://github.com/microsoft/onnxruntime-inference-examples/tree/main/js) has an JS version and has no framework incompatibility (both TF and PyTorch can export in ONNX format). I found the WebGL to be quite buggy on some browsers so I went for the WASM version which uses client CPU.
* I am no expert in JS/HTML/CSS so I chose fomantic-ui: result is quite decent on PC and mobile with low barrier at start. But gosh JavaScript is such an ugly language :-)

I was quite surprised by the final performance of AlphaZero ported in the browser: since game logic and MCTS is in python/pyodide and ML is in JavaScript, browser has to switch these two frameworks and therefore a larger overhead for type conversion. I expected this overhead to be worse but at the end, it is has roughly same speed than regulary python and only 5-10x slower than numba.
