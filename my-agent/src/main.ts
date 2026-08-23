import { config } from "./config.js";
import { createAgent } from "./agent.js";

console.log("Starting Voice Sales Agent...");
console.log(`LiveKit server: ${config.livekitUrl}`);

createAgent();

console.log("Voice Sales Agent is running.");