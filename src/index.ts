import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import path from "path";

async function run() {
  core.debug("Loading actions input");
  const githubToken = core.getInput("github-token");

  const chartmuseumUrl = core.getInput("chartmuseum-url", { required: true });
  const chartmuseumUsername = core.getInput("chartmuseum-username", { required: true });
  const chartmuseumPassword = core.getInput("chartmuseum-password", { required: true });

  core.debug("Loaded actions input");
  core.debug(JSON.stringify({ chartmuseumUrl, chartmuseumUsername, chartmuseumPassword }));

  core.debug("Checking event type");
  if (context.eventName !== "push") {
    throw new Error(`${context.eventName} not supported`);
  }

  core.debug("Build octokit");
  const octokit = getOctokit(githubToken);
  core.debug("Built octokit");
  core.debug("Request diff");
  const { data } = await octokit.rest.repos.compareCommits({
    ...context.repo,
    base: context.payload["before"],
    head: context.payload["after"],
  });
  core.debug("Requested diff");

  core.debug("Process diff");
  core.debug(JSON.stringify(data.files));
  const diffingFiles = data.files ?? [];
  const diffingDirs = diffingFiles.filter(it => it.filename.includes("Chart.yaml")).map(it => path.dirname(it.filename))
  core.debug("Processed diff");
  core.debug(JSON.stringify(diffingDirs));
}

run();
