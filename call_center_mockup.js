"use strict";

const gridCanvas = document.getElementById("cgl");
const gl = gridCanvas.getContext("webgl", { cull: false, antialias: false });
const shaderStageTexture = twgl.createProgramInfo(gl, ["vertex_texture", "fragment_texture"]);
const shaderStageScreen = twgl.createProgramInfo(gl, ["vertex_screen", "fragment_screen"]);

if (gl == null || shaderStageScreen == null || shaderStageTexture == null) {
  throw new Error("WebGL context creation has failed. Your device or browser must be able"
    + " to use WebGL 1.0 to continue.");
}

// Vertices for a unit quad that spans the div so the fragment shader can write
// to the screen.
const glArrays = {
  a_position: [-1.0, -1.0, 0.0, 1.0, -1.0, 0.0, -1.0, 1.0, 0.0,
  -1.0, 1.0, 0.0, 1.0, -1.0, 0.0, 1.0, 1.0, 0.0,
  ],
  a_texcoord: [0.0, 0.0, 1.0, 0.0, 0.0, 1.0,
    0.0, 1.0, 1.0, 0.0, 1.0, 1.0,
  ],
};

// Uniforms are constants shared by every vertex and fragment for each shader.
// twgl sends them to the shaders in a big block statement for convenience.
const uniforms = {
  u_time: 0, u_mouse: [0, 0,], u_mix_duration: 0, u_time_real: 0, u_pauseoffset: 0, u_timescale: 0,
  u_resolution: [0, 0,], u_aafactor: 0, u_gridparams: [0, 0, 0,], u_colortheme: 0,
  u_texture_data: 0, u_texture_color: 0, u_matrix: 0,
};
const bufferInfo = twgl.createBufferInfoFromArrays(gl, glArrays);
twgl.setBuffersAndAttributes(gl, shaderStageScreen, bufferInfo);
twgl.setBuffersAndAttributes(gl, shaderStageTexture, bufferInfo);

var layout = 0; // Take out of global context for real deployment.
function setup() {
  /*
    TODO: Redo initBlock explanations.
  */

  let tempLayout = "";
  let initBlock = 0;
  switch (tempLayout) {
    case "growing":
      initBlock = {
        ticksPerSecond: 20,
        colorMixDuration: 0.5,
        startingUsers: 1,
        maxUsers: 1000000,
        joinPerTick: 1,
        updateRatio: 0.6,
        themeSelection: "RandomHSV",
        dotPadding: 0.15,
        tilingSpanMode: "maxArea",
        tickInterval: 500,
      }
      layout = new LayoutUserGrid(initBlock);
      break;
    default:
      initBlock = {
        ticksPerSecond: 100,
        colorMixDuration: 0.5,
        startingUsers: 10000,
        maxUsers: 10000,
        joinPerTick: 0,
        updateRatio: 0.5,
        themeSelection: "RandomHSV",
        dotPadding: 0.15,
        tilingSpanMode: "maxArea",
        tickInterval: 500,
      }
      layout = new LayoutUserGrid(initBlock);
  }
}

class LayoutUserGrid {
  constructor(tempInitBlock) {
    this.initBlock = tempInitBlock;
    this.userCount = tempInitBlock.startingUsers;
    this.gridMain = new UserGrid(this.userCount, gl.canvas.width, gl.canvas.height, tempInitBlock.dotPadding, tempInitBlock.tilingSpanMode);
    this.userSim = new UserSimulator(this.userCount, tempInitBlock.maxUsers);
    this.texMain = new DataTexture(this.gridMain.parameters.columns, this.gridMain.parameters.rows, tempInitBlock.maxUsers);
    this.gridAnimations = new AnimationGL(tempInitBlock.ticksPerSecond, tempInitBlock.colorMixDuration, 1, this.userCount, tempInitBlock.maxUsers);
    uniforms.u_texture_color = this.texMain.colorTexture;
    uniforms.u_texture_data = this.texMain.dataTexture;
    this.layoutTheme = new ColorTheme(tempInitBlock.themeSelection);
    this.tooltip = document.querySelectorAll('.tooltip');
    this.toolTipIndex = 0;

    // Create a click listener for selecting users:
    addEventListener('mousemove', (event) => {
      this.mouseMove(event);
    });

    if (typeof uniforms.u_texture_color != 'object' || typeof uniforms.u_texture_color != 'object') {
      throw new Error("u_texture_color and u_texture_data have to be set to a valid WebGL texture before"
        + " the draw loop is started. Try using DataTexture.colorTexture and DataTexture.dataTexture from a DataTexture instance.");
    }

    this.simLoop(); // Start sim loop.
    requestAnimationFrame(this.render); // Start draw loop.
  }

