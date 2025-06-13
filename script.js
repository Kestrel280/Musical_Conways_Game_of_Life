//----------------------------Parameters----------------------------//

var boardSize = [40, 25]; //[cols, rows]. recommended size is [40, 25]; fits every pattern without being TOO high pitch

var cellSize = 18;
var cellPad = 2;

var scale = [0, 3, 5, 7, 10];
//[0, 2, 3, 7, 8] = hirajoshi
//[0, 2, 4, 7, 9] = major pentatonic;
//[0, 3, 5, 7, 10] = minor pentatonic;
//[0, 2, 4, 5, 7, 9, 11] = major;
var A4 = 440; //frequency of A4
var rootNote = 37; //lowest note
var attack = 0.01; //i've left ADSR as hidden parameters, instead of sliders, because they're risky to play with. given the speed the game typically runs at, it's very possible for the envelope to bleed into the next step, causing very undesirable behavior (clicks and pops at best, major glitches at worst).
var decay = 0.03;
var sustain = 0.3; //percentage of nodeVol. this is the best ADSR value to play with, IMO: can't really causes glitches, but changes the sound greatly.
var release = 0.02;
var nodeVol = 0.01;
var oscType = "square"; //sawtooth, triangle, sine, square
var lfoType = "sine";
var maxDetune = 8; //in cents. can make some REALLY funky stuff with this
var maxLfoFreq = 0.8;
var scaleSize = scale.length; //this isn't a parameter but i want this here so don't touch it

var aliveColor = "#00FF00";
var deadColor = "#FF0000";
var bgColor = "#FFDDAA";

var birthCond = [3]; //currently unused
var surviveCond = [2, 3]; //currently unused

//------------------------------------------------------------------//

window.onload = resetBoard;

var board = []; //array of arrays: index with board[column, row]
var nboard = []; //2d array of neighbor counts
var aboard = []; //2d array of audio source nodes
var lboard = []; //2d array of LFOs, for the detune value of the oscillators
var lgboard = []; //2d array of gains for the LFOs
var fboard = []; //2d array of biquadfilter nodes
var pboard = []; //1d array of stereopanner nodes
var gboard = []; //2d array of gain nodes

var stepCount = 0; //what stage are we at?
var aliveCells = 0; //how many cells are alive?
var deadCells = 0;

var tempoSlider = document.getElementById("tempoSlider"); //tempo slider
var tempo = 1000 / Math.pow(tempoSlider.value/10, 1.3)
tempoSlider.oninput = function() {
	tempo = 1000 / Math.pow(tempoSlider.value/10, 1.3);
	if(release * 1000 > tempo) {release = tempo/1000 - 0.005}; //stops nodes from taking too long to disconnect 
}

var volSlider = document.getElementById("volSlider"); //volume slider
var masterVol = volSlider.value / 100;
volSlider.oninput = function() {
	masterVol = volSlider.value / 100;
	masterGainNode.gain.value = masterVol;
}

var densSlider = document.getElementById("densSlider"); //random board density slider
var density = densSlider.value / 100;
densSlider.oninput = function() {
	density = densSlider.value / 100;
}

var canvas = document.getElementById("htmlCanv"); //create the canvas, its context, fill in the background, and add an event handler for clicking it
var ctx = canvas.getContext("2d");
canvas.width = boardSize[0] * cellSize; //set the canvas size
canvas.height = boardSize[1] * cellSize;
ctx.fillStyle = bgColor;
ctx.fillRect(0, 0, canvas.width, canvas.height);
canvas.addEventListener('click', boardClick);

const AudioContext = window.AudioContext || window.webkitAudioContext; //set up our audio environment
const actx = new AudioContext();
var masterGainNode = actx.createGain();
masterGainNode.gain.value = masterVol;
masterGainNode.connect(actx.destination);


function sleep(ms) { //a sleep helper function
  return new Promise(resolve => setTimeout(resolve, ms));
}

function midiCPS(midiNote) { //helper function to convert a midi note value to a frequency in hz
	return A4 * Math.pow(2, (midiNote-69)/12);
}

