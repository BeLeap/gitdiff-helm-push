import * as core from "@actions/core";
import { context } from "@actions/github";

interface CustomContext {
  repo: {
    owner: string;
    repo: string;
  };
  before: string;
  after: string;
}

async function run() {
  // Load acitons input
  const chartmuseumUrl = core.getInput("chartmuseum-url", { required: true });
  const chartmuseumUsername = core.getInput("chartmuseum-username", { required: true });
  const chartmuseumPassword = core.getInput("chartmuseum-password", { required: true });

  core.info(JSON.stringify({ chartmuseumUrl, chartmuseumUsername, chartmuseumPassword }));

  let customContext: CustomContext;
  switch (context.eventName) {
    case 'push':
      customContext = {
        repo: context.repo,
        after: context.payload["after"],
        before: context.payload["before"],
      }
      break;
    default:
      throw new Error(`${context.eventName} not supported`);
  }

  core.info(JSON.stringify(customContext));
}

run();
