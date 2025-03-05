/**
 * A custom web component that applies WebGL shader effects to images and videos.
 * This component creates a canvas element that displays media content with customizable shader effects.
 *
 * @customElement
 * @extends HTMLElement
 *
 * @property {string} src - URL of the image or video to display
 * @property {string} fragmentShader - GLSL fragment shader code to apply
 * @property {string} width - Width of the canvas in pixels
 * @property {string} height - Height of the canvas in pixels
 * @property {string} uniforms - JSON string of uniform values to pass to the shader
 * @property {boolean} playing - Controls video playback when the media is a video
 * @property {string} alt - Alternative text for accessibility
 * @property {string} loading - Loading mode ('eager' or 'lazy')
 */
class MediaShader extends HTMLElement {
  /**
   * Creates a new ShaderViewer instance and initializes the WebGL context.
   */
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    // Create and append canvas
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img"); // Add ARIA role
    this.shadowRoot.appendChild(this.canvas);

    // Add default styles
    const style = document.createElement("style");
    style.textContent = `
            :host {
                display: inline-block;
                position: relative;
                width: auto;
                height: auto;
            }
            canvas {
                display: block;
                width: 100%;
                height: 100%;
            }
        `;
    this.shadowRoot.appendChild(style);

    // Initialize properties
    this.gl = null;
    this.mediaElement = null;
    this.texture = null;
    this.program = null;
    this.animationFrame = null;
    this._width = 300;
    this._height = 150;
    this._naturalWidth = null;
    this._naturalHeight = null;
    this._playing = false;
    this._isLoaded = false;
    this._intersectionObserver = null;
    this._uniforms = {};
    this._uniformLocations = new Map();
    this._hasTexture = false;
    this._startTime = performance.now();
    this._mouseData = new Float32Array(4);
    this._isMouseDown = false;

    // Add ResizeObserver for handling CSS-based resizing
    this._resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Only update if dimensions actually changed
        const newWidth = entry.contentRect.width;
        const newHeight = entry.contentRect.height;

