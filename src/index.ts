import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import path from "path";
import * as exec from "@actions/exec";
import { stderr } from "process";

async function run() {
  core.debug("Loading actions input");
  const githubToken = core.getInput("github-token");

  const chartmuseumUrl = core.getInput("chartmuseum-url", { required: true });
  const chartmuseumUsername = core.getInput("chartmuseum-username", { required: true });
  const chartmuseumPassword = core.getInput("chartmuseum-password", { required: true });

  core.setSecret(chartmuseumPassword);

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

  core.debug("Install helm");
  await exec.exec("curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3");
  await exec.exec("chmod 700 get_helm.sh");
  await exec.exec("./get_helm.sh");
  core.debug("Installed helm");

  core.debug("Check helm chart valid");
  diffingDirs.forEach(async it => {
    let lintCmdOptions: exec.ExecOptions = {}; 
    let lintStdout = "";
    let lintStderr = "";
    lintCmdOptions.listeners = {
      stdout: (data: Buffer) => {
        lintStdout += data.toString();
      },
      stderr: (data: Buffer) => {
        lintStderr += data.toString();
      },
    };

    await exec.exec("helm", ["lint", it],lintCmdOptions)

    core.info(lintStdout);
    core.error(lintStderr);
  });
  core.debug("Checked helm chart valid");

  core.debug("Install helm-push plugin");
  await exec.exec("helm plugin install https://github.com/chartmuseum/helm-push");
  core.debug("Installed helm-push plugin");

  core.debug("Add chartmuseum");
  await exec.exec(`helm repo add chartmuseum ${chartmuseumUrl} --username ${chartmuseumUsername} --password ${chartmuseumPassword}`);
  core.debug("Added chartmuseum");

  core.debug("Push chart");
  diffingDirs.forEach(async it => {
    let pushCmdOptions: exec.ExecOptions = {}; 
    let pushStdout = "";
    let pushStderr = "";
    pushCmdOptions.listeners = {
      stdout: (data: Buffer) => {
        pushStdout += data.toString();
      },
      stderr: (data: Buffer) => {
        pushStderr += data.toString();
      },
    };

    await exec.exec("helm", ["cm-push", it, "chartmuseum"], pushCmdOptions)

    if (pushStderr !== "") {
      core.setFailed(`Failed to push ${it}`);
    }
    core.info(pushStdout);
  });
  core.debug("Pushed chart")
}

run();