  updateUniforms(time) {
    uniforms.u_resolution = [gl.canvas.width, gl.canvas.height];
    uniforms.u_gridparams = [this.gridMain.parameters.columns, this.gridMain.parameters.rows, this.gridMain.parameters.padding];
    uniforms.u_aafactor = this.texMain.texHeight * 1.5 / gl.canvas.height; // Magic pixel value for anti-aliasing.
    uniforms.u_colortheme = this.layoutTheme.theme;
    uniforms.u_matrix = VisualAux.scaleFragCoords(this.texMain.texWidth, this.texMain.texHeight, "preserve");
    uniforms.u_time = time;
    uniforms.u_timescale = this.gridAnimations.timescale;
    uniforms.u_pauseoffset = this.gridAnimations.pauseOffset;
    uniforms.u_mix_duration = this.gridAnimations.colorMixDuration;
  }

  updateTooltip() {
    if (this.tooltip[0].style.visible != "none") {
      this.tooltip[0].innerHTML = JSON.stringify(this.userSim.userArray[this.toolTipIndex], null, 2);
    }
  }

  render = (time) => {
    this.gridAnimations.updateTimersDrawloopStart(time);
    this.updateTooltip();

    // Checks for a window resize and adjusts the grid + shader dimensions if
    // necessary.
    if (twgl.resizeCanvasToDisplaySize(gl.canvas)) {
      this.gridMain.resize(gl.canvas.width, gl.canvas.height);
      this.texMain.updateTextureDimensions(this.gridMain.parameters.columns, this.gridMain.parameters.rows);
    }

    // Gets fresh data to the shaders.
    this.updateUniforms(time);

    // Dequeues the newest state changes from userSim and stores them in a state
    // buffer within gridAnimations.
    this.userSim.dequeueNewStatesToBuffer(this.gridAnimations.stateBufferArray);

    // Pops state from the buffer, sets animation end time, and resets control
    // timer for users that have completed their color mixing animation.
    // Increments control timer for those who haven't. 
    this.gridAnimations.updateColorMix(this.texMain.texArray);

    // Creates a new texture from texArray; contains all changes from the
    // previous step since it was passed by reference.
    this.texMain.updateTexture();

    // Prints the dots to the screen.
    this.texMain.display();

    // Grows grid to accomodate user joins.
    if (this.userCount > this.gridMain.parameters.activeTiles) {
      let newCount = this.userCount - this.gridMain.parameters.activeTiles;
      this.gridMain.addTiles(newCount, gl.canvas.width, gl.canvas.height);
      this.texMain.updateTextureDimensions(this.gridMain.parameters.columns, this.gridMain.parameters.rows);
    }

    this.gridAnimations.updateTimersDrawloopEnd(time);
    requestAnimationFrame(this.render); // Repeat the draw loop.
  }

  simLoop() {
    let clientClock = setInterval(() => {
      let updatesPerTick = Math.ceil(this.userSim.userArray.length * this.initBlock.updateRatio);

      for (let i = 0; i < this.initBlock.joinPerTick; i++) {
        var [tempStateCode, tempStateName] = this.userSim.getRandomStateInitialized();
        this.userSim.userJoin(tempStateCode, tempStateName);
        this.userCount++;
      }

      for (let i = 0; i < updatesPerTick; i++) {
        var [tempStateCode, tempStateName] = this.userSim.getRandomStateInitialized();
        this.userSim.setStateUser(Math.random() * this.userCount >> 0, tempStateCode, tempStateName);
      }

      if (this.userCount > this.initBlock.maxUsers) {
        this.resetGrid();
      }
    }, this.initBlock.tickInterval);
  }

  mouseMove(event) {
    // Give dots circular bounds if there are less than 1000 users on screen.
    let circularDotsFlag = 0;
    if (this.userSim.userArray.length < 1000) {
      circularDotsFlag = 1;
    }

    // Use relative positioning to account for other CSS elements.
    var rect = event.target.getBoundingClientRect();
    var mouseX = event.clientX - rect.left;
    var mouseY = event.clientY - rect.top;

    var mouseOverInfo = { index: this.gridMain.getTileIndex(mouseX, mouseY, circularDotsFlag), user: 0 };
    if (mouseOverInfo.index == "invalid") {
      for (var i = this.tooltip.length; i--;) {
        this.tooltip[i].style.display = "none";
      }
    } else {
      this.toolTipIndex = mouseOverInfo.index;
      mouseOverInfo.user = this.userSim.userArray[mouseOverInfo.index];
      let tempColor = 'font-weight: bold; background-color: ' + (this.layoutTheme.colorLookup(mouseOverInfo.user.currentState));
      for (var i = this.tooltip.length; i--;) {
        this.tooltip[i].style.display = "block";
        this.tooltip[i].style.left = event.pageX + 'px';
        this.tooltip[i].style.top = event.pageY + 'px';
      }
    }
  }

