/**
 * A custom web component that applies WebGL shader effects to images and videos.
 * This component creates a canvas element that displays media content with customizable shader effects.
 *
 * @customElement
 * @extends HTMLElement
 *
 * @property {string} src - URL of the image or video to display
 * @property {string|string[]} fragmentShader - GLSL fragment shader code (string for single-pass, array for multi-pass)
 * @property {string} vertexShader - GLSL vertex shader code (for multi-pass, uses same vertex shader for all passes)
 * @property {string} width - Width of the canvas in pixels
 * @property {string} height - Height of the canvas in pixels
 * @property {string|string[]} uniforms - Uniform values (object for single-pass, array of objects for multi-pass)
 * @property {boolean} playing - Controls video playback when the media is a video
 * @property {boolean} muted - Controls video mute state when the media is a video
 * @property {number} volume - Controls video volume from 0 to 1 when the media is a video
 * @property {string} alt - Alternative text for accessibility
 * @property {string} loading - Loading mode ('eager' or 'lazy')
 */
class MediaShader extends HTMLElement {
  // Private fields
  #width = 300;
  #height = 150;
  #naturalWidth = null;
  #naturalHeight = null;
  #playing = false;
  #isLoaded = false;
  #intersectionObserver = null;
  #uniforms = {};
  #passUniforms = []; // Per-pass uniforms
  #uniformLocations = new Map();
  #passUniformLocations = []; // Per-pass uniform locations
  #hasTexture = false;
  #startTime = performance.now();
  #mouseData = new Float32Array(4);
  #isMouseDown = false;
  #framebuffers = [];
  #framebufferTextures = [];
  #isMultiPass = false;
  #fragmentShaders = [];
  #resizeObserver;
  #buffers = null;
  #videoFrameCallback = null;

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
    this.program = null; // For backward compatibility (single-pass)
    this.programs = []; // For multi-pass support
    this.animationFrame = null;

    // Add ResizeObserver for handling CSS-based resizing
    this.#resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Only update if dimensions actually changed
        const newWidth = entry.contentRect.width;
        const newHeight = entry.contentRect.height;

