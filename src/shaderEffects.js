// Collection of shader effects with their fragment shaders and default uniforms
export const shaderEffects = [
  {
    name: "ripple",
    fragmentShader: `
            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uFrequency;
            uniform float uAmplitude;
            uniform vec3 uColor;

            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                float dist = distance(uv, vec2(0.5));
                float wave = sin(dist * uFrequency - uTime) * uAmplitude;
                vec3 color = uColor * (1.0 + wave);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
    defaultUniforms: {
      uFrequency: 20.0,
      uAmplitude: 0.1,
      uColor: [1.0, 0.5, 0.2],
    },
  },
  {
    name: "noise",
    fragmentShader: `
            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uScale;
            uniform vec3 uColorA;
            uniform vec3 uColorB;

            // Simple pseudo-random function
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                float noise = random(uv + uTime * 0.1) * uScale;
                vec3 color = mix(uColorA, uColorB, noise);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
    defaultUniforms: {
      uScale: 0.5,
      uColorA: [0.1, 0.1, 0.4],
      uColorB: [0.8, 0.8, 1.0],
    },
  },
];

// Helper function to get effect by name
export const getEffectByName = (name) => {
  return shaderEffects.find((effect) => effect.name === name);
};