  // TextureData should never be set to null since it can cause memory leaks and
  // textures will resize next cycle anyways. 
  resetGrid() {
    this.userCount = this.initBlock.startingUsers;
    [this.gridMain, this.userSim] = [null, null];
    this.gridMain = new UserGrid(this.userCount, gl.canvas.width, gl.canvas.height, this.initBlock.dotPadding, this.initBlock.tilingSpanMode);
    this.userSim = new UserSimulator(this.userCount, this.initBlock.maxUsers);
  }
}

class UserSimulator {
  constructor(tempUserCount, tempMaxUserCount) {
    if (tempMaxUserCount == null) {
      throw new Error("UserSimulator requires maxUserCount in its constructor.")
    } else if (tempUserCount == null) {
      console.log("UserSimulator was initialized without any users, make sure DataTexture and UserGrid were"
        + " also initialized the same.")
    }

    this.stateCodes = {
      uninit: 0,
      available: 51,
      previewing: 102,
      onCall: 153,
      afterCall: 204,
      loggedOut: 255,
    };

    this.bufferCodes = {
      empty: 254,
    }

    this.userArray = [];
    this.maxUsers = tempMaxUserCount;
    this.updateQueueIndexBuffer = new ArrayBuffer(4 * tempMaxUserCount); // Using Uint32, since Uint16 maxes at only 65535.
    this.updateQueueStateBuffer = new ArrayBuffer(tempMaxUserCount);

    this.updateQueueCounter = 0;
    this.updateQueueIndex = new Uint32Array(this.updateQueueIndexBuffer, 0, tempMaxUserCount);
    this.updateQueueState = new Uint8Array(this.updateQueueStateBuffer, 0, tempMaxUserCount);

    this.updateQueueOverflowFlag = 0;
    this.updateQueueOverflow = new Uint8Array(tempMaxUserCount);
    this.updateQueueOverflow.set(this.bufferCodes.empty);
    this.initUserArray(tempUserCount);
  }

  initUserArray(tempUserCount) {
    for (let i = 0; i < tempUserCount; i++) {
      this.userJoin();
    }
  }

  userJoin(tempState, tempStateName) {
    if (tempState == null || tempStateName == null) {
      [tempState, tempStateName] = this.getRandomStateJoin();
    }
    this.userArray.push({
      userID: (Math.random() + 1).toString(36).substring(7),
      currentState: tempState,
      stateName: tempStateName,
      connectionStart: Math.floor(Date.now() * 0.001), // In epoch time.
      connectionStatus: "online",
    });
    let tempIndex = this.userArray.length - 1;
    this.enqueueNewState(tempIndex, tempState);
  }

  userLeave(tempIndex) {
    this.userArray[tempIndex].currentState = 255;
    this.userArray[tempIndex].stateName = "loggedOut";
    this.userArray[tempIndex].connectionStart = 0,
      this.userArray[tempIndex].connectionStatus = "offline";
    this.enqueueNewState(tempIndex, 255);
  }

  getRandomStateJoin() {
    let tempStateIndex = (3 * Math.random() + 1) >> 0;
    let validStateCodes = [153, 51, 102, 204];
    let validStateNames = ["onCall", "available", "previewing", "afterCall"];
    return [validStateCodes[tempStateIndex], validStateNames[tempStateIndex]];
  }

  getRandomStateInitialized(stateSeed) {
    var tempStateIndex = 0;

    if (stateSeed == null) {
      tempStateIndex = (5 * Math.random()) >> 0;
    } else {
      tempStateIndex = (5 * VisualAux.randomFast(stateSeed)) >> 0;
    }
    var validStateNames = ["onCall", "available", "previewing", "afterCall", "loggedOut"];
    var validStateCodes = [153, 51, 102, 204, 255];
    return [validStateCodes[tempStateIndex], validStateNames[tempStateIndex]];
  }

  setStateUser(tempIndex, tempState, tempStateName) {
    if (tempStateName == "loggedOut") {
      this.userArray[tempIndex].connectionStart = 0;
      this.userArray[tempIndex].connectionStatus = "offline";
    } else if (this.userArray[tempIndex].connectionStatus == "offline") {
      this.userArray[tempIndex].connectionStart = Math.floor(Date.now() * 0.001);
      this.userArray[tempIndex].connectionStatus = "online";
    }

    this.userArray[tempIndex].currentState = tempState;
    this.userArray[tempIndex].stateName = tempStateName;
    this.enqueueNewState(tempIndex, tempState);
  }

  enqueueNewState(tempIndex, tempState) {
    if (this.updateQueueCounter >= this.maxUsers) {
      this.compactNewStates(this.updateQueueOverflow);
    } else {
      this.updateQueueIndex[this.updateQueueCounter] = tempIndex;
      this.updateQueueState[this.updateQueueCounter] = tempState;
      this.updateQueueCounter++;
    }
  }