        // Skip if we have explicit attribute dimensions
        if (this.#width === null && this.#height === null) {
          this.updateCanvasSize();
        }
      }
    });

    // Default shaders
    this.defaultFragmentShader = `#version 300 es
            precision highp float;
            out vec4 fragColor;
            uniform sampler2D u_texture;
            uniform vec2 u_resolution;
            uniform float u_time;
            uniform vec4 u_mouse;
            uniform bool u_has_texture;
            in vec2 v_tex_coord;

            void main() {
                if (u_has_texture) {
                    fragColor = texture(u_texture, v_tex_coord);
                } else {
                    // For non-textured cases, show the animated gradient
                    vec2 uv = v_tex_coord;
                    uv.x *= u_resolution.x/u_resolution.y;
                    vec3 color = 0.5 + 0.5 * cos(u_time + uv.xyx + vec3(0,2,4));
                    fragColor = vec4(color, 1.0);
                }
            }
        `;

    this.defaultVertexShader = `#version 300 es
            precision highp float;
            in vec4 a_position;
            in vec2 a_tex_coord;
            out vec2 v_tex_coord;

            void main() {
                gl_Position = a_position;
                v_tex_coord = a_tex_coord;
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
      this.setAttribute(
        "fragment-shader",
        typeof value === "string" ? value : JSON.stringify(value)
      );
    } else {
      this.removeAttribute("fragment-shader");
    }
  }

  /**
   * Gets the vertex shader code.
   * @returns {string|null} The vertex shader code or null if not set
   */
  get vertexShader() {
    return this.getAttribute("vertex-shader");
  }

  set vertexShader(value) {
    if (value) {
      this.setAttribute("vertex-shader", value);
    } else {
      this.removeAttribute("vertex-shader");
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
   * Gets the muted state for video elements.
   * @returns {boolean} True if the video should be muted
   */
  get muted() {
    return this.getAttribute("muted") !== "false";
  }

  set muted(value) {
    const shouldMute = value !== false && value !== "false";
    if (shouldMute) {
      this.setAttribute("muted", "");
    } else {
      this.setAttribute("muted", "false");
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
   * Gets the volume level for video elements.
   * @returns {number} The volume level from 0 to 1, defaults to 1
   */
  get volume() {
    const value = this.getAttribute("volume");
    if (value === null) return 1;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 1 : Math.max(0, Math.min(1, parsed));
  }

  set volume(value) {
    if (value !== null && value !== undefined) {
      const clamped = Math.max(0, Math.min(1, parseFloat(value) || 0));
      this.setAttribute("volume", clamped.toString());
    } else {
      this.removeAttribute("volume");
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
    this.#resizeObserver.observe(this);

    // Set up intersection observer for both lazy and eager loading
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // Initialize if not loaded, regardless of loading mode
            if (!this.#isLoaded) {
              this.initializeComponent();
            }
          } else {
            // Clean up when out of view, regardless of loading mode
            if (this.#isLoaded) {
              this.cleanup();
            }
          }
        });
      },
      {
        rootMargin: "50px", // Start loading slightly before element comes into view
      }
    );
    this.#intersectionObserver.observe(this);

    // For eager loading, initialize immediately
    if (this.loading === "eager" && !this.#isLoaded) {
      this.initializeComponent();
    }

    // Add mouse event listeners
    this.addEventListener("mousemove", this.#onMouseMove);
    this.addEventListener("mousedown", this.#onMouseDown);
    this.addEventListener("mouseup", this.#onMouseUp);
    // Optional: handle mouse leaving the element
    this.addEventListener("mouseleave", this.#onMouseUp);
  }

  /**
   * Initializes the component by setting up WebGL and loading media.
   */
  initializeComponent() {
    if (this.#isLoaded) return;

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
    this.#isLoaded = true;

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
      this.#width = width;
      this.style.width = width;
      this.updateCanvasSize();
    }
    if (height) {
      this.#height = height;
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
    if (!this.#isLoaded) return;

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
      if (this.#buffers) {
        if (this.#buffers.position) {
          this.gl.deleteBuffer(this.#buffers.position);
        }
        if (this.#buffers.texCoord) {
          this.gl.deleteBuffer(this.#buffers.texCoord);
        }
        this.#buffers = null;
      }

      // Delete textures
      if (this.texture) {
        this.gl.deleteTexture(this.texture);
        this.texture = null;
      }

      // Clean up framebuffers
      this.cleanupFramebuffers();

      // Delete shader program
      if (this.program) {
        this.gl.deleteProgram(this.program);
        this.program = null;
      }

      // Delete multi-pass shader programs
      for (const program of this.programs) {
        this.gl.deleteProgram(program);
      }
      this.programs = [];

      // Clear all attributes and uniforms
      this.#uniformLocations.clear();
      this.#passUniformLocations = [];

      // Reset multi-pass flags
      this.#isMultiPass = false;
      this.#fragmentShaders = [];
      this.#passUniforms = [];

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

    this.#isLoaded = false;
  }

  /**
   * Lifecycle callback when the element is removed from the document.
   * Cleans up resources and stops rendering.
   */
  disconnectedCallback() {
    // Stop observing size changes
    this.#resizeObserver.disconnect();

    // Disconnect intersection observer
    if (this.#intersectionObserver) {
      this.#intersectionObserver.disconnect();
      this.#intersectionObserver = null;
    }

    // Clean up resources
    this.cleanup();

    // Clean up event listeners
    this.removeEventListener("mousemove", this.#onMouseMove);
    this.removeEventListener("mousedown", this.#onMouseDown);
    this.removeEventListener("mouseup", this.#onMouseUp);
    this.removeEventListener("mouseleave", this.#onMouseUp);
  }

  /**
   * Specifies which attributes should be observed for changes.
   * @returns {string[]} Array of attribute names to observe
   */
  static get observedAttributes() {
    return [
      "src",
      "fragment-shader",
      "vertex-shader",
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
      "volume",
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
      case "vertex-shader":
        this.updateShader(
          this.getAttribute("fragment-shader") || this.defaultFragmentShader
        );
        break;
      case "width":
        this.#width = newValue;
        this.style.width = newValue;
        this.updateCanvasSize();
        break;
      case "height":
        this.#height = newValue;
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
              this.#playing = true;
            } else {
              this.mediaElement.pause();
              this.#playing = false;
            }
          } catch (e) {
            console.warn("Video playback control failed:", e);
            this.#playing = false;
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
      case "volume":
        if (this.mediaElement?.tagName === "VIDEO") {
          const volumeValue = newValue ? parseFloat(newValue) : 1;
          this.mediaElement.volume = isNaN(volumeValue)
            ? 1
            : Math.max(0, Math.min(1, volumeValue));
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
      this.#naturalWidth = naturalWidth;
      this.#naturalHeight = naturalHeight;
      // Set aspect ratio on the host element
      this.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`;
    }

    let finalWidth = this.#width;
    let finalHeight = this.#height;
    let rect = this.getBoundingClientRect();

    if (this.#width) {
      finalWidth = rect.width;
    }
    if (this.#height) {
      finalHeight = rect.height;
    }

    // Fallback to reasonable defaults if dimensions are still zero
    if (finalWidth <= 0) {
      finalWidth = 800; // Default width
    }
    if (finalHeight <= 0) {
      finalHeight = 600; // Default height
    }

    // Get device pixel ratio for high DPI displays
    const dpr = window.devicePixelRatio || 1;

    // Set the canvas dimensions
    this.canvas.width = Math.round(finalWidth * dpr);
    this.canvas.height = Math.round(finalHeight * dpr);

    // Update WebGL viewport
    if (this.gl) {
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

      // Resize framebuffers if they exist
      if (this.#framebuffers.length > 0) {
        this.resizeFramebuffers();
      }
      // If we have multi-pass shaders but no framebuffers, create them now
      else if (this.#isMultiPass && this.programs.length > 1) {
        this.createFramebuffers(this.programs.length - 1);
      }
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
      this.#hasTexture = false;
      return;
    }

    if (!this.gl) return;

    const isVideo = /\.(mp4|webm|ogg)$/i.test(src);

    // Clean up previous media element
    if (this.mediaElement) {
      if (this.mediaElement.tagName === "VIDEO") {
        this.mediaElement.pause();
        if ("requestVideoFrameCallback" in this.mediaElement) {
          this.mediaElement.cancelVideoFrameCallback(this.#videoFrameCallback);
        }
      }
      this.mediaElement.remove();
      this.#hasTexture = false;
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

          // Set volume from attribute
          const volumeAttr = this.getAttribute("volume");
          if (volumeAttr !== null) {
            const volumeValue = parseFloat(volumeAttr);
            this.mediaElement.volume = isNaN(volumeValue)
              ? 1
              : Math.max(0, Math.min(1, volumeValue));
          }

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
              this.#playing = shouldPlay;

              if (shouldPlay) {
                try {
                  await this.mediaElement.play();
                } catch (e) {
                  console.warn("Initial video play failed:", e);
                  this.#playing = false;
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
            if (this.#playing && this.isConnected) {
              if ("requestVideoFrameCallback" in this.mediaElement) {
                this.#videoFrameCallback =
                  this.mediaElement.requestVideoFrameCallback(
                    updateVideoTexture
                  );
              } else {
                this.#videoFrameCallback =
                  requestAnimationFrame(updateVideoTexture);
              }
            }
          };

          // Set up video texture update using requestVideoFrameCallback if available
          if ("requestVideoFrameCallback" in this.mediaElement) {
            this.#videoFrameCallback =
              this.mediaElement.requestVideoFrameCallback(updateVideoTexture);
          } else {
            this.#videoFrameCallback =
              requestAnimationFrame(updateVideoTexture);
          }

          // Add event listeners for play/pause
          this.mediaElement.addEventListener("play", () => {
            this.#playing = true;
            // Restart frame updates
            if ("requestVideoFrameCallback" in this.mediaElement) {
              this.#videoFrameCallback =
                this.mediaElement.requestVideoFrameCallback(updateVideoTexture);
            } else {
              this.#videoFrameCallback =
                requestAnimationFrame(updateVideoTexture);
            }
          });

          this.mediaElement.addEventListener("pause", () => {
            this.#playing = false;
            // Cancel frame updates
            if ("requestVideoFrameCallback" in this.mediaElement) {
              this.mediaElement.cancelVideoFrameCallback(
                this.#videoFrameCallback
              );
            } else {
              cancelAnimationFrame(this.#videoFrameCallback);
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
            this.#hasTexture = true;

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
      this.#hasTexture = false;
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

    this.#hasTexture = true;
  }

  /**
   * Initializes WebGL context, shaders, and buffers.
   */
  initWebGL() {
    if (!this.gl) return;

    // Flip texture Y coordinate to match OpenGL coordinate system
    // This makes both v_tex_coord and manual gl_FragCoord calculations consistent
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);

    // Get custom vertex shader or use default
    const customVertexShader = this.getAttribute("vertex-shader");
    const vertexShaderSource = customVertexShader || this.defaultVertexShader;

    // Create shader program
    const vertShader = this.createShader(
      this.gl.VERTEX_SHADER,
      vertexShaderSource
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
    const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]); // Changed from [0, 1, 1, 1, 0, 0, 1, 0]

    // Create and bind position buffer
    const positionBuffer = this.gl.createBuffer();
    if (!positionBuffer) {
      console.error("Failed to create position buffer");
      return;
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, positionBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

    const aPosition = this.gl.getAttribLocation(this.program, "a_position");
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

    const aTexCoord = this.gl.getAttribLocation(this.program, "a_tex_coord");
    this.gl.enableVertexAttribArray(aTexCoord);
    this.gl.vertexAttribPointer(aTexCoord, 2, this.gl.FLOAT, false, 0, 0);

    // Store buffer references for cleanup
    this.#buffers = {
      position: positionBuffer,
      texCoord: texCoordBuffer,
    };

    // Initialize uniform locations only for built-in uniforms during initialization
    // Custom uniforms will be handled when the custom shader is loaded
    this.updateBuiltInUniformLocations();

    // Use the program
    this.gl.useProgram(this.program);

    // Set up initial texture state
    const uTexture = this.#uniformLocations.get("u_texture");
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
      console.error("Shader source:", source);
      this.gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * Creates framebuffers for multi-pass rendering.
   * @param {number} count - Number of framebuffers to create
   */
  createFramebuffers(count) {
    if (!this.gl) return;

    // Ensure canvas has valid dimensions before creating framebuffers
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.updateCanvasSize();
      // If still zero after update, don't create framebuffers
      if (this.canvas.width === 0 || this.canvas.height === 0) {
        console.warn("Cannot create framebuffers: canvas has zero dimensions");
        return;
      }
    }

    // Clean up existing framebuffers
    this.cleanupFramebuffers();

    for (let i = 0; i < count; i++) {
      const framebuffer = this.gl.createFramebuffer();
      const texture = this.gl.createTexture();

      if (!framebuffer || !texture) {
        console.error("Failed to create framebuffer or texture");
        continue;
      }

      // Configure the texture
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.canvas.width,
        this.canvas.height,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        null
      );

      // Set texture parameters
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

      // Attach texture to framebuffer
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
      this.gl.framebufferTexture2D(
        this.gl.FRAMEBUFFER,
        this.gl.COLOR_ATTACHMENT0,
        this.gl.TEXTURE_2D,
        texture,
        0
      );

      // Check framebuffer completeness
      if (
        this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !==
        this.gl.FRAMEBUFFER_COMPLETE
      ) {
        console.error(`Framebuffer ${i} is not complete`);
        this.gl.deleteFramebuffer(framebuffer);
        this.gl.deleteTexture(texture);
        continue;
      }

      this.#framebuffers.push(framebuffer);
      this.#framebufferTextures.push(texture);
    }

    // Unbind framebuffer
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
  }

  /**
   * Cleans up framebuffers and their textures.
   */
  cleanupFramebuffers() {
    if (!this.gl) return;

    // Delete framebuffers
    for (const framebuffer of this.#framebuffers) {
      this.gl.deleteFramebuffer(framebuffer);
    }
    this.#framebuffers = [];

    // Delete framebuffer textures
    for (const texture of this.#framebufferTextures) {
      this.gl.deleteTexture(texture);
    }
    this.#framebufferTextures = [];
  }

  /**
   * Resizes framebuffers when canvas size changes.
   */
  resizeFramebuffers() {
    if (!this.gl || this.#framebuffers.length === 0) return;

    // Resize each framebuffer texture
    for (let i = 0; i < this.#framebufferTextures.length; i++) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.#framebufferTextures[i]);
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.canvas.width,
        this.canvas.height,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        null
      );
    }

    // Unbind texture
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
  }

  /**
   * Updates the fragment shader with new source code.
   * @param {string|string[]} fragmentShaderSource - The new GLSL fragment shader code (string for single-pass, array for multi-pass)
   */
  updateShader(fragmentShaderSource) {
    if (!this.gl) return;

    // Skip empty or whitespace-only strings
    if (!fragmentShaderSource || fragmentShaderSource.trim() === "") {
      console.warn("Empty fragment shader source provided");
      return;
    }

    try {
      // Try to parse as JSON first to detect if it's an array
      const parsed = JSON.parse(fragmentShaderSource);
      if (Array.isArray(parsed)) {
        // Multi-pass shaders
        this.updateMultiPassShaders(parsed);
        return;
      }
    } catch (e) {
      // Not JSON, treat as single shader string
    }

    // Single-pass shader
    this.#isMultiPass = false;
    this.cleanupFramebuffers();

    // Clean up multi-pass programs
    for (const program of this.programs) {
      this.gl.deleteProgram(program);
    }
    this.programs = [];
    this.#passUniformLocations = [];

    // Get custom vertex shader or use default
    const customVertexShader = this.getAttribute("vertex-shader");
    const vertexShaderSource = customVertexShader || this.defaultVertexShader;

    // Create new shader program
    const vertShader = this.createShader(
      this.gl.VERTEX_SHADER,
      vertexShaderSource
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
   * @param {string} uniformsStr - JSON string containing uniform values (object for single-pass, array for multi-pass)
   */
  updateUniforms(uniformsStr) {
    try {
      const parsed = uniformsStr ? JSON.parse(uniformsStr) : {};

      if (Array.isArray(parsed)) {
        // Multi-pass uniforms
        this.#passUniforms = parsed;
        this.#uniforms = {}; // Clear global uniforms when using per-pass uniforms
        console.log("updateUniforms (multi-pass)", this.#passUniforms);

        // Update uniform locations and apply uniforms for multi-pass
        if (this.#isMultiPass && this.programs.length > 0) {
          this.updatePassUniformLocations();
        }
      } else {
        // Single-pass uniforms
        this.#uniforms = parsed;
        this.#passUniforms = []; // Clear per-pass uniforms when using global uniforms
        console.log("updateUniforms (single-pass)", this.#uniforms);

        // If we have an active program, update the uniform locations and apply uniforms
        if (this.program) {
          this.updateUniformLocations();
          this.applyUniforms();
        }
      }
    } catch (error) {
      console.error("Error parsing uniforms JSON:", error);
    }
  }

  /**
   * Updates multi-pass shader programs from an array of shaders.
   * @param {string[]} shaders - Array of fragment shader strings
   */
  updateMultiPassShaders(shaders) {
    if (!Array.isArray(shaders) || shaders.length === 0) {
      console.error("fragment-shaders must be a non-empty array");
      return;
    }

    console.log(`Setting up multi-pass shaders: ${shaders.length} passes`);
    this.#fragmentShaders = shaders;
    this.#isMultiPass = true;

    // Clean up existing single-pass program
    if (this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }

    // Clean up existing multi-pass programs
    for (const program of this.programs) {
      if (this.gl) {
        this.gl.deleteProgram(program);
      }
    }
    this.programs = [];
    this.#passUniformLocations = [];

    if (!this.gl) return;

    // Get custom vertex shader or use default
    const customVertexShader = this.getAttribute("vertex-shader");
    const vertexShaderSource = customVertexShader || this.defaultVertexShader;

    // Create shader programs for each pass
    for (let i = 0; i < shaders.length; i++) {
      const vertShader = this.createShader(
        this.gl.VERTEX_SHADER,
        vertexShaderSource
      );
      const fragShader = this.createShader(this.gl.FRAGMENT_SHADER, shaders[i]);

      if (!vertShader || !fragShader) {
        console.error(`Failed to create shaders for pass ${i}`);
        if (vertShader) this.gl.deleteShader(vertShader);
        if (fragShader) this.gl.deleteShader(fragShader);
        continue;
      }

      const program = this.gl.createProgram();
      if (!program) {
        console.error(`Failed to create program for pass ${i}`);
        this.gl.deleteShader(vertShader);
        this.gl.deleteShader(fragShader);
        continue;
      }

      this.gl.attachShader(program, vertShader);
      this.gl.attachShader(program, fragShader);
      this.gl.linkProgram(program);

      if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
        console.error(
          `Failed to link program for pass ${i}:`,
          this.gl.getProgramInfoLog(program)
        );
        this.gl.deleteShader(vertShader);
        this.gl.deleteShader(fragShader);
        this.gl.deleteProgram(program);
        continue;
      } else {
        console.log(`Successfully created program for pass ${i}`);
      }

      // Clean up shaders after linking
      this.gl.deleteShader(vertShader);
      this.gl.deleteShader(fragShader);

      this.programs.push(program);
      this.#passUniformLocations.push(new Map());
    }

    // Create framebuffers for intermediate passes (need one less than number of passes)
    if (this.programs.length > 1) {
      this.createFramebuffers(this.programs.length - 1);
    }

    // Update uniform locations for all passes
    this.updatePassUniformLocations();

    console.log(
      `Created ${this.programs.length} shader programs for multi-pass rendering`
    );

    // If no programs were successfully created, reset to single-pass mode
    if (this.programs.length === 0) {
      console.warn(
        "No shader programs were successfully created, resetting to single-pass mode"
      );
      this.#isMultiPass = false;
      this.#fragmentShaders = [];
      return;
    }
  }

  /**
   * Updates uniform locations for all passes.
   */
  updatePassUniformLocations() {
    if (!this.gl || !this.#isMultiPass) return;

    // Update uniform locations for each pass
    for (let passIndex = 0; passIndex < this.programs.length; passIndex++) {
      const program = this.programs[passIndex];
      const uniformLocations = this.#passUniformLocations[passIndex];

      if (!uniformLocations) continue;

      uniformLocations.clear();

      // Get locations for built-in uniforms
      const builtInUniforms = [
        "u_texture",
        "u_resolution",
        "u_time",
        "u_mouse",
        "u_has_texture",
      ];
      for (const uniformName of builtInUniforms) {
        const location = this.gl.getUniformLocation(program, uniformName);
        if (location !== null) {
          uniformLocations.set(uniformName, location);
        }
      }

      // Get locations for global uniforms
      for (const uniformName of Object.keys(this.#uniforms)) {
        const location = this.gl.getUniformLocation(program, uniformName);
        if (location !== null) {
          uniformLocations.set(uniformName, location);
        }
      }

      // Get locations for pass-specific uniforms
      if (this.#passUniforms[passIndex]) {
        for (const uniformName of Object.keys(this.#passUniforms[passIndex])) {
          const location = this.gl.getUniformLocation(program, uniformName);
          if (location !== null) {
            uniformLocations.set(uniformName, location);
          }
        }
      }
    }
  }

  /**
   * Updates the locations of built-in uniforms only (used during initialization).
   */
  updateBuiltInUniformLocations() {
    // Only get locations for built-in uniforms during initialization
    const builtInUniforms = [
      "u_resolution",
      "u_texture",
      "u_time",
      "u_mouse",
      "u_has_texture",
    ];

    for (const uniformName of builtInUniforms) {
      const location = this.gl.getUniformLocation(this.program, uniformName);
      if (location !== null) {
        this.#uniformLocations.set(uniformName, location);
      }
    }
  }

  /**
   * Updates the locations of uniforms in the shader program.
   */
  updateUniformLocations() {
    this.#uniformLocations.clear();

    // Get locations for all uniforms
    for (const name of Object.keys(this.#uniforms)) {
      const location = this.gl.getUniformLocation(this.program, name);
      if (location !== null) {
        this.#uniformLocations.set(name, location);
      } else {
        // Only warn about missing uniforms if we're not using the default shader
        // During initialization, uniforms may not exist in the default shader
        const isDefaultShader =
          this.fragmentShader === this.defaultFragmentShader ||
          !this.getAttribute("fragment-shader");
        if (!isDefaultShader) {
          console.warn(`Uniform '${name}' not found in shader program`);
        }
      }
    }

    // Also get locations for built-in uniforms
    const uResolution = this.gl.getUniformLocation(
      this.program,
      "u_resolution"
    );
    if (uResolution !== null) {
      this.#uniformLocations.set("u_resolution", uResolution);
    }

    const uTexture = this.gl.getUniformLocation(this.program, "u_texture");
    if (uTexture !== null) {
      this.#uniformLocations.set("u_texture", uTexture);
    }

    // Add new built-in uniform locations
    const uTime = this.gl.getUniformLocation(this.program, "u_time");
    if (uTime !== null) {
      this.#uniformLocations.set("u_time", uTime);
    }

    const uMouse = this.gl.getUniformLocation(this.program, "u_mouse");
    if (uMouse !== null) {
      this.#uniformLocations.set("u_mouse", uMouse);
    }

    // Add new built-in uniform locations
    const uHasTexture = this.gl.getUniformLocation(
      this.program,
      "u_has_texture"
    );
    if (uHasTexture !== null) {
      this.#uniformLocations.set("u_has_texture", uHasTexture);
    }
  }

  /**
   * Applies current uniform values to the shader program.
   */
  applyUniforms() {
    if (!this.gl || !this.program) return;

    this.gl.useProgram(this.program);

    // Apply each uniform based on its type
    for (const [name, value] of Object.entries(this.#uniforms)) {
      const location = this.#uniformLocations.get(name);
      if (location === undefined) {
        //console.warn(`No location found for uniform '${name}'`);
        continue;
      }

      if (Array.isArray(value)) {
        // Check if this is an array of arrays (uniform array) vs flat array (single vector)
        let isUniformArray = value.every((item) => Array.isArray(item));

        // Also check shader source to detect uniform arrays like bool[3], int[5], etc.
        if (!isUniformArray) {
          const shaderSource =
            this.fragmentShader || this.getAttribute("fragment-shader") || "";
          const uniformArrayRegex = new RegExp(
            `uniform\\s+\\w+\\s+${name}\\s*\\[`,
            "g"
          );
          isUniformArray = uniformArrayRegex.test(shaderSource);
        }

        const flatValue = isUniformArray ? value.flat() : value;
        const len = flatValue.length;

        if (isUniformArray) {
          // Handle uniform arrays (vec2[], vec3[], vec4[], etc.)
          // First try to detect the actual uniform type from shader source
          const shaderSource =
            this.fragmentShader || this.getAttribute("fragment-shader") || "";
          const uniformRegex = new RegExp(
            `uniform\\s+(\\w+)\\s+${name}\\s*\\[`,
            "g"
          );
          const match = uniformRegex.exec(shaderSource);

          let elementSize = value[0].length; // Default to JavaScript array size

          if (match) {
            const uniformType = match[1];
            // Override element size based on shader declaration
            switch (uniformType) {
              case "float":
              case "int":
              case "bool":
                elementSize = 1;
                break;
              case "vec2":
              case "ivec2":
              case "bvec2":
                elementSize = 2;
                break;
              case "vec3":
              case "ivec3":
              case "bvec3":
                elementSize = 3;
                break;
              case "vec4":
              case "ivec4":
              case "bvec4":
                elementSize = 4;
                break;
            }
          }

          if (elementSize === 1) {
            // float array
            this.gl.uniform1fv(location, new Float32Array(flatValue));
          } else if (elementSize === 2) {
            // vec2 array - take first 2 elements of each sub-array
            const vec2Data = value.flatMap((arr) => arr.slice(0, 2));
            this.gl.uniform2fv(location, new Float32Array(vec2Data));
          } else if (elementSize === 3) {
            // vec3 array - take first 3 elements of each sub-array
            const vec3Data = value.flatMap((arr) => arr.slice(0, 3));
            this.gl.uniform3fv(location, new Float32Array(vec3Data));
          } else if (elementSize === 4) {
            // vec4 array
            this.gl.uniform4fv(location, new Float32Array(flatValue));
          } else {
            console.warn(
              `Unsupported uniform array element size: ${elementSize}`
            );
          }
        } else {
          // Handle single vectors, matrices, and scalar arrays
          if (len === 1) {
            this.gl.uniform1f(location, flatValue[0]);
          } else if (len === 2) {
            this.gl.uniform2f(location, flatValue[0], flatValue[1]);
          } else if (len === 3) {
            this.gl.uniform3f(
              location,
              flatValue[0],
              flatValue[1],
              flatValue[2]
            );
          } else if (len === 4) {
            this.gl.uniform4f(
              location,
              flatValue[0],
              flatValue[1],
              flatValue[2],
              flatValue[3]
            );
          } else if (len === 9) {
            // 3x3 matrix
            this.gl.uniformMatrix3fv(
              location,
              false,
              new Float32Array(flatValue)
            );
          } else if (len === 16) {
            // 4x4 matrix
            this.gl.uniformMatrix4fv(
              location,
              false,
              new Float32Array(flatValue)
            );
          } else {
            // Handle arbitrary-length arrays as scalar uniform arrays
            // Check if array contains booleans or integers
            const isBoolean = value.every((v) => typeof v === "boolean");
            const isInteger = value.every(
              (v) => typeof v === "number" && Number.isInteger(v)
            );

            if (isBoolean || isInteger) {
              // Convert booleans to integers (0/1) and pass as integer array
              const intArray = value.map((v) =>
                typeof v === "boolean" ? (v ? 1 : 0) : v
              );
              this.gl.uniform1iv(location, new Int32Array(intArray));
            } else {
              // Assume float array for any other numeric values
              this.gl.uniform1fv(location, new Float32Array(flatValue));
            }
          }
        }
      } else if (typeof value === "number") {
        if (Number.isInteger(value)) {
          const regex = new RegExp(`uniform(.*)float(.*)${name}\\s*;`);
          const match = regex.exec(this.fragmentShader); //match for this pass
          if (match) {
            this.gl.uniform1f(location, value);
          } else {
            this.gl.uniform1i(location, value);
          }
        } else {
          this.gl.uniform1f(location, value);
        }
      } else if (typeof value === "boolean") {
        this.gl.uniform1i(location, value ? 1 : 0);
      }
    }
  }

  /**
   * Applies uniforms for a specific pass.
   * @param {number} passIndex - The index of the pass
   * @param {WebGLProgram} program - The shader program for this pass
   * @param {Map} uniformLocations - The uniform locations for this pass
   */
  applyPassUniforms(passIndex, program, uniformLocations) {
    if (!this.gl || !program || !uniformLocations) return;

    this.gl.useProgram(program);

    // Helper function to set uniform values
    const setUniform = (name, location, value) => {
      if (Array.isArray(value)) {
        // Check if this is an array of arrays (uniform array) vs flat array (single vector)
        let isUniformArray = value.every((item) => Array.isArray(item));

        // Also check shader source to detect uniform arrays like bool[3], int[5], etc.
        if (!isUniformArray) {
          const shaderSource = this.#fragmentShaders[passIndex] || "";
          const uniformArrayRegex = new RegExp(
            `uniform\\s+\\w+\\s+${name}\\s*\\[`,
            "g"
          );
          isUniformArray = uniformArrayRegex.test(shaderSource);
        }

        const flatValue = isUniformArray ? value.flat() : value;
        const len = flatValue.length;

        if (isUniformArray) {
          // Handle uniform arrays (vec2[], vec3[], vec4[], etc.)
          // First try to detect the actual uniform type from shader source
          const shaderSource = this.#fragmentShaders[passIndex] || "";
          const uniformRegex = new RegExp(
            `uniform\\s+(\\w+)\\s+${name}\\s*\\[`,
            "g"
          );
          const match = uniformRegex.exec(shaderSource);

          let elementSize = value[0].length; // Default to JavaScript array size

          if (match) {
            const uniformType = match[1];
            // Override element size based on shader declaration
            switch (uniformType) {
              case "float":
              case "int":
              case "bool":
                elementSize = 1;
                break;
              case "vec2":
              case "ivec2":
              case "bvec2":
                elementSize = 2;
                break;
              case "vec3":
              case "ivec3":
              case "bvec3":
                elementSize = 3;
                break;
              case "vec4":
              case "ivec4":
              case "bvec4":
                elementSize = 4;
                break;
            }
          }

          if (elementSize === 1) {
            // float array
            this.gl.uniform1fv(location, new Float32Array(flatValue));
          } else if (elementSize === 2) {
            // vec2 array - take first 2 elements of each sub-array
            const vec2Data = value.flatMap((arr) => arr.slice(0, 2));
            this.gl.uniform2fv(location, new Float32Array(vec2Data));
          } else if (elementSize === 3) {
            // vec3 array - take first 3 elements of each sub-array
            const vec3Data = value.flatMap((arr) => arr.slice(0, 3));
            this.gl.uniform3fv(location, new Float32Array(vec3Data));
          } else if (elementSize === 4) {
            // vec4 array
            this.gl.uniform4fv(location, new Float32Array(flatValue));
          } else {
            console.warn(
              `Unsupported uniform array element size: ${elementSize}`
            );
          }
        } else {
          // Handle single vectors, matrices, and scalar arrays
          if (len === 1) {
            this.gl.uniform1f(location, flatValue[0]);
          } else if (len === 2) {
            this.gl.uniform2f(location, flatValue[0], flatValue[1]);
          } else if (len === 3) {
            this.gl.uniform3f(
              location,
              flatValue[0],
              flatValue[1],
              flatValue[2]
            );
          } else if (len === 4) {
            this.gl.uniform4f(
              location,
              flatValue[0],
              flatValue[1],
              flatValue[2],
              flatValue[3]
            );
          } else if (len === 9) {
            // 3x3 matrix
            this.gl.uniformMatrix3fv(
              location,
              false,
              new Float32Array(flatValue)
            );
          } else if (len === 16) {
            // 4x4 matrix
            this.gl.uniformMatrix4fv(
              location,
              false,
              new Float32Array(flatValue)
            );
          } else {
            // Handle arbitrary-length arrays as scalar uniform arrays
            // Check if array contains booleans or integers
            const isBoolean = value.every((v) => typeof v === "boolean");
            const isInteger = value.every(
              (v) => typeof v === "number" && Number.isInteger(v)
            );

            if (isBoolean || isInteger) {
              // Convert booleans to integers (0/1) and pass as integer array
              const intArray = value.map((v) =>
                typeof v === "boolean" ? (v ? 1 : 0) : v
              );
              this.gl.uniform1iv(location, new Int32Array(intArray));
            } else {
              // Assume float array for any other numeric values
              this.gl.uniform1fv(location, new Float32Array(flatValue));
            }
          }
        }
      } else if (typeof value === "number") {
        if (Number.isInteger(value)) {
          const regex = new RegExp(`uniform(.*)float(.*)${name}\\s*;`);
          const match = regex.exec(this.#fragmentShaders[passIndex]); //match for this pass
          if (match) {
            this.gl.uniform1f(location, value);
          } else {
            this.gl.uniform1i(location, value);
          }
        } else {
          this.gl.uniform1f(location, value);
        }
      } else if (typeof value === "boolean") {
        this.gl.uniform1i(location, value ? 1 : 0);
      }
    };

    // Apply global uniforms
    for (const [name, value] of Object.entries(this.#uniforms)) {
      const location = uniformLocations.get(name);
      if (location !== undefined) {
        setUniform(name, location, value);
      }
    }

    // Apply pass-specific uniforms
    if (this.#passUniforms[passIndex]) {
      for (const [name, value] of Object.entries(
        this.#passUniforms[passIndex]
      )) {
        const location = uniformLocations.get(name);
        if (location !== undefined) {
          setUniform(name, location, value);
        }
      }
    }

    // Apply built-in uniforms
    const uResolution = uniformLocations.get("u_resolution");
    if (uResolution) {
      this.gl.uniform2f(uResolution, this.canvas.width, this.canvas.height);
    }

    const uTime = uniformLocations.get("u_time");
    if (uTime) {
      const timeInSeconds = (performance.now() - this.#startTime) / 1000.0;
      this.gl.uniform1f(uTime, timeInSeconds);
    }

    const uMouse = uniformLocations.get("u_mouse");
    if (uMouse) {
      this.gl.uniform4fv(uMouse, this.#mouseData);
    }

    const uHasTexture = uniformLocations.get("u_has_texture");
    if (uHasTexture) {
      this.gl.uniform1i(uHasTexture, this.#hasTexture ? 1 : 0);
    }

    const uTexture = uniformLocations.get("u_texture");
    if (uTexture) {
      this.gl.uniform1i(uTexture, 0);
    }
  }

  /**
   * Starts the render loop for continuous rendering.
   */
  startRenderLoop() {
    if (
      !this.gl ||
      (!this.program && (!this.#isMultiPass || this.programs.length === 0))
    ) {
      console.warn("Cannot start render loop: no valid shader programs");
      return;
    }

    const render = () => {
      if (
        !this.gl ||
        (!this.program && (!this.#isMultiPass || this.programs.length === 0))
      ) {
        if (this.animationFrame) {
          cancelAnimationFrame(this.animationFrame);
          this.animationFrame = null;
        }
        return;
      }

      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

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
          this.#hasTexture = true;
        } catch (e) {
          console.warn("Failed to update texture:", e);
          this.#hasTexture = false;
        }
      }

      if (this.#isMultiPass && this.programs.length > 0) {
        // Multi-pass rendering
        this.renderMultiPass();
      } else {
        // Single-pass rendering (backward compatibility)
        this.renderSinglePass();
      }

      this.animationFrame = requestAnimationFrame(render);
    };

    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    render();
  }

  /**
   * Renders a single pass (backward compatibility).
   */
  renderSinglePass() {
    if (!this.gl || !this.program) return;

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.useProgram(this.program);

    // Set built-in uniforms
    const uResolution = this.#uniformLocations.get("u_resolution");
    if (uResolution) {
      this.gl.uniform2f(uResolution, this.canvas.width, this.canvas.height);
    }

    const uTexture = this.#uniformLocations.get("u_texture");
    if (uTexture) {
      this.gl.uniform1i(uTexture, 0);
    }

    const uHasTexture = this.#uniformLocations.get("u_has_texture");
    if (uHasTexture) {
      this.gl.uniform1i(uHasTexture, this.#hasTexture ? 1 : 0);
    }

    // Update time uniform
    const uTime = this.#uniformLocations.get("u_time");
    if (uTime) {
      const timeInSeconds = (performance.now() - this.#startTime) / 1000.0;
      this.gl.uniform1f(uTime, timeInSeconds);
    }

    // Update mouse uniform
    const uMouse = this.#uniformLocations.get("u_mouse");
    if (uMouse) {
      this.gl.uniform4fv(uMouse, this.#mouseData);
    }

    // Bind texture
    this.gl.activeTexture(this.gl.TEXTURE0);
    if (this.texture && this.#hasTexture) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    } else {
      // Create a simple texture if no media
      if (!this.texture) {
        this.texture = this.createDummyTexture();
      }
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    }

    // Apply custom uniforms
    this.applyUniforms();

    // Draw
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Renders multiple passes sequentially.
   */
  renderMultiPass() {
    if (!this.gl || this.programs.length === 0) return;

    for (let passIndex = 0; passIndex < this.programs.length; passIndex++) {
      const program = this.programs[passIndex];
      const uniformLocations = this.#passUniformLocations[passIndex];
      const isLastPass = passIndex === this.programs.length - 1;

      // Set render target
      if (isLastPass) {
        // Final pass renders to canvas
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      } else {
        // Intermediate pass renders to framebuffer
        this.gl.bindFramebuffer(
          this.gl.FRAMEBUFFER,
          this.#framebuffers[passIndex]
        );
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      }

      // Set input texture
      this.gl.activeTexture(this.gl.TEXTURE0);

      if (passIndex === 0) {
        // First pass uses original texture or default
        if (this.texture && this.#hasTexture) {
          this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        } else {
          // Create a simple texture if no media
          if (!this.texture) {
            this.texture = this.createDummyTexture();
          }
          this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        }
      } else {
        // Subsequent passes use output from previous pass
        this.gl.bindTexture(
          this.gl.TEXTURE_2D,
          this.#framebufferTextures[passIndex - 1]
        );
      }

      // Apply uniforms for this pass
      this.applyPassUniforms(passIndex, program, uniformLocations);

      // Draw
      this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  /**
   * Creates a dummy texture for cases where no media is loaded.
   * @returns {WebGLTexture} A 1x1 transparent texture
   */
  createDummyTexture() {
    if (!this.gl) return null;

    const texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
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

    return texture;
  }

  #onMouseMove(event) {
    const rect = this.getBoundingClientRect();
    // Normalize coordinates to [0,1]
    this.#mouseData[0] = (event.clientX - rect.left) / rect.width;
    this.#mouseData[1] = (event.clientY - rect.top) / rect.height;
    // If mouse is down, update click position too
    if (this.#isMouseDown) {
      this.#mouseData[2] = this.#mouseData[0];
      this.#mouseData[3] = this.#mouseData[1];
    }
  }

  #onMouseDown(event) {
    this.#isMouseDown = true;
    const rect = this.getBoundingClientRect();
    // Store click position
    this.#mouseData[2] = (event.clientX - rect.left) / rect.width;
    this.#mouseData[3] = (event.clientY - rect.top) / rect.height;
  }

  #onMouseUp() {
    this.#isMouseDown = false;
    // Make click position negative when mouse is up
    this.#mouseData[2] = -Math.abs(this.#mouseData[2]);
    this.#mouseData[3] = -Math.abs(this.#mouseData[3]);
  }

  #parseJSONWithStringNumbers(jsonString) {
    // Replace all numbers in the JSON string with quoted versions
    const quotedNumbers = jsonString.replace(
      /:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
      ': "$1"'
    );
    return JSON.parse(quotedNumbers);
  }
}

// Register the custom element
customElements.define("media-shader", MediaShader);