        // Skip if we have explicit attribute dimensions
        if (this._width === null && this._height === null) {
          this.updateCanvasSize();
        }
      }
    });

    // Bind methods to this
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);

    // Default shaders
    this.defaultFragmentShader = `
            precision highp float;
            uniform sampler2D uTexture;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec4 uMouse;
            uniform bool uHasTexture;
            varying vec2 vTexCoord;

            void main() {
                if (uHasTexture) {
                    gl_FragColor = texture2D(uTexture, vTexCoord);
                } else {
                    // For non-textured cases, show the animated gradient
                    vec2 uv = vTexCoord;
                    uv.x *= uResolution.x/uResolution.y;
                    vec3 color = 0.5 + 0.5 * cos(uTime + uv.xyx + vec3(0,2,4));
                    gl_FragColor = vec4(color, 1.0);
                }
            }
        `;

    this.vertexShader = `
            attribute vec4 aPosition;
            attribute vec2 aTexCoord;
            varying vec2 vTexCoord;

            void main() {
                gl_Position = aPosition;
                vTexCoord = aTexCoord;
            }
        `;

    // Only initialize WebGL if loading is eager
    if (this.loading === "eager") {
      this.initializeComponent();
    }
  }

  /**
   * Gets the source URL of the media element.
   * @returns {string|null} The source URL or null if not set
   */
  get src() {
    return this.getAttribute("src");
  }

  set src(value) {
    if (value) {
      this.setAttribute("src", value);
    } else {
      this.removeAttribute("src");
    }
  }

  /**
   * Gets the fragment shader code.
   * @returns {string|null} The fragment shader code or null if not set
   */
  get fragmentShader() {
    return this.getAttribute("fragment-shader");
  }

  set fragmentShader(value) {
    if (value) {
      this.setAttribute("fragment-shader", value);
    } else {
      this.removeAttribute("fragment-shader");
    }
  }

  /**
   * Gets the canvas width.
   * @returns {string|null} The width value or null if not set
   */
  get width() {
    return this.getAttribute("width");
  }

  set width(value) {
    if (value) {
      this.setAttribute("width", value);
      // Update the host element's width directly
      this.style.width = value;
    } else {
      this.removeAttribute("width");
      this.style.width = "";
    }
  }

  /**
   * Gets the canvas height.
   * @returns {string|null} The height value or null if not set
   */
  get height() {
    return this.getAttribute("height");
  }

  set height(value) {
    if (value) {
      this.setAttribute("height", value);
      // Update the host element's height directly
      this.style.height = value;
    } else {
      this.removeAttribute("height");
      this.style.height = "";
    }
  }

  /**
   * Gets the uniform values as a JSON string.
   * @returns {string|null} JSON string of uniform values or null if not set
   */
  get uniforms() {
    return this.getAttribute("uniforms");
  }

  set uniforms(value) {
    if (value) {
      this.setAttribute(
        "uniforms",
        typeof value === "string" ? value : JSON.stringify(value)
      );
    } else {
      this.removeAttribute("uniforms");
    }
  }

  /**
   * Gets the playing state for video elements.
   * @returns {boolean} True if the video should be playing
   */
  get playing() {
    return this.getAttribute("playing") !== "false";
  }

  set playing(value) {
    const shouldPlay = value !== false && value !== "false";
    if (shouldPlay) {
      this.setAttribute("playing", "");
    } else {
      this.setAttribute("playing", "false");
    }
  }

  /**
   * Gets the alternative text for accessibility.
   * @returns {string|null} The alternative text or null if not set
   */
  get alt() {
    return this.getAttribute("alt");
  }

  set alt(value) {
    if (value) {
      this.setAttribute("alt", value);
    } else {
      this.removeAttribute("alt");
    }
  }

  /**
   * Gets the loading mode ('eager' or 'lazy').
   * @returns {string} The loading mode, defaults to 'lazy'
   */
  get loading() {
    return this.getAttribute("loading") || "lazy";
  }

  set loading(value) {
    if (value && (value === "eager" || value === "lazy")) {
      this.setAttribute("loading", value);
    } else {
      this.removeAttribute("loading");
    }
  }

  /**
   * Lifecycle callback when the element is added to the document.
   * Initializes the component with attribute values.
   */
  connectedCallback() {
    // Start observing size changes
    this._resizeObserver.observe(this);

    // Set up intersection observer for both lazy and eager loading
    this._intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Initialize if not loaded, regardless of loading mode
            if (!this._isLoaded) {
              this.initializeComponent();
            }
          } else {
            // Clean up when out of view, regardless of loading mode
            if (this._isLoaded) {
              this.cleanup();
            }
          }
        });
      },
      {
        rootMargin: "50px", // Start loading slightly before element comes into view
      }
    );
    this._intersectionObserver.observe(this);

    // For eager loading, initialize immediately
    if (this.loading === "eager" && !this._isLoaded) {
      this.initializeComponent();
    }

    // Add mouse event listeners
    this.addEventListener("mousemove", this._onMouseMove);
    this.addEventListener("mousedown", this._onMouseDown);
    this.addEventListener("mouseup", this._onMouseUp);
    // Optional: handle mouse leaving the element
    this.addEventListener("mouseleave", this._onMouseUp);
  }

  /**
   * Initializes the component by setting up WebGL and loading media.
   */
  initializeComponent() {
    if (this._isLoaded) return;

    // Remove any existing canvas first
    if (this.canvas) {
      this.canvas.remove();
    }

    // Create new canvas
    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("role", "img");
    this.shadowRoot.appendChild(this.canvas);

    // Initialize WebGL context
    this.gl = this.canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      alpha: true,
    });
    if (!this.gl) {
      console.error("WebGL2 not supported");
      return;
    }

    // Initialize WebGL setup
    this.initWebGL();

    // Mark as loaded before processing attributes to prevent circular dependencies
    this._isLoaded = true;

    // Get initial attribute values
    const src = this.getAttribute("src");
    const fragmentShader = this.getAttribute("fragment-shader");
    const uniforms = this.getAttribute("uniforms");
    const width = this.getAttribute("width");
    const height = this.getAttribute("height");

    // Apply initial attributes if present
    if (fragmentShader) {
      this.updateShader(fragmentShader);
    }
    if (uniforms) {
      this.updateUniforms(uniforms);
    }
    if (width) {
      this._width = width;
      this.style.width = width;
      this.updateCanvasSize();
    }
    if (height) {
      this._height = height;
      this.style.height = height;
      this.updateCanvasSize();
    }
    if (src) {
      this.loadMedia(src);
    } else {
      // Start render loop even without media
      this.startRenderLoop();
    }
  }

  /**
   * Cleans up resources when the component is unloaded.
   */
  cleanup() {
    if (!this._isLoaded) return;

    // Cancel animation frame
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    // Pause video if playing
    if (this.mediaElement && this.mediaElement.tagName === "VIDEO") {
      this.mediaElement.pause();
    }

    // Clean up WebGL resources
    if (this.gl) {
      // Delete buffers
      if (this._buffers) {
        if (this._buffers.position) {
          this.gl.deleteBuffer(this._buffers.position);
        }
        if (this._buffers.texCoord) {
          this.gl.deleteBuffer(this._buffers.texCoord);
        }
        this._buffers = null;
      }

      // Delete textures
      if (this.texture) {
        this.gl.deleteTexture(this.texture);
        this.texture = null;
      }

      // Delete shader program
      if (this.program) {
        this.gl.deleteProgram(this.program);
        this.program = null;
      }

      // Clear all attributes and uniforms
      this._uniformLocations.clear();

      // Clear the canvas
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);

      // Lose the context
      const ext = this.gl.getExtension("WEBGL_lose_context");
      if (ext) {
        ext.loseContext();
      }

      this.gl = null;
    }

    // Remove the canvas element completely
    if (this.canvas) {
      this.canvas.remove();
      this.canvas = null;
    }

    this._isLoaded = false;
  }

  /**
   * Lifecycle callback when the element is removed from the document.
   * Cleans up resources and stops rendering.
   */
  disconnectedCallback() {
    // Stop observing size changes
    this._resizeObserver.disconnect();

    // Disconnect intersection observer
    if (this._intersectionObserver) {
      this._intersectionObserver.disconnect();
      this._intersectionObserver = null;
    }

    // Clean up resources
    this.cleanup();

    // Clean up event listeners
    this.removeEventListener("mousemove", this._onMouseMove);
    this.removeEventListener("mousedown", this._onMouseDown);
    this.removeEventListener("mouseup", this._onMouseUp);
    this.removeEventListener("mouseleave", this._onMouseUp);
  }

  /**
   * Specifies which attributes should be observed for changes.
   * @returns {string[]} Array of attribute names to observe
   */
  static get observedAttributes() {
    return [
      "src",
      "fragment-shader",
      "width",
      "height",
      "uniforms",
      "playing",
      "alt",
      "loading",
      "muted",
      "playsinline",
      "loop",
      "autoplay",
    ];
  }

  /**
   * Lifecycle callback when observed attributes change.
   * @param {string} name - Name of the changed attribute
   * @param {string} oldValue - Previous value of the attribute
   * @param {string} newValue - New value of the attribute
   */
  async attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;

    switch (name) {
      case "src":
        await this.loadMedia(newValue);
        break;
      case "fragment-shader":
        this.updateShader(newValue || this.defaultFragmentShader);
        break;
      case "width":
        this._width = newValue;
        this.style.width = newValue;
        this.updateCanvasSize();
        break;
      case "height":
        this._height = newValue;
        this.style.height = newValue;
        this.updateCanvasSize();
        break;
      case "uniforms":
        this.updateUniforms(newValue);
        break;
      case "alt":
        this.updateAccessibility(newValue);
        break;
      case "playing":
        if (this.mediaElement?.tagName === "VIDEO") {
          const shouldPlay = newValue !== "false";
          try {
            if (shouldPlay) {
              await this.mediaElement.play();
              this._playing = true;
            } else {
              this.mediaElement.pause();
              this._playing = false;
            }
          } catch (e) {
            console.warn("Video playback control failed:", e);
            this._playing = false;
            this.setAttribute("playing", "false");
          }
        }
        break;
      case "loading":
        if (newValue === "eager") {
          this.initializeComponent();
        }
        break;
      case "muted":
        if (this.mediaElement?.tagName === "VIDEO") {
          this.mediaElement.muted = newValue !== "false";
        }
        break;
      case "playsinline":
        if (this.mediaElement?.tagName === "VIDEO") {
          this.mediaElement.playsInline = newValue !== "false";
        }
        break;
      case "loop":
        if (this.mediaElement?.tagName === "VIDEO") {
          this.mediaElement.loop = newValue !== "false";
        }
        break;
      case "autoplay":
        if (this.mediaElement?.tagName === "VIDEO") {
          this.mediaElement.autoplay = newValue !== "false";
        }
        break;
    }
  }

  /**
   * Updates the canvas size based on media dimensions and attributes.
   * Maintains aspect ratio when only width or height is specified.
   */
  updateCanvasSize() {
    if (!this.canvas) {
      console.warn("Cannot update canvas size: canvas element does not exist");
      return;
    }

    // Get natural dimensions from media if available
    const naturalWidth =
      this.mediaElement?.naturalWidth || this.mediaElement?.videoWidth;
    const naturalHeight =
      this.mediaElement?.naturalHeight || this.mediaElement?.videoHeight;

    // Store natural dimensions for aspect ratio
    if (naturalWidth && naturalHeight) {
      this._naturalWidth = naturalWidth;
      this._naturalHeight = naturalHeight;
      // Set aspect ratio on the host element
      this.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`;
    }

    let finalWidth = this._width;
    let finalHeight = this._height;
    let rect = this.getBoundingClientRect();

    if (this._width) {
      finalWidth = rect.width;
    }
    if (this._height) {
      finalHeight = rect.height;
    }

    // Get device pixel ratio for high DPI displays
    const dpr = window.devicePixelRatio || 1;

    // Set the canvas dimensions
    this.canvas.width = Math.round(finalWidth * dpr);
    this.canvas.height = Math.round(finalHeight * dpr);

    // Update WebGL viewport
    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /**
   * Updates accessibility attributes for the canvas and media elements.
   * @param {string} altText - Alternative text for accessibility
   */
  updateAccessibility(altText) {
    // Update canvas accessibility attributes
    this.canvas.setAttribute("aria-label", altText || "");

    // Set appropriate role based on media type
    const isVideo = this.mediaElement && this.mediaElement.tagName === "VIDEO";

    if (!altText) {
      this.canvas.setAttribute("role", "presentation");
    } else if (isVideo) {
      this.canvas.setAttribute("role", "application");
      // Add additional video-specific ARIA attributes
      this.canvas.setAttribute(
        "aria-label",
        (altText || "") + " (video player)"
      );
    } else {
      this.canvas.setAttribute("role", "img");
    }

    // Update media element if it exists
    if (this.mediaElement) {
      this.mediaElement.alt = altText || "";
      this.mediaElement.setAttribute("aria-hidden", "true"); // Hide from screen readers since canvas is the visible element
    }
  }

  /**
   * Loads and initializes a new media element (image or video).
   * @param {string} src - URL of the media to load
   * @returns {Promise<void>}
   */
  async loadMedia(src) {
    if (!src) {
      this._hasTexture = false;
      return;
    }

    if (!this.gl) return;

    const isVideo = /\.(mp4|webm|ogg)$/i.test(src);

    // Clean up previous media element
    if (this.mediaElement) {
      if (this.mediaElement.tagName === "VIDEO") {
        this.mediaElement.pause();
        this.mediaElement.removeEventListener("play", this._onPlay);
        this.mediaElement.removeEventListener("pause", this._onPause);
        this.mediaElement.removeEventListener("timeupdate", this._onTimeUpdate);
        if ("requestVideoFrameCallback" in this.mediaElement) {
          this.mediaElement.cancelVideoFrameCallback(this._videoFrameCallback);
        }
      }
      this.mediaElement.remove();
      this._hasTexture = false;
    }

    // Create new media element
    this.mediaElement = document.createElement(isVideo ? "video" : "img");
    this.mediaElement.crossOrigin = "anonymous";
    this.mediaElement.style.display = "none";
    this.shadowRoot.appendChild(this.mediaElement);

    try {
      await new Promise((resolve, reject) => {
        if (isVideo) {
          // Replace hardcoded values with attribute values
          this.mediaElement.muted = this.getAttribute("muted") !== "false";
          this.mediaElement.playsInline =
            this.getAttribute("playsinline") !== "false";
          this.mediaElement.loop = this.getAttribute("loop") !== "false";
          this.mediaElement.autoplay = this.getAttribute("autoplay") === "true";

          // Wait for metadata to load before proceeding
          this.mediaElement.addEventListener(
            "loadedmetadata",
            async () => {
              if (!this.isConnected || !this.mediaElement || !this.canvas) {
                return reject(new Error("Component disconnected during load"));
              }

              // Update canvas size now that we have video dimensions
              this.updateCanvasSize();
              this.createTexture();

              // Initialize video playback
              const shouldPlay = this.getAttribute("playing") !== "false";
              this._playing = shouldPlay;

              if (shouldPlay) {
                try {
                  await this.mediaElement.play();
                } catch (e) {
                  console.warn("Initial video play failed:", e);
                  this._playing = false;
                  this.setAttribute("playing", "false");
                }
              }

              resolve();
            },
            { once: true }
          );

          // Define updateVideoTexture function
          const updateVideoTexture = () => {
            if (this.texture && this.mediaElement.readyState >= 2) {
              this.gl.activeTexture(this.gl.TEXTURE0);
              this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
              this.gl.texImage2D(
                this.gl.TEXTURE_2D,
                0,
                this.gl.RGBA,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                this.mediaElement
              );
            }
            if (this._playing && this.isConnected) {
              if ("requestVideoFrameCallback" in this.mediaElement) {
                this._videoFrameCallback =
                  this.mediaElement.requestVideoFrameCallback(
                    updateVideoTexture
                  );
              } else {
                this._videoFrameCallback =
                  requestAnimationFrame(updateVideoTexture);
              }
            }
          };

          // Set up video texture update using requestVideoFrameCallback if available
          if ("requestVideoFrameCallback" in this.mediaElement) {
            this._videoFrameCallback =
              this.mediaElement.requestVideoFrameCallback(updateVideoTexture);
          } else {
            this._videoFrameCallback =
              requestAnimationFrame(updateVideoTexture);
          }

          // Add event listeners for play/pause
          this.mediaElement.addEventListener("play", () => {
            this._playing = true;
            // Restart frame updates
            if ("requestVideoFrameCallback" in this.mediaElement) {
              this._videoFrameCallback =
                this.mediaElement.requestVideoFrameCallback(updateVideoTexture);
            } else {
              this._videoFrameCallback =
                requestAnimationFrame(updateVideoTexture);
            }
          });

          this.mediaElement.addEventListener("pause", () => {
            this._playing = false;
            // Cancel frame updates
            if ("requestVideoFrameCallback" in this.mediaElement) {
              this.mediaElement.cancelVideoFrameCallback(
                this._videoFrameCallback
              );
            } else {
              cancelAnimationFrame(this._videoFrameCallback);
            }
          });

          // Start loading the video
          this.mediaElement.src = src;
        } else {
          // For images

          this.mediaElement.onload = async () => {
            if (!this.isConnected || !this.mediaElement || !this.canvas) {
              return reject(new Error("Component disconnected during load"));
            }

            this.updateCanvasSize();
            this.createTexture();

            // For images, update the texture immediately
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
            this.gl.texImage2D(
              this.gl.TEXTURE_2D,
              0,
              this.gl.RGBA,
              this.gl.RGBA,
              this.gl.UNSIGNED_BYTE,
              this.mediaElement
            );
            this._hasTexture = true;

            resolve();
          };

          if (this.mediaElement.complete) {
            this.mediaElement.onload();
          }

          this.mediaElement.onerror = reject;
          this.mediaElement.src = src;
        }
      });

      // Start render loop after media is loaded
      this.startRenderLoop();
    } catch (error) {
      console.error("Error loading media:", error);
      if (this.mediaElement) {
        this.mediaElement.remove();
        this.mediaElement = null;
      }
      this._hasTexture = false;
    }
  }

  /**
   * Creates and initializes a WebGL texture for the media element.
   */
  createTexture() {
    if (!this.gl) return;

    if (this.texture) {
      this.gl.deleteTexture(this.texture);
    }

    this.texture = this.gl.createTexture();
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);

    // Set texture parameters
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_S,
      this.gl.CLAMP_TO_EDGE
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_WRAP_T,
      this.gl.CLAMP_TO_EDGE
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.LINEAR
    );
    this.gl.texParameteri(
      this.gl.TEXTURE_2D,
      this.gl.TEXTURE_MAG_FILTER,
      this.gl.LINEAR
    );

    if (
      this.mediaElement?.tagName === "VIDEO" &&
      this.mediaElement.readyState >= 2
    ) {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        this.mediaElement
      );
    } else {
      // Initialize with transparent pixel
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        1,
        1,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
      );
    }

    this._hasTexture = true;
  }

  /**
   * Initializes WebGL context, shaders, and buffers.
   */
  initWebGL() {
    if (!this.gl) return;

    // Create shader program
    const vertShader = this.createShader(
      this.gl.VERTEX_SHADER,
      this.vertexShader
    );
    const fragShader = this.createShader(
      this.gl.FRAGMENT_SHADER,
      this.defaultFragmentShader
    );

    if (!vertShader || !fragShader) {
      console.error("Failed to create shaders");
      if (vertShader) this.gl.deleteShader(vertShader);
      if (fragShader) this.gl.deleteShader(fragShader);
      return;
    }

    this.program = this.gl.createProgram();
    if (!this.program) {
      console.error("Failed to create shader program");
      this.gl.deleteShader(vertShader);
      this.gl.deleteShader(fragShader);
      return;
    }

    this.gl.attachShader(this.program, vertShader);
    this.gl.attachShader(this.program, fragShader);
    this.gl.linkProgram(this.program);

    if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
      console.error(
        "Unable to initialize shader program:",
        this.gl.getProgramInfoLog(this.program)
      );
      this.gl.deleteShader(vertShader);
      this.gl.deleteShader(fragShader);
      this.gl.deleteProgram(this.program);
      this.program = null;
      return;
    }

    // After successful linking, we can delete the shader objects
    this.gl.deleteShader(vertShader);
    this.gl.deleteShader(fragShader);

    // Set up vertex buffer
    const positions = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const texCoords = new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]);

    // Create and bind position buffer
    const positionBuffer = this.gl.createBuffer();
    if (!positionBuffer) {
      console.error("Failed to create position buffer");
      return;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

    const aPosition = this.gl.getAttribLocation(this.program, "aPosition");
    this.gl.enableVertexAttribArray(aPosition);
    this.gl.vertexAttribPointer(aPosition, 2, this.gl.FLOAT, false, 0, 0);

    // Create and bind texture coordinate buffer
    const texCoordBuffer = this.gl.createBuffer();
    if (!texCoordBuffer) {
      console.error("Failed to create texture coordinate buffer");
      return;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, texCoordBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, texCoords, this.gl.STATIC_DRAW);

    const aTexCoord = this.gl.getAttribLocation(this.program, "aTexCoord");
    this.gl.enableVertexAttribArray(aTexCoord);
    this.gl.vertexAttribPointer(aTexCoord, 2, this.gl.FLOAT, false, 0, 0);

    // Store buffer references for cleanup
    this._buffers = {
      position: positionBuffer,
      texCoord: texCoordBuffer,
    };

    // Initialize uniform locations
    this.updateUniformLocations();

    // Use the program
    this.gl.useProgram(this.program);

    // Set up initial texture state
    const uTexture = this._uniformLocations.get("uTexture");
    if (uTexture) {
      this.gl.uniform1i(uTexture, 0);
    }
  }

  /**
   * Creates and compiles a WebGL shader.
   * @param {number} type - The shader type (VERTEX_SHADER or FRAGMENT_SHADER)
   * @param {string} source - The GLSL source code
   * @returns {WebGLShader|null} The compiled shader or null if compilation failed
   */
  createShader(type, source) {
    if (!this.gl) return null;

    const shader = this.gl.createShader(type);
    if (!shader) {
      console.error("Failed to create shader");
      return null;
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Updates the fragment shader with new source code.
   * @param {string} fragmentShaderSource - The new GLSL fragment shader code
   */
  updateShader(fragmentShaderSource) {
    if (!this.gl) return;

    // Create new shader program
    const vertShader = this.createShader(
      this.gl.VERTEX_SHADER,
      this.vertexShader
    );
    const fragShader = this.createShader(
      this.gl.FRAGMENT_SHADER,
      fragmentShaderSource
    );

    if (!vertShader || !fragShader) {
      console.error("Failed to create shaders");
      return;
    }

    const newProgram = this.gl.createProgram();
    this.gl.attachShader(newProgram, vertShader);
    this.gl.attachShader(newProgram, fragShader);
    this.gl.linkProgram(newProgram);

    if (!this.gl.getProgramParameter(newProgram, this.gl.LINK_STATUS)) {
      console.error(
        "Unable to initialize shader program:",
        this.gl.getProgramInfoLog(newProgram)
      );
      return;
    }

    // Clean up old program and switch to new one
    if (this.program) {
      this.gl.deleteProgram(this.program);
    }
    this.program = newProgram;

    // Update uniform locations for the new program
    this.updateUniformLocations();

    // Reapply current uniforms
    this.applyUniforms();
  }

  /**
   * Updates uniform values from a JSON string.
   * @param {string} uniformsStr - JSON string containing uniform values
   */
  updateUniforms(uniformsStr) {
    try {
      const newUniforms = uniformsStr ? JSON.parse(uniformsStr) : {};
      this._uniforms = newUniforms;

      // If we have an active program, update the uniform locations and apply uniforms
      if (this.program) {
        this.updateUniformLocations();
        this.applyUniforms();
      }
    } catch (error) {
      console.error("Error parsing uniforms JSON:", error);
    }
  }

  /**
   * Updates the locations of uniforms in the shader program.
   */
  updateUniformLocations() {
    this._uniformLocations.clear();

    // Get locations for all uniforms
    for (const name of Object.keys(this._uniforms)) {
      const location = this.gl.getUniformLocation(this.program, name);
      if (location !== null) {
        this._uniformLocations.set(name, location);
      } else {
        console.warn(`Uniform '${name}' not found in shader program`);
      }
    }

    // Also get locations for built-in uniforms
    const uResolution = this.gl.getUniformLocation(this.program, "uResolution");
    if (uResolution !== null) {
      this._uniformLocations.set("uResolution", uResolution);
    }

    const uTexture = this.gl.getUniformLocation(this.program, "uTexture");
    if (uTexture !== null) {
      this._uniformLocations.set("uTexture", uTexture);
    }

    // Add new built-in uniform locations
    const uTime = this.gl.getUniformLocation(this.program, "uTime");
    if (uTime !== null) {
      this._uniformLocations.set("uTime", uTime);
    }

    const uMouse = this.gl.getUniformLocation(this.program, "uMouse");
    if (uMouse !== null) {
      this._uniformLocations.set("uMouse", uMouse);
    }

    // Add new built-in uniform locations
    const uHasTexture = this.gl.getUniformLocation(this.program, "uHasTexture");
    if (uHasTexture !== null) {
      this._uniformLocations.set("uHasTexture", uHasTexture);
    }
  }

  /**
   * Applies current uniform values to the shader program.
   */
  applyUniforms() {
    if (!this.gl || !this.program) return;

    this.gl.useProgram(this.program);

    // Apply each uniform based on its type
    for (const [name, value] of Object.entries(this._uniforms)) {
      const location = this._uniformLocations.get(name);
      if (location === undefined) {
        //console.warn(`No location found for uniform '${name}'`);
        continue;
      }

      if (Array.isArray(value)) {
        switch (value.length) {
          case 2:
            this.gl.uniform2f(location, value[0], value[1]);
            break;
          case 3:
            this.gl.uniform3f(location, value[0], value[1], value[2]);
            break;
          case 4:
            this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
            break;
          case 9:
            this.gl.uniformMatrix3fv(location, false, new Float32Array(value));
            break;
          case 16:
            this.gl.uniformMatrix4fv(location, false, new Float32Array(value));
            break;
        }
      } else if (typeof value === "number") {
        if (Number.isInteger(value)) {
          this.gl.uniform1i(location, value);
        } else {
          this.gl.uniform1f(location, value);
        }
      } else if (typeof value === "boolean") {
        this.gl.uniform1i(location, value ? 1 : 0);
      }
    }
  }

  /**
   * Starts the render loop for continuous rendering.
   */
  startRenderLoop() {
    if (!this.gl || !this.program) {
      return;
    }

    const render = () => {
      if (!this.gl || !this.program) {
        if (this.animationFrame) {
          cancelAnimationFrame(this.animationFrame);
          this.animationFrame = null;
        }
        return;
      }

      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);

      this.gl.useProgram(this.program);

      // Only update texture if we have media element and it's an image
      // (video textures are updated in the timeupdate event)
      if (
        this.mediaElement &&
        this.texture &&
        this.mediaElement.tagName === "IMG"
      ) {
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        try {
          this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGBA,
            this.gl.RGBA,
            this.gl.UNSIGNED_BYTE,
            this.mediaElement
          );
          this._hasTexture = true;
        } catch (e) {
          console.warn("Failed to update texture:", e);
          this._hasTexture = false;
        }
      }

      // Set built-in uniforms
      const uResolution = this._uniformLocations.get("uResolution");
      if (uResolution) {
        this.gl.uniform2f(uResolution, this.canvas.width, this.canvas.height);
      }

      const uTexture = this._uniformLocations.get("uTexture");
      if (uTexture) {
        this.gl.uniform1i(uTexture, 0);
      }

      const uHasTexture = this._uniformLocations.get("uHasTexture");
      if (uHasTexture) {
        this.gl.uniform1i(uHasTexture, this._hasTexture ? 1 : 0);
      }

      // Update time uniform
      const uTime = this._uniformLocations.get("uTime");
      if (uTime) {
        const timeInSeconds = (performance.now() - this._startTime) / 1000.0;
        this.gl.uniform1f(uTime, timeInSeconds);
      }

      // Update mouse uniform
      const uMouse = this._uniformLocations.get("uMouse");
      if (uMouse) {
        this.gl.uniform4fv(uMouse, this._mouseData);
      }

      // Apply custom uniforms
      this.applyUniforms();

      // Draw
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

      this.animationFrame = requestAnimationFrame(render);
    };

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    render();
  }

  _onMouseMove(event) {
    const rect = this.getBoundingClientRect();
    // Normalize coordinates to [0,1]
    this._mouseData[0] = (event.clientX - rect.left) / rect.width;
    this._mouseData[1] = (event.clientY - rect.top) / rect.height;
    // If mouse is down, update click position too
    if (this._isMouseDown) {
      this._mouseData[2] = this._mouseData[0];
      this._mouseData[3] = this._mouseData[1];
    }
  }

  _onMouseDown(event) {
    this._isMouseDown = true;
    const rect = this.getBoundingClientRect();
    // Store click position
    this._mouseData[2] = (event.clientX - rect.left) / rect.width;
    this._mouseData[3] = (event.clientY - rect.top) / rect.height;
  }

  _onMouseUp() {
    this._isMouseDown = false;
    // Make click position negative when mouse is up
    this._mouseData[2] = -Math.abs(this._mouseData[2]);
    this._mouseData[3] = -Math.abs(this._mouseData[3]);
  }
}

// Register the custom element
customElements.define("media-shader", MediaShader);