  // Writes outstanding states to a state buffer from oldest to newest.
  dequeueNewStatesToBuffer(tempStateBuffer) {

    // Applies overflow array if the queue ran out of space, then dequeues per
    // usual afterwards.
    if (this.updateQueueOverflowFlag == 1) {
      let empty = this.bufferCodes.empty;
      for (let i = 0; i < this.userArray.length; i++) {
        if (this.updateQueueOverflow[i] != empty) {
          tempStateBuffer[i] = this.updateQueueOverflow[i];
          this.updateQueueOverflow[i] = this.bufferCodes.empty;
        }
      }
      this.updateQueueOverflowFlag = 0;
    }
    for (let i = 0; i < this.updateQueueCounter; i++) {
      tempStateBuffer[this.updateQueueIndex[i]] = this.updateQueueState[i];
    }
    this.updateQueueCounter = 0;
  }

  // Prevents the queue from overflowing while minimized.
  compactNewStates() {
    for (let i = 0; i < this.userArray.length; i++) {
      this.updateQueueOverflow[this.updateQueueIndex[i]] = this.updateQueueState[i];
    }
    this.updateQueueOverflowFlag = 1;
    this.updateQueueCounter = 0;
  }
}

class DataTexture {
  constructor(tempWidth, tempHeight, tempMaxTiles) {
    this.texWidth = tempWidth;
    this.texHeight = tempHeight;

    // TODO: enforce minimum window dimensions so narrow windows can't cause
    // thousands of texels.
    let maxTexels = 0;
    if (tempMaxTiles < 100) {
      maxTexels = 500;
    } else {
      maxTexels = (tempMaxTiles - 1) * 2; // Account for worst case texture size.
    }
    this.texBuffer = new ArrayBuffer(maxTexels * 4);

    this.texArray = new Uint8Array(this.texBuffer, 0, tempWidth * tempHeight * 4);
    this.colorTexture = this.createTexture(tempWidth, tempHeight);
    this.dataTexture = this.createTexture(tempWidth, tempHeight);
    this.initFramebuffer();
  }

  createTexture(tempWidth, tempHeight) {
    let tempTexture = twgl.createTexture(gl, {
      target: gl.TEXTURE_2D,
      width: tempWidth,
      height: tempHeight,
      format: gl.RGBA,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      level: 0,
    });
    return tempTexture;
  }

  initFramebuffer() {
    this.bufferAttachments = [{
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
      attachment: this.colorTexture,
    }];
    this.stageBufferInfo = twgl.createFramebufferInfo(gl, this.bufferAttachments, this.texWidth, this.texHeight);
  }

  updateTexture() {
    let options = {
      target: gl.TEXTURE_2D,
      width: this.texWidth,
      height: this.texHeight,
      format: gl.RGBA,
      min: gl.NEAREST,
      mag: gl.NEAREST,
      wrap: gl.CLAMP_TO_EDGE,
    };
    twgl.setTextureFromArray(gl, this.dataTexture, this.texArray, options);
  }

  display() {
    twgl.resizeFramebufferInfo(gl, this.stageBufferInfo, this.bufferAttachments, this.texWidth, this.texHeight);

    // Use the fragment_texture and vertex_texture shaders to process the color
    // codes and timing info in dataTexture.
    gl.useProgram(shaderStageTexture.program);
    twgl.setUniforms(shaderStageTexture, uniforms);

    // Bind the output of the current fragment shader to a framebuffer so that
    // the processed colors can be written to colorTexture.
    twgl.bindFramebufferInfo(gl, this.stageBufferInfo);
    twgl.drawBufferInfo(gl, bufferInfo);

    // Unbind the framebuffer to write to the screen again.
    twgl.bindFramebufferInfo(gl, null);

    // Use the fragment_screen and vertex_screen shaders to draw the dots to the
    // screen using colors from colorTexture.
    gl.useProgram(shaderStageScreen.program);
    twgl.setUniforms(shaderStageScreen, uniforms);
    twgl.drawBufferInfo(gl, bufferInfo);
  }

  updateTextureDimensions(tempWidth, tempHeight) {
    var tempArrayLength = tempWidth * tempHeight * 4;
    if (this.texArray.length > tempArrayLength) {
      this.texArray.fill(0, this.texArray.length - 1, tempArrayLength);
      this.texArray = new Uint8Array(this.texBuffer, 0, tempArrayLength);
    } else {
      this.texArray = new Uint8Array(this.texBuffer, 0, tempArrayLength);
    }
    this.texWidth = tempWidth;
    this.texHeight = tempHeight;
  }
}

