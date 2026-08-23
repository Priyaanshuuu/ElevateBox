import { config } from "./config.ts";
import { createAgent } from "./agent.ts";

console.log("Starting Voice Sales Agent...");
console.log(`LiveKit server: ${config.livekitUrl}`);

createAgent();

console.log("Voice Sales Agent is running.");