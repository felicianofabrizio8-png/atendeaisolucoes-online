/** Pause hidden canvases and release observers when the conversation changes. */
export function attachGpuGate(canvas: HTMLCanvasElement) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    paused: document.hidden,
    reducedMotion: motion.matches,
    lowPower: matchMedia("(pointer: coarse)").matches || navigator.hardwareConcurrency <= 6,
  };
  let visible = true;
  const update = () => {
    state.paused = !visible || document.hidden;
  };
  const onMotion = () => {
    state.reducedMotion = motion.matches;
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    update();
  });
  observer.observe(canvas);
  document.addEventListener("visibilitychange", update);
  motion.addEventListener("change", onMotion);
  return {
    state,
    frameMs: state.lowPower ? 70 : 1000 / 30,
    dispose() {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      motion.removeEventListener("change", onMotion);
    },
  };
}
export function deferUntilVisible(element: Element, callback: () => void) {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        observer.disconnect();
        callback();
      }
    },
    { rootMargin: "200px" },
  );
  observer.observe(element);
  return () => observer.disconnect();
}