class AnimationGL {
  constructor(tempTicksPerSecond, tempColorMixDuration, tempPulseDuration, totalObjects, tempMaxUsers) {

    if (Math.floor(tempTicksPerSecond) - tempTicksPerSecond != 0) {
      throw new Error("ticksPerSecond must be an integer value.");
    } else if (tempTicksPerSecond * tempColorMixDuration > 255 || tempTicksPerSecond * tempPulseDuration > 255) {
      throw new Error("Animations are not allowed to last longer than 255 ticks.");
    } else if (tempColorMixDuration * tempTicksPerSecond < 1 || tempPulseDuration * tempTicksPerSecond < 1) {
      throw new Error("A shader animation lasts less than a single tick, animations cannot progress.");
    }
    this.colorMixDuration = tempColorMixDuration * tempTicksPerSecond;
    this.pulseDuration = tempPulseDuration * tempTicksPerSecond;

    this.bufferCodes = {
      uninit: 253,
      empty: 254,
    }

    this.ticksPerSecond = tempTicksPerSecond;
    this.timescale = tempTicksPerSecond * 0.001;
    this.maxUsers = tempMaxUsers;

    this.colorMixTimerArrayBuffer = new ArrayBuffer(tempMaxUsers * 4);
    this.colorMixTimerArray = new Float32Array(this.colorMixTimerArrayBuffer, 0, tempMaxUsers);

    this.pulseTimerArrayBuffer = new ArrayBuffer(tempMaxUsers * 4);
    this.pulseTimerArray = new Float32Array(this.pulseTimerArrayBuffer, 0, tempMaxUsers);

    this.stateBufferArrayBuffer = new ArrayBuffer(tempMaxUsers);
    this.stateBufferArray = new Uint8Array(this.stateBufferArrayBuffer, 0, tempMaxUsers);
    this.stateBufferArray.set(this.bufferCodes.uninit);

    this.runTime = 0;
    this.controlTime = 0;
    this.shaderLoop = 0;
    this.prevTime = 0;
    this.deltaTime = 0;
    this.pauseOffset = 0;

    this.staggerTimers(this.pulseTimerArray, this.pulseDuration);
    this.staggerTimers(this.colorMixTimerArray, this.colorMixDuration);
  }

  // Introduces random delay to reduce animation clumping.
  staggerTimers(tempControlTimerArray, animationDuration) {
    for (let i = 0; i < tempControlTimerArray.length; i++) {
      tempControlTimerArray[i] = this.controlTime + Math.random() * animationDuration;
    }
  }

  // This function maintains the color mix animation. 
  //
  // This is a shader based animation and progresses by referencing the end time
  // stored in texArray[i + 3] with shaderLoop which is passed as a uniform.
  //
  // Since shaderLoop is a looping timer, every animation would repeat itself
  // without intervention. Control timers are used on the JS side to perform the
  // necessary updates to determine when texArray should be updated.
  updateColorMix(texArray) {
    let shaderStartTime = this.shaderLoop >> 0;
    let stopMixCode = 255;

    let counter = 0;
    for (let i = 0; i < texArray.length; i += 4) {
      let endTime = this.colorMixTimerArray[counter];
      if (this.controlTime >= endTime) {
        if (this.stateBufferArray[counter] == this.bufferCodes.empty) {
          // Stop the animation and reduce chance of animation clumping when
          // next state arrives.
          texArray[i + 3] = stopMixCode;
          this.colorMixTimerArray[counter] = this.controlTime + this.colorMixDuration * Math.random();
        } else {
          // Make the last end state the new start state.
          texArray[i] = texArray[i + 1];

          // Pop from the state buffer.
          texArray[i + 1] = this.stateBufferArray[counter];
          this.stateBufferArray[counter] = this.bufferCodes.empty;

          // Start the animation.
          texArray[i + 3] = shaderStartTime;
          this.colorMixTimerArray[counter] = this.controlTime + this.colorMixDuration;
        }
      }
      counter++;
    }
  }

  // Call at the beginning of the draw loop to update timers.
  updateTimersDrawloopStart(time) {
    this.deltaTime = time - this.prevTime;

    // Adjusts time to account for minimizing. Causes animations to pause if FPS
    // drops below 10.
    if (this.deltaTime > 100) {
      this.pauseOffset += this.deltaTime;
    } else {
      this.runTime = time * 0.001;
      this.controlTime = (time - this.pauseOffset) * this.timescale;
      this.shaderLoop = this.controlTime % 255.0;
    }
  }

  // Call at the end of the draw loop to get a comparison value for deltaTime.
  updateTimersDrawloopEnd(time) {
    this.prevTime = time;
  }

