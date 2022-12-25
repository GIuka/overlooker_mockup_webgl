"use strict";

const gridCanvas = document.getElementById("cgl");
const gl = gridCanvas.getContext("webgl", { cull: false, antialias: false });
const shaderStageTexture = twgl.createProgramInfo(gl, ["vertex_texture", "fragment_texture"]);
const shaderStageScreen = twgl.createProgramInfo(gl, ["vertex_screen", "fragment_screen"]);

if (gl == null || shaderStageScreen == null || shaderStageTexture == null) {
  throw new Error("WebGL context creation has failed. Your device or browser must be able"
    + " to use WebGL 1.0 to continue.");
}

// Vertices for a unit quad that spans the canvas so the fragment shader can write
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
  u_timerloop: 0, u_mouse: [0, 0,], u_mix_duration: 0, u_pulse_duration: 0,
  u_resolution: [0, 0,], u_aafactor: 0, u_gridparams: [0, 0, 0,], u_colortheme: 0,
  u_texture_data: 0, u_texture_color: 0, u_matrix: 0,
};
const bufferInfo = twgl.createBufferInfoFromArrays(gl, glArrays);
twgl.setBuffersAndAttributes(gl, shaderStageScreen, bufferInfo);
twgl.setBuffersAndAttributes(gl, shaderStageTexture, bufferInfo);


