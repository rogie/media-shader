# Media Shader

A powerful web component for applying WebGL shader effects to images and videos. This component makes it easy to add real-time shader effects to your media elements with minimal setup.

🎮 [Live Demo & Documentation](https://rogie.github.io/media-shader/)

## Features

- 🎨 Custom WebGL shader support
- 🖼️ Apply shaders to images and videos
- 🎮 Interactive mouse controls
- ⚡ Efficient rendering with WebGL
- 📱 Responsive design
- 🔄 Real-time updates
- 🎯 Lazy loading support
- ♿ Accessibility features

## Installation

```bash
npm install media-shader
```

## Usage

### Import the Component

```javascript
import "media-shader";
```

### Basic Example

```html
<!-- Apply default shader to an image -->
<media-shader src="path/to/your/image.jpg" width="400" height="300">
</media-shader>

<!-- Apply default shader to a video -->
<media-shader
  src="path/to/your/video.mp4"
  width="640"
  height="360"
  playing="true"
>
</media-shader>
```

### Custom Shader Example

```html
<media-shader
  src="path/to/your/media.jpg"
  fragment-shader="
    precision highp float;
    uniform sampler2D uTexture;
    uniform vec2 uResolution;
    uniform float uTime;
    varying vec2 vTexCoord;

    void main() {
      vec2 uv = vTexCoord;
      vec4 color = texture2D(uTexture, uv);
      // Add a simple wave effect
      color.rgb *= 0.8 + 0.2 * sin(uTime + uv.x * 10.0);
      gl_FragColor = color;
    }
  "
>
</media-shader>
```

### Custom Uniforms Example

```html
<media-shader
  src="path/to/your/media.jpg"
  uniforms='{"intensity": 1.0, "color": [1.0, 0.0, 0.0]}'
>
</media-shader>
```

## API Reference

### Attributes

| Attribute       | Type          | Default          | Description                          |
| --------------- | ------------- | ---------------- | ------------------------------------ |
| src             | string        | null             | URL of the image or video to display |
| fragment-shader | string        | (default shader) | GLSL fragment shader code            |
| width           | number        | null             | Width of the canvas in pixels        |
| height          | number        | null             | Height of the canvas in pixels       |
| uniforms        | string (JSON) | {}               | JSON string of uniform values        |
| playing         | boolean       | true             | Controls video playback              |
| alt             | string        | null             | Alternative text for accessibility   |
| loading         | string        | "lazy"           | Loading mode ('eager' or 'lazy')     |

### Built-in Uniforms

The following uniforms are automatically available in your shaders:

| Uniform     | Type      | Description                                           |
| ----------- | --------- | ----------------------------------------------------- |
| uTexture    | sampler2D | The media texture                                     |
| uResolution | vec2      | Canvas dimensions in pixels                           |
| uTime       | float     | Time in seconds since initialization                  |
| uMouse      | vec4      | Mouse position and click state [x, y, clickX, clickY] |
| uHasTexture | bool      | Whether a texture is currently loaded                 |

### Events

The component inherits standard HTMLElement events and adds:

- `play` - Fired when video playback starts
- `pause` - Fired when video playback pauses
- `loadeddata` - Fired when media data is loaded

## Performance Considerations

- The component uses `requestVideoFrameCallback` (with fallback to `requestAnimationFrame`) for optimal video performance
- Texture updates are synchronized with video frames
- The component supports lazy loading for better page performance
- WebGL context is managed efficiently with proper cleanup

## Browser Support

Supports all modern browsers with WebGL2 capability. Requires the following features:

- Custom Elements v1
- WebGL2
- ES6 Modules

## License

MIT License - See LICENSE file for details

## Author

Created by Rogie King
