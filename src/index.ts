import * as core from "@actions/core";
import { context, getOctokit } from "@actions/github";
import path from "path";
import * as exec from "@actions/exec";
import * as yaml from "js-yaml";
import * as fs from "fs";

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
  const lintPromises = diffingDirs.map(async it => {
    let lintCmdOptions: exec.ExecOptions = {}; 
    let lintStdout = "";
    lintCmdOptions.listeners = {
      stdout: (data: Buffer) => {
        lintStdout += data.toString();
      },
    };

    return exec.exec("helm", ["lint", it], lintCmdOptions)
            .catch(() => {
              core.error(`${it} lint failed`);
            }).finally(() => {
              core.info(lintStdout);
            });
  });
  await Promise.all(lintPromises);
  core.debug("Checked helm chart valid");

  core.debug("Install helm-push plugin");
  try {
    await exec.exec("helm plugin install https://github.com/chartmuseum/helm-push");
    core.debug("Installed helm-push plugin");
  } catch (err) {
    core.debug("Failed to install helm-push plugin: maybe already exists");
  }

  core.debug("Add chartmuseum");
  await exec.exec(`helm repo add chartmuseum ${chartmuseumUrl} --username ${chartmuseumUsername} --password ${chartmuseumPassword}`);
  core.debug("Added chartmuseum");

  core.debug("Build chart");
  const buildPromises = diffingDirs.map(async it => {
    let buildCmdOptions: exec.ExecOptions = {}; 
    let buildStderr = "";
    buildCmdOptions.listeners = {
      stderr: (data: Buffer) => {
        buildStderr += data.toString();
      },
    };

    return exec.exec("helm", ["dependency", "build",  it], buildCmdOptions)
            .catch(() => {
              core.error(buildStderr);
              core.setFailed(`${it} build failed`);
            });
  });
  await Promise.all(buildPromises);
  core.debug("Built chart")

  core.debug("Push chart");
  const pushPromises = diffingDirs.map(async it => {
    let pushCmdOptions: exec.ExecOptions = {}; 
    let pushStderr = "";
    pushCmdOptions.listeners = {
      stderr: (data: Buffer) => {
        pushStderr += data.toString();
      },
    };

    return exec.exec("helm", ["cm-push", it, "chartmuseum"], pushCmdOptions)
            .then(() => {
              const chartInfo: { name: string, version: string } = yaml.load(fs.readFileSync(`${it}/Chart.yaml`, 'utf-8')) as any;
              return octokit.rest.git.createRef({
                ...context.repo,
                ref: `refs/tags/${chartInfo.name}-${chartInfo.version}`,
                sha: context.payload["after"],
              });
            })
            .catch(() => {
              core.error(pushStderr);
              core.setFailed(`${it} push failed`);
            });
  });
  await Promise.all(pushPromises);
  core.debug("Pushed chart")
}

run();