function dispBoard() { //debugging function to output a visual representation of the current state of the board to console
	console.clear();
	var visBoard = "";
	for(var row = 0; row < boardSize[1]; row++) { //take the (row)th element of each column, 
		for(var col = 0; col < boardSize[0]; col++) {
			visBoard += board[col][row]; //concatenate it to the string
			visBoard += " ";
		}
		visBoard += "\n"; //at the end of the row, put a newline to move onto the next row
	}
	console.log(visBoard);	
}

function initBoard() { //initialize all the internal 2d arrays we need
	var midiNote;
	var flippedRow; //basically just (rows - current_row); easier to have pitches make sense this way
	board = [];
	nboard = [];
	aboard = [];
	lboard = [];
	lgboard = [];
	fboard = [];
	pboard = [];
	gboard = [];
	for(var col = 0; col < boardSize[0]; col++) {
		
		board.push([]);
		nboard.push([]);
		aboard.push([]);
		lboard.push([]);
		lgboard.push([]);
		fboard.push([]);
		pboard.push([]);
		gboard.push([]);
		for(var row = 0; row < boardSize[1]; row++) {
			board[col][row] = 0;
			nboard[col][row] = 0;
			
			flippedRow = boardSize[1] - 1 - row;
			midiNote = scale[flippedRow%scaleSize]; //index into the scale array
			midiNote = midiNote + (12 * (Math.floor(flippedRow/scaleSize))) + rootNote; //handle the overflow (octaves)
			
			aboard[col][row] = actx.createOscillator(); //individual oscillator nodes
			aboard[col][row].type = oscType;
			aboard[col][row].frequency.value = midiCPS(midiNote);
			//aboard[col][row].detune.value = Math.random() * maxDetune;
			
			lboard[col][row] = actx.createOscillator();
			lboard[col][row].type = lfoType;
			lboard[col][row].frequency.value = Math.random() * maxLfoFreq;
			
			lgboard[col][row] = actx.createGain();
			lgboard[col][row].gain.value = Math.random() * maxDetune;
			
			fboard[col][row] = actx.createBiquadFilter(); //individual filter nodes
			fboard[col][row].type = "lowpass";
			fboard[col][row].Q.value = 1; //default to Q=1; this will very with #neighbors later
			fboard[col][row].frequency.value = Math.abs(boardSize[0]/2 - col) * 75 + 1600; //cells closer to edges have higher cutoff frequencies
			
			pboard[col][row] = actx.createStereoPanner();  //individual panning nodes
			pboard[col][row].pan.value = -(boardSize[0]/2 - col)/boardSize[0]; //stereo panning left/right corresponding to node's X position
			
			gboard[col][row] = actx.createGain(); //individual gain nodes
			gboard[col][row].gain.value = 0;
			
			lboard[col][row].connect(lgboard[col][row]);
			lgboard[col][row].connect(aboard[col][row].detune);
			aboard[col][row].connect(fboard[col][row]);
			fboard[col][row].connect(pboard[col][row]);
			pboard[col][row].connect(gboard[col][row]);
			
			aboard[col][row].start();
			lboard[col][row].start();
		}
	}
}

function resetBoard() { //function to reset the board to all 0's
	if((typeof board[1]) == "undefined") {initBoard(); resetBoard()};
	for(var col = 0; col < boardSize[0]; col++) { //in each column...
		for(var row = 0; row < boardSize[1]; row++) { //now for each array (row) in that column...
			board[col][row] = 0;
			nboard[col][row] = 0;
			gboard[col][row].connect(masterGainNode);
			gboard[col][row].disconnect(masterGainNode);
		}
	}
	stepCount = 0;
	step();
}

function randomBoard() {
	resetBoard();
	masterGainNode.gain.value = 0; //we're about to set potentially hundreds of cells to alive... let's mute the thing for a moment
	for(var col = 0; col < boardSize[0]; col++) {
		for(var row = 0; row < boardSize[1]; row++) {
			if(Math.random() < density) {setCell(col, row, 1)};
		}
	}
	stepCount = 0;
	step();
	setTimeout(function() {masterGainNode.gain.linearRampToValueAtTime(masterVol, actx.currentTime + attack)}, 1000*(attack + decay)); //gradually unmute
}