  shaderDebugger(timestamp, control) {
    let start = timestamp;
    let end = 0;
    let duration = this.colorMixDuration;
    let progress = 0.0;

    if (start == 255.0) {

    }
    else if ((start + duration >= 255.0) && (this.shaderLoop < 255.0 + duration - start)) {
      start = start - 254.0;
      end = start + duration;
      progress = VisualAux.constrain(0, 1, (this.shaderLoop - start) / (end - start));
      console.log(progress, this.shaderLoop, end)
    } else if (start + duration >= 255.0) {
      end = start + duration;
      progress = VisualAux.constrain(0, 1, (this.shaderLoop - start) / (end - start));
      console.log(progress, this.shaderLoop, end)
    }
  }
}

class UserGrid {
  constructor(tempActiveTiles, canvasWidth, canvasHeight, tempPadding, tempSpanMode) {
    this.parameters = {
      activeTiles: tempActiveTiles, tileSize: 0, width: 0, height: 0, rows: 0, columns: 0,
      capacity: 0, padding: tempPadding, marginX: 0, marginY: 0, spanMode: tempSpanMode
    };
    this.updateTiling(tempSpanMode, canvasWidth, canvasHeight);
  }

  addTiles(tempCountToAdd, tempWidth, tempHeight) {
    let newActiveTiles = this.parameters.activeTiles + tempCountToAdd;
    if (newActiveTiles > this.parameters.capacity) {
      this.parameters.activeTiles += tempCountToAdd;
      this.updateTiling(this.parameters.spanMode, tempWidth, tempHeight);
    } else if (newActiveTiles > this.parameters.activeTiles) {
      this.parameters.activeTiles += tempCountToAdd;
    } else {
      console.log("UserGrid.addTiles: tempCountToAdd <= 0.")
    }
  }

  resize(tempWidth, tempHeight) {
    this.updateTiling(this.parameters.spanMode, tempWidth, tempHeight);
  }

  updateTiling(tempSpanMode, tempWidth, tempHeight) {
    let paramsHeight, paramsWidth;
    switch (tempSpanMode) {
      case "spanWidth":
        paramsWidth = this.tilingSpanWidth(tempWidth, tempHeight);
        Object.assign(this.parameters, paramsWidth);
        break;
      case "spanHeight":
        paramsHeight = this.tilingSpanHeight(tempWidth, tempHeight);
        Object.assign(this.parameters, paramsHeight);
        break;
      case "maxTiles":
        paramsWidth = this.tilingSpanWidth(tempWidth, tempHeight);
        paramsHeight = this.tilingSpanHeight(tempWidth, tempHeight);
        if (paramsWidth.capacity > paramsHeight.capacity) {
          Object.assign(this.parameters, paramsWidth);
        } else {
          Object.assign(this.parameters, paramsHeight);
        }
        break;
      case "maxArea":
        paramsWidth = this.tilingSpanWidth(tempWidth, tempHeight);
        paramsHeight = this.tilingSpanHeight(tempWidth, tempHeight);
        if (paramsWidth.tileSize > paramsHeight.tileSize) {
          Object.assign(this.parameters, paramsHeight);
        } else {
          Object.assign(this.parameters, paramsWidth);
        }
        break;
      default:
        console.log("Invalid tiling spanMode!");
    }
    this.parameters.marginX = (tempWidth - this.parameters.width) / 2;
    this.parameters.marginY = (tempHeight - this.parameters.height) / 2;
  }

  tilingSpanWidth(canvasWidth, canvasHeight) {
    let windowRatio = canvasWidth / canvasHeight;
    let cellWidth = Math.sqrt(this.parameters.activeTiles * windowRatio);

    let columnsW = Math.ceil(cellWidth);
    let rowsW = Math.ceil(this.parameters.activeTiles / columnsW);
    while (columnsW < rowsW * windowRatio) {
      columnsW++;
      rowsW = Math.ceil(this.parameters.activeTiles / columnsW);
    }
    let tileSizeW = canvasWidth / columnsW;

    let tempParameters = {
      rows: rowsW, columns: columnsW,
      tileSize: tileSizeW, width: canvasWidth,
      height: rowsW * tileSizeW, capacity: rowsW * columnsW,
    }
    return tempParameters;
  }

  tilingSpanHeight(canvasWidth, canvasHeight) {
    let windowRatio = canvasWidth / canvasHeight;
    let cellWidth = Math.sqrt(this.parameters.activeTiles * windowRatio);
    let cellHeight = this.parameters.activeTiles / cellWidth;

    let rowsH = Math.ceil(cellHeight);
    let columnsH = Math.ceil(this.parameters.activeTiles / rowsH);
    while (rowsH * windowRatio < columnsH) {
      rowsH++;
      columnsH = Math.ceil(this.parameters.activeTiles / rowsH);
    }
    let tileSizeH = canvasHeight / rowsH;

    let tempParameters = {
      rows: rowsH, columns: columnsH,
      tileSize: tileSizeH, width: columnsH * tileSizeH,
      height: canvasHeight, capacity: rowsH * columnsH,
    }
    return tempParameters;
  }

