import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";

async function run() {
  // Load acitons input
  const githubToken = core.getInput("github-token");
  
  const chartmuseumUrl = core.getInput("chartmuseum-url", { required: true });
  const chartmuseumUsername = core.getInput("chartmuseum-username", { required: true });
  const chartmuseumPassword = core.getInput("chartmuseum-password", { required: true });

  core.info(JSON.stringify({ chartmuseumUrl, chartmuseumUsername, chartmuseumPassword }));

  if (context.eventName !== "push") {
    throw new Error(`${context.eventName} not supported`);
  }

  const octokit = getOctokit(githubToken);
  const { data } = await octokit.rest.repos.compareCommits({
    ...context.repo,
    base: context.payload["before"],
    head: context.payload["after"],
  });

  core.info(JSON.stringify(data));
}

run();
