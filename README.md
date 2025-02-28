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