  // Returns a tile index given an x position and y position. Invalid if out of
  // boundaries or, if tiles are treated as circular, outside of the radius.
  getTileIndex(tempXPos, tempYPos, treatAsCircular) {
    let xPosGrid = Math.floor((tempXPos - this.parameters.marginX) / this.parameters.tileSize);
    let yPosGrid = Math.floor((tempYPos - this.parameters.marginY) / this.parameters.tileSize);
    let tempIndex = xPosGrid + yPosGrid * this.parameters.columns;

    let index = 0;
    if (xPosGrid < 0 || this.parameters.columns <= xPosGrid || yPosGrid < 0 || this.parameters.activeTiles <= tempIndex) {
      index = "invalid";
    } else if (treatAsCircular) {
      // Use a distance formula test from input coords to center of tile:
      // greater than radius means the user missed.
      let radius = 0.5 * this.parameters.tileSize * (1 - this.parameters.padding);
      let centerX = this.parameters.marginX + 0.5 * this.parameters.tileSize + xPosGrid * this.parameters.tileSize;
      let centerY = this.parameters.marginY + 0.5 * this.parameters.tileSize + yPosGrid * this.parameters.tileSize;
      let centerDistance = Math.sqrt(Math.pow(tempXPos - centerX, 2) + Math.pow(tempYPos - centerY, 2));
      if (centerDistance > radius) {
        index = "invalid";
      } else {
        index = xPosGrid + yPosGrid * this.parameters.columns;
      }
    } else {
      index = xPosGrid + yPosGrid * this.parameters.columns;
    }
    return index;
  }
}

class ColorTheme {
  constructor(tempThemeName) {
    this.theme = this.setColorTheme(tempThemeName);
  }

  // Selects from predefined, user defined, or randomized themes and translates
  // them into a format usable by the fragment_texture shader. The resulting
  // array needs to be passed into the u_colortheme uniform - which is used to
  // match each color to its state code.
  setColorTheme(themeSelection) {
    // themeArray[0, 1, 2] = background
    // themeArray[3, 4, 5] = available
    // themeArray[6, 7, 8] = previewing
    // themeArray[9, 10, 11] = onCall
    // themeArray[12, 13, 14] = afterCall
    // themeArray[15, 16, 17] = loggedOut
    let themeArray = [];
    switch (themeSelection) {
      case "User":
        // Values from CSS color picker go here.
        break;
      case "RandomHSV":
        themeArray = this.randomThemeArray(Math.random(), 6);
        break;
      case "RandomRGB":
        let runningAverage = [0, 0, 0];
        for (let i = 0; i < 6 * 3; i += 3) {
          themeArray[i] = 255 * Math.random();
          themeArray[i + 1] = 255 * Math.random();
          themeArray[i + 2] = 255 * Math.random();
          runningAverage[0] += themeArray[i];
          runningAverage[1] += themeArray[i + 1];
          runningAverage[2] += themeArray[i + 2];
        }
        runningAverage = [runningAverage[0] / 6, runningAverage[1] / 6, runningAverage[2] / 6];
        [themeArray[0], themeArray[1], themeArray[2]] = [0.3 * runningAverage[0], 0.3 * runningAverage[1], 0.3 * runningAverage[2]]
        break;
      case "American":
        themeArray = [40, 40, 48, 98, 96, 162, 87, 153, 226, 215, 70, 88, 40, 73, 250, 230, 220, 230];
        break;
      default:
        themeArray = [0, 0, 0, 63, 191, 177, 0, 110, 184, 243, 108, 82, 255, 205, 52, 0, 48, 70]; // Theme from the client's slide.
        break;
    }

    document.body.style.backgroundColor = "rgb(" + themeArray[0] + ","
      + themeArray[1] + "," + themeArray[2] + ")";

    // Normalize colors: the shader uses colors whose channels go from 0 to 1.
    for (let i = 0; i < themeArray.length; i++) {
      themeArray[i] = themeArray[i] / 255;
    }
    return themeArray;
  }

  // Generates a theme given a starting HSV hue. 
  randomThemeArray(centerPoint, totalColors) {
    let tempColorArray = [];

    function pushColor(h, s, v) {
      h = Math.abs(Math.sin(0.5 * Math.PI * h));
      s = Math.abs(Math.sin(0.5 * Math.PI * s));
      v = Math.abs(Math.sin(0.5 * Math.PI * v));
      let tempBuffer = [].concat(...VisualAux.HSVtoRGB(h, s, v));
      tempColorArray.push(tempBuffer[0], tempBuffer[1], tempBuffer[2]);
    }

    function tunedValue(mean, deviation) {
      return mean + deviation * Math.sin(2 * Math.PI * Math.random());
    }

    let hueSpread = Math.random();
    for (let i = 0; i < totalColors; i++) {
      let randomHue = centerPoint + Math.sin(((2 * Math.PI / totalColors) * (i + hueSpread)));
      let randomSat = 0.6 + 0.4 * Math.sin(((2 * Math.PI / totalColors) * i));
      let randomVal = tunedValue(0.1 + i / totalColors, 0.1);
      pushColor(randomHue, randomSat, randomVal);
    }
    return tempColorArray;
  }

