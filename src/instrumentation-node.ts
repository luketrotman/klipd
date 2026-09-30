import { sweepRenders } from "./lib/video/clips";

// A few seconds after start: give every clip players can see a real MP4 if it does not have one.
setTimeout(() => {
  sweepRenders().catch((e) => console.error("[render sweep]", e));
}, 4000);
