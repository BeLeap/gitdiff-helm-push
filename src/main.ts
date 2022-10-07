import * as core from "@actions/core";
import { context } from "@actions/github";

async function run() {
  // Load acitons input
  const chartmuseumUrl = core.getInput("chartmuseum-url", { required: true });
  const chartmuseumUsername = core.getInput("chartmuseum-username", { required: true });
  const chartmuseumPassword = core.getInput("chartmuseum-password", { required: true });

  core.debug(JSON.stringify({ chartmuseumUrl, chartmuseumUsername, chartmuseumPassword }));

  switch (context.eventName) {
    case 'push':
      break;
    default:
      core.error(`${context.eventName} not supported`);
  }
}

run();
