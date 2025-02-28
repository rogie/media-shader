# ShaderViewer

A powerful and flexible WebGL shader viewer implemented as a custom web component. This project allows you to easily add interactive shader effects to your web applications, with support for both standalone shaders and shader effects applied to images or videos.

## Features

- 🎨 Custom WebGL shader support
- 🖼️ Apply shaders to images and videos
- 🎮 Interactive mouse controls
- ⚡ Efficient rendering with WebGL
- 📱 Responsive design
- 🔄 Real-time updates
- 🎯 Lazy loading support
- ♿ Accessibility features

## Usage

### Basic Implementation

Add the component to your HTML:

```html
<script src="media-shader.js"></script>

<media-shader
  width="300"
  height="200"
  fragment-shader="
    precision highp float;
    uniform float uTime;
    varying vec2 vTexCoord;

    void main() {
      vec2 uv = vTexCoord;
      vec3 color = 0.5 + 0.5 * cos(uTime + uv.xyx + vec3(0,2,4));
      gl_FragColor = vec4(color, 1.0);
    }
  "
></media-shader>
```

### Comprehensive Examples

#### Image with Shader Effect

Apply a ripple effect to an image:

```html
<media-shader
  src="path/to/your/image.jpg"
  width="400"
  height="300"
  alt="Ripple effect on landscape"
  fragment-shader="
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uTime;
    varying vec2 vTexCoord;

    void main() {
      vec2 uv = vTexCoord;
      float wave = sin(uv.x * 10.0 + uTime) * 0.01;
      vec2 distortedUV = vec2(uv.x, uv.y + wave);
      gl_FragColor = texture2D(uTexture, distortedUV);
    }
  "
></media-shader>
```

#### Video with Real-time Effects

Apply a color manipulation effect to a video:

```html
<media-shader
  src="path/to/your/video.mp4"
  width="640"
  height="360"
  playing
  alt="Color effect on video"
  fragment-shader="
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uTime;
    varying vec2 vTexCoord;

    void main() {
      vec4 texColor = texture2D(uTexture, vTexCoord);
      float r = texColor.r * (1.0 + sin(uTime) * 0.5);
      float g = texColor.g * (1.0 + cos(uTime) * 0.5);
      float b = texColor.b;
      gl_FragColor = vec4(r, g, b, texColor.a);
    }
  "
></media-shader>
```

#### Responsive Sizing

Make the shader component responsive to its container:

```html
<style>
  .shader-container {
    width: 100%;
    max-width: 800px;
    aspect-ratio: 16/9;
  }

  media-shader {
    width: 100% !important;
    height: 100% !important;
  }
</style>

<div class="shader-container">
  <media-shader width="800" height="450" fragment-shader="..."></media-shader>
</div>
```

#### Custom Uniforms

Pass custom data to your shader:

```html
<media-shader
  width="300"
  height="200"
  uniforms='{
    "uColor": [1.0, 0.0, 0.0],
    "uSpeed": 2.0,
    "uIntensity": 0.5
  }'
  fragment-shader="
    precision highp float;
    uniform vec3 uColor;
    uniform float uSpeed;
    uniform float uIntensity;
    uniform float uTime;
    varying vec2 vTexCoord;

    void main() {
      vec2 uv = vTexCoord;
      float pattern = sin(uv.x * 10.0 + uTime * uSpeed) * uIntensity;
      vec3 color = uColor * pattern;
      gl_FragColor = vec4(color, 1.0);
    }
  "
></media-shader>
```

#### Lazy Loading

Optimize performance with lazy loading:

```html
<media-shader
  src="path/to/large-image.jpg"
  width="800"
  height="600"
  loading="lazy"
  alt="Lazy loaded shader effect"
  fragment-shader="..."
></media-shader>
```

### Attributes

- `src`: URL of the image or video to apply shaders to
- `fragment-shader`: GLSL fragment shader code
- `width`: Canvas width in pixels
- `height`: Canvas height in pixels
- `uniforms`: JSON string of uniform values
- `playing`: Controls video playback (when media is video)
- `alt`: Alternative text for accessibility
- `loading`: Loading mode ('eager' or 'lazy')

### Built-in Uniforms

The component automatically provides several useful uniforms to your shaders:

- `uTime`: Elapsed time in seconds
- `uMouse`: Mouse position (x, y) and click state
- `uResolution`: Canvas dimensions
- `uTexture`: Input texture (when src is provided)
- `uHasTexture`: Boolean indicating if a texture is loaded

## Examples

The project includes several example shaders demonstrating various effects:

1. Plasma Wave - Interactive plasma effect with mouse influence
2. Fractal Spiral - Dynamic spiral patterns reacting to mouse movement
3. Mandelbrot Zoom - Interactive Mandelbrot set visualization
4. Neon Rings - Animated neon ring effect with mouse interaction

## Installation

1. Clone the repository:

```bash
git clone https://github.com/rogie/shader-media.git
```

2. Include the script in your HTML:

```html
<script src="media-shader.js"></script>
```

## Development

The project uses vanilla JavaScript and WebGL, with no external dependencies. The main component is implemented as a custom web component (`MediaShader`) that extends `HTMLElement`.

### Project Structure

- `media-shader.js` - Main component implementation
- `index.html` - Examples and documentation
- `src/` - Additional source files and utilities

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the MIT License.

## Author

Created by Rogie King
