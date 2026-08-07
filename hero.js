/**
 * Hero Premium Canvas Image Sequence Animation
 * Author: Sahrul Efendi Portfolio
 * Style: Apple, Vercel & Linear inspired.
 * Uses: ES6 Modules, OffscreenCanvas, ResizeObserver, IntersectionObserver, requestAnimationFrame
 */

// Configuration parameters
const CONFIG = {
  totalFrames: 240,
  fps: 30,
  sequencePath: 'sequence',
  prefix: 'frame_',
  ext: 'jpg',
  batchSize: 15 // Number of concurrent fetches during preloading
};

export class PremiumHero {
  constructor(canvasId, containerId, sectionId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.warn(`Canvas with id "${canvasId}" not found. PremiumHero initialization skipped.`);
      return;
    }
    
    this.ctx = this.canvas.getContext('2d');
    this.container = document.getElementById(containerId);
    this.section = document.getElementById(sectionId);
    
    this.frames = [];
    this.isPlaying = false;
    this.frameIndex = 0;
    this.lastTime = 0;
    this.interval = 1000 / CONFIG.fps;
    this.animationFrameId = null;
    this.isLoaded = false;
    
    // Double buffering detection
    this.useOffscreen = typeof window.OffscreenCanvas !== 'undefined';
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    
    this.initialize();
  }

  initialize() {
    // Setup Canvas Resize handler
    this.setupResizeHandler();
    
    // Setup Viewport Visibility Observer
    this.setupViewportObserver();
    
    // Setup Mouse parallax & glow tracking
    this.setupInteractivity();
    
    // Trigger Preloading
    const startPreload = () => {
      this.preloadFrames()
        .then(decodedBitmaps => {
          this.frames = decodedBitmaps;
          this.isLoaded = true;
          this.revealHero();
        })
        .catch(err => {
          console.error("Critical error preloading sequence frames:", err);
        });
    };

    if (typeof window.requestIdleCallback !== 'undefined') {
      window.requestIdleCallback(() => startPreload());
    } else {
      startPreload();
    }
  }

  /**
   * Preloads all sequence images.
   * Decodes using createImageBitmap for zero-latency main thread execution when drawing.
   */
  async preloadFrames() {
    const loaderPercentage = document.getElementById('loader-percentage');
    const loadingCircle = document.getElementById('loading-circle-progress');
    const total = CONFIG.totalFrames;
    let loadedCount = 0;
    const results = new Array(total);

    // Circumference of SVG circle loader = 2 * PI * r = 2 * 3.14159 * 40 = 251.2
    const circleStrokeOffset = 251.2;

    const updateProgress = (count) => {
      const percentage = Math.round((count / total) * 100);
      if (loaderPercentage) {
        loaderPercentage.textContent = `${percentage}%`;
      }
      if (loadingCircle) {
        const offset = circleStrokeOffset - (percentage / 100) * circleStrokeOffset;
        loadingCircle.style.strokeDashoffset = offset;
      }
    };

    // Load in concurrent batches to prevent socket exhaustion while maintaining speed
    for (let i = 1; i <= total; i += CONFIG.batchSize) {
      const batchPromises = [];
      
      for (let j = 0; j < CONFIG.batchSize && (i + j) <= total; j++) {
        const frameIndex = i + j;
        const filePath = `${CONFIG.sequencePath}/${CONFIG.prefix}${String(frameIndex).padStart(4, '0')}.${CONFIG.ext}`;
        
        batchPromises.push(
          fetch(filePath)
            .then(response => {
              if (!response.ok) throw new Error(`HTTP ${response.status} loading ${filePath}`);
              return response.blob();
            })
            .then(blob => {
              // Decode bitmap on worker thread using browser engine
              if (window.createImageBitmap) {
                return createImageBitmap(blob);
              } else {
                return new Promise((resolve, reject) => {
                  const img = new Image();
                  img.onload = () => resolve(img);
                  img.onerror = reject;
                  img.src = URL.createObjectURL(blob);
                });
              }
            })
            .then(bitmap => {
              results[frameIndex - 1] = bitmap;
              loadedCount++;
              updateProgress(loadedCount);
            })
            .catch(err => {
              console.error(`Frame loading failed on index ${frameIndex}:`, err);
              // Fallback to empty space placeholder or load static image reference
              results[frameIndex - 1] = null;
            })
        );
      }
      
      await Promise.all(batchPromises);
    }
    
    return results;
  }

  /**
   * Resizes canvas based on device pixel ratio (sharp rendering on Retina screen)
   */
  resize() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Logical display size
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    
    // Physical drawing pixels
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    // Sync Offscreen Canvas if used for double buffering
    if (this.useOffscreen) {
      if (!this.offscreenCanvas) {
        this.offscreenCanvas = new OffscreenCanvas(this.canvas.width, this.canvas.height);
        this.offscreenCtx = this.offscreenCanvas.getContext('2d');
      } else {
        this.offscreenCanvas.width = this.canvas.width;
        this.offscreenCanvas.height = this.canvas.height;
      }
    }
    
    // Draw current frame immediately upon resize to prevent brief blank screen
    if (this.isLoaded && this.frames[this.frameIndex]) {
      this.drawFrame(this.frames[this.frameIndex]);
    }
  }

  setupResizeHandler() {
    // ResizeObserver tracks actual container bounds smoothly
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(this.container);
    
    // Fallback for page loads
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * IntersectionObserver pauses the loop when the component is scrolled out of viewport
   */
  setupViewportObserver() {
    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          this.resumePlayback();
        } else {
          this.pausePlayback();
        }
      });
    }, { threshold: 0.05 });
    
    this.intersectionObserver.observe(this.section);
  }

  /**
   * Setup 3D Canvas tilt parallax, custom cursor glow positioning, and floating background circle drift.
   */
  setupInteractivity() {
    if (!this.section) return;
    
    const cursorGlow = document.getElementById('cursor-glow');
    const floatingCircles = document.querySelectorAll('.floating-blur-circle');
    const canvasBox = this.container;

    this.section.addEventListener('mousemove', (e) => {
      const rect = this.section.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // 1. Move Cursor Glow Spot
      if (cursorGlow) {
        cursorGlow.style.opacity = '1';
        cursorGlow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      
      // Relative values from center: -0.5 to 0.5
      const relX = (x / rect.width) - 0.5;
      const relY = (y / rect.height) - 0.5;
      
      // 2. Parallax 3D tilt on canvas container
      if (canvasBox) {
        const transX = relX * 18; // Max translate X: 18px
        const transY = relY * 12; // Max translate Y: 12px
        const rotX = relY * -6;    // Max rotate X: -6deg
        const rotY = relX * 6;     // Max rotate Y: 6deg
        
        canvasBox.style.transform = `translate3d(${transX}px, ${transY}px, 20px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
      }

      // 3. Float subtle background elements
      floatingCircles.forEach((circle, idx) => {
        const factor = (idx + 1) * 12;
        circle.style.transform = `translate3d(${relX * factor}px, ${relY * factor}px, 0)`;
      });
    });

    this.section.addEventListener('mouseleave', () => {
      if (cursorGlow) {
        cursorGlow.style.opacity = '0';
      }
      if (canvasBox) {
        canvasBox.style.transform = 'translate3d(0, 0, 0) rotateX(0) rotateY(0)';
      }
      floatingCircles.forEach(circle => {
        circle.style.transform = 'translate3d(0, 0, 0)';
      });
    });
  }

  /**
   * Draw the image bitmap to the canvas using a DPI-aware CSS-contained layout rules.
   * Eliminates top/bottom/left/right clipping (contain).
   */
  drawFrame(img) {
    if (!img) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    
    // Choose context based on double buffering setting
    const targetCtx = this.useOffscreen ? this.offscreenCtx : this.ctx;
    
    targetCtx.clearRect(0, 0, w, h);
    
    const imgWidth = img.width || img.naturalWidth;
    const imgHeight = img.height || img.naturalHeight;
    
    // "Contain" scaling math
    const ratio = Math.min(w / imgWidth, h / imgHeight);
    
    const renderWidth = imgWidth * ratio;
    const renderHeight = imgHeight * ratio;
    
    // Center it on canvas
    const x = (w - renderWidth) / 2;
    const y = (h - renderHeight) / 2;
    
    targetCtx.drawImage(img, x, y, renderWidth, renderHeight);
    
    // If double buffered, draw the buffer image to the screen canvas in a single operation
    if (this.useOffscreen) {
      this.ctx.clearRect(0, 0, w, h);
      this.ctx.drawImage(this.offscreenCanvas, 0, 0);
    }
  }

  /**
   * Delta-time animation loop at stable 30 FPS.
   */
  animate(timestamp) {
    if (!this.isPlaying) return;

    if (!this.lastTime) this.lastTime = timestamp;
    const delta = timestamp - this.lastTime;

    if (delta >= this.interval) {
      // Calculate index increment depending on delta
      const framesToAdvance = Math.floor(delta / this.interval);
      this.frameIndex = (this.frameIndex + framesToAdvance) % CONFIG.totalFrames;
      
      const currentImg = this.frames[this.frameIndex];
      if (currentImg) {
        this.drawFrame(currentImg);
      }
      
      // Keep frame remainders for sub-frame accuracy
      this.lastTime = timestamp - (delta % this.interval);
    }

    this.animationFrameId = requestAnimationFrame((t) => this.animate(t));
  }

  resumePlayback() {
    if (this.isPlaying || !this.isLoaded) return;
    this.isPlaying = true;
    this.lastTime = 0;
    this.animationFrameId = requestAnimationFrame((t) => this.animate(t));
  }

  pausePlayback() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  /**
   * Preload complete: Fade loader, add active anim styles, trigger typewriter and start rendering.
   */
  revealHero() {
    const loader = document.getElementById('hero-loader');
    if (loader) {
      loader.classList.add('fade-out');
    }
    
    setTimeout(() => {
      this.section.classList.add('hero-loaded');
      this.triggerTypewriter();
      this.resumePlayback();
    }, 400);
  }

  /**
   * Custom intro name typing effect when hero first loads
   */
  triggerTypewriter() {
    const nameEl = document.getElementById('hero-name-typewriter');
    if (!nameEl) return;
    
    const nameString = "Sahrul Efendi";
    nameEl.textContent = "";
    nameEl.classList.add('typewriter-cursor-blink');
    
    let charIndex = 0;
    const typeChar = () => {
      if (charIndex < nameString.length) {
        nameEl.textContent += nameString.charAt(charIndex);
        charIndex++;
        setTimeout(typeChar, 70 + Math.random() * 50); // Fluid typing speed
      } else {
        setTimeout(() => {
          nameEl.classList.remove('typewriter-cursor-blink');
        }, 1500); // Remove blinking cursor indicator after a brief pause
      }
    };
    
    setTimeout(typeChar, 600); // Wait for stagger fade transition to settle
  }
}

// Auto-initialize if DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PremiumHero('hero-canvas', 'hero-canvas-container', 'hero-section');
});