function applyAtt(col, row) { //attack envelope & connect node
	gboard[col][row].gain.value = 0;
	gboard[col][row].gain.linearRampToValueAtTime(nodeVol, actx.currentTime + attack); //apply the attack
	gboard[col][row].gain.linearRampToValueAtTime(nodeVol * sustain, actx.currentTime + attack + decay);
	gboard[col][row].connect(masterGainNode); //connect the node
}
function applyRel(col, row) { //release envelope & disconnect node
	gboard[col][row].gain.linearRampToValueAtTime(0, actx.currentTime + release); //apply the release
	setTimeout(function() {gboard[col][row].disconnect(masterGainNode)}, release * 1000); //disconnect the node once it's fully released
}

function checkNeighbors(col, row) { //returns the number of living neighbors to a cell
	var livingNeighbors = 0;
	var xOffset;
	var yOffset;
	for(var relX = -1; relX <= 1; relX++){ //horizontal neighbors
		for(var relY = -1; relY <= 1; relY++) { //vertical neighbors
			//make it toroidal along the left and right edges...
			if(col+relX < 0) {xOffset = boardSize[0] - 1}
			else if(col+relX > boardSize[0] - 1) {xOffset = -boardSize[0] + 1}
			else {xOffset = relX};
			
			//now the top and bottom edges...
			if(row+relY < 0) {yOffset = boardSize[1] - 1}
			else if(row+relY > boardSize[1] - 1) {yOffset = -boardSize[1] + 1}
			else {yOffset = relY};
			
			//and now do the actual check
			if(xOffset == 0 && yOffset == 0) {continue} //exclude the current cell
			else {
				if(board[col+xOffset][row+yOffset] == 1) { //if the neighbor is alive, increment livingNeighbors
					livingNeighbors++;
				}
			}
		}
	}
	return livingNeighbors;
}

function createNeighborArray() { //this function creates a 2D array where each index corresponds to the main array, and contains the number of living neighbors to that cell
	for(var col = 0; col < boardSize[0]; col++) {
		for(var row = 0; row < boardSize[1]; row++) {
			nboard[col][row] = checkNeighbors(col, row);
			fboard[col][row].Q.value = 1 + Math.pow((nboard[col][row]), 1.5); //Q factor increases by 0.5 for every neighbor
		}
	}
	var visBoard1 = "";
	/* like dispBoard(), but for the neighbor array
	for(var row = 0; row < boardSize[1]; row++) { //take the (row)th element of each column, 
		for(var col = 0; col < boardSize[0]; col++) {
			visBoard1 += nboard[col][row]; //concatenate it to the string
			visBoard1 += " ";
		}
		visBoard1 += "\n"; //at the end of the row, put a newline to move onto the next row
	}
	console.log(visBoard1);
	*/
}

function updateCell(col, row) { //the core of Conway's GoL: logic for updating a cell
	var alive = 0;
	
	if(board[col][row] == 0 && nboard[col][row] == 3) { //if dead but 3 neighbors, become alive
		board[col][row] = 1;
		ctx.fillStyle = aliveColor;
		applyAtt(col, row);
		alive = 1;
	}
	else if(board[col][row] == 1) { //if alive...
		if(nboard[col][row] == 2 || nboard[col][row] == 3) {alive = 1;ctx.fillStyle = aliveColor} //and 2/3 neighbors, stay alive
		else {
			board[col][row] = 0;
			ctx.fillStyle = deadColor; //not (2 or 3) neighbors, die.
			applyRel(col, row);
		} 
	}
	else{ctx.fillStyle = deadColor};
	ctx.fillRect(col*cellSize + cellPad, row*cellSize + cellPad, cellSize - (2*cellPad), cellSize - (2*cellPad)); //fill the corresponding cell
	return alive;
}

function step() { //using the current state of board and nboard, calculate the next state of each
	createNeighborArray();
	aliveCells = 0;
	deadCells = 0;
	for(var col = 0; col < boardSize[0]; col++) {
		for(var row = 0; row < boardSize[1]; row++) {
			var alive = updateCell(col, row);
			if(alive) {aliveCells++}
			else if(!alive) {deadCells++};
		}
	}
	stepCount++;
	document.getElementById("stats").innerHTML = "step number: " + stepCount + "<br />" + "alive cells: " + aliveCells + "<br />" + "dead cells: " + deadCells;
}

