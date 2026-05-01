import serverless from "serverless-http";
import { createApp, runStartupChecks } from "../../backend/src/app.js";

const app = createApp({ serveFrontend: false });
runStartupChecks();

export const handler = serverless(app);