  // Gets the color associated with a state code and returns it in the 
  // rgb(r, g, b) format used by CSS.
  colorLookup(tempCode) {
    let tempColor;
    let tempColorArray = [];

    if (tempCode != null) {
      let arrayStart = (tempCode / 51) * 3;
      let arrayEnd = arrayStart + 3;
      tempColorArray = this.theme.slice(arrayStart, arrayEnd);
    }

    tempColor = "rgb(" + 255 * tempColorArray[0] + ","
      + 255 * tempColorArray[1] + "," + 255 * tempColorArray[2] + ");";

    return tempColor;
  }
}

// A collection of various functions that are useful for graphics and visualization.
class VisualAux {
  constructor(sineLength) {
    this.sineArray = VisualAux.createSineArray(sineLength);
  }

  // Uses the mulberry32 algorithm, which is faster than Math.random() while
  // still producing a decent distribution. 
  // https://github.com/skeeto/hash-prospector
  static randomFast(seed) {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  // Creates a lookup array for replacing the Math.sin function.
  static createSineArray(tempRes) {
    let tempSineArray = new Float32Array(tempRes);
    let tempScale = (2 * Math.PI) / tempRes;
    for (let i = 0; i < tempRes - 1; i++) {
      tempSineArray[i] = Math.sin(i * tempScale);
    }
    return tempSineArray;
  }

  // Uses a non-periodic sum of sinusoids for smooth noise generation.
  sineNoise(inputA, inputB, offsetA, offsetB) {
    var modLength = this.sineArray.length;
    var sineInputPI = ((Math.PI * inputA + offsetA) % modLength) >> 0;
    var sineInput2 = ((Math.sqrt(2) * inputB + offsetB) % modLength) >> 0;
    var sineOutput = 0.5 * (this.sineArray[sineInputPI] + this.sineArray[sineInput2]);
    return sineOutput;
  }

  // Creates a transformation matrix for scaling our quad's vertices. Needed to
  // preserve the aspect ratio of the tiles within the shader. It also flips the
  // texture so that circles maintain a proper ordering. 
  // https://stackoverflow.com/questions/52507592/how-to-scale-a-texture-in-webgl
  static scaleFragCoords(tempWidth, tempHeight, tempScaleType) {
    const canvasAspectRatio = gl.canvas.width / gl.canvas.height;
    const textureAspectRatio = tempWidth / tempHeight;
    let scaleX, scaleY;
    let scaleType = tempScaleType;
    switch (scaleType) {
      case 'spanHeight':
        scaleY = 1;
        scaleX = textureAspectRatio / canvasAspectRatio;
        break;
      case 'spanWidth':
        scaleX = 1;
        scaleY = canvasAspectRatio / textureAspectRatio;
        break;
      case 'preserve':
        scaleY = 1;
        scaleX = textureAspectRatio / canvasAspectRatio;
        if (scaleX > 1) {
          scaleY = 1 / scaleX;
          scaleX = 1;
        }
        break;
      case 'stretch':
        scaleY = 1;
        scaleX = textureAspectRatio / canvasAspectRatio;
        if (scaleX < 1) {
          scaleY = 1 / scaleX;
          scaleX = 1;
        }
        break;
    }

    let matrix = [
      scaleX, 0.0, 0.0,
      0.0, -scaleY, 0.0,
      0.0, 0.0, 1.0,
    ]

    return matrix;
  }

  static constrain(lowerBound, upperBound, tempValue) {
    let constrained = Math.min(Math.max(tempValue, lowerBound), upperBound);
    return constrained;
  }

  static HSVtoRGB(h, s, v) {
    var r, g, b, i, f, p, q, t;
    if (arguments.length === 1) {
      s = h.s, v = h.v, h = h.h;
    }
    i = Math.floor(h * 6);
    f = h * 6 - i;
    p = v * (1 - s);
    q = v * (1 - f * s);
    t = v * (1 - (1 - f) * s);
    switch (i % 6) {
      case 0: r = v, g = t, b = p; break;
      case 1: r = q, g = v, b = p; break;
      case 2: r = p, g = v, b = t; break;
      case 3: r = p, g = q, b = v; break;
      case 4: r = t, g = p, b = v; break;
      case 5: r = v, g = p, b = q; break;
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
}

setup();