function setCell(col, row, status) { //helper function for boardClick and pattern functions
	board[col][row] = status;
	if(status==1) {applyAtt(col, row); ctx.fillStyle = aliveColor}
	else {applyRel(col, row); ctx.fillStyle = deadColor};
	ctx.fillRect(col*cellSize + cellPad, row*cellSize + cellPad, cellSize - (2*cellPad), cellSize - (2*cellPad)); //fill the corresponding cell
}

function boardClick(event) {
	var cX = event.clientX + document.body.scrollLeft + document.documentElement.scrollLeft - canvas.offsetLeft;
	var cY = event.clientY + document.body.scrollTop + document.documentElement.scrollTop - canvas.offsetTop;
	var clickedCol = Math.floor(cX/cellSize);
	var clickedRow = Math.floor(cY/cellSize);
	if(board[clickedCol][clickedRow] == 0) {setCell(clickedCol, clickedRow, 1)}
	else {setCell(clickedCol, clickedRow, 0)};
}

async function play() {
	
	var checkBox = document.getElementById("playButton");
	while(checkBox.checked) {
		step();
		await sleep(tempo);
	}
	actx.resume();
}

//the following functions are all demo pattern functions. they contain encoded data (that I input by hand...) for some interesting patterns in Conway's. there's TONS of interesting patterns/oscillators/etc, so i chose some of the more prolific ones.

function gosper() { //resets the board and fits in a Gosper Glider Gun + an eater 1
	if(boardSize[0] < 38 || boardSize[1] < 24) {alert("board too small for GGG"); return};
	resetBoard();
	var data = [ [0, 5], [0, 6], [1, 5], [1, 6], [10, 5], [10, 6], [10, 7], [11, 4], [11, 8], [12, 3], [12, 9], [13, 3], [13, 9], [14, 6], [15, 4], [15, 8], [16, 5], [16, 6], [16, 7], [17, 6], [20, 3], [20, 4], [20, 5], [21, 3], [21, 4], [21, 5], [22, 2], [22, 6], [24, 1], [24, 2], [24, 6], [24, 7], [34, 3], [34, 4], [35, 3], [35, 4], [33, 20], [33, 21], [34, 20], [35, 21], [35, 22], [35, 23], [36, 23] ];
	for(var i = 0; i < data.length; i++) {
		setCell(data[i][0], data[i][1], 1);
	}
}

function blocker() { //the "Blocker" oscillator
	if(boardSize[0] < 12 || boardSize[1] < 12) {alert("board too small for Blocker"); return};
	resetBoard();
	var data = [ [3, 3], [3, 4], [3, 5], [4, 3], [4, 4], [4, 5], [5, 3], [5, 4], [5, 5], [6, 6], [6, 7], [6, 8], [7, 6], [7, 7], [7, 8], [8, 6], [8, 7], [8, 8] ];
	for(var i = 0; i < data.length; i++) {
		setCell(data[i][0], data[i][1], 1);
	}
}

function glider() { //a regular glider
	if(boardSize[0] < 5 || boardSize[1] < 5) {alert("board too small for a Glider"); return};
	resetBoard();
	var data = [ [1, 3], [2, 1], [2, 3], [3, 2], [3, 3] ];
	for(var i = 0; i < data.length; i++) {
		setCell(data[i][0], data[i][1], 1);
	}
}

function pentadecathlons() { //10 blocks in a row creates a period-15 oscillator. here's 3 of them.
	if(boardSize[0] < 34 || boardSize[1] < 23) {alert("board too small for a Glider"); return};
	resetBoard();
	var data = [ [4, 10], [4, 11], [4, 12], [4, 13], [4, 14], [4, 15], [4, 16], [4, 17], [4, 18], [4, 19], [10, 10], [11, 9], [11, 10], [11, 11], [12, 8], [12, 10], [12, 12], [13, 8], [13, 10], [13, 12], [14, 9], [14, 10], [14, 11], [15, 10], [18, 10], [19, 9], [19, 10], [19, 11], [20, 8], [20, 10], [20, 12], [21, 8], [21, 10], [21, 12], [22, 9], [22, 10], [22, 11], [23, 10], [29, 3], [29, 4], [29, 5], [29, 6], [29, 7], [29, 8], [29, 9], [29, 10], [29, 11], [29, 12] ];
	for(var i = 0; i < data.length; i++) {
		setCell(data[i][0], data[i][1], 1);
	}
}