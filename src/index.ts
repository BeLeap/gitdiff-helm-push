import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import path from "path";

async function run() {
  // Load acitons input
  const githubToken = core.getInput("github-token");
  
  const chartmuseumUrl = core.getInput("chartmuseum-url", { required: true });
  const chartmuseumUsername = core.getInput("chartmuseum-username", { required: true });
  const chartmuseumPassword = core.getInput("chartmuseum-password", { required: true });

  core.debug(JSON.stringify({ chartmuseumUrl, chartmuseumUsername, chartmuseumPassword }));

  // Check event type
  if (context.eventName !== "push") {
    throw new Error(`${context.eventName} not supported`);
  }

  // Check diff
  const octokit = getOctokit(githubToken);
  const { data } = await octokit.rest.repos.compareCommits({
    ...context.repo,
    base: context.payload["before"],
    head: context.payload["after"],
  });
  core.debug(JSON.stringify(data));

  // Process diff
  const diffingFiles = data.files ?? [];
  const diffingDirs = diffingFiles.map(it => path.dirname(it.filename))

  core.info(JSON.stringify(diffingDirs));
}

run();