function setup() {

  // ticksPerSecond:  Sets the number of animation ticks, valid from 2 to 255.
  // colorMixDuration: The length of the color mixing animation in seconds.
  // pulseDuration: Not yet implemented.
  // startingUsers: The number of users that the layout will start with or reset to if maxUsers is exceeded.
  // maxUsers: The number of users to allocate memory for. The simulator will reset the grid when this value is exceeded.
  // joinPerTick: The number of users that are allowed to join per tick of the simulator.
  // updateRatio: The ratio of users that will receive a state update per tick of the simulator.
  // themeSelection: "RandomHSV", "RandomRGB", "default", "American"
  // dotPadding: The ratio of the dot radius removed for creating empty space between dots. Negative values create squares.
  // tilingSpanMode: Technique for spanning the tiles: "spanWidth", "spanHeight", "maxArea", "maxTiles".
  // tickInterval: The very rough time in milliseconds between ticks of the simulator.

  let tempLayout = "";
  let initBlock = 0;
  let layout = 0; // Put in the global context if checking values thru console is needed.
  switch (tempLayout) {
    case "growing":
      initBlock = {
        ticksPerSecond: 50,
        colorMixDuration: 0.5,
        pulseDuration: 2.0,
        startingUsers: 100,
        maxUsers: 100000,
        joinPerTick: 1,
        updateRatio: 0.0,
        themeSelection: "RandomHSV",
        dotPadding: 0.15,
        tilingSpanMode: "maxArea",
        tickInterval: 25,
      }
      layout = new LayoutUserGrid(initBlock);
      break;
    default:
      initBlock = {
        ticksPerSecond: 20,
        colorMixDuration: 0.5,
        pulseDuration: 1,
        startingUsers: 10000,
        maxUsers: 100000,
        joinPerTick: 0,
        updateRatio: 0.075,
        themeSelection: "",
        dotPadding: 0.15,
        tilingSpanMode: "maxArea",
        tickInterval: 25,
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
    this.gridAnimations = new AnimationGL(tempInitBlock.ticksPerSecond, tempInitBlock.colorMixDuration, tempInitBlock.pulseDuration, tempInitBlock.maxUsers);
    uniforms.u_texture_color = this.texMain.colorTexture;
    uniforms.u_texture_data = this.texMain.dataTexture;
    this.layoutTheme = new ColorTheme(tempInitBlock.themeSelection);
    this.tooltip = document.querySelectorAll('.tooltip');
    this.toolTipIndex = 0;

    // Creates a mousemove listener for the tooltip.
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

  // Draw loop.
  render = (time) => {
    this.gridAnimations.updateTimersDrawloopStart(time);
    this.updateTooltip();

    // Checks for a window resize and adjusts the grid + shader dimensions if
    // necessary.
    if (twgl.resizeCanvasToDisplaySize(gl.canvas)) {
      this.gridMain.resize(gl.canvas.width, gl.canvas.height);
      this.texMain.updateTextureDimensions(this.gridMain.parameters.columns, this.gridMain.parameters.rows);
    }

    /*
    // For debugging bad animation start times.
    this.currTime = this.gridAnimations.mapTime(this.texMain.texArray[2], this.gridAnimations.colorMixDuration);
    if (this.lastTime >= 1.0 && this.currTime > 0.02) {
      console.log(this.currTime)
    }
    this.lastTime = this.gridAnimations.mapTime(this.texMain.texArray[2], this.gridAnimations.colorMixDuration);
    */

    // Gets fresh data to the shaders.
    this.updateUniforms();


    // Only update animations and DataTextures on animation tick.
    if (this.gridAnimations.newTickFlag == 1) {

      // Dequeues the newest state changes from userSim and stores them in a state
      // buffer within gridAnimations.
      this.userSim.dequeueNewStatesToBuffer(this.gridAnimations.stateBufferArray);

      // Pops state from the buffer, sets animation start time, and sets control
      // timer for users that have completed their color mixing animation.
      this.gridAnimations.updateColorMix(this.texMain.texArray);
      this.gridAnimations.updatePulse(this.texMain.texArray, this.userCount);

      // Creates a new texture from texArray; contains all changes from the
      // previous step since it was passed by reference.
      this.texMain.updateTexture();
    }

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
    let clientSelect = 0;
    let clientClock = setInterval(() => {
      let updatesPerTick = Math.ceil(this.userCount * this.initBlock.updateRatio);

      for (let i = 0; i < this.initBlock.joinPerTick; i++) {
        var [tempStateCode, tempStateName] = this.userSim.getRandomStateInitialized();
        this.userSim.userJoin(tempStateCode, tempStateName);
        this.userCount++;
      }

      for (let i = 0; i < updatesPerTick; i++) {
        var [tempStateCode, tempStateName] = this.userSim.getRandomStateInitialized();
        this.userSim.setStateUser(clientSelect, tempStateCode, tempStateName);
        clientSelect = (clientSelect + 1) % this.userCount;
      }

      if (this.userCount > this.initBlock.maxUsers) {
        this.resetGrid();
      }
    }, this.initBlock.tickInterval);
  }

  updateUniforms() {
    uniforms.u_resolution = [gl.canvas.width, gl.canvas.height];
    uniforms.u_gridparams = [this.gridMain.parameters.columns, this.gridMain.parameters.rows, this.gridMain.parameters.padding];
    uniforms.u_aafactor = this.texMain.texHeight * 1.5 / gl.canvas.height; // Magic pixel value for anti-aliasing.
    uniforms.u_colortheme = this.layoutTheme.theme;
    uniforms.u_matrix = VisualAux.scaleFragCoords(this.texMain.texWidth, this.texMain.texHeight, "preserve");
    uniforms.u_mix_duration = this.gridAnimations.colorMixDuration;
    uniforms.u_pulse_duration = this.gridAnimations.pulseDuration;
    uniforms.u_timerloop = this.gridAnimations.shaderLoop;
  }

  updateTooltip() {
    if (this.tooltip[0].style.visible != "none") {
      this.tooltip[0].innerHTML = JSON.stringify(this.userSim.userArray[this.toolTipIndex], null, 2);
    }
  }

  mouseMove(event) {
    // Give dots circular bounds if there are less than 1000 users on screen.
    let circularDotsFlag = 0;
    if (this.userSim.userArray.length < 1000) {
      circularDotsFlag = 1;
    }

    // Use relative positioning to account for other CSS elements.
    var rect = gridCanvas.getBoundingClientRect();
    var mouseX = event.clientX - rect.left;
    var mouseY = event.clientY - rect.top;

    var mouseOverInfo = { index: this.gridMain.getTileIndex(mouseX, mouseY, circularDotsFlag), user: 0 };
    if (mouseOverInfo.index == "invalid") {
      for (var i = this.tooltip.length; i--;) {
        this.tooltip[i].style.display = "none";
      }
    } else {
      var flipX = 0;
      var flipY = 0;

      if (mouseX + 200 > gridCanvas.width) {
        flipX = 200;
      }
      if (mouseY + 200 > gridCanvas.height) {
        flipY = 200;
      }

      this.toolTipIndex = mouseOverInfo.index;
      mouseOverInfo.user = this.userSim.userArray[mouseOverInfo.index];
      for (var i = this.tooltip.length; i--;) {
        this.tooltip[i].style.display = "block";
        this.tooltip[i].style.left = (event.pageX - flipX) + 'px';
        this.tooltip[i].style.top = (event.pageY - flipY) + 'px';
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

// This class is meant to simulate the state updates of an API.
//
// Alongside the simulator loop in the LayoutUserGrid, this code is
// meant to demonstrate how state changes can be processed to hook into the
// renderer.
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

  // Maintains a queue of new state changes for the animation buffer. A single
  // user can have multiple states appear in the queue; only the most recent
  // makes it to the buffer due to write order during dequeue.
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
  //
  // Using the queue for state updates is preferred over the overflow array since
  // the latter requires processing the entire buffer while the former is more
  // selective (with the drawback that it contains redundant states).
  compactNewStates() {
    for (let i = 0; i < this.userArray.length; i++) {
      this.updateQueueOverflow[this.updateQueueIndex[i]] = this.updateQueueState[i];
    }
    this.updateQueueOverflowFlag = 1;
    this.updateQueueCounter = 0;
  }
}

// The main purpose of this class is to get state and animation timing info to
// the shaders in the form of a data texture. It also displays the dots to the
// screen in two separate shader stages.
// 
// texArray is used to create a dataTexture each frame. It is a Uint8Array
// containing 4 rgba channels per user w/ the following format: 
// [prevStateCode, currStateCode,colorMixStartTime, pulseStartTime]
//
// First shader stage: 
// State codes are matched to their color thru a color theme uniform, while
// animations reference a looping timer and duration uniform to progress each
// frame. The result is a real color value for each user, which gets written to
// colorTexture.
//
// Second shader stage:
// A few auxillary uniforms are used to draw and tile the dots before pulling
// the appropriate color for the user from colorTexture.
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

  // A collection of attachments. Used for writing to colorTexture instead of
  // the screen during the first shader stage.
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

  // Uses the data within texArray to update the dataTexture.
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

  // Prints the dots to the screen through two discrete shader stages.
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

  // Changes the texture dimensions. 
  //
  // Should be called using columns/rows from UserGrid's tiling algorithm; which
  // calculates the appropriate dimensions to span the div as users
  // join or the screen dimensions are changes.
  //
  // Data is not copied over during resize; the end points of the ArrayBuffer
  // view are moved instead.
  updateTextureDimensions(tempWidth, tempHeight) {
    var tempArrayLength = tempWidth * tempHeight * 4;
    this.texArray = new Uint8Array(this.texBuffer, 0, tempArrayLength);
    this.texWidth = tempWidth;
    this.texHeight = tempHeight;
  }
}

// This class is responsible for getting state and animation info to texArray;
// which is processed each frame to set the colors for each user.
//
// texArray has the following format:
// [prevStateCode, currStateCode,colorMixStartTime, pulseStartTime]
//
// A state buffer containing the most recent state code is maintained for each
// user and popped to perform the colorMix animation once the preceding
// animation has completed.
//
// Shader-side timing logic:
// shaderLoop is the shader-side reference timer and is adjusted according to
// ticksPerSecond and then passed as a uniform each frame.
//
// colorMixDuration and pulseDuration also get passed into the shader. Where the
// endTime of each animation is startTime + duration.
// 
// The function progress = (shaderLoop - startTime) / (endTime - startTime) is
// used to progress each animation as necessary.
//
// The 255 start time is reserved for stopping animations.
//
// *fragment_texture contains details about the edge case where animations span
// both ends of the timing loop.

class AnimationGL {
  constructor(tempTicksPerSecond, tempColorMixDuration, tempPulseDuration, tempMaxUsers) {

    if (Math.floor(tempTicksPerSecond) - tempTicksPerSecond != 0) {
      throw new Error("ticksPerSecond must be an integer value.");
    } else if (tempTicksPerSecond * tempColorMixDuration > 255 || tempTicksPerSecond * tempPulseDuration > 255) {
      throw new Error("Animations are not allowed to last longer than 255 ticks.");
    } else if (tempColorMixDuration * tempTicksPerSecond < 1 || tempPulseDuration * tempTicksPerSecond < 1) {
      throw new Error("A shader animation lasts less than a single tick, animations cannot progress.");
    }

    // Animation lengths are specified in seconds and converted to a discrete
    // number of ticks.
    this.colorMixDuration = Math.round(tempColorMixDuration * tempTicksPerSecond);
    this.pulseDuration = Math.round(tempPulseDuration * tempTicksPerSecond);

    this.ticksPerSecond = tempTicksPerSecond;
    this.timescale = tempTicksPerSecond * 0.001;
    this.maxUsers = tempMaxUsers;
    this.stopAnimationCode = 255; // Defined in the fragment_texture shader.

    // TODO: Use views instead of arrays to handle issues w/ big-endian devices.
    this.colorMixTimerArrayBuffer = new ArrayBuffer(tempMaxUsers * 4);
    this.colorMixTimerArray = new Float32Array(this.colorMixTimerArrayBuffer, 0, tempMaxUsers);

    this.pulseTimerArrayBuffer = new ArrayBuffer(tempMaxUsers * 4);
    this.pulseTimerArray = new Float32Array(this.pulseTimerArrayBuffer, 0, tempMaxUsers);

    this.emptyBufferCode = 254;
    this.uninitBufferCode = 253;
    this.stateBufferArrayBuffer = new ArrayBuffer(tempMaxUsers);
    this.stateBufferArray = new Uint8Array(this.stateBufferArrayBuffer, 0, tempMaxUsers);
    this.stateBufferArray.set(this.uninitBufferCode);

    this.rawTime = 0;
    this.scaledTime = 0;
    this.shaderLoop = 0;
    this.prevTime = 0;
    this.deltaTime = 0;
    this.pauseOffset = 0;
    this.staggerDuration = 1.5;
    this.newTickFlag = 0;
  }

  updatePulse(texArray, userCount) {
    let counter = 0;
    for (let i = 0; i < userCount * 4; i += 4) {
      var startTime = texArray[i + 3];

      if (this.mapTime(startTime, this.pulseDuration) >> 0) {
        // Stop the animation immediately
        texArray[i + 3] = this.stopAnimationCode;

        if (VisualAux.randomFast(this.rawTime + counter) > 0.5) {
          texArray[i + 3] = this.shaderLoop;
        }
      }
      counter++;
    }

    for (let i = (userCount - 1) * 4; i <= texArray.length; i += 4) {
      texArray[i + 3] = this.stopAnimationCode;
    }
  }

  // This function maintains the colorMix animation.
  //
  // texArray has the following format:
  // [prevStateCode, currStateCode, colorMixStartTime, pulseStartTime]
  //
  // This animation does a linear mix from the color corresponding to
  // prevStateCode to the color corresponding to currStateCode.
  updateColorMix(texArray) {
    if (this.newTickFlag) {
      let currShaderloop = this.shaderLoop >> 0;
      let counter = 0;

      for (let i = 0; i < texArray.length; i += 4) {

        var startTime = texArray[i + 2];
        if (this.mapTime(startTime, this.colorMixDuration) >> 0) {
          // Stop the animation immediately.
          texArray[i + 2] = this.stopAnimationCode;

          var nextState = this.stateBufferArray[counter];
          var prevState = texArray[i + 1];

          if (nextState != this.emptyBufferCode && nextState != prevState) {
            // Make the last end state the new start state.
            texArray[i] = texArray[i + 1];

            // Pop from the state buffer.
            texArray[i + 1] = this.stateBufferArray[counter];
            this.stateBufferArray[counter] = this.emptyBufferCode;

            // Start the next animation.
            texArray[i + 2] = currShaderloop;
          }
        }
        counter++;
      }
    }
  }

  // Call at the beginning of the draw loop to update timers.
  updateTimersDrawloopStart(time) {
    let prevShaderLoop = this.shaderLoop;
    this.deltaTime = time - this.prevTime;
    this.rawTime = time;

    // Adjusts time to pause animations while minimized.
    if (this.deltaTime > 200) {
      this.pauseOffset += this.deltaTime;
    }
    this.scaledTime = (time - this.pauseOffset) * this.timescale;
    this.shaderLoop = this.scaledTime % 255.0;

    this.newTickFlag = ((prevShaderLoop >> 0) - (this.shaderLoop >> 0)) != 0;
  }

  mapTime(startTime, duration) {
    let progress = 0.0;
    let endTime = startTime + duration;
    let timer = this.shaderLoop;

    if (startTime >= 255.0) {
      progress = 1.0;
    } else if (timer < startTime) {
      timer += 255.0;
      progress = (timer - startTime) / (endTime - startTime);
    } else {
      progress = (timer - startTime) / (endTime - startTime);
    }

    return progress;
  }

  // Call at the end of the draw loop to get a comparison value for deltaTime.
  updateTimersDrawloopEnd(time) {
    this.prevTime = time;
  }
}

// This class is used for grid logic, such as resizing the texture when the
// window is changed or new users are added.
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

  // Find the parameters for a grid spanning the width of the div.
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

  // Find the parameters for a grid spanning the height of the div.
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

    // Normalize colors: shader colors have channels that go from 0 to 1.
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

  static constrain(tempValue, lowerBound, upperBound) {
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
